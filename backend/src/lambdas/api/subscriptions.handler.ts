/**
 * POST /subscriptions — Creates alert subscriptions for a user.
 * GET /subscriptions/verify — Confirms email verification via token.
 *
 * Accepts { email, provinces, minSeverity } and writes subscription items to DynamoDB.
 * Subscriptions start as unverified. A verification email is sent with a token.
 * Unverified subscriptions have a 72h TTL for automatic cleanup.
 *
 * Task 8.2 — Requirements: 10.5
 */

import { PutCommand, UpdateCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { docClient, TABLE_NAME } from '../../data/dynamoClient.js';
import { PROVINCES_SET } from '../../shared/constants.js';
import { createLogger } from '../../shared/logger.js';
import {
  initiateVerification,
  confirmVerification,
  VERIFICATION_TOKEN_TTL_SECONDS,
} from '../../services/subscriptionVerifier.js';
import type { VerifierDependencies, VerificationToken } from '../../services/subscriptionVerifier.js';
import type { AlertSeverity, SubscriptionItem } from '../../shared/types.js';
import {
  validateApiKey,
  forbidden,
  success,
  badRequest,
  internalError,
} from './apiUtils.js';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from './apiUtils.js';

const logger = createLogger('Subscriptions');

// ============================================
// Types
// ============================================

interface SubscriptionRequest {
  email: string;
  provinces: string[];
  minSeverity: AlertSeverity;
}

interface VerifyRequest {
  token: string;
  email: string;
}

// ============================================
// Dependencies (for DI / testing)
// ============================================

export interface SubscriptionsDeps {
  putSubscription: (item: SubscriptionItem) => Promise<void>;
  verifierDeps: VerifierDependencies;
}

const sesClient = new SESClient({});
const FROM_EMAIL = process.env.FROM_EMAIL ?? 'alertas@fuegoradar.ar';
const VERIFY_BASE_URL = process.env.VERIFY_BASE_URL ?? 'https://api.fuegoradar.ar/subscriptions/verify';

async function putSubscriptionDefault(item: SubscriptionItem): Promise<void> {
  await docClient.send(
    new PutCommand({ TableName: TABLE_NAME, Item: item }),
  );
}

const defaultVerifierDeps: VerifierDependencies = {
  persistToken: async (item: VerificationToken) => {
    await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  },
  getToken: async (token: string, email: string) => {
    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `VERIFY#${token}`, SK: `EMAIL#${email}` },
    }));
    return (result.Item as VerificationToken) ?? null;
  },
  deleteToken: async (token: string, email: string) => {
    await docClient.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `VERIFY#${token}`, SK: `EMAIL#${email}` },
    }));
  },
  markSubscriptionsVerified: async (email: string, provinces: string[]) => {
    for (const province of provinces) {
      await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `SUB#${email}`, SK: `PROV#${province}` },
        UpdateExpression: 'SET verified = :v REMOVE #ttl',
        ExpressionAttributeNames: { '#ttl': 'TTL' },
        ExpressionAttributeValues: { ':v': true },
      }));
    }
  },
  sendVerificationEmail: async (request) => {
    const verifyUrl = `${VERIFY_BASE_URL}?token=${request.token}&email=${encodeURIComponent(request.email)}`;
    await sesClient.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [request.to] },
      Message: {
        Subject: { Data: '🔥 Fuego Radar - Verificá tu suscripción', Charset: 'UTF-8' },
        Body: {
          Text: {
            Data: [
              'Hola,',
              '',
              'Gracias por suscribirte a alertas de incendio en Fuego Radar.',
              `Provincias: ${request.provinces.join(', ')}`,
              '',
              'Para activar tu suscripción, hacé clic en el siguiente enlace:',
              verifyUrl,
              '',
              'Este enlace expira en 72 horas.',
              '',
              '---',
              'Fuego Radar - Sistema de Alerta Temprana de Incendios',
            ].join('\n'),
            Charset: 'UTF-8',
          },
        },
      },
    }));
  },
};

const defaultDeps: SubscriptionsDeps = {
  putSubscription: putSubscriptionDefault,
  verifierDeps: defaultVerifierDeps,
};

// ============================================
// Validation
// ============================================

