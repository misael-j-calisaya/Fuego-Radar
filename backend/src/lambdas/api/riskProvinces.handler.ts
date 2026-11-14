/**
 * GET /risk/provinces — Returns risk scores for all 24 provinces.
 *
 * Requirement 6.4: Array of 24 provinces with provinceName, riskScore (0-100),
 * activeHotspotsCount (≥0), riskLevel, trend, lastUpdated (ISO 8601), confidenceScore (50-100).
 */

import { getAllRiskScores } from '../../data/repository.js';
import type { RiskScoreItem } from '../../shared/types.js';
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

export interface RiskProvincesDeps {
  getAllRiskScores: () => Promise<RiskScoreItem[]>;
}

const defaultDeps: RiskProvincesDeps = {
  getAllRiskScores,
};

// ============================================
// Handler Factory
// ============================================

export function createRiskProvincesHandler(deps: RiskProvincesDeps = defaultDeps) {
  return async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    if (!validateApiKey(event)) {
      return forbidden();
    }

    try {
      const items = await deps.getAllRiskScores();

      const formatted = items.map((item) => ({
        provinceName: item.SK.replace('PROVINCE#', ''),
        riskScore: item.riskScore,
        activeHotspotsCount: item.activeHotspotsCount,
        riskLevel: item.riskLevel,
        trend: item.trend,
        lastUpdated: item.lastUpdated,
        confidenceScore: item.confidenceScore,
      }));

      return success(formatted);
    } catch (error) {
      return internalError(error);
    }
  };
}

export const handler = createRiskProvincesHandler();
