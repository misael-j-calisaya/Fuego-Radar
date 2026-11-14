/**
 * Property-based tests for notification filtering (Task 8.3).
 *
 * Property 11: Filtrado de notificaciones por criterio
 * For any alert and subscription list, notifications are sent only when:
 * - province matches AND
 * - alert severity >= subscriber's minSeverity AND
 * - subscription is verified
 *
 * Uses fast-check to generate random combinations of province, severity,
 * and subscriber preferences.
 *
 * Validates: Requirements 10.2, 10.3
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  runNotificationDispatch,
  severityMeetsThreshold,
} from '../lambdas/notificationDispatcher.handler.js';
import type {
  SNSEvent,
  NotificationDependencies,
  EmailRequest,
} from '../lambdas/notificationDispatcher.handler.js';
import type { AlertItem, AlertSeverity, SubscriptionItem } from '../shared/types.js';
import { PROVINCES } from '../shared/constants.js';

// ============================================
// Generators
// ============================================

const severityArb: fc.Arbitrary<AlertSeverity> = fc.constantFrom(
  'Bajo' as AlertSeverity,
  'Medio' as AlertSeverity,
  'Alto' as AlertSeverity,
  'Crítico' as AlertSeverity,
);

const provinceArb: fc.Arbitrary<string> = fc.constantFrom(...PROVINCES);

const verifiedArb: fc.Arbitrary<boolean> = fc.boolean();

/** Generates a random alert for a given province and severity */
function alertArb(province: string, severity: AlertSeverity): AlertItem {
  return {
    PK: `ALERT#${province}` as `ALERT#${string}`,
    SK: `TS#2024-01-15T15:00:00Z#test` as `TS#${string}#${string}`,
    GSI1PK: `SEVERITY#${severity}` as `SEVERITY#${string}`,
    GSI1SK: `TS#2024-01-15T15:00:00Z` as `TS#${string}`,
    title: `Alerta - ${province}`,
    description: `Test alert for ${province}`,
    severity,
    type: 'Incendio',
    locationName: province,
    coordinates: { lat: -34.6, lng: -58.4 },
    radius: 50,
    TTL: Math.floor(Date.now() / 1000) + 604800,
  };
}

/** Generates a random subscription for a given province, severity, and verified status */
function subArb(province: string, minSeverity: AlertSeverity, verified: boolean): SubscriptionItem {
  return {
    PK: `SUB#user-${Math.random().toString(36).slice(2)}` as `SUB#${string}`,
    SK: `PROV#${province}` as `PROV#${string}`,
    GSI1PK: `PROVINCE#${province}` as `PROVINCE#${string}`,
    GSI1SK: `SEVERITY#${minSeverity}` as `SEVERITY#${string}`,
    email: `user${Math.floor(Math.random() * 10000)}@test.com`,
    minSeverity,
    verified,
    createdAt: '2024-01-01T00:00:00Z',
  };
}

// ============================================
// Severity ordering helpers
// ============================================

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  'Bajo': 1,
  'Medio': 2,
  'Alto': 3,
  'Crítico': 4,
};

// ============================================
// Property Tests
// ============================================

describe('Property: Severity ordering invariants', () => {
  it('Bajo < Medio < Alto < Crítico (strict total order)', () => {
    fc.assert(
      fc.property(severityArb, severityArb, (s1, s2) => {
        const o1 = SEVERITY_ORDER[s1];
        const o2 = SEVERITY_ORDER[s2];

        if (o1 < o2) {
          // s1 < s2 means s1 does NOT meet s2 threshold
          assert.strictEqual(severityMeetsThreshold(s1, s2), false);
        } else if (o1 === o2) {
          // Equal means it meets threshold
          assert.strictEqual(severityMeetsThreshold(s1, s2), true);
        } else {
          // s1 > s2 means it exceeds threshold
          assert.strictEqual(severityMeetsThreshold(s1, s2), true);
        }
      }),
      { numRuns: 100, seed: 42 },
    );
  });

  it('severityMeetsThreshold is reflexive (any severity meets itself)', () => {
    fc.assert(
      fc.property(severityArb, (severity) => {
        assert.strictEqual(severityMeetsThreshold(severity, severity), true);
      }),
      { numRuns: 50, seed: 42 },
    );
  });

  it('severityMeetsThreshold is transitive', () => {
    fc.assert(
      fc.property(severityArb, severityArb, severityArb, (a, b, c) => {
        // If a >= b and b >= c, then a >= c
        if (severityMeetsThreshold(a, b) && severityMeetsThreshold(b, c)) {
          assert.strictEqual(severityMeetsThreshold(a, c), true);
        }
      }),
      { numRuns: 200, seed: 42 },
    );
  });
});

