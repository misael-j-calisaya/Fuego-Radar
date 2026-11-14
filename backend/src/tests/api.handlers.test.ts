/**
 * Unit tests for API Gateway Lambda handlers.
 * Tests auth validation, response formats, and error handling.
 *
 * Requirements tested: 6.2, 6.3, 6.4, 6.5, 6.8, 6.9
 */

import test from 'node:test';
import assert from 'node:assert';
import { createRiskProvincesHandler } from '../lambdas/api/riskProvinces.handler.js';
import { createRiskZonesHandler } from '../lambdas/api/riskZones.handler.js';
import { createHotspotsHandler } from '../lambdas/api/hotspots.handler.js';
import { createAlertsHandler } from '../lambdas/api/alerts.handler.js';
import { createSubscriptionsHandler } from '../lambdas/api/subscriptions.handler.js';
import { handler as healthHandler } from '../lambdas/api/health.handler.js';
import type { APIGatewayProxyEvent } from '../lambdas/api/apiUtils.js';
import type { RiskScoreItem, RiskZoneItem, HotspotItem, AlertItem } from '../shared/types.js';

// ============================================
// Test Helpers
// ============================================

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    headers: { 'x-api-key': 'test-valid-key' },
    body: null,
    ...overrides,
  };
}

function makeEventNoKey(): APIGatewayProxyEvent {
  return { headers: {}, body: null };
}

function makeEventInvalidKey(): APIGatewayProxyEvent {
  return { headers: { 'x-api-key': 'wrong-key' }, body: null };
}

// Set up env for tests
const originalApiKeys = process.env.API_KEYS;

// ============================================
// Risk Provinces Handler Tests (Req 6.4)
// ============================================

test('Risk Provinces Handler', async (t) => {
  t.beforeEach(() => {
    process.env.API_KEYS = 'test-valid-key,another-key';
  });
  t.afterEach(() => {
    process.env.API_KEYS = originalApiKeys;
  });

  await t.test('returns 403 when x-api-key header is missing (Req 6.2, 6.3)', async () => {
    const handler = createRiskProvincesHandler({ getAllRiskScores: async () => [] });
    const result = await handler(makeEventNoKey());

    assert.strictEqual(result.statusCode, 403);
    const body = JSON.parse(result.body);
    assert.ok(body.error);
    // Must NOT reveal whether key exists or is invalid
    assert.ok(!body.error.toLowerCase().includes('exist'));
    assert.ok(!body.error.toLowerCase().includes('invalid'));
  });

  await t.test('returns 403 when x-api-key is invalid — same message as missing (Req 6.3)', async () => {
    const handler = createRiskProvincesHandler({ getAllRiskScores: async () => [] });
    const resultMissing = await handler(makeEventNoKey());
    const resultInvalid = await handler(makeEventInvalidKey());

    // Both should return identical response (indistinguishable)
    assert.strictEqual(resultMissing.statusCode, resultInvalid.statusCode);
    assert.strictEqual(resultMissing.body, resultInvalid.body);
  });

  await t.test('returns 200 with formatted provinces on success (Req 6.4)', async () => {
    const mockData: RiskScoreItem[] = [
      {
        PK: 'RISK#CURRENT',
        SK: 'PROVINCE#Córdoba',
        GSI1PK: 'RISKLEVEL#Alto',
        GSI1SK: 'SCORE#75',
        riskScore: 75,
        riskLevel: 'Alto',
        activeHotspotsCount: 12,
        trend: 'up',
        explanation: 'High temperature and wind',
        confidenceScore: 85,
        lastUpdated: '2024-01-15T10:00:00Z',
        weatherStale: false,
      },
    ];

    const handler = createRiskProvincesHandler({ getAllRiskScores: async () => mockData });
    const result = await handler(makeEvent());

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.headers['Content-Type'], 'application/json');

    const body = JSON.parse(result.body);
    assert.strictEqual(body.length, 1);
    assert.strictEqual(body[0].provinceName, 'Córdoba');
    assert.strictEqual(body[0].riskScore, 75);
    assert.strictEqual(body[0].activeHotspotsCount, 12);
    assert.strictEqual(body[0].riskLevel, 'Alto');
    assert.strictEqual(body[0].trend, 'up');
    assert.strictEqual(body[0].lastUpdated, '2024-01-15T10:00:00Z');
    assert.strictEqual(body[0].confidenceScore, 85);
    // Should NOT expose internal fields
    assert.strictEqual(body[0].explanation, undefined);
    assert.strictEqual(body[0].weatherStale, undefined);
    assert.strictEqual(body[0].PK, undefined);
    assert.strictEqual(body[0].SK, undefined);
  });

  await t.test('returns 500 with generic error on internal failure (Req 6.8)', async () => {
    const handler = createRiskProvincesHandler({
      getAllRiskScores: async () => { throw new Error('DynamoDB connection failed'); },
    });
    const result = await handler(makeEvent());

    assert.strictEqual(result.statusCode, 500);
    const body = JSON.parse(result.body);
    assert.ok(body.error);
    // Must NOT expose internal error details
    assert.ok(!body.error.includes('DynamoDB'));
    assert.ok(!body.error.includes('connection'));
  });
});

