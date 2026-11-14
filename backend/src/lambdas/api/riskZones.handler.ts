/**
 * GET /risk/zones — Returns grid cells with FWI and risk level.
 *
 * Requirement 6.5: Array of grid cells with id, bounds, fwi (0-100),
 * riskLevel, hotspotsInCell (≥0).
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../../data/dynamoClient.js';
import type { RiskZoneItem } from '../../shared/types.js';
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

export interface RiskZonesDeps {
  queryRiskZones: () => Promise<RiskZoneItem[]>;
}

async function queryRiskZonesDefault(): Promise<RiskZoneItem[]> {
  const response = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': 'RISK#ZONES',
      },
    }),
  );
  return (response.Items ?? []) as RiskZoneItem[];
}

const defaultDeps: RiskZonesDeps = {
  queryRiskZones: queryRiskZonesDefault,
};

// ============================================
// Handler Factory
// ============================================

export function createRiskZonesHandler(deps: RiskZonesDeps = defaultDeps) {
  return async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    if (!validateApiKey(event)) {
      return forbidden();
    }

    try {
      const nowEpoch = Math.floor(Date.now() / 1000);
      const live = (await deps.queryRiskZones()).filter(
        (item) => typeof item.TTL !== 'number' || item.TTL > nowEpoch,
      );
      const latest = live.reduce((max, item) => (item.lastUpdated > max ? item.lastUpdated : max), '');
      const items = live.filter((item) => item.lastUpdated === latest);

      const formatted = items.map((item) => ({
        id: item.SK.replace('GRID#', ''),
        bounds: item.bounds,
        fwi: item.fwi,
        riskLevel: item.riskLevel,
        hotspotsInCell: item.hotspotsInCell,
      }));

      return success(formatted);
    } catch (error) {
      return internalError(error);
    }
  };
}

export const handler = createRiskZonesHandler();