describe('Property: Subscribers only receive alerts where alertSeverity >= minSeverity', () => {
  it('notification is sent iff severity meets threshold (province match + verified)', async () => {
    await fc.assert(
      fc.asyncProperty(
        provinceArb,
        severityArb,
        severityArb,
        async (province, alertSeverity, minSeverity) => {
          const sentEmails: EmailRequest[] = [];
          const alert = alertArb(province, alertSeverity);
          const sub = subArb(province, minSeverity, true); // Same province, verified

          const event: SNSEvent = {
            Records: [{
              Sns: {
                Message: JSON.stringify(alert),
                MessageId: 'prop-test',
                TopicArn: 'arn:test',
                Timestamp: new Date().toISOString(),
              },
            }],
          };

          const deps: NotificationDependencies = {
            getSubscriptions: async () => [sub],
            sendEmail: async (req) => { sentEmails.push(req); },
          };

          const result = await runNotificationDispatch(event, deps);

          const shouldSend = severityMeetsThreshold(alertSeverity, minSeverity);

          if (shouldSend) {
            assert.strictEqual(result.body.sentNotifications, 1,
              `Expected send for alert=${alertSeverity} min=${minSeverity}`);
            assert.strictEqual(sentEmails.length, 1);
          } else {
            assert.strictEqual(result.body.sentNotifications, 0,
              `Expected skip for alert=${alertSeverity} min=${minSeverity}`);
            assert.strictEqual(sentEmails.length, 0);
          }
        },
      ),
      { numRuns: 50, seed: 42 },
    );
  });
});

describe('Property: Province filtering invariants', () => {
  it('notification is NEVER sent to subscriber of a different province', async () => {
    await fc.assert(
      fc.asyncProperty(
        provinceArb,
        provinceArb,
        severityArb,
        async (alertProvince, subProvince, severity) => {
          // Skip when provinces match (that case is tested above)
          fc.pre(alertProvince !== subProvince);

          const sentEmails: EmailRequest[] = [];
          const alert = alertArb(alertProvince, severity);
          const sub = subArb(subProvince, 'Bajo', true); // Lowest threshold, verified

          const event: SNSEvent = {
            Records: [{
              Sns: {
                Message: JSON.stringify(alert),
                MessageId: 'province-test',
                TopicArn: 'arn:test',
                Timestamp: new Date().toISOString(),
              },
            }],
          };

          const deps: NotificationDependencies = {
            // getSubscriptions is called with the ALERT province
            // If the sub is for a different province, it shouldn't appear
            // in the query results (by design, DDB queries by province)
            getSubscriptions: async (queriedProvince) => {
              // Only return sub if queried province matches sub province
              if (queriedProvince === subProvince) return [sub];
              return []; // Different province → no subscribers
            },
            sendEmail: async (req) => { sentEmails.push(req); },
          };

          const result = await runNotificationDispatch(event, deps);

          // Alert province != sub province → query returns empty → no notification
          assert.strictEqual(result.body.sentNotifications, 0,
            `Should NOT send: alert=${alertProvince} sub=${subProvince}`);
          assert.strictEqual(sentEmails.length, 0);
        },
      ),
      { numRuns: 50, seed: 42 },
    );
  });

  it('notification IS sent when province matches and severity meets threshold', async () => {
    await fc.assert(
      fc.asyncProperty(
        provinceArb,
        severityArb,
        async (province, severity) => {
          const sentEmails: EmailRequest[] = [];
          const alert = alertArb(province, severity);
          // Subscriber with lowest threshold (Bajo) → always meets
          const sub = subArb(province, 'Bajo', true);

          const event: SNSEvent = {
            Records: [{
              Sns: {
                Message: JSON.stringify(alert),
                MessageId: 'match-test',
                TopicArn: 'arn:test',
                Timestamp: new Date().toISOString(),
              },
            }],
          };

          const deps: NotificationDependencies = {
            getSubscriptions: async () => [sub],
            sendEmail: async (req) => { sentEmails.push(req); },
          };

          const result = await runNotificationDispatch(event, deps);

          // Province matches + severity always >= Bajo → always sent
          assert.strictEqual(result.body.sentNotifications, 1);
          assert.strictEqual(sentEmails.length, 1);
        },
      ),
      { numRuns: 50, seed: 42 },
    );
  });
});

