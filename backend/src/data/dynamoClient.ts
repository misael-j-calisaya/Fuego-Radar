/**
 * DynamoDB Document Client setup with retry configuration.
 * Uses Single Table Design — all entities share one table.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DYNAMODB_RETRY } from '../shared/constants.js';

/** Table name from environment variable */
export const TABLE_NAME = process.env.TABLE_NAME ?? 'FireRiskEngine';

/** Raw DynamoDB client with retry configuration */
const client = new DynamoDBClient({
  maxAttempts: DYNAMODB_RETRY.maxRetries,
  retryMode: 'standard',
});

/** DynamoDB Document Client for simplified marshalling/unmarshalling */
export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});
