/**
 * Notification Dispatcher Lambda Handler (Task 8.1)
 *
 * Triggered by SNS CriticalAlerts topic when a province reaches severity ≥ Alto.
 * Flow: SNS event → parse alert → query subscriptions → filter → send emails → report.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.6
 */

import { getSubscriptionsByProvince } from '../data/repository.js';
import { createLogger } from '../shared/logger.js';
import type { AlertItem, AlertSeverity, SubscriptionItem } from '../shared/types.js';

const logger = createLogger('NotificationDispatcher');

// ============================================
// Types
// ============================================

/** SNS event record structure (simplified for Lambda) */
export interface SNSEvent {
  Records: SNSRecord[];
}

export interface SNSRecord {
  Sns: {
    Message: string;
    MessageId: string;
    TopicArn: string;
    Timestamp: string;
  };
}

/** Result returned by the handler */
export interface NotificationResult {
  statusCode: number;
  body: {
    receivedAlerts: number;
    matchedSubscriptions: number;
    sentNotifications: number;
    skippedSubscriptions: number;
    failedNotifications: number;
    timestamp: string;
  };
}

/** Email send request */
export interface EmailRequest {
  to: string;
  subject: string;
  body: string;
}

/** Dependency injection interface for testability */
export interface NotificationDependencies {
  getSubscriptions: (province: string) => Promise<SubscriptionItem[]>;
  sendEmail: (request: EmailRequest) => Promise<void>;
}

// ============================================
// Severity Ordering
// ============================================

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  'Bajo': 1,
  'Medio': 2,
  'Alto': 3,
  'Crítico': 4,
};

/**
 * Returns true if the alert severity meets or exceeds the subscriber's minimum.
 */
export function severityMeetsThreshold(
  alertSeverity: AlertSeverity,
  minSeverity: AlertSeverity,
): boolean {
  return (SEVERITY_ORDER[alertSeverity] ?? 0) >= (SEVERITY_ORDER[minSeverity] ?? 0);
}

// ============================================
// Alert Parsing
// ============================================

/**
 * Parses an SNS message body into an AlertItem.
 * Returns null if the message is malformed.
 */
export function parseAlertFromSNS(message: string): AlertItem | null {
  try {
    const parsed = JSON.parse(message);

    // Validate minimum required fields
    if (
      !parsed.locationName ||
      !parsed.severity ||
      !parsed.title
    ) {
      logger.warn('Malformed alert: missing required fields', {
        hasLocationName: !!parsed.locationName,
        hasSeverity: !!parsed.severity,
        hasTitle: !!parsed.title,
      });
      return null;
    }

    return parsed as AlertItem;
  } catch (error) {
    logger.error('Failed to parse SNS message as JSON', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ============================================
// Email Composition
// ============================================

function composeAlertEmail(alert: AlertItem): { subject: string; body: string } {
  const subject = `🔥 ${alert.title} [${alert.severity}]`;
  const body = [
    `Alerta de Incendio - ${alert.locationName}`,
    `Severidad: ${alert.severity}`,
    `Tipo: ${alert.type}`,
    '',
    alert.description,
    '',
    `Coordenadas: ${alert.coordinates?.lat ?? 'N/A'}, ${alert.coordinates?.lng ?? 'N/A'}`,
    `Radio estimado: ${alert.radius ?? 'N/A'} km`,
    '',
    '---',
    'Fuego Radar - Sistema de Alerta Temprana de Incendios',
    'Este es un mensaje automático. No responda a este correo.',
  ].join('\n');

  return { subject, body };
}

// ============================================
// Core Logic
// ============================================

/**
 * Processes notification dispatch with injected dependencies.
 */
export async function runNotificationDispatch(
  event: SNSEvent,
  deps: NotificationDependencies,
): Promise<NotificationResult> {
  const startTime = Date.now();
  let receivedAlerts = 0;
  let matchedSubscriptions = 0;
  let sentNotifications = 0;
  let skippedSubscriptions = 0;
  let failedNotifications = 0;

  for (const record of event.Records) {
    // Parse alert from SNS message
    const alert = parseAlertFromSNS(record.Sns.Message);
    if (!alert) {
      logger.warn('Skipping malformed SNS record', {
        messageId: record.Sns.MessageId,
      });
      continue;
    }

    receivedAlerts++;
    const province = alert.locationName;

    logger.info('Processing alert notification', {
      province,
      severity: alert.severity,
      alertType: alert.type,
    });

    // Query subscriptions for the affected province
    let subscriptions: SubscriptionItem[];
    try {
      subscriptions = await deps.getSubscriptions(province);
    } catch (error) {
      logger.error('Failed to query subscriptions', {
        province,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    // Process each subscription
    for (const sub of subscriptions) {
      // Filter: skip unverified subscriptions
      if (sub.verified === false) {
        skippedSubscriptions++;
        logger.info('Skipped unverified subscription', {
          subscriptionId: sub.PK,
          province,
        });
        continue;
      }

      // Filter: skip if alert severity is below subscriber's minimum
      if (!severityMeetsThreshold(alert.severity, sub.minSeverity)) {
        skippedSubscriptions++;
        logger.info('Skipped subscription below severity threshold', {
          subscriptionId: sub.PK,
          alertSeverity: alert.severity,
          minSeverity: sub.minSeverity,
        });
        continue;
      }

      // Subscription matches — attempt to send email
      matchedSubscriptions++;
      const { subject, body } = composeAlertEmail(alert);

      try {
        await deps.sendEmail({
          to: sub.email,
          subject,
          body,
        });
        sentNotifications++;
        logger.info('Notification sent successfully', {
          subscriptionId: sub.PK,
          province,
          severity: alert.severity,
        });
      } catch (error) {
        failedNotifications++;
        logger.error('Failed to send notification', {
          subscriptionId: sub.PK,
          province,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue processing other subscribers — do NOT fail the batch
      }
    }
  }

  const durationMs = Date.now() - startTime;
  logger.info('Notification dispatch complete', {
    receivedAlerts,
    matchedSubscriptions,
    sentNotifications,
    skippedSubscriptions,
    failedNotifications,
    durationMs,
  });

  return {
    statusCode: 200,
    body: {
      receivedAlerts,
      matchedSubscriptions,
      sentNotifications,
      skippedSubscriptions,
      failedNotifications,
      timestamp: new Date().toISOString(),
    },
  };
}

// ============================================
// Default Dependencies (production)
// ============================================

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const sesClient = new SESClient({});
const FROM_EMAIL = process.env.FROM_EMAIL ?? 'alertas@fuegoradar.ar';

async function sendEmailViaSES(request: EmailRequest): Promise<void> {
  await sesClient.send(
    new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [request.to] },
      Message: {
        Subject: { Data: request.subject, Charset: 'UTF-8' },
        Body: { Text: { Data: request.body, Charset: 'UTF-8' } },
      },
    }),
  );
}

const defaultDeps: NotificationDependencies = {
  getSubscriptions: getSubscriptionsByProvince,
  sendEmail: sendEmailViaSES,
};

// ============================================
// Lambda Handler Export
// ============================================

export async function handler(event: SNSEvent): Promise<NotificationResult> {
  return runNotificationDispatch(event, defaultDeps);
}
