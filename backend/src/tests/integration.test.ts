/**
 * Integration tests for end-to-end backend flows (Task 10.3).
 *
 * Tests the full pipeline paths with mocked AWS dependencies:
 * 1. Ingestion: EventBridge → fetch FIRMS → normalize → geocode → deduplicate → persist
 * 2. Risk calculation: trigger → read hotspots → weather → FWI → risk → persist → alerts
 * 3. API query: valid request → DynamoDB read → formatted response
 *
 * All tests are deterministic — no real AWS calls.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runIngestionPipeline,
  _resetConsecutiveFailures,
} from '../lambdas/firmsIngestion.handler.js';
import type { IngestionDependencies } from '../lambdas/firmsIngestion.handler.js';

import { runRiskCalculation } from '../lambdas/riskCalculation.handler.js';
import type { RiskCalculationDependencies } from '../lambdas/riskCalculation.handler.js';

import { createRiskProvincesHandler } from '../lambdas/api/riskProvinces.handler.js';
import { createHotspotsHandler } from '../lambdas/api/hotspots.handler.js';
import { createAlertsHandler } from '../lambdas/api/alerts.handler.js';

import type { HotspotItem, RiskScoreItem, AlertItem, IngestionMetaItem } from '../shared/types.js';
import type { NormalizedHotspot } from '../services/csvNormalizer.js';
import type { APIGatewayProxyEvent } from '../lambdas/api/apiUtils.js';

// ============================================
// Shared Test Data
// ============================================

const MOCK_CSV_HEADER = 'latitude,longitude,bright_ti4,acq_date,acq_time,satellite,confidence,frp';
const MOCK_CSV_ROWS = [
  '-31.4200,-64.4900,335.4,2024-01-15,1420,N,high,42.5',
  '-34.6037,-58.3816,298.1,2024-01-15,1435,T,nominal,28.0',
  '-27.4534,-59.0153,310.7,2024-01-15,1440,N,high,55.2',
].join('\n');
const MOCK_CSV = `${MOCK_CSV_HEADER}\n${MOCK_CSV_ROWS}\n`;

const VALID_API_KEY = 'test-api-key-for-integration-tests';

function makeApiEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    headers: { 'x-api-key': VALID_API_KEY },
    body: null,
    pathParameters: null,
    queryStringParameters: null,
    ...overrides,
  };
}

// ============================================
// 1. INGESTION PIPELINE INTEGRATION TEST
// ============================================

describe('Integration: Ingestion Pipeline', () => {
  beforeEach(() => {
    _resetConsecutiveFailures();
    process.env.API_KEYS = VALID_API_KEY;
  });

  it('full pipeline: fetch → normalize → geocode → deduplicate → persist hotspots → write metadata', async () => {
    // Track all side effects
    const persisted: { hotspots: HotspotItem[]; meta: IngestionMetaItem | null } = {
      hotspots: [],
      meta: null,
    };
    let s3Saved = false;
    let s3Key = '';

    const deps: IngestionDependencies = {
      fetchFirms: async () => ({
        success: true as const,
        csvData: MOCK_CSV,
        rawLength: MOCK_CSV.length,
      }),
      saveToS3: async (_data: string, key: string) => {
        s3Saved = true;
        s3Key = key;
      },
      normalize: (csvData: string) => {
        const lines = csvData.trim().split('\n').slice(1); // skip header
        const hotspots: NormalizedHotspot[] = lines.map((line, idx) => {
          const [lat, lng, brightness, date, time, sat, conf] = line.split(',');
          return {
            id: `hotspot-${idx}`,
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            brightness: parseFloat(brightness),
            confidence: conf === 'high' ? 95 : 75,
            date: `${date}T${time.slice(0, 2)}:${time.slice(2)}:00.000Z`,
            satellite: (sat === 'N' ? 'VIIRS' : 'MODIS') as 'VIIRS' | 'MODIS',
          };
        });
        return {
          hotspots,
          rawEntries: lines.length,
          discarded: 0,
          discardReasons: [],
        };
      },
      initGeocoder: () => {},
      geocode: (lat: number, lng: number) => {
        // Simple mock geocoder based on known coordinates
        if (lat > -32 && lat < -31) return 'Córdoba';
        if (lat > -35 && lat < -34) return 'Buenos Aires';
        if (lat > -28 && lat < -27) return 'Chaco';
        return 'Buenos Aires';
      },
      deduplicate: (hotspots: NormalizedHotspot[]) => ({
        hotspots,
        inputCount: hotspots.length,
        outputCount: hotspots.length,
        discardedCount: 0,
        duplicateCount: 0,
        discardReasons: [],
      }),
      persistHotspots: async (items: HotspotItem[]) => {
        persisted.hotspots = items;
        return { written: items.length, rejected: 0, errors: [] };
      },
      persistMeta: async (item: IngestionMetaItem) => {
        persisted.meta = item;
      },
    };

    const result = await runIngestionPipeline(deps);

    // Verify pipeline completed successfully
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.source, 'FIRMS_API');

    // Verify S3 raw save was called
    assert.strictEqual(s3Saved, true);
    assert.ok(s3Key.startsWith('firms-raw/'));

    // Verify hotspots were persisted to DynamoDB
    assert.strictEqual(persisted.hotspots.length, 3);

    // Verify each hotspot item has correct DynamoDB key structure
    for (const item of persisted.hotspots) {
      assert.ok(item.PK.startsWith('HOTSPOT#'));
      assert.ok(item.SK.startsWith('TS#'));
      assert.ok(item.GSI1PK.startsWith('DATE#'));
      assert.ok(item.GSI1SK.startsWith('PROV#'));
      assert.ok(item.lat >= -56 && item.lat <= -21);
      assert.ok(item.lng >= -74 && item.lng <= -53);
      assert.ok(item.TTL > 0);
      assert.ok(['VIIRS', 'MODIS'].includes(item.satellite));
      assert.ok(item.province.length > 0);
    }

    // Verify provinces were assigned via geocoder
    const provinces = persisted.hotspots.map(h => h.province);
    assert.ok(provinces.includes('Córdoba'));
    assert.ok(provinces.includes('Buenos Aires'));
    assert.ok(provinces.includes('Chaco'));

    // Verify ingestion metadata was written
    assert.ok(persisted.meta !== null);
    assert.strictEqual(persisted.meta!.PK, 'META#INGESTION');
    assert.ok(persisted.meta!.SK.startsWith('RUN#'));
    assert.strictEqual(persisted.meta!.rawEntries, 3);
    assert.strictEqual(persisted.meta!.finalCount, 3);
    assert.strictEqual(persisted.meta!.duplicatesRemoved, 0);
    assert.strictEqual(persisted.meta!.source, 'FIRMS_API');
    assert.ok(persisted.meta!.duration_ms >= 0);
  });

  it('pipeline handles FIRMS API failure gracefully — records fallback metadata', async () => {
    let metaWritten: IngestionMetaItem | null = null;

    const deps: IngestionDependencies = {
      fetchFirms: async () => ({
        success: false as const,
        reason: 'timeout' as const,
        message: 'Request timed out after 6000ms',
      }),
      saveToS3: async () => {},
      normalize: () => ({ hotspots: [], rawEntries: 0, discarded: 0, discardReasons: [] }),
      initGeocoder: () => {},
      geocode: () => null,
      deduplicate: (h: NormalizedHotspot[]) => ({
        hotspots: h,
        inputCount: 0,
        outputCount: 0,
        discardedCount: 0,
        duplicateCount: 0,
        discardReasons: [],
      }),
      persistHotspots: async () => ({ written: 0, rejected: 0, errors: [] }),
      persistMeta: async (item: IngestionMetaItem) => { metaWritten = item; },
    };

    const result = await runIngestionPipeline(deps);

    assert.strictEqual(result.statusCode, 202);
    assert.strictEqual(result.body.source, 'FALLBACK_CACHE');
    assert.ok(metaWritten !== null);
    assert.strictEqual(metaWritten!.source, 'FALLBACK_CACHE');
  });

  it('pipeline deduplication removes duplicates and preserves unique hotspots', async () => {
    let persistedCount = 0;

    const deps: IngestionDependencies = {
      fetchFirms: async () => ({
        success: true as const,
        csvData: MOCK_CSV,
        rawLength: MOCK_CSV.length,
      }),
      saveToS3: async () => {},
      normalize: () => ({
        hotspots: [
          { id: 'h1', lat: -31.42, lng: -64.49, brightness: 335, confidence: 95, date: '2024-01-15T14:20:00Z', satellite: 'VIIRS' as const },
          { id: 'h2', lat: -31.421, lng: -64.491, brightness: 330, confidence: 80, date: '2024-01-15T14:21:00Z', satellite: 'VIIRS' as const }, // duplicate of h1
          { id: 'h3', lat: -34.60, lng: -58.38, brightness: 298, confidence: 75, date: '2024-01-15T14:35:00Z', satellite: 'MODIS' as const }, // unique
        ],
        rawEntries: 3,
        discarded: 0,
        discardReasons: [],
      }),
      initGeocoder: () => {},
      geocode: () => 'Buenos Aires',
      deduplicate: (hotspots: NormalizedHotspot[]) => ({
        // Simulate dedup: h1 and h2 are too close, keep h1 (higher confidence)
        hotspots: [hotspots[0], hotspots[2]],
        inputCount: 3,
        outputCount: 2,
        discardedCount: 1,
        duplicateCount: 1,
        discardReasons: ['spatial_temporal_duplicate'],
      }),
      persistHotspots: async (items: HotspotItem[]) => {
        persistedCount = items.length;
        return { written: items.length, rejected: 0, errors: [] };
      },
      persistMeta: async () => {},
    };

    const result = await runIngestionPipeline(deps);

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.deduplicatedRows, 2);
    assert.strictEqual(result.body.duplicateCount, 1);
    assert.strictEqual(persistedCount, 2);
  });
});

// ============================================
// 2. RISK CALCULATION PIPELINE INTEGRATION TEST
// ============================================

describe('Integration: Risk Calculation Pipeline', () => {
  it('full pipeline: read hotspots → fetch weather → calculate FWI → evaluate risk → persist → generate alert', async () => {
    // Track persisted items and SNS publishes
    const persisted: { riskScores: RiskScoreItem[]; alerts: AlertItem[] } = {
      riskScores: [],
      alerts: [],
    };
    const snsMessages: string[] = [];

    const today = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();

    const mockHotspots: HotspotItem[] = [
      {
        PK: 'HOTSPOT#cordoba-1' as `HOTSPOT#${string}`,
        SK: `TS#${nowIso}#h1` as `TS#${string}#${string}`,
        GSI1PK: `DATE#${today}` as `DATE#${string}`,
        GSI1SK: 'PROV#Córdoba' as `PROV#${string}`,
        lat: -31.42,
        lng: -64.49,
        brightness: 335.4,
        confidence: 95,
        satellite: 'VIIRS',
        province: 'Córdoba',
        TTL: Math.floor(Date.now() / 1000) + 86400,
      },
      {
        PK: 'HOTSPOT#cordoba-2' as `HOTSPOT#${string}`,
        SK: `TS#${nowIso}#h2` as `TS#${string}#${string}`,
        GSI1PK: `DATE#${today}` as `DATE#${string}`,
        GSI1SK: 'PROV#Córdoba' as `PROV#${string}`,
        lat: -31.45,
        lng: -64.50,
        brightness: 310.0,
        confidence: 85,
        satellite: 'MODIS',
        province: 'Córdoba',
        TTL: Math.floor(Date.now() / 1000) + 86400,
      },
    ];

    const deps: RiskCalculationDependencies = {
      queryHotspotsByProvince: async (province: string, date: string) => {
        // Only return hotspots for "today" query to avoid doubling
        if (province === 'Córdoba' && date === new Date().toISOString().slice(0, 10)) return mockHotspots;
        return [];
      },
      fetchWeather: async (_province: string) => ({
        data: {
          temperature: 38,          // Very hot
          relativeHumidity: 15,     // Very dry
          windSpeed: 45,            // High wind
          windDir: 'N',
          rain24h: 0,              // No rain
        },
        stale: false,
      }),
      calculateFWI: (weather) => ({
        success: true as const,
        fwi: 82,
        errors: [],
      }),
      evaluateRisk: (input) => ({
        riskScore: 85,
        riskLevel: 'Extremo' as const,
        explanation: 'Temperatura extrema (38°C), humedad crítica (15%), viento fuerte (45 km/h), sin precipitaciones, 2 focos activos.',
        confidenceScore: 90,
      }),
      calculateConfidence: (_input, _stale) => ({
        confidenceScore: 88,
        factors: [],
      }),
      putRiskScore: async (item: RiskScoreItem) => {
        persisted.riskScores.push(item);
      },
      putAlert: async (item: AlertItem) => {
        persisted.alerts.push(item);
      },
      publishToSNS: async (message: string, _topicArn: string) => {
        snsMessages.push(message);
      },
    };

    process.env.ALERTS_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789:FireRiskEngine-CriticalAlerts';
    const result = await runRiskCalculation(deps);

    // Verify overall result
    assert.strictEqual(result.statusCode, 200);
    assert.ok(result.body.provincesProcessed >= 1);
    assert.ok(result.body.alertsGenerated >= 1);

    // Verify risk score was persisted for Córdoba
    const cordobaRisk = persisted.riskScores.find(r => r.SK === 'PROVINCE#Córdoba');
    assert.ok(cordobaRisk !== undefined);
    assert.strictEqual(cordobaRisk!.PK, 'RISK#CURRENT');
    assert.strictEqual(cordobaRisk!.riskLevel, 'Extremo');
    assert.strictEqual(cordobaRisk!.riskScore, 85);
    assert.strictEqual(cordobaRisk!.activeHotspotsCount, 2);
    assert.ok(cordobaRisk!.lastUpdated.length > 0);
    assert.strictEqual(cordobaRisk!.weatherStale, false);

    // Verify GSI1 keys for severity-based queries
    assert.strictEqual(cordobaRisk!.GSI1PK, 'RISKLEVEL#Extremo');
    assert.ok(cordobaRisk!.GSI1SK.startsWith('SCORE#'));

    // Verify alert was generated (severity Extremo ≥ Alto)
    assert.ok(persisted.alerts.length >= 1);
    const cordobaAlert = persisted.alerts.find(a => a.locationName === 'Córdoba');
    assert.ok(cordobaAlert !== undefined);
    assert.ok(cordobaAlert!.PK.startsWith('ALERT#'));
    assert.ok(cordobaAlert!.SK.startsWith('TS#'));
    assert.strictEqual(cordobaAlert!.type, 'Incendio');
    assert.strictEqual(cordobaAlert!.severity, 'Crítico'); // Extremo maps to Crítico
    assert.ok(cordobaAlert!.TTL > 0);

    // Verify SNS publish was called
    assert.ok(snsMessages.length >= 1);
    const cordobaPayload = snsMessages.map(m => JSON.parse(m)).find(p => p.locationName === 'Córdoba');
    assert.ok(cordobaPayload !== undefined);
    assert.strictEqual(cordobaPayload.locationName, 'Córdoba');
  });

  it('processes all 24 provinces even with no hotspot activity', async () => {
    const persisted: RiskScoreItem[] = [];

    const deps: RiskCalculationDependencies = {
      queryHotspotsByProvince: async () => [], // No hotspots anywhere
      fetchWeather: async () => ({
        data: { temperature: 25, relativeHumidity: 60, windSpeed: 10, windDir: 'S', rain24h: 5 },
        stale: false,
      }),
      calculateFWI: () => ({ success: true as const, fwi: 20, errors: [] }),
      evaluateRisk: () => ({ riskScore: 15, riskLevel: 'Bajo' as const, explanation: 'Low risk', confidenceScore: 90 }),
      calculateConfidence: () => ({ confidenceScore: 90, factors: [] }),
      putRiskScore: async (item: RiskScoreItem) => { persisted.push(item); },
      putAlert: async () => {},
      publishToSNS: async () => {},
    };

    const result = await runRiskCalculation(deps);

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.provincesProcessed, 24);
    assert.strictEqual(result.body.alertsGenerated, 0);
    assert.strictEqual(persisted.length, 24);
  });

  it('does not generate alert when risk level is below Alto', async () => {
    const alerts: AlertItem[] = [];
    const snsMessages: string[] = [];

    const deps: RiskCalculationDependencies = {
      queryHotspotsByProvince: async (province: string) => {
        if (province === 'Mendoza') return [{
          PK: 'HOTSPOT#mza-1' as `HOTSPOT#${string}`,
          SK: 'TS#2024-01-15T10:00:00Z#h1' as `TS#${string}#${string}`,
          GSI1PK: 'DATE#2024-01-15' as `DATE#${string}`,
          GSI1SK: 'PROV#Mendoza' as `PROV#${string}`,
          lat: -32.89, lng: -68.84, brightness: 280, confidence: 70,
          satellite: 'VIIRS' as const, province: 'Mendoza',
          TTL: Math.floor(Date.now() / 1000) + 86400,
        }];
        return [];
      },
      fetchWeather: async () => ({
        data: { temperature: 22, relativeHumidity: 55, windSpeed: 12, windDir: 'O', rain24h: 2 },
        stale: false,
      }),
      calculateFWI: () => ({ success: true as const, fwi: 25, errors: [] }),
      evaluateRisk: () => ({
        riskScore: 35,
        riskLevel: 'Medio' as const,  // Below 'Alto' threshold
        explanation: 'Moderate conditions',
        confidenceScore: 85,
      }),
      calculateConfidence: () => ({ confidenceScore: 85, factors: [] }),
      putRiskScore: async () => {},
      putAlert: async (item: AlertItem) => { alerts.push(item); },
      publishToSNS: async (msg: string) => { snsMessages.push(msg); },
    };

    const result = await runRiskCalculation(deps);

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.provincesProcessed, 24);
    assert.strictEqual(result.body.alertsGenerated, 0);
    assert.strictEqual(alerts.length, 0);
    assert.strictEqual(snsMessages.length, 0);
  });
});

// ============================================
// 3. API QUERY PIPELINE INTEGRATION TEST
// ============================================

describe('Integration: API Query Pipeline', () => {
  beforeEach(() => {
    process.env.API_KEYS = VALID_API_KEY;
  });

  it('GET /risk/provinces — returns formatted risk scores for all provinces with activity', async () => {
    const mockRiskScores: RiskScoreItem[] = [
      {
        PK: 'RISK#CURRENT',
        SK: 'PROVINCE#Córdoba' as `PROVINCE#${string}`,
        GSI1PK: 'RISKLEVEL#Alto' as `RISKLEVEL#${string}`,
        GSI1SK: 'SCORE#065' as `SCORE#${string}`,
        riskScore: 65,
        riskLevel: 'Alto',
        activeHotspotsCount: 3,
        trend: 'up',
        explanation: 'High fire danger in Córdoba',
        confidenceScore: 88,
        lastUpdated: '2024-01-15T15:00:00.000Z',
        weatherStale: false,
      },
      {
        PK: 'RISK#CURRENT',
        SK: 'PROVINCE#Mendoza' as `PROVINCE#${string}`,
        GSI1PK: 'RISKLEVEL#Bajo' as `RISKLEVEL#${string}`,
        GSI1SK: 'SCORE#020' as `SCORE#${string}`,
        riskScore: 20,
        riskLevel: 'Bajo',
        activeHotspotsCount: 0,
        trend: 'stable',
        explanation: 'Low risk in Mendoza',
        confidenceScore: 92,
        lastUpdated: '2024-01-15T15:00:00.000Z',
        weatherStale: false,
      },
    ];

    const handler = createRiskProvincesHandler({
      getAllRiskScores: async () => mockRiskScores,
    });

    const event = makeApiEvent();
    const response = await handler(event);

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);

    // Verify array format
    assert.ok(Array.isArray(body));
    assert.strictEqual(body.length, 2);

    // Verify first province data structure
    const cordoba = body.find((p: any) => p.provinceName === 'Córdoba');
    assert.ok(cordoba !== undefined);
    assert.strictEqual(cordoba.riskScore, 65);
    assert.strictEqual(cordoba.riskLevel, 'Alto');
    assert.strictEqual(cordoba.activeHotspotsCount, 3);
    assert.strictEqual(cordoba.trend, 'up');
    assert.strictEqual(cordoba.lastUpdated, '2024-01-15T15:00:00.000Z');
    assert.strictEqual(cordoba.confidenceScore, 88);
  });

  it('GET /hotspots — returns formatted active hotspots', async () => {
    const mockHotspots: HotspotItem[] = [
      {
        PK: 'HOTSPOT#cord-1' as `HOTSPOT#${string}`,
        SK: 'TS#2024-01-15T14:20:00.000Z#h1' as `TS#${string}#${string}`,
        GSI1PK: 'DATE#2024-01-15' as `DATE#${string}`,
        GSI1SK: 'PROV#Córdoba' as `PROV#${string}`,
        lat: -31.42,
        lng: -64.49,
        brightness: 335.4,
        confidence: 95,
        satellite: 'VIIRS',
        province: 'Córdoba',
        TTL: Math.floor(Date.now() / 1000) + 86400,
      },
    ];

    const handler = createHotspotsHandler({
      queryRecentHotspots: async () => mockHotspots,
    });

    const event = makeApiEvent();
    const response = await handler(event);

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);

    assert.ok(Array.isArray(body));
    assert.strictEqual(body.length, 1);
    assert.strictEqual(body[0].lat, -31.42);
    assert.strictEqual(body[0].lng, -64.49);
    assert.strictEqual(body[0].brightness, 335.4);
    assert.strictEqual(body[0].confidence, 95);
    assert.strictEqual(body[0].satellite, 'VIIRS');
    assert.strictEqual(body[0].province, 'Córdoba');
    assert.ok(body[0].date.includes('2024-01-15'));
  });

  it('GET /alerts — returns formatted alerts by severity', async () => {
    const mockAlerts: AlertItem[] = [
      {
        PK: 'ALERT#Córdoba' as `ALERT#${string}`,
        SK: 'TS#2024-01-15T15:00:00Z#alert-1' as `TS#${string}#${string}`,
        GSI1PK: 'SEVERITY#Crítico' as `SEVERITY#${string}`,
        GSI1SK: 'TS#2024-01-15T15:00:00Z' as `TS#${string}`,
        title: 'Alerta de incendio - Córdoba',
        description: 'Condiciones extremas de incendio',
        severity: 'Crítico',
        type: 'Incendio',
        locationName: 'Córdoba',
        coordinates: { lat: -31.42, lng: -64.18 },
        radius: 50,
        TTL: Math.floor(Date.now() / 1000) + 604800,
      },
    ];

    const handler = createAlertsHandler({
      queryAlerts: async () => mockAlerts,
    });

    const event = makeApiEvent();
    const response = await handler(event);

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);

    assert.ok(Array.isArray(body));
    assert.strictEqual(body.length, 1);
    assert.strictEqual(body[0].title, 'Alerta de incendio - Córdoba');
    assert.strictEqual(body[0].severity, 'Crítico');
    assert.strictEqual(body[0].type, 'Incendio');
    assert.strictEqual(body[0].locationName, 'Córdoba');
    assert.deepStrictEqual(body[0].coordinates, { lat: -31.42, lng: -64.18 });
    assert.strictEqual(body[0].radius, 50);
  });

  it('API returns 403 for invalid API key', async () => {
    const handler = createRiskProvincesHandler({
      getAllRiskScores: async () => [],
    });

    const event = makeApiEvent({ headers: { 'x-api-key': 'invalid-key' } });
    const response = await handler(event);

    assert.strictEqual(response.statusCode, 403);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.error, 'Forbidden');
  });

  it('API returns 403 for missing API key', async () => {
    const handler = createHotspotsHandler({
      queryRecentHotspots: async () => [],
    });

    const event = makeApiEvent({ headers: {} });
    const response = await handler(event);

    assert.strictEqual(response.statusCode, 403);
  });

  it('API returns 500 on internal error without exposing details', async () => {
    const handler = createAlertsHandler({
      queryAlerts: async () => { throw new Error('DynamoDB connection timeout'); },
    });

    const event = makeApiEvent();
    const response = await handler(event);

    assert.strictEqual(response.statusCode, 500);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.error, 'Internal server error');
    // Verify no internal details leaked
    assert.ok(!response.body.includes('DynamoDB'));
    assert.ok(!response.body.includes('timeout'));
  });
});
