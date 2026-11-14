/**
 * Unit tests for the Risk Calculation Lambda Handler.
 * Uses dependency injection to mock all external services.
 *
 * Requirements tested: 3.1, 3.2, 3.9, 2.3, 2.6, 10.1
 */

import test from 'node:test';
import assert from 'node:assert';
import { runRiskCalculation } from '../lambdas/riskCalculation.handler.js';
import type { RiskCalculationDependencies } from '../lambdas/riskCalculation.handler.js';
import type {
  HotspotItem,
  RiskScoreItem,
  AlertItem,
  WeatherData,
} from '../shared/types.js';
import type { WeatherFetchResult } from '../services/weatherApiClient.js';

// ============================================
// Test Helpers
// ============================================

function makeHotspotItem(province: string, dateIso: string, id?: string): HotspotItem {
  const hotspotId = id ?? `hotspot-${Date.now()}`;
  const dateOnly = dateIso.substring(0, 10);
  return {
    PK: `HOTSPOT#${province}` as `HOTSPOT#${string}`,
    SK: `TS#${dateIso}#${hotspotId}` as `TS#${string}#${string}`,
    GSI1PK: `DATE#${dateOnly}` as `DATE#${string}`,
    GSI1SK: `PROV#${province}` as `PROV#${string}`,
    lat: -31.42,
    lng: -64.49,
    brightness: 335.4,
    confidence: 95,
    satellite: 'VIIRS',
    province,
    TTL: Math.floor(Date.now() / 1000) + 172800,
  };
}

function freshWeatherResult(province: string): WeatherFetchResult {
  return {
    data: {
      temperature: 30,
      relativeHumidity: 25,
      windSpeed: 20,
      windDir: 'N',
      rain24h: 0,
    },
    stale: false,
    province,
    fetchedAt: new Date().toISOString(),
  };
}

function staleWeatherResult(province: string): WeatherFetchResult {
  return {
    data: {
      temperature: 20,
      relativeHumidity: 50,
      windSpeed: 10,
      windDir: 'N',
      rain24h: 0,
    },
    stale: true,
    province,
    fetchedAt: new Date().toISOString(),
    error: 'timeout',
  };
}

function createMockDeps(overrides: Partial<RiskCalculationDependencies> = {}): RiskCalculationDependencies {
  const _now = new Date().toISOString();

  return {
    queryHotspotsByProvince: async (_province: string, _date: string) => [],
    fetchWeather: async (province: string) => freshWeatherResult(province),
    calculateFWI: (_weather: WeatherData) => ({
      success: true as const,
      result: { fwiScore: 55, dangerLevel: 'Alto' as const, explanation: 'Alto riesgo' },
    }),
    evaluateRisk: (_input) => ({
      riskScore: 55,
      riskLevel: 'Alto' as const,
      explanation: 'Condiciones de alto riesgo detectadas.',
      contributingFactors: [],
    }),
    calculateConfidence: (_input, _stale) => ({
      confidenceScore: 85,
      factors: [],
      weatherStale: false,
    }),
    putRiskScore: async (_item: RiskScoreItem) => {},
    putAlert: async (_item: AlertItem) => {},
    publishToSNS: async (_message: string, _topicArn: string) => {},
    ...overrides,
  };
}

// ============================================
// Tests
// ============================================