describe('Property: Unverified subscriptions NEVER receive notifications', () => {
  it('unverified subscriber never gets email regardless of severity match', async () => {
    await fc.assert(
      fc.asyncProperty(
        provinceArb,
        severityArb,
        severityArb,
        async (province, alertSeverity, minSeverity) => {
          const sentEmails: EmailRequest[] = [];
          const alert = alertArb(province, alertSeverity);
          const sub = subArb(province, minSeverity, false); // UNVERIFIED

          const event: SNSEvent = {
            Records: [{
              Sns: {
                Message: JSON.stringify(alert),
                MessageId: 'unverified-test',
                TopicArn: 'arn:test',
                Timestamp: new Date().toISOString(),
              },
            }],
          };

          const deps: NotificationDependencies = {
            getSubscriptions: async () => [sub],
            sendEmail: async (req) => { sentEmails.push(req); },
          };

          const result = await runNotificationDispatch(event, deps);

          // INVARIANT: unverified = never sent, always skipped
          assert.strictEqual(result.body.sentNotifications, 0,
            `Unverified should NEVER receive: alert=${alertSeverity} min=${minSeverity}`);
          assert.strictEqual(result.body.skippedSubscriptions, 1);
          assert.strictEqual(sentEmails.length, 0);
        },
      ),
      { numRuns: 50, seed: 42 },
    );
  });
});

describe('Property: Mixed verified/unverified batch preserves invariants', () => {
  it('in any batch, only verified+matching subscribers receive notifications', async () => {
    const subsArb = fc.array(
      fc.tuple(severityArb, verifiedArb),
      { minLength: 1, maxLength: 10 },
    );

    await fc.assert(
      fc.asyncProperty(
        provinceArb,
        severityArb,
        subsArb,
        async (province, alertSeverity, subConfigs) => {
          const sentEmails: EmailRequest[] = [];
          const alert = alertArb(province, alertSeverity);

          const subs = subConfigs.map(([minSeverity, verified]) =>
            subArb(province, minSeverity, verified)
          );

          const event: SNSEvent = {
            Records: [{
              Sns: {
                Message: JSON.stringify(alert),
                MessageId: 'batch-test',
                TopicArn: 'arn:test',
                Timestamp: new Date().toISOString(),
              },
            }],
          };

          const deps: NotificationDependencies = {
            getSubscriptions: async () => subs,
            sendEmail: async (req) => { sentEmails.push(req); },
          };

          const result = await runNotificationDispatch(event, deps);

          // Count expected sends: verified AND severity meets threshold
          const expectedSends = subConfigs.filter(
            ([minSev, verified]) => verified && severityMeetsThreshold(alertSeverity, minSev)
          ).length;

          const expectedSkips = subConfigs.length - expectedSends;

          assert.strictEqual(result.body.sentNotifications, expectedSends,
            `Expected ${expectedSends} sends for ${subConfigs.length} subs`);
          assert.strictEqual(result.body.skippedSubscriptions, expectedSkips);
          assert.strictEqual(sentEmails.length, expectedSends);
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });
});