const VALID_SEVERITIES: ReadonlySet<string> = new Set(['Bajo', 'Medio', 'Alto', 'Crítico']);

function validateSubscriptionRequest(body: unknown): { valid: true; data: SubscriptionRequest } | { valid: false; message: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, message: 'Request body is required' };
  }

  const obj = body as Record<string, unknown>;

  if (!obj.email || typeof obj.email !== 'string' || !obj.email.includes('@')) {
    return { valid: false, message: 'Valid email is required' };
  }

  if (!Array.isArray(obj.provinces) || obj.provinces.length === 0) {
    return { valid: false, message: 'At least one province is required' };
  }

  for (const prov of obj.provinces) {
    if (typeof prov !== 'string' || !PROVINCES_SET.has(prov)) {
      return { valid: false, message: `Invalid province: ${prov}` };
    }
  }

  if (!obj.minSeverity || typeof obj.minSeverity !== 'string' || !VALID_SEVERITIES.has(obj.minSeverity)) {
    return { valid: false, message: 'Valid minSeverity is required (Bajo, Medio, Alto, Crítico)' };
  }

  return {
    valid: true,
    data: {
      email: obj.email,
      provinces: obj.provinces as string[],
      minSeverity: obj.minSeverity as AlertSeverity,
    },
  };
}

function validateVerifyRequest(params: Record<string, string | undefined> | null): { valid: true; data: VerifyRequest } | { valid: false; message: string } {
  const token = params?.token;
  const email = params?.email;

  if (!token || typeof token !== 'string' || token.length < 32) {
    return { valid: false, message: 'Valid token is required' };
  }

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return { valid: false, message: 'Valid email is required' };
  }

  return { valid: true, data: { token, email } };
}

// ============================================
// Handler Factory
// ============================================

export function createSubscriptionsHandler(customDeps: Partial<SubscriptionsDeps> = {}) {
  const deps = { ...defaultDeps, ...customDeps };
  return async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    if (!validateApiKey(event)) {
      return forbidden();
    }

    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.body ?? '');
      } catch {
        return badRequest('Invalid JSON body');
      }

      const validation = validateSubscriptionRequest(parsed);
      if (!validation.valid) {
        return badRequest(validation.message);
      }

      const { email, provinces, minSeverity } = validation.data;
      const createdAt = new Date().toISOString();
      const subscriptionId = `${email}#${createdAt}`;

      // TTL for unverified subscriptions: 72 hours from now
      const unverifiedTTL = Math.floor(Date.now() / 1000) + VERIFICATION_TOKEN_TTL_SECONDS;

      // Create subscription items (unverified, with TTL)
      for (const province of provinces) {
        const item: SubscriptionItem = {
          PK: `SUB#${email}`,
          SK: `PROV#${province}`,
          GSI1PK: `PROVINCE#${province}`,
          GSI1SK: `SEVERITY#${minSeverity}`,
          email,
          minSeverity,
          verified: false,
          createdAt,
        };
        // Add TTL for automatic cleanup of unverified subscriptions
        (item as any).TTL = unverifiedTTL;
        await deps.putSubscription(item);
      }

      // Initiate email verification
      await initiateVerification(email, provinces, deps.verifierDeps);

      logger.info('Subscription created, verification pending', {
        subscriptionId,
        provincesCount: provinces.length,
      });

      return success({
        subscriptionId,
        status: 'pending_verification',
        message: 'Revise su correo electrónico para verificar la suscripción',
      });
    } catch (error) {
      return internalError(error);
    }
  };
}

// ============================================
// Verify Handler Factory
// ============================================

export function createVerifyHandler(customDeps: Partial<SubscriptionsDeps> = {}) {
  const deps = { ...defaultDeps, ...customDeps };
  return async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
      const validation = validateVerifyRequest(event.queryStringParameters);
      if (!validation.valid) {
        return badRequest(validation.message);
      }

      const { token, email } = validation.data;
      const result = await confirmVerification(token, email, deps.verifierDeps);

      if (result.success) {
        return success({ status: 'verified', message: result.message });
      } else {
        return badRequest(result.message);
      }
    } catch (error) {
      return internalError(error);
    }
  };
}

export const handler = createSubscriptionsHandler();
export const verifyHandler = createVerifyHandler();