// ============================================
// Risk Zones Handler Tests (Req 6.5)
// ============================================

test('Risk Zones Handler', async (t) => {
  t.beforeEach(() => {
    process.env.API_KEYS = 'test-valid-key';
  });
  t.afterEach(() => {
    process.env.API_KEYS = originalApiKeys;
  });

  await t.test('returns formatted zones on success (Req 6.5)', async () => {
    const mockData: RiskZoneItem[] = [
      {
        PK: 'RISK#ZONES',
        SK: 'GRID#cell-001',
        GSI1PK: 'PROVINCE#Córdoba',
        GSI1SK: 'FWI#65',
        bounds: [[-32.0, -64.5], [-31.5, -64.0]],
        fwi: 65,
        riskLevel: 'Alto',
        hotspotsInCell: 3,
        lastUpdated: '2024-01-15T10:00:00Z',
      },
    ];

    const handler = createRiskZonesHandler({ queryRiskZones: async () => mockData });
    const result = await handler(makeEvent());

    assert.strictEqual(result.statusCode, 200);
    const body = JSON.parse(result.body);
    assert.strictEqual(body.length, 1);
    assert.strictEqual(body[0].id, 'cell-001');
    assert.deepStrictEqual(body[0].bounds, [[-32.0, -64.5], [-31.5, -64.0]]);
    assert.strictEqual(body[0].fwi, 65);
    assert.strictEqual(body[0].riskLevel, 'Alto');
    assert.strictEqual(body[0].hotspotsInCell, 3);
    // Should NOT expose internal fields
    assert.strictEqual(body[0].PK, undefined);
    assert.strictEqual(body[0].lastUpdated, undefined);
  });

  await t.test('returns 403 for invalid API key', async () => {
    const handler = createRiskZonesHandler({ queryRiskZones: async () => [] });
    const result = await handler(makeEventInvalidKey());
    assert.strictEqual(result.statusCode, 403);
  });
});

// ============================================
// Hotspots Handler Tests (Req 6.9)
// ============================================

test('Hotspots Handler', async (t) => {
  t.beforeEach(() => {
    process.env.API_KEYS = 'test-valid-key';
  });
  t.afterEach(() => {
    process.env.API_KEYS = originalApiKeys;
  });

  await t.test('returns formatted hotspots on success (Req 6.9)', async () => {
    const mockData: HotspotItem[] = [
      {
        PK: 'HOTSPOT#Córdoba',
        SK: 'TS#2024-01-15T14:20:00.000Z#abc123',
        GSI1PK: 'DATE#2024-01-15',
        GSI1SK: 'PROV#Córdoba',
        lat: -31.42,
        lng: -64.49,
        brightness: 335.4,
        confidence: 95,
        satellite: 'VIIRS',
        province: 'Córdoba',
        TTL: 1705507200,
      },
    ];

    const handler = createHotspotsHandler({ queryRecentHotspots: async () => mockData });
    const result = await handler(makeEvent());

    assert.strictEqual(result.statusCode, 200);
    const body = JSON.parse(result.body);
    assert.strictEqual(body.length, 1);
    assert.strictEqual(body[0].lat, -31.42);
    assert.strictEqual(body[0].lng, -64.49);
    assert.strictEqual(body[0].brightness, 335.4);
    assert.strictEqual(body[0].confidence, 95);
    assert.strictEqual(body[0].satellite, 'VIIRS');
    assert.strictEqual(body[0].province, 'Córdoba');
    assert.strictEqual(body[0].date, '2024-01-15T14:20:00.000Z');
    assert.strictEqual(typeof body[0].windSpeed, 'number');
    assert.strictEqual(typeof body[0].fwi, 'number');
    assert.strictEqual(typeof body[0].dangerLevel, 'string');
    assert.strictEqual(typeof body[0].area, 'number');
    assert.ok(body[0].area >= 1);
    // Should NOT expose internal fields
    assert.strictEqual(body[0].PK, undefined);
    assert.strictEqual(body[0].TTL, undefined);
  });

  await t.test('returns 500 on internal error without details', async () => {
    const handler = createHotspotsHandler({
      queryRecentHotspots: async () => { throw new Error('GSI1 query timeout'); },
    });
    const result = await handler(makeEvent());

    assert.strictEqual(result.statusCode, 500);
    const body = JSON.parse(result.body);
    assert.ok(!body.error.includes('GSI1'));
    assert.ok(!body.error.includes('timeout'));
  });
});

