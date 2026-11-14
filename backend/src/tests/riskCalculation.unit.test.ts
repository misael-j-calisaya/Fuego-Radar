/**
 * Comprehensive unit tests for riskCalculation.handler (Task 6.3).
 *
 * Tests: successful flow, no hotspots, stale weather, confidence reduction,
 * alert generation thresholds, DDB persistence, SNS publish, error isolation,
 * stale hotspot handling.
 *
 * Requirements: 3.1, 3.2, 3.9, 2.3
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runRiskCalculation } from '../lambdas/riskCalculation.handler.js';
import type { RiskCalculationDependencies } from '../lambdas/riskCalculation.handler.js';
import type { HotspotItem, RiskScoreItem, AlertItem } from '../shared/types.js';

// ============================================
// Helpers
// ============================================

const today = new Date().toISOString().slice(0, 10);
const nowIso = new Date().toISOString();

function makeHotspot(province: string, overrides: Partial<HotspotItem> = {}): HotspotItem {
  return {
    PK: `HOTSPOT#${province}-1` as `HOTSPOT#${string}`,
    SK: `TS#${nowIso}#h1` as `TS#${string}#${string}`,
    GSI1PK: `DATE#${today}` as `DATE#${string}`,
    GSI1SK: `PROV#${province}` as `PROV#${string}`,
    lat: -31.42,
    lng: -64.49,
    brightness: 335,
    confidence: 95,
    satellite: 'VIIRS',
    province,
    TTL: Math.floor(Date.now() / 1000) + 86400,
    ...overrides,
  };
}

function makeBaseDeps(overrides: Partial<RiskCalculationDependencies> = {}): RiskCalculationDependencies {
  return {
    queryHotspotsByProvince: async () => [],
    fetchWeather: async () => ({
      data: { temperature: 30, relativeHumidity: 30, windSpeed: 25, windDir: 'N', rain24h: 0 },
      stale: false,
      province: 'Test',
      fetchedAt: new Date().toISOString(),
    }),
    calculateFWI: () => ({ success: true as const, result: { fwiScore: 60, dangerLevel: 'Alto' as const, explanation: 'Alto' }, errors: [] }),
    evaluateRisk: () => ({
      riskScore: 50,
      riskLevel: 'Alto' as const,
      explanation: 'Test risk',
      contributingFactors: [],
    }),
    calculateConfidence: () => ({ confidenceScore: 85, factors: [], weatherStale: false }),
    putRiskScore: async () => {},
    putAlert: async () => {},
    publishToSNS: async () => {},
    ...overrides,
  };
}

// ============================================
// Test: Successful risk calculation flow
// ============================================

describe('Risk Calculation — successful flow', () => {
  it('processes province with hotspots and returns success', async () => {
    const persisted: RiskScoreItem[] = [];

    const deps = makeBaseDeps({
      queryHotspotsByProvince: async (province, date) => {
        if (province === 'Córdoba' && date === today) return [makeHotspot('Córdoba')];
        return [];
      },
      putRiskScore: async (item) => { persisted.push(item); },
    });

    process.env.ALERTS_TOPIC_ARN = 'arn:test:topic';
    const result = await runRiskCalculation(deps);

    assert.strictEqual(result.statusCode, 200);
    assert.ok(result.body.provincesProcessed >= 1);
    assert.ok(result.body.durationMs >= 0);
    assert.ok(persisted.length >= 1);
  });
});

// ============================================
// Test: Province with no hotspots is skipped
// ============================================

describe('Risk Calculation — no hotspots', () => {
  it('processes all 24 provinces even with no hotspot activity', async () => {
    const persisted: RiskScoreItem[] = [];

    const deps = makeBaseDeps({
      queryHotspotsByProvince: async () => [], // No hotspots anywhere
      putRiskScore: async (item) => { persisted.push(item); },
    });

    const result = await runRiskCalculation(deps);

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.provincesProcessed, 24);
    assert.strictEqual(persisted.length, 24);
  });
});

// ============================================
// Test: Stale weather handling
// ============================================

describe('Risk Calculation — stale weather', () => {
  it('counts stale weather occurrences', async () => {
    const deps = makeBaseDeps({
      queryHotspotsByProvince: async (province) => {
        if (province === 'Salta') return [makeHotspot('Salta')];
        return [];
      },
      fetchWeather: async () => ({
        data: { temperature: 28, relativeHumidity: 35, windSpeed: 20, windDir: 'N', rain24h: 0 },
        stale: true, // Stale!
        province: 'Test',
        fetchedAt: new Date().toISOString(),
      }),
    });

    const result = await runRiskCalculation(deps);

    assert.strictEqual(result.body.staleWeatherCount, 24);
  });
});

// ============================================
// Test: Confidence reduction for stale weather
// ============================================

describe('Risk Calculation — confidence with stale weather', () => {
  it('passes weatherStale=true to calculateConfidence when weather is stale', async () => {
    let confidenceCalledWithStale = false;

    const deps = makeBaseDeps({
      queryHotspotsByProvince: async (province) => {
        if (province === 'Mendoza') return [makeHotspot('Mendoza')];
        return [];
      },
      fetchWeather: async () => ({
        data: { temperature: 25, relativeHumidity: 40, windSpeed: 15, windDir: 'O', rain24h: 0 },
        stale: true,
        province: 'Test',
        fetchedAt: new Date().toISOString(),
      }),
      calculateConfidence: (_input, stale) => {
        if (stale) confidenceCalledWithStale = true;
        return { confidenceScore: 75, factors: [], weatherStale: stale ?? false };
      },
    });

    await runRiskCalculation(deps);

    assert.strictEqual(confidenceCalledWithStale, true);
  });
});

// ============================================
// Test: Alert generation for Alto, Muy Alto, Extremo
// ============================================

describe('Risk Calculation — alert generation', () => {
  it('generates alert when riskLevel is Alto', async () => {
    const alerts: AlertItem[] = [];
    const snsMessages: string[] = [];

    const deps = makeBaseDeps({
      queryHotspotsByProvince: async (province) => {
        if (province === 'Chaco') return [makeHotspot('Chaco')];
        return [];
      },
      evaluateRisk: () => ({
        riskScore: 55,
        riskLevel: 'Alto' as const,
        explanation: 'Alto risk',
        contributingFactors: [],
      }),
      putAlert: async (item) => { alerts.push(item); },
      publishToSNS: async (msg) => { snsMessages.push(msg); },
    });

    process.env.ALERTS_TOPIC_ARN = 'arn:test:topic';
    const result = await runRiskCalculation(deps);

    assert.ok(alerts.length >= 1);
    assert.ok(snsMessages.length >= 1);
    assert.strictEqual(result.body.alertsGenerated, 24);
  });

  it('generates alert when riskLevel is Muy Alto', async () => {
    const alerts: AlertItem[] = [];

    const deps = makeBaseDeps({
      queryHotspotsByProvince: async (province) => {
        if (province === 'Formosa') return [makeHotspot('Formosa')];
        return [];
      },
      evaluateRisk: () => ({
        riskScore: 70,
        riskLevel: 'Muy Alto' as const,
        explanation: 'Muy Alto risk',
        contributingFactors: [],
      }),
      putAlert: async (item) => { alerts.push(item); },
    });

    await runRiskCalculation(deps);
    assert.ok(alerts.length >= 1);
  });

  it('generates alert when riskLevel is Extremo', async () => {
    const alerts: AlertItem[] = [];

    const deps = makeBaseDeps({
      queryHotspotsByProvince: async (province) => {
        if (province === 'Misiones') return [makeHotspot('Misiones')];
        return [];
      },
      evaluateRisk: () => ({
        riskScore: 90,
        riskLevel: 'Extremo' as const,
        explanation: 'Extremo risk',
        contributingFactors: [],
      }),
      putAlert: async (item) => { alerts.push(item); },
    });

    await runRiskCalculation(deps);
    assert.ok(alerts.length >= 1);
  });
});

// ============================================
// Test: No alert for Bajo and Medio
// ============================================

describe('Risk Calculation — no alert for low severity', () => {
  it('does not generate alert when riskLevel is Bajo', async () => {
    const alerts: AlertItem[] = [];

    const deps = makeBaseDeps({
      queryHotspotsByProvince: async (province) => {
        if (province === 'Santa Cruz') return [makeHotspot('Santa Cruz')];
        return [];
      },
      evaluateRisk: () => ({
        riskScore: 15,
        riskLevel: 'Bajo' as const,
        explanation: 'Low risk',
        contributingFactors: [],
      }),
      putAlert: async (item) => { alerts.push(item); },
    });

    const result = await runRiskCalculation(deps);

    assert.strictEqual(alerts.length, 0);
    assert.strictEqual(result.body.alertsGenerated, 0);
  });

  it('does not generate alert when riskLevel is Medio', async () => {
    const alerts: AlertItem[] = [];
    const snsMessages: string[] = [];

    const deps = makeBaseDeps({
      queryHotspotsByProvince: async (province) => {
        if (province === 'Neuquén') return [makeHotspot('Neuquén')];
        return [];
      },
      evaluateRisk: () => ({
        riskScore: 35,
        riskLevel: 'Medio' as const,
        explanation: 'Medium risk',
        contributingFactors: [],
      }),
      putAlert: async (item) => { alerts.push(item); },
      publishToSNS: async (msg) => { snsMessages.push(msg); },
    });

    await runRiskCalculation(deps);

    assert.strictEqual(alerts.length, 0);
    assert.strictEqual(snsMessages.length, 0);
  });
});

// ============================================
// Test: DynamoDB persistence
// ============================================

describe('Risk Calculation — DynamoDB persistence', () => {
  it('persists RiskScoreItem with correct structure', async () => {
    const persistedItems: RiskScoreItem[] = [];

    const deps = makeBaseDeps({
      queryHotspotsByProvince: async (province, date) => {
        if (province === 'Córdoba' && date === today) return [makeHotspot('Córdoba'), makeHotspot('Córdoba')];
        return [];
      },
      evaluateRisk: () => ({
        riskScore: 72,
        riskLevel: 'Muy Alto' as const,
        explanation: 'Very high risk',
        contributingFactors: [],
      }),
      calculateConfidence: () => ({ confidenceScore: 82, factors: [], weatherStale: false }),
      putRiskScore: async (item) => { persistedItems.push(item); },
    });

    await runRiskCalculation(deps);

    const persistedItem = persistedItems.find(item => item.SK === 'PROVINCE#Córdoba');
    assert.ok(persistedItem !== undefined);
    assert.strictEqual(persistedItem!.PK, 'RISK#CURRENT');
    assert.strictEqual(persistedItem!.SK, 'PROVINCE#Córdoba');
    assert.strictEqual(persistedItem!.riskScore, 72);
    assert.strictEqual(persistedItem!.riskLevel, 'Muy Alto');
    assert.strictEqual(persistedItem!.activeHotspotsCount, 2);
    assert.strictEqual(persistedItem!.confidenceScore, 82);
    assert.ok(persistedItem!.lastUpdated.length > 0);
    assert.ok(persistedItem!.GSI1PK.startsWith('RISKLEVEL#'));
    assert.ok(persistedItem!.GSI1SK.startsWith('SCORE#'));
  });
});

// ============================================
// Test: SNS publish behavior
// ============================================

describe('Risk Calculation — SNS publish', () => {
  it('publishes alert JSON to SNS topic ARN', async () => {
    const publishedMessages: { msg: string, topic: string }[] = [];

    const deps = makeBaseDeps({
      queryHotspotsByProvince: async (province) => {
        if (province === 'Salta') return [makeHotspot('Salta')];
        return [];
      },
      evaluateRisk: () => ({
        riskScore: 85,
        riskLevel: 'Extremo' as const,
        explanation: 'Extreme',
        contributingFactors: [],
      }),
      publishToSNS: async (msg, topic) => {
        publishedMessages.push({ msg, topic });
      },
    });

    process.env.ALERTS_TOPIC_ARN = 'arn:aws:sns:us-east-1:123:FireRiskEngine-CriticalAlerts';
    await runRiskCalculation(deps);

    assert.ok(publishedMessages.length > 0);
    const saltaRecord = publishedMessages.find(p => JSON.parse(p.msg).locationName === 'Salta');
    assert.ok(saltaRecord !== undefined);
    assert.strictEqual(saltaRecord!.topic, 'arn:aws:sns:us-east-1:123:FireRiskEngine-CriticalAlerts');

    const parsed = JSON.parse(saltaRecord!.msg);
    assert.strictEqual(parsed.locationName, 'Salta');
    assert.strictEqual(parsed.type, 'Incendio');
  });
});

// ============================================
// Test: Error isolation
// ============================================

describe('Risk Calculation — error isolation', () => {
  it('continues processing other provinces when one fails', async () => {
    const persisted: RiskScoreItem[] = [];

    const deps = makeBaseDeps({
      queryHotspotsByProvince: async (province) => {
        if (province === 'Córdoba') return [makeHotspot('Córdoba')];
        if (province === 'Salta') return [makeHotspot('Salta')];
        return [];
      },
      fetchWeather: async (province) => {
        if (province === 'Córdoba') throw new Error('Network timeout');
        return {
          data: { temperature: 30, relativeHumidity: 30, windSpeed: 20, windDir: 'N', rain24h: 0 },
          stale: false,
          province,
          fetchedAt: new Date().toISOString(),
        };
      },
      putRiskScore: async (item) => { persisted.push(item); },
    });

    const result = await runRiskCalculation(deps);

    // Córdoba failed, but Salta should still succeed
    assert.strictEqual(result.statusCode, 200);
    assert.ok(persisted.length >= 1);
    assert.ok(persisted.some(p => p.SK === 'PROVINCE#Salta'));
  });
});

// ============================================
// Test: Stale hotspot confidence reduction
// ============================================

describe('Risk Calculation — stale hotspot confidence reduction', () => {
  it('reduces confidence by 20 when hotspots are older than 48h', async () => {
    let storedConfidence = 0;

    // Create hotspot with old timestamp (>48h ago)
    const oldDate = new Date(Date.now() - 72 * 60 * 60 * 1000); // 72h ago
    const oldHotspot = makeHotspot('Tucumán', {
      SK: `TS#${oldDate.toISOString()}#old-h1` as `TS#${string}#${string}`,
    });

    const deps = makeBaseDeps({
      queryHotspotsByProvince: async (province) => {
        if (province === 'Tucumán') return [oldHotspot];
        return [];
      },
      calculateConfidence: () => ({ confidenceScore: 90, factors: [], weatherStale: false }),
      putRiskScore: async (item) => {
        if (item.SK === 'PROVINCE#Tucumán') {
          storedConfidence = item.confidenceScore;
        }
      },
    });

    await runRiskCalculation(deps);

    // Confidence should be reduced by 20 (from 90 to 70), clamped to min 50
    assert.strictEqual(storedConfidence, 70);
  });

  it('clamps stale hotspot confidence reduction to minimum 50', async () => {
    let storedConfidence = 0;

    const oldDate = new Date(Date.now() - 72 * 60 * 60 * 1000);
    const oldHotspot = makeHotspot('Jujuy', {
      SK: `TS#${oldDate.toISOString()}#old-h1` as `TS#${string}#${string}`,
    });

    const deps = makeBaseDeps({
      queryHotspotsByProvince: async (province) => {
        if (province === 'Jujuy') return [oldHotspot];
        return [];
      },
      calculateConfidence: () => ({ confidenceScore: 60, factors: [], weatherStale: false }),
      putRiskScore: async (item) => {
        if (item.SK === 'PROVINCE#Jujuy') {
          storedConfidence = item.confidenceScore;
        }
      },
    });

    await runRiskCalculation(deps);

    // 60 - 20 = 40, but clamped to min 50
    assert.strictEqual(storedConfidence, 50);
  });
});
