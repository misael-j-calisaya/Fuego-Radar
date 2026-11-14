/**
 * Unit tests for Notification Dispatcher Lambda (Task 8.1).
 *
 * Validates: SNS event parsing, subscription filtering (province, severity,
 * verified status), SES failure isolation, malformed message handling.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runNotificationDispatch,
  parseAlertFromSNS,
  severityMeetsThreshold,
} from '../lambdas/notificationDispatcher.handler.js';
import type {
  SNSEvent,
  NotificationDependencies,
  EmailRequest,
} from '../lambdas/notificationDispatcher.handler.js';
import type { AlertItem, SubscriptionItem, AlertSeverity } from '../shared/types.js';

// ============================================
// Test Helpers
// ============================================

function makeAlert(overrides: Partial<AlertItem> = {}): AlertItem {
  return {
    PK: 'ALERT#Córdoba' as `ALERT#${string}`,
    SK: 'TS#2024-01-15T15:00:00Z#alert-1' as `TS#${string}#${string}`,
    GSI1PK: 'SEVERITY#Crítico' as `SEVERITY#${string}`,
    GSI1SK: 'TS#2024-01-15T15:00:00Z' as `TS#${string}`,
    title: 'Alerta de incendio - Córdoba',
    description: 'Condiciones extremas de incendio forestal',
    severity: 'Crítico',
    type: 'Incendio',
    locationName: 'Córdoba',
    coordinates: { lat: -31.42, lng: -64.18 },
    radius: 50,
    TTL: Math.floor(Date.now() / 1000) + 604800,
    ...overrides,
  };
}

function makeSub(overrides: Partial<SubscriptionItem> = {}): SubscriptionItem {
  return {
    PK: 'SUB#user-1' as `SUB#${string}`,
    SK: 'PROV#Córdoba' as `PROV#${string}`,
    GSI1PK: 'PROVINCE#Córdoba' as `PROVINCE#${string}`,
    GSI1SK: 'SEVERITY#Alto' as `SEVERITY#${string}`,
    email: 'subscriber@example.com',
    minSeverity: 'Alto',
    verified: true,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeSNSEvent(alerts: AlertItem[]): SNSEvent {
  return {
    Records: alerts.map((alert, idx) => ({
      Sns: {
        Message: JSON.stringify(alert),
        MessageId: `msg-${idx}`,
        TopicArn: 'arn:aws:sns:us-east-1:123456789:FireRiskEngine-CriticalAlerts',
        Timestamp: new Date().toISOString(),
      },
    })),
  };
}

function makeDeps(overrides: Partial<NotificationDependencies> = {}): NotificationDependencies {
  return {
    getSubscriptions: async () => [],
    sendEmail: async () => {},
    ...overrides,
  };
}

// ============================================
// Tests: severityMeetsThreshold
// ============================================

describe('severityMeetsThreshold', () => {
  it('Crítico meets Alto threshold', () => {
    assert.strictEqual(severityMeetsThreshold('Crítico', 'Alto'), true);
  });

  it('Alto meets Alto threshold (equal)', () => {
    assert.strictEqual(severityMeetsThreshold('Alto', 'Alto'), true);
  });

  it('Medio does NOT meet Alto threshold', () => {
    assert.strictEqual(severityMeetsThreshold('Medio', 'Alto'), false);
  });

  it('Bajo does NOT meet Medio threshold', () => {
    assert.strictEqual(severityMeetsThreshold('Bajo', 'Medio'), false);
  });

  it('Crítico meets Bajo threshold', () => {
    assert.strictEqual(severityMeetsThreshold('Crítico', 'Bajo'), true);
  });
});

// ============================================
// Tests: parseAlertFromSNS
// ============================================

describe('parseAlertFromSNS', () => {
  it('parses valid alert JSON', () => {
    const alert = makeAlert();
    const result = parseAlertFromSNS(JSON.stringify(alert));
    assert.ok(result !== null);
    assert.strictEqual(result!.locationName, 'Córdoba');
    assert.strictEqual(result!.severity, 'Crítico');
  });

  it('returns null for invalid JSON', () => {
    const result = parseAlertFromSNS('not json at all {{{');
    assert.strictEqual(result, null);
  });

  it('returns null for missing required fields', () => {
    const result = parseAlertFromSNS(JSON.stringify({ foo: 'bar' }));
    assert.strictEqual(result, null);
  });

  it('returns null for empty string', () => {
    const result = parseAlertFromSNS('');
    assert.strictEqual(result, null);
  });
});

// ============================================
// Tests: Full Dispatch Pipeline
// ============================================

describe('Notification Dispatcher - valid SNS alert', () => {
  it('sends notification to verified subscriber matching province and severity', async () => {
    const sentEmails: EmailRequest[] = [];
    const alert = makeAlert({ severity: 'Crítico', locationName: 'Córdoba' });
    const sub = makeSub({ minSeverity: 'Alto', verified: true });

    const deps = makeDeps({
      getSubscriptions: async () => [sub],
      sendEmail: async (req) => { sentEmails.push(req); },
    });

    const result = await runNotificationDispatch(makeSNSEvent([alert]), deps);

    assert.strictEqual(result.body.receivedAlerts, 1);
    assert.strictEqual(result.body.matchedSubscriptions, 1);
    assert.strictEqual(result.body.sentNotifications, 1);
    assert.strictEqual(result.body.skippedSubscriptions, 0);
    assert.strictEqual(result.body.failedNotifications, 0);

    // Verify email content
    assert.strictEqual(sentEmails.length, 1);
    assert.strictEqual(sentEmails[0].to, 'subscriber@example.com');
    assert.ok(sentEmails[0].subject.includes('Córdoba'));
    assert.ok(sentEmails[0].subject.includes('Crítico'));
    assert.ok(sentEmails[0].body.includes('Córdoba'));
  });
});

describe('Notification Dispatcher - filtering by province', () => {
  it('only queries subscriptions for the affected province', async () => {
    const queriedProvinces: string[] = [];
    const alert = makeAlert({ locationName: 'Salta' });

    const deps = makeDeps({
      getSubscriptions: async (province) => {
        queriedProvinces.push(province);
        return [];
      },
    });

    await runNotificationDispatch(makeSNSEvent([alert]), deps);

    assert.strictEqual(queriedProvinces.length, 1);
    assert.strictEqual(queriedProvinces[0], 'Salta');
  });
});

describe('Notification Dispatcher - filtering by severity', () => {
  it('skips subscriber whose minSeverity is higher than the alert severity', async () => {
    const sentEmails: EmailRequest[] = [];
    const alert = makeAlert({ severity: 'Medio' }); // Medio alert
    const sub = makeSub({ minSeverity: 'Alto' });    // Wants Alto or above

    const deps = makeDeps({
      getSubscriptions: async () => [sub],
      sendEmail: async (req) => { sentEmails.push(req); },
    });

    const result = await runNotificationDispatch(makeSNSEvent([alert]), deps);

    assert.strictEqual(result.body.matchedSubscriptions, 0);
    assert.strictEqual(result.body.skippedSubscriptions, 1);
    assert.strictEqual(result.body.sentNotifications, 0);
    assert.strictEqual(sentEmails.length, 0);
  });

  it('sends to subscriber whose minSeverity equals the alert severity', async () => {
    const sentEmails: EmailRequest[] = [];
    const alert = makeAlert({ severity: 'Alto' });
    const sub = makeSub({ minSeverity: 'Alto' });

    const deps = makeDeps({
      getSubscriptions: async () => [sub],
      sendEmail: async (req) => { sentEmails.push(req); },
    });

    const result = await runNotificationDispatch(makeSNSEvent([alert]), deps);

    assert.strictEqual(result.body.matchedSubscriptions, 1);
    assert.strictEqual(result.body.sentNotifications, 1);
    assert.strictEqual(sentEmails.length, 1);
  });
});

describe('Notification Dispatcher - inactive/unverified subscriptions', () => {
  it('skips unverified subscription (verified: false)', async () => {
    const sentEmails: EmailRequest[] = [];
    const alert = makeAlert({ severity: 'Crítico' });
    const sub = makeSub({ verified: false });

    const deps = makeDeps({
      getSubscriptions: async () => [sub],
      sendEmail: async (req) => { sentEmails.push(req); },
    });

    const result = await runNotificationDispatch(makeSNSEvent([alert]), deps);

    assert.strictEqual(result.body.skippedSubscriptions, 1);
    assert.strictEqual(result.body.matchedSubscriptions, 0);
    assert.strictEqual(result.body.sentNotifications, 0);
    assert.strictEqual(sentEmails.length, 0);
  });

  it('processes verified subscription normally', async () => {
    const sentEmails: EmailRequest[] = [];
    const alert = makeAlert({ severity: 'Crítico' });
    const sub = makeSub({ verified: true, minSeverity: 'Bajo' });

    const deps = makeDeps({
      getSubscriptions: async () => [sub],
      sendEmail: async (req) => { sentEmails.push(req); },
    });

    const result = await runNotificationDispatch(makeSNSEvent([alert]), deps);

    assert.strictEqual(result.body.matchedSubscriptions, 1);
    assert.strictEqual(result.body.sentNotifications, 1);
    assert.strictEqual(sentEmails.length, 1);
  });
});

describe('Notification Dispatcher - SES failure isolation', () => {
  it('SES failure for one subscriber does not stop others', async () => {
    const sentEmails: EmailRequest[] = [];
    const alert = makeAlert({ severity: 'Crítico' });

    const sub1 = makeSub({
      PK: 'SUB#user-1' as `SUB#${string}`,
      email: 'user1@example.com',
      minSeverity: 'Bajo',
    });
    const sub2 = makeSub({
      PK: 'SUB#user-2' as `SUB#${string}`,
      email: 'user2@example.com',
      minSeverity: 'Bajo',
    });
    const sub3 = makeSub({
      PK: 'SUB#user-3' as `SUB#${string}`,
      email: 'user3@example.com',
      minSeverity: 'Bajo',
    });

    let callCount = 0;
    const deps = makeDeps({
      getSubscriptions: async () => [sub1, sub2, sub3],
      sendEmail: async (req) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('SES rate limit exceeded');
        }
        sentEmails.push(req);
      },
    });

    const result = await runNotificationDispatch(makeSNSEvent([alert]), deps);

    // 3 matched, 2 sent successfully, 1 failed
    assert.strictEqual(result.body.matchedSubscriptions, 3);
    assert.strictEqual(result.body.sentNotifications, 2);
    assert.strictEqual(result.body.failedNotifications, 1);
    assert.strictEqual(sentEmails.length, 2);
    // Verify the right emails were sent (1st and 3rd)
    assert.strictEqual(sentEmails[0].to, 'user1@example.com');
    assert.strictEqual(sentEmails[1].to, 'user3@example.com');
  });
});

describe('Notification Dispatcher - malformed SNS message', () => {
  it('handles malformed SNS message gracefully without crashing', async () => {
    const event: SNSEvent = {
      Records: [
        {
          Sns: {
            Message: 'this is not valid JSON!!!',
            MessageId: 'bad-msg-1',
            TopicArn: 'arn:aws:sns:us-east-1:123:topic',
            Timestamp: new Date().toISOString(),
          },
        },
        {
          Sns: {
            Message: JSON.stringify(makeAlert()),
            MessageId: 'good-msg-1',
            TopicArn: 'arn:aws:sns:us-east-1:123:topic',
            Timestamp: new Date().toISOString(),
          },
        },
      ],
    };

    const sentEmails: EmailRequest[] = [];
    const deps = makeDeps({
      getSubscriptions: async () => [makeSub({ minSeverity: 'Bajo' })],
      sendEmail: async (req) => { sentEmails.push(req); },
    });

    const result = await runNotificationDispatch(event, deps);

    // First record skipped (malformed), second processed
    assert.strictEqual(result.body.receivedAlerts, 1);
    assert.strictEqual(result.body.sentNotifications, 1);
    assert.strictEqual(sentEmails.length, 1);
  });

  it('handles empty Records array', async () => {
    const event: SNSEvent = { Records: [] };

    const deps = makeDeps();
    const result = await runNotificationDispatch(event, deps);

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.receivedAlerts, 0);
    assert.strictEqual(result.body.sentNotifications, 0);
  });

  it('handles SNS message with missing required alert fields', async () => {
    const event: SNSEvent = {
      Records: [
        {
          Sns: {
            Message: JSON.stringify({ description: 'no title or location' }),
            MessageId: 'partial-msg',
            TopicArn: 'arn:aws:sns:us-east-1:123:topic',
            Timestamp: new Date().toISOString(),
          },
        },
      ],
    };

    const deps = makeDeps();
    const result = await runNotificationDispatch(event, deps);

    assert.strictEqual(result.body.receivedAlerts, 0);
    assert.strictEqual(result.body.sentNotifications, 0);
  });
});

describe('Notification Dispatcher - multiple alerts in single event', () => {
  it('processes multiple alerts independently', async () => {
    const sentEmails: EmailRequest[] = [];
    const alert1 = makeAlert({ locationName: 'Córdoba', severity: 'Crítico' });
    const alert2 = makeAlert({ locationName: 'Salta', severity: 'Alto' });

    const deps = makeDeps({
      getSubscriptions: async (province) => {
        if (province === 'Córdoba') {
          return [makeSub({ email: 'cordoba@test.com', minSeverity: 'Alto' })];
        }
        if (province === 'Salta') {
          return [makeSub({ email: 'salta@test.com', minSeverity: 'Alto', SK: 'PROV#Salta' as `PROV#${string}` })];
        }
        return [];
      },
      sendEmail: async (req) => { sentEmails.push(req); },
    });

    const result = await runNotificationDispatch(makeSNSEvent([alert1, alert2]), deps);

    assert.strictEqual(result.body.receivedAlerts, 2);
    assert.strictEqual(result.body.matchedSubscriptions, 2);
    assert.strictEqual(result.body.sentNotifications, 2);
    assert.strictEqual(sentEmails.length, 2);
  });
});