test('Risk Calculation Handler Tests', async (t) => {
  await t.test('Successful risk calculation — province with hotspots gets risk calculated and persisted', async () => {
    const today = new Date().toISOString().substring(0, 10);
    const hotspotDate = new Date().toISOString();
    let persistedRiskScore: RiskScoreItem | undefined;

    const deps = createMockDeps({
      queryHotspotsByProvince: async (province: string, date: string) => {
        if (province === 'Córdoba' && date === today) {
          return [makeHotspotItem('Córdoba', hotspotDate, 'h1')];
        }
        return [];
      },
      putRiskScore: async (item: RiskScoreItem) => {
        if (item.SK === 'PROVINCE#Córdoba') {
          persistedRiskScore = item;
        }
      },
    });

    const result = await runRiskCalculation(deps);

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.provincesProcessed, 24);
    assert.ok(result.body.durationMs >= 0);
    assert.ok(result.body.timestamp);

    // Verify persisted risk score
    assert.ok(persistedRiskScore, 'Risk score should be persisted');
    assert.strictEqual(persistedRiskScore!.PK, 'RISK#CURRENT');
    assert.strictEqual(persistedRiskScore!.SK, 'PROVINCE#Córdoba');
    assert.strictEqual(persistedRiskScore!.riskScore, 55);
    assert.strictEqual(persistedRiskScore!.riskLevel, 'Alto');
    assert.strictEqual(persistedRiskScore!.activeHotspotsCount, 1);
    assert.strictEqual(persistedRiskScore!.confidenceScore, 85);
    assert.strictEqual(persistedRiskScore!.weatherStale, false);
    assert.ok(persistedRiskScore!.lastUpdated);
    assert.ok(persistedRiskScore!.GSI1PK.startsWith('RISKLEVEL#'));
    assert.ok(persistedRiskScore!.GSI1SK.startsWith('SCORE#'));
  });

  await t.test('Stale weather fallback — confidence reduced and weatherStale=true in persisted item', async () => {
    const today = new Date().toISOString().substring(0, 10);
    const hotspotDate = new Date().toISOString();
    let persistedRiskScore: RiskScoreItem | undefined;

    const deps = createMockDeps({
      queryHotspotsByProvince: async (province: string, date: string) => {
        if (province === 'Córdoba' && date === today) {
          return [makeHotspotItem('Córdoba', hotspotDate, 'h1')];
        }
        return [];
      },
      fetchWeather: async (province: string) => staleWeatherResult(province),
      calculateConfidence: (_input, weatherStale) => ({
        confidenceScore: 75, // reduced due to stale weather
        factors: [{ name: 'weatherStale', penalty: -10, description: 'Datos desactualizados' }],
        weatherStale: weatherStale ?? false,
      }),
      evaluateRisk: (_input) => ({
        riskScore: 35,
        riskLevel: 'Medio' as const,
        explanation: 'Riesgo moderado con datos desactualizados.',
        contributingFactors: [],
      }),
      putRiskScore: async (item: RiskScoreItem) => {
        if (item.SK === 'PROVINCE#Córdoba') {
          persistedRiskScore = item;
        }
      },
    });

    const result = await runRiskCalculation(deps);

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.staleWeatherCount, 24);
    assert.ok(persistedRiskScore, 'Risk score should be persisted');
    assert.strictEqual(persistedRiskScore!.weatherStale, true);
    assert.strictEqual(persistedRiskScore!.confidenceScore, 75);
  });

  await t.test('Province with Alto severity generates alert — verify alert persisted + SNS published', async () => {
    const today = new Date().toISOString().substring(0, 10);
    const hotspotDate = new Date().toISOString();
    let alertPersisted: AlertItem | undefined;
    let snsPublished = false;
    let snsMessage = '';

    const deps = createMockDeps({
      queryHotspotsByProvince: async (province: string, date: string) => {
        if (province === 'Córdoba' && date === today) {
          return [makeHotspotItem('Córdoba', hotspotDate, 'h1')];
        }
        return [];
      },
      evaluateRisk: (_input) => ({
        riskScore: 55,
        riskLevel: 'Alto' as const,
        explanation: 'Alto riesgo de incendio.',
        contributingFactors: [],
      }),
      putAlert: async (item: AlertItem) => {
        if (item.PK === 'ALERT#Córdoba') {
          alertPersisted = item;
        }
      },
      publishToSNS: async (message: string, _topicArn: string) => {
        if (message.includes('Córdoba')) {
          snsPublished = true;
          snsMessage = message;
        }
      },
    });

    const result = await runRiskCalculation(deps);

    assert.strictEqual(result.body.alertsGenerated, 24);
    assert.ok(alertPersisted, 'Alert should be persisted');
    assert.ok(alertPersisted!.PK.startsWith('ALERT#Córdoba'));
    assert.ok(alertPersisted!.SK.startsWith('TS#'));
    assert.strictEqual(alertPersisted!.severity, 'Alto');
    assert.strictEqual(alertPersisted!.type, 'Incendio');
    assert.strictEqual(alertPersisted!.locationName, 'Córdoba');
    assert.strictEqual(alertPersisted!.radius, 50);
    assert.ok(alertPersisted!.TTL > Math.floor(Date.now() / 1000));
    assert.ok(alertPersisted!.title.includes('Córdoba'));

    // Verify SNS published
    assert.strictEqual(snsPublished, true);
    assert.ok(snsMessage.includes('Córdoba'));
  });

  await t.test('Province with Bajo/Medio does NOT generate alert — no alert/SNS', async () => {
    const today = new Date().toISOString().substring(0, 10);
    const hotspotDate = new Date().toISOString();
    let alertPersisted = false;
    let snsPublished = false;

    const deps = createMockDeps({
      queryHotspotsByProvince: async (province: string, date: string) => {
        if (province === 'Córdoba' && date === today) {
          return [makeHotspotItem('Córdoba', hotspotDate, 'h1')];
        }
        return [];
      },
      evaluateRisk: (_input) => ({
        riskScore: 25,
        riskLevel: 'Medio' as const,
        explanation: 'Riesgo moderado.',
        contributingFactors: [],
      }),
      putAlert: async (_item: AlertItem) => {
        alertPersisted = true;
      },
      publishToSNS: async (_message: string, _topicArn: string) => {
        snsPublished = true;
      },
    });

    const result = await runRiskCalculation(deps);

    assert.strictEqual(result.body.alertsGenerated, 0);
    assert.strictEqual(alertPersisted, false, 'No alert should be persisted for Medio severity');
    assert.strictEqual(snsPublished, false, 'No SNS should be published for Medio severity');
  });

  await t.test('No active hotspots — no risk scores written, clean return', async () => {
    let putRiskScoreCalled = false;
    let putAlertCalled = false;

    const deps = createMockDeps({
      queryHotspotsByProvince: async () => [],
      evaluateRisk: (_input) => ({
        riskScore: 25,
        riskLevel: 'Medio' as const,
        explanation: 'Mocked risk evaluation',
        contributingFactors: [],
      }),
      putRiskScore: async () => {
        putRiskScoreCalled = true;
      },
      putAlert: async () => {
        putAlertCalled = true;
      },
    });

    const result = await runRiskCalculation(deps);

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.provincesProcessed, 24);
    assert.strictEqual(result.body.alertsGenerated, 0);
    assert.strictEqual(result.body.staleWeatherCount, 0);
    assert.strictEqual(putRiskScoreCalled, true, 'putRiskScore should be called with no hotspots');
    assert.strictEqual(putAlertCalled, false, 'putAlert should NOT be called with no hotspots');
  });

  await t.test('DynamoDB read failure — queryHotspotsByProvince throws → controlled error, continues other provinces', async () => {
    const today = new Date().toISOString().substring(0, 10);
    const hotspotDate = new Date().toISOString();
    const provincesWithRiskScores: string[] = [];

    const deps = createMockDeps({
      queryHotspotsByProvince: async (province: string, date: string) => {
        if (province === 'Buenos Aires') {
          throw new Error('DynamoDB ProvisionedThroughputExceeded');
        }
        if (province === 'Córdoba' && date === today) {
          return [makeHotspotItem('Córdoba', hotspotDate, 'h1')];
        }
        return [];
      },
      putRiskScore: async (item: RiskScoreItem) => {
        provincesWithRiskScores.push(item.SK);
      },
    });

    // Should not throw — continues processing other provinces
    const result = await runRiskCalculation(deps);

    assert.strictEqual(result.statusCode, 200);
    // Córdoba should still be processed despite Buenos Aires failure
    assert.ok(
      provincesWithRiskScores.includes('PROVINCE#Córdoba'),
      'Córdoba should still be processed',
    );
    assert.ok(
      !provincesWithRiskScores.includes('PROVINCE#Buenos Aires'),
      'Buenos Aires should NOT be processed due to error',
    );
  });

  await t.test('Stale hotspots (>48h) reduces confidence by 20 and logs warning', async () => {
    const today = new Date().toISOString().substring(0, 10);
    // Create a hotspot that's 50 hours old (> 48h threshold)
    const staleDate = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString();
    let persistedRiskScore: RiskScoreItem | undefined;
    const consoleLogs: string[] = [];
    const originalWarn = console.warn;

    console.warn = (...args: unknown[]) => {
      consoleLogs.push(args.map(String).join(' '));
    };

    const deps = createMockDeps({
      queryHotspotsByProvince: async (province: string, date: string) => {
        if (province === 'Córdoba' && date === today) {
          return [makeHotspotItem('Córdoba', staleDate, 'stale-h1')];
        }
        return [];
      },
      calculateConfidence: (_input, _stale) => ({
        confidenceScore: 90,
        factors: [],
        weatherStale: false,
      }),
      putRiskScore: async (item: RiskScoreItem) => {
        if (item.SK === 'PROVINCE#Córdoba') {
          persistedRiskScore = item;
        }
      },
    });

    const result = await runRiskCalculation(deps);

    console.warn = originalWarn;

    assert.strictEqual(result.statusCode, 200);
    assert.ok(persistedRiskScore, 'Risk score should be persisted');
    // Confidence should be reduced by 20: 90 - 20 = 70
    assert.strictEqual(persistedRiskScore!.confidenceScore, 70);

    // Verify warning was logged with staleHotspots: true
    const staleLog = consoleLogs.find((log) => log.includes('staleHotspots'));
    assert.ok(staleLog, 'Should log warning about stale hotspots');
    assert.ok(staleLog!.includes('"staleHotspots":true'));
  });

  await t.test('Extremo severity maps to Crítico alert severity', async () => {
    const today = new Date().toISOString().substring(0, 10);
    const hotspotDate = new Date().toISOString();
    let alertPersisted: AlertItem | undefined;

    const deps = createMockDeps({
      queryHotspotsByProvince: async (province: string, date: string) => {
        if (province === 'Córdoba' && date === today) {
          return [makeHotspotItem('Córdoba', hotspotDate, 'h1')];
        }
        return [];
      },
      evaluateRisk: (_input) => ({
        riskScore: 85,
        riskLevel: 'Extremo' as const,
        explanation: 'Condiciones extremas de incendio.',
        contributingFactors: [],
      }),
      putAlert: async (item: AlertItem) => {
        alertPersisted = item;
      },
    });

    await runRiskCalculation(deps);

    assert.ok(alertPersisted, 'Alert should be persisted for Extremo');
    assert.strictEqual(alertPersisted!.severity, 'Crítico');
    assert.ok(alertPersisted!.GSI1PK.startsWith('SEVERITY#Crítico'));
  });
});
