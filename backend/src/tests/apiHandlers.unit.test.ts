/**
 * Comprehensive unit tests for all API handlers (Task 7.3).
 *
 * Tests: successful responses, auth (missing/invalid key), malformed params,
 * DDB errors, response format compatibility.
 *
 * Requirements: 6.2, 6.3, 6.4, 6.5, 6.8
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createHealthHandler } from '../lambdas/api/health.handler.js';

const healthHandler = createHealthHandler({
  getLatestIngestionMeta: async () => null,
  getRiskScores: async () => [],
});
import { createRiskProvincesHandler } from '../lambdas/api/riskProvinces.handler.js';
import { createRiskZonesHandler } from '../lambdas/api/riskZones.handler.js';
import { createHotspotsHandler } from '../lambdas/api/hotspots.handler.js';
import { createAlertsHandler } from '../lambdas/api/alerts.handler.js';
import { createSubscriptionsHandler } from '../lambdas/api/subscriptions.handler.js';

import type { APIGatewayProxyEvent } from '../lambdas/api/apiUtils.js';
import type { RiskScoreItem, RiskZoneItem, HotspotItem, AlertItem } from '../shared/types.js';

// ============================================
// Helpers
// ============================================

const VALID_KEY = 'test-api-key-unit';

beforeEach(() => {
  process.env.API_KEYS = VALID_KEY;
});

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    headers: { 'x-api-key': VALID_KEY },
    body: null,
    pathParameters: null,
    queryStringParameters: null,
    ...overrides,
  };
}

// ============================================
// GET /health
// ============================================

describe('GET /health', () => {
  it('returns 200 with status, timestamp, version (no auth required)', async () => {
    const response = await healthHandler(makeEvent({ headers: {} }));
    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(['healthy', 'degraded'].includes(body.status));
    assert.ok(body.services);
    assert.ok(body.timestamp);
    assert.strictEqual(typeof body.version, 'string');
  });

  it('includes Content-Type and CORS headers', async () => {
    const response = await healthHandler(makeEvent());
    assert.strictEqual(response.headers['Content-Type'], 'application/json');
    assert.ok(response.headers['Access-Control-Allow-Origin']);
  });
});

// ============================================
// GET /risk/provinces
// ============================================

describe('GET /risk/provinces', () => {
  const mockScores: RiskScoreItem[] = [{
    PK: 'RISK#CURRENT', SK: 'PROVINCE#Córdoba' as `PROVINCE#${string}`,
    GSI1PK: 'RISKLEVEL#Alto' as `RISKLEVEL#${string}`, GSI1SK: 'SCORE#065' as `SCORE#${string}`,
    riskScore: 65, riskLevel: 'Alto', activeHotspotsCount: 3, trend: 'up',
    explanation: 'Test', confidenceScore: 88, lastUpdated: '2024-01-15T15:00:00Z', weatherStale: false,
  }];

  it('returns 200 with formatted province array', async () => {
    const handler = createRiskProvincesHandler({ getAllRiskScores: async () => mockScores });
    const response = await handler(makeEvent());
    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(Array.isArray(body));
    assert.strictEqual(body[0].provinceName, 'Córdoba');
    assert.strictEqual(body[0].riskScore, 65);
    assert.strictEqual(body[0].riskLevel, 'Alto');
    assert.strictEqual(body[0].activeHotspotsCount, 3);
    assert.strictEqual(body[0].trend, 'up');
    assert.strictEqual(body[0].confidenceScore, 88);
    assert.strictEqual(body[0].lastUpdated, '2024-01-15T15:00:00Z');
  });

  it('returns 403 for missing API key', async () => {
    const handler = createRiskProvincesHandler({ getAllRiskScores: async () => [] });
    const response = await handler(makeEvent({ headers: {} }));
    assert.strictEqual(response.statusCode, 403);
  });

  it('returns 403 for invalid API key', async () => {
    const handler = createRiskProvincesHandler({ getAllRiskScores: async () => [] });
    const response = await handler(makeEvent({ headers: { 'x-api-key': 'wrong' } }));
    assert.strictEqual(response.statusCode, 403);
  });

  it('returns 500 on DDB error without exposing details', async () => {
    const handler = createRiskProvincesHandler({
      getAllRiskScores: async () => { throw new Error('DDB throttled'); },
    });
    const response = await handler(makeEvent());
    assert.strictEqual(response.statusCode, 500);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.error, 'Internal server error');
    assert.ok(!response.body.includes('DDB'));
  });
});

// ============================================
// GET /risk/zones
// ============================================

describe('GET /risk/zones', () => {
  const mockZones: RiskZoneItem[] = [{
    PK: 'RISK#ZONES', SK: 'GRID#cell-001' as `GRID#${string}`,
    GSI1PK: 'PROVINCE#Córdoba' as `PROVINCE#${string}`, GSI1SK: 'FWI#060' as `FWI#${string}`,
    bounds: [[-32, -65], [-31, -64]], fwi: 60, riskLevel: 'Alto',
    hotspotsInCell: 2, lastUpdated: '2024-01-15T15:00:00Z',
  }];

  it('returns 200 with formatted zone array', async () => {
    const handler = createRiskZonesHandler({ queryRiskZones: async () => mockZones });
    const response = await handler(makeEvent());
    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(Array.isArray(body));
    assert.strictEqual(body[0].id, 'cell-001');
    assert.deepStrictEqual(body[0].bounds, [[-32, -65], [-31, -64]]);
    assert.strictEqual(body[0].fwi, 60);
    assert.strictEqual(body[0].riskLevel, 'Alto');
    assert.strictEqual(body[0].hotspotsInCell, 2);
  });

  it('returns 403 for missing API key', async () => {
    const handler = createRiskZonesHandler({ queryRiskZones: async () => [] });
    const response = await handler(makeEvent({ headers: {} }));
    assert.strictEqual(response.statusCode, 403);
  });

  it('returns 500 on DDB error', async () => {
    const handler = createRiskZonesHandler({
      queryRiskZones: async () => { throw new Error('timeout'); },
    });
    const response = await handler(makeEvent());
    assert.strictEqual(response.statusCode, 500);
    assert.ok(!response.body.includes('timeout'));
  });
});

// ============================================
// GET /hotspots
// ============================================

describe('GET /hotspots', () => {
  const mockHotspots: HotspotItem[] = [{
    PK: 'HOTSPOT#h1' as `HOTSPOT#${string}`,
    SK: 'TS#2024-01-15T14:20:00.000Z#h1' as `TS#${string}#${string}`,
    GSI1PK: 'DATE#2024-01-15' as `DATE#${string}`,
    GSI1SK: 'PROV#Córdoba' as `PROV#${string}`,
    lat: -31.42, lng: -64.49, brightness: 335.4, confidence: 95,
    satellite: 'VIIRS', province: 'Córdoba',
    TTL: Math.floor(Date.now() / 1000) + 86400,
  }];

  it('returns 200 with formatted hotspot array', async () => {
    const handler = createHotspotsHandler({ queryRecentHotspots: async () => mockHotspots });
    const response = await handler(makeEvent());
    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(Array.isArray(body));
    assert.strictEqual(body[0].lat, -31.42);
    assert.strictEqual(body[0].lng, -64.49);
    assert.strictEqual(body[0].brightness, 335.4);
    assert.strictEqual(body[0].confidence, 95);
    assert.strictEqual(body[0].satellite, 'VIIRS');
    assert.strictEqual(body[0].province, 'Córdoba');
    assert.ok(body[0].date.includes('2024-01-15'));
  });

  it('returns 403 for invalid API key', async () => {
    const handler = createHotspotsHandler({ queryRecentHotspots: async () => [] });
    const response = await handler(makeEvent({ headers: { 'x-api-key': 'bad' } }));
    assert.strictEqual(response.statusCode, 403);
  });

  it('returns 500 on error without details', async () => {
    const handler = createHotspotsHandler({
      queryRecentHotspots: async () => { throw new Error('connection refused'); },
    });
    const response = await handler(makeEvent());
    assert.strictEqual(response.statusCode, 500);
    assert.ok(!response.body.includes('connection'));
  });

  it('returns empty array when no hotspots exist', async () => {
    const handler = createHotspotsHandler({ queryRecentHotspots: async () => [] });
    const response = await handler(makeEvent());
    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(response.body), []);
  });
});

// ============================================
// GET /alerts
// ============================================

describe('GET /alerts', () => {
  const mockAlerts: AlertItem[] = [{
    PK: 'ALERT#Córdoba' as `ALERT#${string}`,
    SK: 'TS#2024-01-15T15:00:00Z#a1' as `TS#${string}#${string}`,
    GSI1PK: 'SEVERITY#Crítico' as `SEVERITY#${string}`,
    GSI1SK: 'TS#2024-01-15T15:00:00Z' as `TS#${string}`,
    title: 'Alerta test', description: 'Desc', severity: 'Crítico',
    type: 'Incendio', locationName: 'Córdoba',
    coordinates: { lat: -31.4, lng: -64.2 }, radius: 50,
    TTL: Math.floor(Date.now() / 1000) + 604800,
  }];

  it('returns 200 with formatted alert array', async () => {
    const handler = createAlertsHandler({ queryAlerts: async () => mockAlerts });
    const response = await handler(makeEvent());
    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(Array.isArray(body));
    assert.strictEqual(body[0].title, 'Alerta test');
    assert.strictEqual(body[0].severity, 'Crítico');
    assert.strictEqual(body[0].type, 'Incendio');
    assert.strictEqual(body[0].locationName, 'Córdoba');
    assert.deepStrictEqual(body[0].coordinates, { lat: -31.4, lng: -64.2 });
    assert.strictEqual(body[0].radius, 50);
  });

  it('returns 403 for missing key', async () => {
    const handler = createAlertsHandler({ queryAlerts: async () => [] });
    const response = await handler(makeEvent({ headers: {} }));
    assert.strictEqual(response.statusCode, 403);
  });

  it('returns 500 on error', async () => {
    const handler = createAlertsHandler({
      queryAlerts: async () => { throw new Error('throttled'); },
    });
    const response = await handler(makeEvent());
    assert.strictEqual(response.statusCode, 500);
  });
});

// ============================================
// POST /subscriptions
// ============================================

describe('POST /subscriptions', () => {
  const validBody = JSON.stringify({
    email: 'test@example.com',
    provinces: ['Córdoba'],
    minSeverity: 'Alto',
  });

  it('returns 200 with pending_verification status', async () => {
    const handler = createSubscriptionsHandler({
      putSubscription: async () => {},
      verifierDeps: {
        persistToken: async () => {},
        getToken: async () => null,
        deleteToken: async () => {},
        markSubscriptionsVerified: async () => {},
        sendVerificationEmail: async () => {},
      },
    });
    const response = await handler(makeEvent({ body: validBody }));
    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.status, 'pending_verification');
  });

  it('returns 403 for missing API key', async () => {
    const handler = createSubscriptionsHandler({
      putSubscription: async () => {},
      verifierDeps: {
        persistToken: async () => {},
        getToken: async () => null,
        deleteToken: async () => {},
        markSubscriptionsVerified: async () => {},
        sendVerificationEmail: async () => {},
      },
    });
    const response = await handler(makeEvent({ headers: {}, body: validBody }));
    assert.strictEqual(response.statusCode, 403);
  });

  it('returns 400 for invalid JSON body', async () => {
    const handler = createSubscriptionsHandler({
      putSubscription: async () => {},
      verifierDeps: {
        persistToken: async () => {},
        getToken: async () => null,
        deleteToken: async () => {},
        markSubscriptionsVerified: async () => {},
        sendVerificationEmail: async () => {},
      },
    });
    const response = await handler(makeEvent({ body: 'not json' }));
    assert.strictEqual(response.statusCode, 400);
  });

  it('returns 400 for missing email', async () => {
    const handler = createSubscriptionsHandler({
      putSubscription: async () => {},
      verifierDeps: {
        persistToken: async () => {},
        getToken: async () => null,
        deleteToken: async () => {},
        markSubscriptionsVerified: async () => {},
        sendVerificationEmail: async () => {},
      },
    });
    const response = await handler(makeEvent({
      body: JSON.stringify({ provinces: ['Córdoba'], minSeverity: 'Alto' }),
    }));
    assert.strictEqual(response.statusCode, 400);
    assert.ok(response.body.includes('email'));
  });

  it('returns 400 for invalid province', async () => {
    const handler = createSubscriptionsHandler({
      putSubscription: async () => {},
      verifierDeps: {
        persistToken: async () => {},
        getToken: async () => null,
        deleteToken: async () => {},
        markSubscriptionsVerified: async () => {},
        sendVerificationEmail: async () => {},
      },
    });
    const response = await handler(makeEvent({
      body: JSON.stringify({ email: 'a@b.com', provinces: ['Narnia'], minSeverity: 'Alto' }),
    }));
    assert.strictEqual(response.statusCode, 400);
    assert.ok(response.body.includes('province'));
  });

  it('returns 400 for invalid severity', async () => {
    const handler = createSubscriptionsHandler({
      putSubscription: async () => {},
      verifierDeps: {
        persistToken: async () => {},
        getToken: async () => null,
        deleteToken: async () => {},
        markSubscriptionsVerified: async () => {},
        sendVerificationEmail: async () => {},
      },
    });
    const response = await handler(makeEvent({
      body: JSON.stringify({ email: 'a@b.com', provinces: ['Córdoba'], minSeverity: 'Extreme' }),
    }));
    assert.strictEqual(response.statusCode, 400);
    assert.ok(response.body.includes('Severity'));
  });

  it('returns 500 on DDB write error', async () => {
    const handler = createSubscriptionsHandler({
      putSubscription: async () => { throw new Error('DDB write failed'); },
      verifierDeps: {
        persistToken: async () => {},
        getToken: async () => null,
        deleteToken: async () => {},
        markSubscriptionsVerified: async () => {},
        sendVerificationEmail: async () => {},
      },
    });
    const response = await handler(makeEvent({ body: validBody }));
    assert.strictEqual(response.statusCode, 500);
    assert.ok(!response.body.includes('DDB'));
  });
});

// ============================================
// Response format compatibility
// ============================================

describe('API handlers — response format', () => {
  it('all responses include Content-Type: application/json', async () => {
    const riskHandler = createRiskProvincesHandler({ getAllRiskScores: async () => [] });
    const zonesHandler = createRiskZonesHandler({ queryRiskZones: async () => [] });
    const hotspotsH = createHotspotsHandler({ queryRecentHotspots: async () => [] });
    const alertsH = createAlertsHandler({ queryAlerts: async () => [] });

    const responses = await Promise.all([
      riskHandler(makeEvent()),
      zonesHandler(makeEvent()),
      hotspotsH(makeEvent()),
      alertsH(makeEvent()),
      healthHandler(makeEvent()),
    ]);

    for (const r of responses) {
      assert.strictEqual(r.headers['Content-Type'], 'application/json');
    }
  });

  it('403 responses do not reveal whether key exists', async () => {
    const handler = createRiskProvincesHandler({ getAllRiskScores: async () => [] });
    const r1 = await handler(makeEvent({ headers: {} }));
    const r2 = await handler(makeEvent({ headers: { 'x-api-key': 'nonexistent' } }));

    // Both should return identical error body
    assert.strictEqual(r1.body, r2.body);
    assert.strictEqual(JSON.parse(r1.body).error, 'Forbidden');
  });
});
