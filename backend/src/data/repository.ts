/**
 * DynamoDB repository for Single Table Design operations.
 * Handles all CRUD operations with validation and BatchWriteItem retry logic.
 *
 * Requirements: 9.1–9.9, 2.4, 2.5
 */

import {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { WriteRequest } from '@aws-sdk/client-dynamodb';
import { docClient, TABLE_NAME } from './dynamoClient.js';
import {
  validateHotspot,
  validateRiskScoreItem,
  validateAlert,
  validateIngestionMeta,
} from './validators.js';
import type { ValidationResult } from './validators.js';
import { DYNAMODB_RETRY } from '../shared/constants.js';
import type {
  HotspotItem,
  RiskScoreItem,
  AlertItem,
  SubscriptionItem,
  IngestionMetaItem,
  RiskZoneItem,
} from '../shared/types.js';

// ============================================
// Error Types
// ============================================

/** Thrown when item validation fails before DynamoDB write */
export class ValidationFailedError extends Error {
  constructor(
    public readonly field: string,
    public readonly value: unknown,
    public readonly validationErrors: ValidationResult['errors'],
  ) {
    super(`Validation failed for field "${field}": ${JSON.stringify(value)}`);
    this.name = 'ValidationFailedError';
  }
}

/** Thrown when BatchWriteItem retries are exhausted */
export class BatchWriteExhaustedError extends Error {
  constructor(public readonly unprocessedCount: number) {
    super(`BatchWriteItem failed: ${unprocessedCount} items unprocessed after ${DYNAMODB_RETRY.maxRetries} retries`);
    this.name = 'BatchWriteExhaustedError';
  }
}

// ============================================
// BatchWriteItem Helper with UnprocessedItems Retry
// ============================================

/**
 * Execute BatchWriteItem in chunks of 25 with exponential backoff retry
 * for UnprocessedItems (Requirement 9.9).
 */
async function batchWriteWithRetry(
  items: Record<string, unknown>[],
): Promise<void> {
  // DynamoDB BatchWriteItem supports max 25 items per call
  const BATCH_SIZE = 25;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    let requestItems: Record<string, WriteRequest[]> = {
      [TABLE_NAME]: chunk.map((item) => ({
        PutRequest: { Item: item },
      })) as unknown as WriteRequest[],
    };

    let retries = 0;

    while (retries <= DYNAMODB_RETRY.maxRetries) {
      const response = await docClient.send(
        new BatchWriteCommand({ RequestItems: requestItems }),
      );

      const unprocessed = response.UnprocessedItems;
      if (!unprocessed || !unprocessed[TABLE_NAME] || unprocessed[TABLE_NAME].length === 0) {
        break; // All items written successfully
      }

      retries++;
      if (retries > DYNAMODB_RETRY.maxRetries) {
        const remaining = unprocessed[TABLE_NAME].length;
        console.error(
          `[repository] BatchWriteItem exhausted retries: ${remaining} items unprocessed`,
        );
        throw new BatchWriteExhaustedError(remaining);
      }

      // Exponential backoff: baseDelay * 2^(retry-1)
      const delay = DYNAMODB_RETRY.baseDelayMs * Math.pow(2, retries - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));

      requestItems = unprocessed as Record<string, WriteRequest[]>;
    }
  }
}

// ============================================
// Repository Methods
// ============================================

/**
 * Persist multiple hotspots to DynamoDB.
 * Validates each item; invalid items are rejected individually without
 * blocking the rest of the batch (Requirement 9.8).
 */
export async function putHotspots(items: HotspotItem[]): Promise<{
  written: number;
  rejected: number;
  errors: Array<{ index: number; errors: ValidationResult['errors'] }>;
}> {
  const validItems: HotspotItem[] = [];
  const rejections: Array<{ index: number; errors: ValidationResult['errors'] }> = [];

  for (let i = 0; i < items.length; i++) {
    const result = validateHotspot(items[i]);
    if (result.valid) {
      validItems.push(items[i]);
    } else {
      console.warn(
        `[repository] Hotspot validation failed at index ${i}:`,
        JSON.stringify(result.errors),
      );
      rejections.push({ index: i, errors: result.errors });
    }
  }

  if (validItems.length > 0) {
    await batchWriteWithRetry(validItems as unknown as Record<string, unknown>[]);
  }

  return { written: validItems.length, rejected: rejections.length, errors: rejections };
}

/**
 * Persist a single RiskScoreItem to DynamoDB.
 * Validates before writing; throws ValidationFailedError if invalid.
 */
