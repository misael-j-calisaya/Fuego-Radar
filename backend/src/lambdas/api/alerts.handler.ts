/**
 * GET /alerts — Returns active alerts grouped by severity.
 *
 * Queries GSI1 by severity levels to return all active alerts.
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../../data/dynamoClient.js';
import type { AlertItem } from '../../shared/types.js';
import {
  validateApiKey,
  forbidden,
  success,
  internalError,
} from './apiUtils.js';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from './apiUtils.js';

// ============================================
// Dependencies (for DI / testing)
// ============================================

export interface AlertsDeps {
  queryAlerts: () => Promise<AlertItem[]>;
}

/**
 * Queries GSI1 by severity levels: Crítico, Alto, Medio, Bajo.
 */
async function queryAlertsDefault(): Promise<AlertItem[]> {
  const severities = ['Crítico', 'Alto', 'Medio', 'Bajo'];
  const results: AlertItem[] = [];

  for (const severity of severities) {
    const response = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :gsi1pk',
        ExpressionAttributeValues: {
          ':gsi1pk': `SEVERITY#${severity}`,
        },
      }),
    );
    results.push(...((response.Items ?? []) as AlertItem[]));
  }

  return results;
}

const defaultDeps: AlertsDeps = {
  queryAlerts: queryAlertsDefault,
};

// ============================================
// Handler Factory
// ============================================

export function createAlertsHandler(deps: AlertsDeps = defaultDeps) {
  return async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    if (!validateApiKey(event)) {
      return forbidden();
    }

    try {
      const items = await deps.queryAlerts();

      const formatted = items.map((item) => ({
        title: item.title,
        description: item.description,
        severity: item.severity,
        type: item.type,
        locationName: item.locationName,
        coordinates: item.coordinates,
        radius: item.radius,
      }));

      return success(formatted);
    } catch (error) {
      return internalError(error);
    }
  };
}

export const handler = createAlertsHandler();
