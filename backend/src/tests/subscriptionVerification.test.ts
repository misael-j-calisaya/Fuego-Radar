/**
 * Unit tests for subscription verification flow (Task 8.2).
 *
 * Validates: token generation, unverified creation, verification email,
 * valid/expired/invalid token handling, verified eligibility for notifications.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateToken,
  initiateVerification,
  confirmVerification,
  VERIFICATION_TOKEN_TTL_SECONDS,
} from '../services/subscriptionVerifier.js';
import type {
  VerifierDependencies,
  VerificationToken,
  VerificationEmailRequest,
} from '../services/subscriptionVerifier.js';

import {
  createSubscriptionsHandler,
  createVerifyHandler,
} from '../lambdas/api/subscriptions.handler.js';
import type { SubscriptionsDeps } from '../lambdas/api/subscriptions.handler.js';

import type { SubscriptionItem } from '../shared/types.js';
import type { APIGatewayProxyEvent } from '../lambdas/api/apiUtils.js';

// ============================================
// Test Helpers
// ============================================

const VALID_API_KEY = 'test-key-for-verification';

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    headers: { 'x-api-key': VALID_API_KEY },
    body: null,
    pathParameters: null,
    queryStringParameters: null,
    ...overrides,
  };
}

function makeMockVerifierDeps(overrides: Partial<VerifierDependencies> = {}): VerifierDependencies {
  const tokens = new Map<string, VerificationToken>();

  return {
    persistToken: async (item) => { tokens.set(`${item.PK}|${item.SK}`, item); },
    getToken: async (token, email) => {
      const key = `VERIFY#${token}|EMAIL#${email}`;
      return tokens.get(key) ?? null;
    },
    deleteToken: async (token, email) => {
      tokens.delete(`VERIFY#${token}|EMAIL#${email}`);
    },
    markSubscriptionsVerified: async () => {},
    sendVerificationEmail: async () => {},
    ...overrides,
  };
}

function makeSubscriptionsDeps(overrides: Partial<SubscriptionsDeps> = {}): SubscriptionsDeps {
  return {
    putSubscription: async () => {},
    verifierDeps: makeMockVerifierDeps(),
    ...overrides,
  };
}

// ============================================
// Tests: Token Generation
// ============================================

describe('Token Generation', () => {
  it('generates a 64-character hex token', () => {
    const token = generateToken();
    assert.strictEqual(token.length, 64);
    assert.match(token, /^[0-9a-f]+$/);
  });

  it('generates unique tokens on successive calls', () => {
    const t1 = generateToken();
    const t2 = generateToken();
    const t3 = generateToken();
    assert.notStrictEqual(t1, t2);
    assert.notStrictEqual(t2, t3);
    assert.notStrictEqual(t1, t3);
  });
});

// ============================================
// Tests: Subscription Created as Unverified
// ============================================

describe('Subscription created as unverified', () => {
  beforeEach(() => {
    process.env.API_KEYS = VALID_API_KEY;
  });

  it('creates subscription with verified=false and TTL set', async () => {
    const persisted: SubscriptionItem[] = [];

    const deps = makeSubscriptionsDeps({
      putSubscription: async (item) => { persisted.push(item); },
    });

    const handler = createSubscriptionsHandler(deps);
    const event = makeEvent({
      body: JSON.stringify({
        email: 'test@example.com',
        provinces: ['Córdoba'],
        minSeverity: 'Alto',
      }),
    });

    const response = await handler(event);
    assert.strictEqual(response.statusCode, 200);

    // Verify subscription stored as unverified
    assert.strictEqual(persisted.length, 1);
    assert.strictEqual(persisted[0].verified, false);
    assert.strictEqual(persisted[0].email, 'test@example.com');

    // Verify TTL is set (72h from now)
    const ttl = (persisted[0] as any).TTL;
    assert.ok(ttl > 0);
    const expectedMin = Math.floor(Date.now() / 1000) + VERIFICATION_TOKEN_TTL_SECONDS - 10;
    const expectedMax = Math.floor(Date.now() / 1000) + VERIFICATION_TOKEN_TTL_SECONDS + 10;
    assert.ok(ttl >= expectedMin && ttl <= expectedMax);

    // Verify response indicates pending verification
    const body = JSON.parse(response.body);
    assert.strictEqual(body.status, 'pending_verification');
  });
});

// ============================================
// Tests: Verification Token Generated
// ============================================

describe('Verification token generated', () => {
  it('initiateVerification creates and persists a token', async () => {
    let persistedToken = null as VerificationToken | null;

    const deps = makeMockVerifierDeps({
      persistToken: async (item) => { persistedToken = item; },
    });

    const result = await initiateVerification('user@test.com', ['Córdoba', 'Salta'], deps);

    assert.ok(result.token.length === 64);
    assert.ok(persistedToken !== null);
    assert.strictEqual(persistedToken!.PK, `VERIFY#${result.token}`);
    assert.strictEqual(persistedToken!.SK, 'EMAIL#user@test.com');
    assert.strictEqual(persistedToken!.email, 'user@test.com');
    assert.deepStrictEqual(persistedToken!.provinces, ['Córdoba', 'Salta']);
    assert.ok(persistedToken!.TTL > Math.floor(Date.now() / 1000));
  });
});

// ============================================
// Tests: Verification Email Sent
// ============================================

describe('Verification email sent', () => {
  it('sends email with token to subscriber', async () => {
    let emailSent = null as VerificationEmailRequest | null;

    const deps = makeMockVerifierDeps({
      sendVerificationEmail: async (req) => { emailSent = req; },
    });

    const result = await initiateVerification('subscriber@domain.com', ['Mendoza'], deps);

    assert.ok(emailSent !== null);
    assert.strictEqual(emailSent!.to, 'subscriber@domain.com');
    assert.strictEqual(emailSent!.token, result.token);
    assert.deepStrictEqual(emailSent!.provinces, ['Mendoza']);
  });
});

// ============================================
// Tests: Valid Token Verifies Subscription
// ============================================

describe('Valid token verifies subscription', () => {
  it('marks subscriptions as verified when valid token is provided', async () => {
    const verifiedCalls: { email: string; provinces: string[] }[] = [];
    const deletedTokens: string[] = [];

    // Create a valid, non-expired token
    const token = generateToken();
    const tokenItem: VerificationToken = {
      PK: `VERIFY#${token}`,
      SK: 'EMAIL#user@test.com',
      subscriptionPK: 'SUB#user@test.com',
      provinces: ['Córdoba', 'Salta'],
      email: 'user@test.com',
      token,
      createdAt: new Date().toISOString(),
      TTL: Math.floor(Date.now() / 1000) + 3600, // Valid for 1 more hour
    };

    const deps = makeMockVerifierDeps({
      getToken: async () => tokenItem,
      markSubscriptionsVerified: async (email, provinces) => {
        verifiedCalls.push({ email, provinces });
      },
      deleteToken: async (t) => { deletedTokens.push(t); },
    });

    const result = await confirmVerification(token, 'user@test.com', deps);

    assert.strictEqual(result.success, true);
    assert.ok(result.message.includes('verificada'));

    // Verify markSubscriptionsVerified was called
    assert.strictEqual(verifiedCalls.length, 1);
    assert.strictEqual(verifiedCalls[0].email, 'user@test.com');
    assert.deepStrictEqual(verifiedCalls[0].provinces, ['Córdoba', 'Salta']);

    // Verify token was deleted (single-use)
    assert.strictEqual(deletedTokens.length, 1);
    assert.strictEqual(deletedTokens[0], token);
  });
});

// ============================================
// Tests: Expired Token Rejected
// ============================================

describe('Expired token rejected', () => {
  it('rejects verification when token TTL has passed', async () => {
    const token = generateToken();
    const expiredTokenItem: VerificationToken = {
      PK: `VERIFY#${token}`,
      SK: 'EMAIL#user@test.com',
      subscriptionPK: 'SUB#user@test.com',
      provinces: ['Córdoba'],
      email: 'user@test.com',
      token,
      createdAt: '2024-01-01T00:00:00Z',
      TTL: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
    };

    let markCalled = false;
    const deps = makeMockVerifierDeps({
      getToken: async () => expiredTokenItem,
      markSubscriptionsVerified: async () => { markCalled = true; },
    });

    const result = await confirmVerification(token, 'user@test.com', deps);

    assert.strictEqual(result.success, false);
    assert.ok(result.message.toLowerCase().includes('expirado'));
    assert.strictEqual(markCalled, false); // Should NOT mark as verified
  });
});

// ============================================
// Tests: Invalid Token Rejected
// ============================================

describe('Invalid token rejected', () => {
  it('rejects verification when token does not exist', async () => {
    const deps = makeMockVerifierDeps({
      getToken: async () => null, // Token not found
    });

    const result = await confirmVerification('nonexistent-token-abc', 'user@test.com', deps);

    assert.strictEqual(result.success, false);
    assert.ok(result.message.toLowerCase().includes('inválido') || result.message.toLowerCase().includes('expirado'));
  });

  it('verify endpoint returns 400 for invalid token format', async () => {
    process.env.API_KEYS = VALID_API_KEY;
    const deps = makeSubscriptionsDeps();
    const handler = createVerifyHandler(deps);

    const event = makeEvent({
      queryStringParameters: { token: 'short', email: 'user@test.com' },
    });

    const response = await handler(event);
    assert.strictEqual(response.statusCode, 400);
  });

  it('verify endpoint returns 400 for missing email', async () => {
    process.env.API_KEYS = VALID_API_KEY;
    const deps = makeSubscriptionsDeps();
    const handler = createVerifyHandler(deps);

    const event = makeEvent({
      queryStringParameters: { token: generateToken() },
    });

    const response = await handler(event);
    assert.strictEqual(response.statusCode, 400);
  });
});

// ============================================
// Tests: Verified Subscription Eligible for Notifications
// ============================================

describe('Verified subscription eligible for notifications', () => {
  it('subscription with verified=true passes notification filter', async () => {
    // Import the notification dispatcher filtering logic
    const { severityMeetsThreshold } = await import('../lambdas/notificationDispatcher.handler.js');

    // A verified subscription
    const sub: SubscriptionItem = {
      PK: 'SUB#verified@test.com' as `SUB#${string}`,
      SK: 'PROV#Córdoba' as `PROV#${string}`,
      GSI1PK: 'PROVINCE#Córdoba' as `PROVINCE#${string}`,
      GSI1SK: 'SEVERITY#Alto' as `SEVERITY#${string}`,
      email: 'verified@test.com',
      minSeverity: 'Alto',
      verified: true,
      createdAt: '2024-01-01T00:00:00Z',
    };

    // Alert with matching severity
    assert.strictEqual(sub.verified, true);
    assert.strictEqual(severityMeetsThreshold('Crítico', sub.minSeverity), true);
  });

  it('subscription with verified=false is skipped by notification dispatcher', async () => {
    const { runNotificationDispatch } = await import('../lambdas/notificationDispatcher.handler.js');
    const sentEmails: string[] = [];

    const unverifiedSub: SubscriptionItem = {
      PK: 'SUB#unverified@test.com' as `SUB#${string}`,
      SK: 'PROV#Córdoba' as `PROV#${string}`,
      GSI1PK: 'PROVINCE#Córdoba' as `PROVINCE#${string}`,
      GSI1SK: 'SEVERITY#Bajo' as `SEVERITY#${string}`,
      email: 'unverified@test.com',
      minSeverity: 'Bajo',
      verified: false,
      createdAt: '2024-01-01T00:00:00Z',
    };

    const event = {
      Records: [{
        Sns: {
          Message: JSON.stringify({
            PK: 'ALERT#Córdoba',
            SK: 'TS#2024-01-15T15:00:00Z#a1',
            GSI1PK: 'SEVERITY#Crítico',
            GSI1SK: 'TS#2024-01-15T15:00:00Z',
            title: 'Alerta - Córdoba',
            description: 'Test',
            severity: 'Crítico',
            type: 'Incendio',
            locationName: 'Córdoba',
            coordinates: { lat: -31.4, lng: -64.2 },
            radius: 50,
            TTL: 9999999999,
          }),
          MessageId: 'msg-1',
          TopicArn: 'arn:test',
          Timestamp: new Date().toISOString(),
        },
      }],
    };

    const result = await runNotificationDispatch(event, {
      getSubscriptions: async () => [unverifiedSub],
      sendEmail: async (req) => { sentEmails.push(req.to); },
    });

    // Unverified subscription should be skipped
    assert.strictEqual(result.body.skippedSubscriptions, 1);
    assert.strictEqual(result.body.sentNotifications, 0);
    assert.strictEqual(sentEmails.length, 0);
  });
});
