/**
 * Risk context helpers: trend, rolling fire history, critical-alert detection,
 * alert de-duplication and risk-zone grid generation.
 *
 * Pure functions so they can be unit/property tested without AWS.
 */

import { getDangerLevel } from './fwiCalculator.js';
import type {
  AlertItem,
  AlertSeverity,
  HotspotItem,
  RiskScoreItem,
  RiskZoneItem,
  Trend,
} from '../shared/types.js';

export const TREND_THRESHOLD = 5;
export const HISTORY_DAYS = 7;
export const CRITICAL_ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const ALERT_DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000;
export const GRID_CELL_DEGREES = 1;
export const RISK_ZONE_TTL_SECONDS = 2 * 60 * 60;

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  Bajo: 0,
  Medio: 1,
  Alto: 2,
  Crítico: 3,
};

export function computeTrend(previousScore: number | undefined, currentScore: number): Trend {
  if (previousScore === undefined || !Number.isFinite(previousScore)) return 'stable';
  const delta = currentScore - previousScore;
  if (delta >= TREND_THRESHOLD) return 'up';
  if (delta <= -TREND_THRESHOLD) return 'down';
  return 'stable';
}

/**
 * Updates the rolling daily hotspot history. Today's value keeps the max seen
 * (ingestion is cumulative per day); entries older than HISTORY_DAYS are dropped.
 */
export function updateDailyHotspotCounts(
  previous: Record<string, number> | undefined,
  today: string,
  todayCount: number,
): Record<string, number> {
  const cutoff = new Date(`${today}T00:00:00Z`).getTime() - (HISTORY_DAYS - 1) * 86_400_000;
  const next: Record<string, number> = {};
  for (const [date, count] of Object.entries(previous ?? {})) {
    const ts = new Date(`${date}T00:00:00Z`).getTime();
    if (Number.isFinite(ts) && ts >= cutoff && Number.isFinite(count) && count >= 0) {
      next[date] = count;
    }
  }
  next[today] = Math.max(next[today] ?? 0, Math.max(0, todayCount));
  return next;
}

/** Historical fire count = hotspots seen in previous days of the window (excluding today). */
export function historicalFireCount(history: Record<string, number>, today: string): number {
  return Object.entries(history)
    .filter(([date]) => date !== today)
    .reduce((sum, [, count]) => sum + count, 0);
}

function alertTimestamp(alert: AlertItem): number {
  const iso = alert.GSI1SK?.replace('TS#', '') ?? alert.SK.split('#')[1];
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

export function hasRecentCriticalAlert(alerts: AlertItem[], now: number = Date.now()): boolean {
  return alerts.some(
    (a) => a.severity === 'Crítico' && now - alertTimestamp(a) <= CRITICAL_ALERT_WINDOW_MS,
  );
}

/**
 * True when an alert of equal or higher severity was already issued for the
 * province within the de-dup window (avoids emailing every 30 minutes).
 */
export function isDuplicateAlert(
  alerts: AlertItem[],
  severity: AlertSeverity,
  now: number = Date.now(),
): boolean {
  return alerts.some(
    (a) =>
      SEVERITY_RANK[a.severity] >= SEVERITY_RANK[severity] &&
      now - alertTimestamp(a) <= ALERT_DEDUP_WINDOW_MS,
  );
}

export interface ProvinceZoneInput {
  province: string;
  fwi: number;
  centroid?: { lat: number; lng: number };
  hotspots: Pick<HotspotItem, 'lat' | 'lng'>[];
}

function cellKey(lat: number, lng: number): { key: string; south: number; west: number } {
  const south = Math.floor(lat / GRID_CELL_DEGREES) * GRID_CELL_DEGREES;
  const west = Math.floor(lng / GRID_CELL_DEGREES) * GRID_CELL_DEGREES;
  return { key: `${south}_${west}`, south, west };
}

/**
 * Builds 1°×1° risk-zone cells around active hotspots and province centroids.
 * Cell FWI = province FWI boosted by hotspot density (+5 per hotspot, max +25).
 */
export function buildRiskZones(
  inputs: ProvinceZoneInput[],
  nowIso: string = new Date().toISOString(),
): RiskZoneItem[] {
  const cells = new Map<string, { south: number; west: number; province: string; fwi: number; hotspots: number }>();

  const touch = (lat: number, lng: number, province: string, fwi: number, hotspot: boolean) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const { key, south, west } = cellKey(lat, lng);
    const cell = cells.get(key) ?? { south, west, province, fwi, hotspots: 0 };
    if (fwi > cell.fwi) {
      cell.fwi = fwi;
      cell.province = province;
    }
    if (hotspot) cell.hotspots++;
    cells.set(key, cell);
  };

  for (const input of inputs) {
    if (input.centroid) touch(input.centroid.lat, input.centroid.lng, input.province, input.fwi, false);
    for (const h of input.hotspots) touch(h.lat, h.lng, input.province, input.fwi, true);
  }

  const ttl = Math.floor(new Date(nowIso).getTime() / 1000) + RISK_ZONE_TTL_SECONDS;

  return [...cells.entries()].map(([key, cell]) => {
    const fwi = Math.min(100, Math.round(cell.fwi + Math.min(25, cell.hotspots * 5)));
    return {
      PK: 'RISK#ZONES',
      SK: `GRID#${key}`,
      GSI1PK: `PROVINCE#${cell.province}`,
      GSI1SK: `FWI#${fwi.toString().padStart(3, '0')}`,
      bounds: [
        [cell.south, cell.west],
        [cell.south + GRID_CELL_DEGREES, cell.west + GRID_CELL_DEGREES],
      ],
      fwi,
      riskLevel: getDangerLevel(fwi),
      hotspotsInCell: cell.hotspots,
      lastUpdated: nowIso,
      TTL: ttl,
    } satisfies RiskZoneItem;
  });
}

/** Lookup map of current province risk snapshots. */
export function indexRiskScores(scores: RiskScoreItem[]): Map<string, RiskScoreItem> {
  return new Map(scores.map((s) => [s.SK.replace('PROVINCE#', ''), s]));
}
