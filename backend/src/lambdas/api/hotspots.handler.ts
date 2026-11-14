/**
 * GET /hotspots — Returns active hotspots from last 48 hours.
 *
 * Requirement 6.9: Array with lat, lng, brightness, confidence (0-100),
 * satellite, province, date (ISO), windSpeed, fwi (0-100), dangerLevel, area (≥1 hectares).
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../../data/dynamoClient.js';
import { getAllRiskScores } from '../../data/repository.js';
import { getDangerLevel } from '../../services/fwiCalculator.js';
import { estimateFireArea } from '../../services/areaEstimator.js';
import { indexRiskScores } from '../../services/riskContext.js';
import type { HotspotItem, RiskScoreItem } from '../../shared/types.js';
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
  /** Current province risk snapshots (weather + FWI) used to enrich hotspots */
  queryRiskScores?: () => Promise<RiskScoreItem[]>;
}

const NEARBY_CELL_DEGREES = 0.1;

function nearbyKey(lat: number, lng: number): string {
  return `${Math.floor(lat / NEARBY_CELL_DEGREES)}_${Math.floor(lng / NEARBY_CELL_DEGREES)}`;
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
  queryRiskScores: getAllRiskScores,
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
      const [items, scores] = await Promise.all([
        deps.queryRecentHotspots(),
        deps.queryRiskScores ? deps.queryRiskScores().catch(() => [] as RiskScoreItem[]) : Promise.resolve([] as RiskScoreItem[]),
      ]);
      const riskByProvince = indexRiskScores(scores);

      // Hotspots in the same ~10 km cell count as a cluster for area estimation
      const clusterSizes = new Map<string, number>();
      for (const item of items) {
        const key = nearbyKey(item.lat, item.lng);
        clusterSizes.set(key, (clusterSizes.get(key) ?? 0) + 1);
      }

      const formatted = items.map((item) => {
        // Extract date from SK: TS#{isoTimestamp}#{id}
        const skParts = item.SK.replace('TS#', '');
        const dateMatch = skParts.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/);
        const date = dateMatch ? dateMatch[1] : item.GSI1PK.replace('DATE#', '');

        const risk = riskByProvince.get(item.province);
        const windSpeed = risk?.windSpeed ?? 0;
        const fwi = risk?.fwi ?? 0;
        const area = estimateFireArea({
          brightness: item.brightness,
          windSpeed,
          fwi,
          nearbyHotspots: Math.max(0, (clusterSizes.get(nearbyKey(item.lat, item.lng)) ?? 1) - 1),
          confidence: item.confidence,
        }).areaHectares;

        return {
          lat: item.lat,
          lng: item.lng,
          brightness: item.brightness,
          confidence: item.confidence,
          satellite: item.satellite,
          province: item.province,
          date,
          windSpeed,
          fwi,
          dangerLevel: getDangerLevel(fwi),
          area,
          weatherAvailable: risk?.fwi !== undefined,
        };
      });

      return success(formatted);
    } catch (error) {
      return internalError(error);
    }
  };
}

export const handler = createHotspotsHandler();
