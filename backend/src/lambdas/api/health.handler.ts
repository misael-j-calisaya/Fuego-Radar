/**
 * GET /health — public (no API key) liveness + data-freshness report.
 *
 * Reports the status of each data source so the frontend can show whether it is
 * displaying live, stale or fallback data. Never fails hard: a DynamoDB error
 * degrades the report instead of returning 500.
 */

import { getAllRiskScores, getLatestIngestionMeta } from '../../data/repository.js';
import type { IngestionMetaItem, RiskScoreItem } from '../../shared/types.js';
import { success } from './apiUtils.js';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from './apiUtils.js';

export type SourceStatus = 'ok' | 'degraded' | 'down' | 'unknown';

/** FIRMS ingests every 15 min; more than 1h without a successful run is stale. */
export const INGESTION_STALE_MS = 60 * 60 * 1000;
/** Risk calculation runs every 30 min; more than 90 min is stale. */
export const RISK_STALE_MS = 90 * 60 * 1000;

export interface HealthDeps {
  getLatestIngestionMeta: () => Promise<IngestionMetaItem | null>;
  getRiskScores: () => Promise<RiskScoreItem[]>;
  now?: () => number;
}

const defaultDeps: HealthDeps = {
  getLatestIngestionMeta,
  getRiskScores: getAllRiskScores,
};

export function buildHealthReport(
  meta: IngestionMetaItem | null,
  scores: RiskScoreItem[] | null,
  now: number,
) {
  let firms: SourceStatus = 'unknown';
  let lastIngestion: string | null = null;
  if (meta) {
    lastIngestion = meta.SK.replace('RUN#', '');
    const age = now - new Date(lastIngestion).getTime();
    if (meta.source === 'FALLBACK_CACHE') firms = 'down';
    else if (!Number.isFinite(age) || age > INGESTION_STALE_MS) firms = 'degraded';
    else firms = 'ok';
  }

  let weather: SourceStatus = 'unknown';
  let riskEngine: SourceStatus = 'unknown';
  let lastRiskCalculation: string | null = null;
  let staleWeatherProvinces = 0;
  if (scores && scores.length > 0) {
    staleWeatherProvinces = scores.filter((s) => s.weatherStale).length;
    weather = staleWeatherProvinces === 0 ? 'ok' : staleWeatherProvinces === scores.length ? 'down' : 'degraded';
    lastRiskCalculation = scores.map((s) => s.lastUpdated).sort().at(-1) ?? null;
    const age = lastRiskCalculation ? now - new Date(lastRiskCalculation).getTime() : Infinity;
    riskEngine = age <= RISK_STALE_MS ? 'ok' : 'degraded';
  }

  const statuses = [firms, weather, riskEngine];
  const status = statuses.every((s) => s === 'ok') ? 'healthy' : 'degraded';

  return {
    status,
    timestamp: new Date(now).toISOString(),
    version: process.env.APP_VERSION ?? '1.1.0',
    services: {
      firms: { status: firms, lastIngestion, lastSource: meta?.source ?? null, hotspots: meta?.finalCount ?? null },
      weather: { status: weather, staleProvinces: staleWeatherProvinces },
      riskEngine: { status: riskEngine, lastCalculation: lastRiskCalculation, provinces: scores?.length ?? 0 },
    },
  };
}

export function createHealthHandler(deps: HealthDeps = defaultDeps) {
  return async function handler(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const now = deps.now?.() ?? Date.now();
    const [meta, scores] = await Promise.all([
      deps.getLatestIngestionMeta().catch(() => null),
      deps.getRiskScores().catch(() => null),
    ]);
    return success(buildHealthReport(meta, scores, now));
  };
}

export const handler = createHealthHandler();
