/**
 * Tests for risk context (trend, history, critical alerts, de-dup, zones),
 * hotspot enrichment, health report, SES retry and persisted FIRMS failures.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  computeTrend,
  updateDailyHotspotCounts,
  historicalFireCount,
  hasRecentCriticalAlert,
  isDuplicateAlert,
  buildRiskZones,
} from '../services/riskContext.js';
import { withRetry } from '../shared/retry.js';
import { buildHealthReport } from '../lambdas/api/health.handler.js';
import { createHotspotsHandler } from '../lambdas/api/hotspots.handler.js';
import { runRiskCalculation } from '../lambdas/riskCalculation.handler.js';
import type { RiskCalculationDependencies } from '../lambdas/riskCalculation.handler.js';
import { calculateFWI } from '../services/fwiCalculator.js';
import { evaluateFireRisk, calculateConfidence } from '../services/riskEvaluator.js';
import type { AlertItem, HotspotItem, RiskScoreItem, RiskZoneItem, IngestionMetaItem } from '../shared/types.js';

process.env.API_KEYS = 'test-key';

function alert(severity: AlertItem['severity'], ageMs: number, now: number): AlertItem {
  const iso = new Date(now - ageMs).toISOString();
  return {
    PK: 'ALERT#Córdoba', SK: `TS#${iso}#x`, GSI1PK: `SEVERITY#${severity}`, GSI1SK: `TS#${iso}`,
    title: 't', description: 'd', severity, type: 'Incendio', locationName: 'Córdoba',
    coordinates: { lat: -31, lng: -64 }, radius: 50, TTL: 0,
  };
}

function score(province: string, extra: Partial<RiskScoreItem> = {}): RiskScoreItem {
  return {
    PK: 'RISK#CURRENT', SK: `PROVINCE#${province}`, GSI1PK: 'RISKLEVEL#Alto', GSI1SK: 'SCORE#060',
    riskScore: 60, riskLevel: 'Alto', activeHotspotsCount: 1, trend: 'stable', explanation: '',
    confidenceScore: 80, lastUpdated: new Date().toISOString(), weatherStale: false, ...extra,
  };
}

describe('computeTrend', () => {
  it('is stable without a previous score', () => assert.equal(computeTrend(undefined, 80), 'stable'));
  it('detects up/down/stable around the threshold', () => {
    assert.equal(computeTrend(50, 56), 'up');
    assert.equal(computeTrend(50, 44), 'down');
    assert.equal(computeTrend(50, 53), 'stable');
  });
  it('property: sign of trend matches sign of delta', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), (a, b) => {
      const t = computeTrend(a, b);
      if (t === 'up') return b > a;
      if (t === 'down') return b < a;
      return Math.abs(b - a) < 5;
    }));
  });
});

describe('rolling fire history', () => {
  it('keeps the max for today and drops entries older than 7 days', () => {
    const h = updateDailyHotspotCounts({ '2026-01-01': 9, '2026-01-09': 3, '2026-01-10': 5 }, '2026-01-10', 2);
    assert.deepEqual(h, { '2026-01-09': 3, '2026-01-10': 5 });
    assert.equal(historicalFireCount(h, '2026-01-10'), 3);
  });
  it('starts empty history with today only', () => {
    assert.deepEqual(updateDailyHotspotCounts(undefined, '2026-01-10', 4), { '2026-01-10': 4 });
  });
});

describe('critical alerts and de-duplication', () => {
  const now = Date.now();
  it('detects a critical alert in the last 24h only', () => {
    assert.equal(hasRecentCriticalAlert([alert('Crítico', 3_600_000, now)], now), true);
    assert.equal(hasRecentCriticalAlert([alert('Crítico', 25 * 3_600_000, now)], now), false);
    assert.equal(hasRecentCriticalAlert([alert('Alto', 60_000, now)], now), false);
  });
  it('suppresses same-or-lower severity within 6h, allows escalation', () => {
    const recent = [alert('Alto', 3_600_000, now)];
    assert.equal(isDuplicateAlert(recent, 'Alto', now), true);
    assert.equal(isDuplicateAlert(recent, 'Crítico', now), false);
    assert.equal(isDuplicateAlert([alert('Alto', 7 * 3_600_000, now)], 'Alto', now), false);
  });
});

describe('buildRiskZones', () => {
  it('creates one cell per 1° square with hotspot boost and valid levels', () => {
    const zones = buildRiskZones([
      { province: 'Córdoba', fwi: 40, centroid: { lat: -31.4, lng: -64.2 }, hotspots: [{ lat: -31.5, lng: -64.5 }, { lat: -31.1, lng: -64.9 }] },
      { province: 'Salta', fwi: 10, hotspots: [] },
    ], '2026-01-10T00:00:00.000Z');
    assert.equal(zones.length, 1);
    const [z] = zones;
    assert.equal(z.PK, 'RISK#ZONES');
    assert.equal(z.hotspotsInCell, 2);
    assert.equal(z.fwi, 50);
    assert.deepEqual(z.bounds, [[-32, -65], [-31, -64]]);
    assert.ok(z.TTL && z.TTL > 0);
  });
  it('property: fwi stays within [0,100]', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 100 }),
      fc.array(fc.record({ lat: fc.double({ min: -55, max: -22, noNaN: true }), lng: fc.double({ min: -73, max: -54, noNaN: true }) }), { maxLength: 30 }),
      (fwi, hotspots) => buildRiskZones([{ province: 'X', fwi, hotspots }]).every((z) => z.fwi >= 0 && z.fwi <= 100),
    ));
  });
});

describe('withRetry (SES backoff 1s → 2s → 4s)', () => {
  it('retries 3 times with exponential delays then throws', async () => {
    const waits: number[] = [];
    let calls = 0;
    await assert.rejects(withRetry(async () => { calls++; throw new Error('throttled'); }, undefined, async (ms) => { waits.push(ms); }));
    assert.equal(calls, 4);
    assert.deepEqual(waits, [1000, 2000, 4000]);
  });
  it('returns as soon as an attempt succeeds', async () => {
    let calls = 0;
    const r = await withRetry(async () => { calls++; if (calls < 2) throw new Error('x'); return 'ok'; }, undefined, async () => {});
    assert.equal(r, 'ok');
    assert.equal(calls, 2);
  });
});

describe('buildHealthReport', () => {
  const now = Date.parse('2026-01-10T12:00:00.000Z');
  const meta = (source: IngestionMetaItem['source'], iso: string): IngestionMetaItem => ({
    PK: 'META#INGESTION', SK: `RUN#${iso}`, rawEntries: 1, finalCount: 1, duplicatesRemoved: 0, source, duration_ms: 1, TTL: 0,
  });
  it('is healthy when every source is fresh', () => {
    const r = buildHealthReport(meta('FIRMS_API', '2026-01-10T11:50:00.000Z'), [score('A', { lastUpdated: '2026-01-10T11:40:00.000Z' })], now);
    assert.equal(r.status, 'healthy');
    assert.equal(r.services.firms.status, 'ok');
  });
  it('reports FIRMS down on fallback and weather degraded on partial staleness', () => {
    const r = buildHealthReport(meta('FALLBACK_CACHE', '2026-01-10T11:50:00.000Z'), [score('A', { lastUpdated: '2026-01-10T11:40:00.000Z' }), score('B', { weatherStale: true, lastUpdated: '2026-01-10T11:40:00.000Z' })], now);
    assert.equal(r.status, 'degraded');
    assert.equal(r.services.firms.status, 'down');
    assert.equal(r.services.weather.status, 'degraded');
  });
  it('is unknown/degraded without data', () => {
    const r = buildHealthReport(null, null, now);
    assert.equal(r.status, 'degraded');
    assert.equal(r.services.firms.status, 'unknown');
  });
});

describe('hotspot enrichment', () => {
  it('uses province FWI/wind for dangerLevel and area instead of placeholders', async () => {
    const h: HotspotItem = {
      PK: 'HOTSPOT#Córdoba', SK: 'TS#2026-01-10T10:00:00Z#-31.5#-64.5', GSI1PK: 'DATE#2026-01-10', GSI1SK: 'PROV#Córdoba',
      lat: -31.5, lng: -64.5, brightness: 360, confidence: 90, satellite: 'VIIRS', province: 'Córdoba', TTL: 0,
    } as HotspotItem;
    const handler = createHotspotsHandler({
      queryRecentHotspots: async () => [h, { ...h, lng: -64.52 }],
      queryRiskScores: async () => [score('Córdoba', { fwi: 70, windSpeed: 30 })],
    });
    const res = await handler({ headers: { 'x-api-key': 'test-key' }, body: null });
    assert.equal(res.statusCode, 200);
    const [first] = JSON.parse(res.body);
    assert.equal(first.fwi, 70);
    assert.equal(first.windSpeed, 30);
    assert.equal(first.dangerLevel, 'Muy Alto');
    assert.ok(first.area > 1);
    assert.equal(first.weatherAvailable, true);
  });
});

describe('runRiskCalculation with risk context', () => {
  function deps(overrides: Partial<RiskCalculationDependencies>, sink: { scores: RiskScoreItem[]; alerts: AlertItem[]; zones: RiskZoneItem[] }): RiskCalculationDependencies {
    return {
      queryHotspotsByProvince: async () => [],
      fetchWeather: async (province) => ({
        data: { temperature: 40, relativeHumidity: 10, windSpeed: 50, windDir: 'N', rain24h: 0 },
        stale: false, province, fetchedAt: new Date().toISOString(),
      }),
      calculateFWI,
      evaluateRisk: evaluateFireRisk,
      calculateConfidence,
      putRiskScore: async (s) => { sink.scores.push(s); },
      putAlert: async (a) => { sink.alerts.push(a); },
      publishToSNS: async () => {},
      putRiskZones: async (z) => { sink.zones.push(...z); },
      ...overrides,
    };
  }

  it('computes trend, stores weather/FWI snapshot and persists zones', async () => {
    const sink = { scores: [] as RiskScoreItem[], alerts: [] as AlertItem[], zones: [] as RiskZoneItem[] };
    const result = await runRiskCalculation(deps({ getPreviousRiskScore: async (p) => score(p, { riskScore: 10 }) }, sink));
    assert.equal(result.body.provincesProcessed, 24);
    assert.ok(result.body.riskZonesWritten > 0);
    assert.ok(sink.scores.every((s) => s.trend === 'up'));
    assert.ok(sink.scores.every((s) => typeof s.fwi === 'number' && s.windSpeed === 50));
    assert.ok(sink.zones.every((z) => z.PK === 'RISK#ZONES'));
  });

  it('does not re-alert provinces with a recent alert of equal severity', async () => {
    const sink = { scores: [] as RiskScoreItem[], alerts: [] as AlertItem[], zones: [] as RiskZoneItem[] };
    const now = Date.now();
    const result = await runRiskCalculation(deps({ queryRecentAlerts: async () => [alert('Crítico', 60_000, now)] }, sink));
    assert.equal(sink.alerts.length, 0);
    assert.equal(result.body.alertsSuppressed, result.body.provincesProcessed);
  });
});
