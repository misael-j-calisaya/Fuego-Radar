/**
 * GET /hotspots — Returns active hotspots from last 48 hours.
 *
 * Requirement 6.9: Array with lat, lng, brightness, confidence (0-100),
 * satellite, province, date (ISO), windSpeed, fwi (0-100), dangerLevel, area (≥1 hectares).
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../../data/dynamoClient.js';
import type { HotspotItem } from '../../shared/types.js';
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

export interface HotspotsDeps {
  queryRecentHotspots: () => Promise<HotspotItem[]>;
}

/**
 * Queries GSI1 with DATE#{today} and DATE#{yesterday} to get 48h window.
 */
async function queryRecentHotspotsDefault(): Promise<HotspotItem[]> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const dates = [today, yesterday];
  const results: HotspotItem[] = [];

  for (const date of dates) {
    const response = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :gsi1pk',
        ExpressionAttributeValues: {
          ':gsi1pk': `DATE#${date}`,
        },
      }),
    );
    results.push(...((response.Items ?? []) as HotspotItem[]));
  }

  return results;
}

const defaultDeps: HotspotsDeps = {
  queryRecentHotspots: queryRecentHotspotsDefault,
};

// ============================================
// Handler Factory
// ============================================

export function createHotspotsHandler(deps: HotspotsDeps = defaultDeps) {
  return async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    if (!validateApiKey(event)) {
      return forbidden();
    }

    try {
      const items = await deps.queryRecentHotspots();

      const formatted = items.map((item) => {
        // Extract date from SK: TS#{isoTimestamp}#{id}
        const skParts = item.SK.replace('TS#', '');
        const dateMatch = skParts.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/);
        const date = dateMatch ? dateMatch[1] : item.GSI1PK.replace('DATE#', '');

        return {
          lat: item.lat,
          lng: item.lng,
          brightness: item.brightness,
          confidence: item.confidence,
          satellite: item.satellite,
          province: item.province,
          date,
          windSpeed: 0,         // placeholder — enrichment not yet implemented
          fwi: 0,               // placeholder — enrichment not yet implemented
          dangerLevel: 'Bajo',  // placeholder — enrichment not yet implemented
          area: 1,              // placeholder — enrichment not yet implemented
        };
      });

      return success(formatted);
    } catch (error) {
      return internalError(error);
    }
  };
}

export const handler = createHotspotsHandler();