export async function putRiskScore(item: RiskScoreItem): Promise<void> {
  const result = validateRiskScoreItem(item);
  if (!result.valid) {
    const firstError = result.errors[0];
    console.warn(
      `[repository] RiskScore validation failed:`,
      JSON.stringify(result.errors),
    );
    throw new ValidationFailedError(firstError.field, firstError.value, result.errors);
  }

  await docClient.send(
    new PutCommand({ TableName: TABLE_NAME, Item: item }),
  );
}

/**
 * Persist a single AlertItem to DynamoDB.
 * Validates before writing; throws ValidationFailedError if invalid.
 */
export async function putAlert(item: AlertItem): Promise<void> {
  const result = validateAlert(item);
  if (!result.valid) {
    const firstError = result.errors[0];
    console.warn(
      `[repository] Alert validation failed:`,
      JSON.stringify(result.errors),
    );
    throw new ValidationFailedError(firstError.field, firstError.value, result.errors);
  }

  await docClient.send(
    new PutCommand({ TableName: TABLE_NAME, Item: item }),
  );
}

/**
 * Query hotspots by province for a given date.
 * Access Pattern #1: PK=HOTSPOT#{prov}, SK begins_with TS#{date}
 */
export async function queryHotspotsByProvince(
  province: string,
  date: string,
): Promise<HotspotItem[]> {
  const response = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `HOTSPOT#${province}`,
        ':skPrefix': `TS#${date}`,
      },
    }),
  );

  return (response.Items ?? []) as HotspotItem[];
}

/**
 * Get all current risk scores (one per province).
 * Access Pattern #3: PK=RISK#CURRENT
 */
export async function getAllRiskScores(): Promise<RiskScoreItem[]> {
  const response = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': 'RISK#CURRENT',
      },
    }),
  );

  return (response.Items ?? []) as RiskScoreItem[];
}

/**
 * Query active alerts by province.
 * Access Pattern #5: PK=ALERT#{prov}, SK begins_with TS#
 */
export async function queryAlertsByProvince(
  province: string,
): Promise<AlertItem[]> {
  const response = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `ALERT#${province}`,
        ':skPrefix': 'TS#',
      },
    }),
  );

  return (response.Items ?? []) as AlertItem[];
}

/**
 * Get subscriptions by province (for notification dispatch).
 * Access Pattern #7: GSI1PK=PROVINCE#{prov}
 */
export async function getSubscriptionsByProvince(
  province: string,
): Promise<SubscriptionItem[]> {
  const response = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: {
        ':gsi1pk': `PROVINCE#${province}`,
      },
    }),
  );

  return (response.Items ?? []) as SubscriptionItem[];
}

/**
 * Persist ingestion metadata item.
 * Validates TTL before writing.
 */
export async function putIngestionMeta(item: IngestionMetaItem): Promise<void> {
  const result = validateIngestionMeta(item);
  if (!result.valid) {
    const firstError = result.errors[0];
    console.warn(
      `[repository] IngestionMeta validation failed:`,
      JSON.stringify(result.errors),
    );
    throw new ValidationFailedError(firstError.field, firstError.value, result.errors);
  }

  await docClient.send(
    new PutCommand({ TableName: TABLE_NAME, Item: item }),
  );
}

// ============================================
// Risk context & operational state
// ============================================

/** Get the current risk score for one province (previous run, used for trend/history). */
export async function getRiskScore(province: string): Promise<RiskScoreItem | null> {
  const response = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: 'RISK#CURRENT', SK: `PROVINCE#${province}` },
    }),
  );
  return (response.Item as RiskScoreItem | undefined) ?? null;
}

/** Persist risk-zone grid cells (PK=RISK#ZONES) using BatchWriteItem with retry. */
export async function putRiskZones(items: RiskZoneItem[]): Promise<void> {
  if (items.length === 0) return;
  await batchWriteWithRetry(items as unknown as Record<string, unknown>[]);
}

/** Most recent ingestion run metadata (PK=META#INGESTION, newest RUN#). */
export async function getLatestIngestionMeta(): Promise<IngestionMetaItem | null> {
  const response = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': 'META#INGESTION', ':sk': 'RUN#' },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );
  return (response.Items?.[0] as IngestionMetaItem | undefined) ?? null;
}

const FIRMS_STATE_KEY = { PK: 'META#INGESTION', SK: 'STATE#FIRMS' } as const;

/** Consecutive FIRMS failure counter persisted across Lambda cold starts. */
export async function getFirmsFailureCount(): Promise<number> {
  const response = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: FIRMS_STATE_KEY }),
  );
  const value = response.Item?.consecutiveFailures;
  return typeof value === 'number' && value >= 0 ? value : 0;
}

export async function putFirmsFailureCount(count: number): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { ...FIRMS_STATE_KEY, consecutiveFailures: count, updatedAt: new Date().toISOString() },
    }),
  );
}
