/**
 * Subscription Verification Service (Task 8.2)
 *
 * Handles token generation, storage, email sending, and verification.
 * Tokens expire after 72 hours.
 *
 * Requirements: 10.5
 */

import { randomBytes } from 'node:crypto';
import { createLogger } from '../shared/logger.js';

const logger = createLogger('SubscriptionVerifier');

// ============================================
// Constants
// ============================================

/** Token expiry: 72 hours in seconds */
export const VERIFICATION_TOKEN_TTL_SECONDS = 72 * 60 * 60; // 259200

/** Token length in bytes (produces 64 hex chars) */
const TOKEN_BYTES = 32;

// ============================================
// Types
// ============================================

export interface VerificationToken {
  /** DynamoDB PK: VERIFY#<token> */
  PK: string;
  /** DynamoDB SK: EMAIL#<email> */
  SK: string;
  /** The subscription PK (SUB#email) */
  subscriptionPK: string;
  /** Province list for the subscription */
  provinces: string[];
  /** Minimum severity requested with this token; applied only when this token is confirmed */
  minSeverity?: string;
  /** Email of the subscriber */
  email: string;
  /** Token string */
  token: string;
  /** Creation timestamp */
  createdAt: string;
  /** TTL for automatic DynamoDB expiry (epoch seconds) */
  TTL: number;
}

export interface VerificationEmailRequest {
  to: string;
  token: string;
  provinces: string[];
}

export interface VerificationResult {
  success: boolean;
  message: string;
}

/** Dependencies for testability */
export interface VerifierDependencies {
  persistToken: (item: VerificationToken) => Promise<void>;
  getToken: (token: string, email: string) => Promise<VerificationToken | null>;
  deleteToken: (token: string, email: string) => Promise<void>;
  markSubscriptionsVerified: (email: string, provinces: string[], minSeverity?: string) => Promise<void>;
  sendVerificationEmail: (request: VerificationEmailRequest) => Promise<void>;
}

// ============================================
// Token Generation
// ============================================

/**
 * Generates a cryptographically secure verification token.
 * Returns a 64-character hex string.
 */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

// ============================================
// Create Verification Flow
// ============================================

/**
 * Creates a verification token and sends the verification email.
 * Called after subscription creation.
 */
export async function initiateVerification(
  email: string,
  provinces: string[],
  deps: VerifierDependencies,
  minSeverity?: string,
): Promise<{ token: string }> {
  const token = generateToken();
  const now = new Date();
  const ttlEpoch = Math.floor(now.getTime() / 1000) + VERIFICATION_TOKEN_TTL_SECONDS;

  const tokenItem: VerificationToken = {
    PK: `VERIFY#${token}`,
    SK: `EMAIL#${email}`,
    subscriptionPK: `SUB#${email}`,
    provinces,
    ...(minSeverity ? { minSeverity } : {}),
    email,
    token,
    createdAt: now.toISOString(),
    TTL: ttlEpoch,
  };

  // Persist token to DynamoDB
  await deps.persistToken(tokenItem);

  logger.info('Verification token created', {
    subscriptionPK: `SUB#${email}`,
    provincesCount: provinces.length,
    expiresAt: new Date(ttlEpoch * 1000).toISOString(),
  });

  // Send verification email
  await deps.sendVerificationEmail({ to: email, token, provinces });

  logger.info('Verification email sent', {
    subscriptionPK: `SUB#${email}`,
  });

  return { token };
}

// ============================================
// Confirm Verification Flow
// ============================================

/**
 * Verifies a subscription using the provided token.
 * Returns success/failure with message.
 */
export async function confirmVerification(
  token: string,
  email: string,
  deps: VerifierDependencies,
): Promise<VerificationResult> {
  // Retrieve the token from DynamoDB
  const tokenItem = await deps.getToken(token, email);

  if (!tokenItem) {
    logger.warn('Verification failed: token not found or expired', {
      subscriptionPK: `SUB#${email}`,
    });
    return { success: false, message: 'Token inválido o expirado' };
  }

  // Check if token has expired (belt-and-suspenders alongside DynamoDB TTL)
  const nowEpoch = Math.floor(Date.now() / 1000);
  if (tokenItem.TTL <= nowEpoch) {
    logger.warn('Verification failed: token expired', {
      subscriptionPK: `SUB#${email}`,
      expiredAt: new Date(tokenItem.TTL * 1000).toISOString(),
    });
    return { success: false, message: 'Token expirado' };
  }

  // Mark subscriptions as verified
  await deps.markSubscriptionsVerified(email, tokenItem.provinces, tokenItem.minSeverity);

  // Delete the token (single use)
  await deps.deleteToken(token, email);

  logger.info('Subscription verified successfully', {
    subscriptionPK: `SUB#${email}`,
    provinces: tokenItem.provinces,
  });

  return { success: true, message: 'Suscripción verificada exitosamente' };
}