// ============================================
// Alerts Handler Tests
// ============================================

test('Alerts Handler', async (t) => {
  t.beforeEach(() => {
    process.env.API_KEYS = 'test-valid-key';
  });
  t.afterEach(() => {
    process.env.API_KEYS = originalApiKeys;
  });

  await t.test('returns formatted alerts on success', async () => {
    const mockData: AlertItem[] = [
      {
        PK: 'ALERT#Córdoba',
        SK: 'TS#2024-01-15T10:00:00Z#alert-1',
        GSI1PK: 'SEVERITY#Alto',
        GSI1SK: 'TS#2024-01-15T10:00:00Z',
        title: 'Alerta de incendio',
        description: 'Riesgo alto de incendio en zona norte',
        severity: 'Alto',
        type: 'Incendio',
        locationName: 'Córdoba Norte',
        coordinates: { lat: -31.0, lng: -64.0 },
        radius: 50,
        TTL: 1706112000,
      },
    ];

    const handler = createAlertsHandler({ queryAlerts: async () => mockData });
    const result = await handler(makeEvent());

    assert.strictEqual(result.statusCode, 200);
    const body = JSON.parse(result.body);
    assert.strictEqual(body.length, 1);
    assert.strictEqual(body[0].title, 'Alerta de incendio');
    assert.strictEqual(body[0].severity, 'Alto');
    assert.strictEqual(body[0].type, 'Incendio');
    assert.deepStrictEqual(body[0].coordinates, { lat: -31.0, lng: -64.0 });
    // Should NOT expose internal fields
    assert.strictEqual(body[0].PK, undefined);
    assert.strictEqual(body[0].TTL, undefined);
  });
});

// ============================================
// Subscriptions Handler Tests
// ============================================

test('Subscriptions Handler', async (t) => {
  t.beforeEach(() => {
    process.env.API_KEYS = 'test-valid-key';
  });
  t.afterEach(() => {
    process.env.API_KEYS = originalApiKeys;
  });

  await t.test('returns 200 with subscriptionId on valid request', async () => {
    const written: unknown[] = [];
    const handler = createSubscriptionsHandler({
      putSubscription: async (item) => { written.push(item); },
      verifierDeps: {
        persistToken: async () => {},
        getToken: async () => null,
        deleteToken: async () => {},
        markSubscriptionsVerified: async () => {},
        sendVerificationEmail: async () => {},
      },
    });

    const event = makeEvent({
      body: JSON.stringify({
        email: 'user@example.com',
        provinces: ['Córdoba'],
        minSeverity: 'Alto',
      }),
    });

    const result = await handler(event);

    assert.strictEqual(result.statusCode, 200);
    const body = JSON.parse(result.body);
    assert.ok(body.subscriptionId);
    assert.strictEqual(body.status, 'pending_verification');
    assert.strictEqual(written.length, 1);
  });

  await t.test('returns 400 for missing email', async () => {
    const handler = createSubscriptionsHandler({
      putSubscription: async () => {},
    });

    const event = makeEvent({
      body: JSON.stringify({ provinces: ['Córdoba'], minSeverity: 'Alto' }),
    });

    const result = await handler(event);
    assert.strictEqual(result.statusCode, 400);
  });

  await t.test('returns 400 for invalid province', async () => {
    const handler = createSubscriptionsHandler({
      putSubscription: async () => {},
    });

    const event = makeEvent({
      body: JSON.stringify({
        email: 'user@test.com',
        provinces: ['InvalidProvince'],
        minSeverity: 'Alto',
      }),
    });

    const result = await handler(event);
    assert.strictEqual(result.statusCode, 400);
    const body = JSON.parse(result.body);
    assert.ok(body.error.includes('Invalid province'));
  });

  await t.test('returns 400 for invalid JSON body', async () => {
    const handler = createSubscriptionsHandler({
      putSubscription: async () => {},
    });

    const event = makeEvent({ body: 'not json{' });
    const result = await handler(event);
    assert.strictEqual(result.statusCode, 400);
  });

  await t.test('returns 403 for missing API key', async () => {
    const handler = createSubscriptionsHandler({
      putSubscription: async () => {},
    });
    const result = await handler(makeEventNoKey());
    assert.strictEqual(result.statusCode, 403);
  });
});

// ============================================
// Health Handler Tests
// ============================================

test('Health Handler', async (t) => {
  await t.test('returns 200 with health info — no API key required', async () => {
    const result = await healthHandler(makeEventNoKey());

    assert.strictEqual(result.statusCode, 200);
    const body = JSON.parse(result.body);
    assert.strictEqual(body.status, 'healthy');
    assert.strictEqual(body.version, '1.0.0');
    assert.ok(body.timestamp);
    // Verify timestamp is ISO 8601
    assert.ok(!isNaN(Date.parse(body.timestamp)));
  });
});
