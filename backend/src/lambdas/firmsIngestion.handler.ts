/**
 * FIRMS Ingestion Lambda Handler
 *
 * Orchestrates the full ingestion pipeline:
 * EventBridge trigger → fetch FIRMS → save raw to S3 → normalize → geocode →
 * deduplicate → persist to DynamoDB with TTL 48h → write ingestion metadata
 *
 * Requirements: 1.1, 1.2, 1.8, 1.9, 2.1, 2.2
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { fetchFirmsData } from '../services/firmsApiClient.js';
import { normalizeCsv } from '../services/csvNormalizer.js';
import { initializeGeocoder, assignProvince } from '../services/geocoder.js';
import { detectDuplicates } from '../services/deduplicator.js';
import { putHotspots, putIngestionMeta } from '../data/repository.js';
import {
  TTL_HOTSPOTS_SECONDS,
  TTL_INGESTION_META_SECONDS,
  FIRMS_MAX_CONSECUTIVE_FAILURES,
} from '../shared/constants.js';
import type { HotspotItem, IngestionMetaItem, IngestionSource } from '../shared/types.js';
import type { FirmsApiResult } from '../services/firmsApiClient.js';
import type { NormalizedHotspot } from '../services/csvNormalizer.js';
import type { DeduplicationResult } from '../services/deduplicator.js';

// ============================================
// Types
// ============================================

/** EventBridge scheduled event shape */
export interface EventBridgeEvent {
  source: string;
  'detail-type': string;
  detail: {
    forceRefresh?: boolean;
  };
}

/** Result returned by the ingestion handler */
export interface IngestionHandlerResult {
  statusCode: number;
  body: {
    source: IngestionSource;
    rawRows: number;
    normalizedRows: number;
    geocodedRows: number;
    deduplicatedRows: number;
    discardedRows: number;
    duplicateCount: number;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
  };
}

/** Dependency injection interface for testability */
export interface IngestionDependencies {
  fetchFirms: typeof fetchFirmsData;
  saveToS3: (csvData: string, key: string) => Promise<void>;
  normalize: typeof normalizeCsv;
  initGeocoder: typeof initializeGeocoder;
  geocode: typeof assignProvince;
  deduplicate: typeof detectDuplicates;
  persistHotspots: typeof putHotspots;
  persistMeta: typeof putIngestionMeta;
}

// ============================================
// Module-level state
// ============================================

/** Consecutive failure counter (resets on cold start or success) */
let consecutiveFailures = 0;

/** Exported for testing — get current failure count */
export function _getConsecutiveFailures(): number {
  return consecutiveFailures;
}

/** Exported for testing — reset failure count */
export function _resetConsecutiveFailures(): void {
  consecutiveFailures = 0;
}

// ============================================
// S3 Helper
// ============================================

const s3Client = new S3Client({});
const RAW_BUCKET_NAME = process.env.RAW_BUCKET_NAME ?? '';

/**
 * Saves raw CSV data to S3 bucket.
 */
async function saveRawCsvToS3(csvData: string, key: string): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: RAW_BUCKET_NAME,
      Key: key,
      Body: csvData,
      ContentType: 'text/csv',
    }),
  );
}

// ============================================
// Core Pipeline Logic (testable via DI)
// ============================================

/**
 * Runs the full ingestion pipeline with injected dependencies.
 * This function contains the core orchestration logic and is designed
 * for easy unit testing via dependency injection.
 */
export async function runIngestionPipeline(
  deps: IngestionDependencies,
): Promise<IngestionHandlerResult> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  // Helper to build a result object
  function buildResult(
    source: IngestionSource,
    stats: {
      rawRows?: number;
      normalizedRows?: number;
      geocodedRows?: number;
      deduplicatedRows?: number;
      discardedRows?: number;
      duplicateCount?: number;
    } = {},
  ): IngestionHandlerResult {
    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startTime;
    return {
      statusCode: source === 'FIRMS_API' ? 200 : 202,
      body: {
        source,
        rawRows: stats.rawRows ?? 0,
        normalizedRows: stats.normalizedRows ?? 0,
        geocodedRows: stats.geocodedRows ?? 0,
        deduplicatedRows: stats.deduplicatedRows ?? 0,
        discardedRows: stats.discardedRows ?? 0,
        duplicateCount: stats.duplicateCount ?? 0,
        startedAt,
        finishedAt,
        durationMs,
      },
    };
  }

  // Step 1: Fetch FIRMS data
  let firmsResult: FirmsApiResult;
  try {
    firmsResult = await deps.fetchFirms();
  } catch (error) {
    // Unexpected error from fetchFirms (should not happen, but handle gracefully)
    console.warn('[Ingestion] Unexpected error fetching FIRMS data:', error);
    consecutiveFailures++;
    await handleFailureMetrics(consecutiveFailures);
    await writeMetadata(deps, 'FALLBACK_CACHE', startedAt, 0, 0, 0);
    return buildResult('FALLBACK_CACHE');
  }

  // Step 1b: Handle FIRMS API failure
  if (!firmsResult.success) {
    console.warn(`[Ingestion] FIRMS API failure: ${firmsResult.reason} - ${firmsResult.message}`);
    consecutiveFailures++;
    await handleFailureMetrics(consecutiveFailures);
    await writeMetadata(deps, 'FALLBACK_CACHE', startedAt, 0, 0, 0);
    return buildResult('FALLBACK_CACHE');
  }

  // FIRMS succeeded — reset consecutive failures
  consecutiveFailures = 0;

  const csvData = firmsResult.csvData;

  // Step 2: Save raw CSV to S3
  const timestamp = Date.now();
  const s3Key = `firms-raw/firms_raw_${timestamp}.csv`;
  try {
    await deps.saveToS3(csvData, s3Key);
  } catch (error) {
    console.warn('[Ingestion] Failed to save raw CSV to S3:', error);
    // Non-fatal: continue pipeline even if S3 save fails
  }

  // Step 3: Normalize CSV
  const normResult = deps.normalize(csvData);
  const rawRows = normResult.rawEntries;
  const normalizedRows = normResult.hotspots.length;

  // Step 3b: Handle empty response (header only, no data rows)
  if (normResult.rawEntries === 0 && normResult.hotspots.length === 0) {
    console.info('[Ingestion] Empty FIRMS response (header only, no data rows). Maintaining existing data.');
    await writeMetadata(deps, 'EMPTY_RESPONSE', startedAt, 0, 0, 0);
    return buildResult('EMPTY_RESPONSE', { rawRows: 0 });
  }

  // Step 4: Initialize geocoder and assign provinces
  try {
    const geojsonPath = process.env.PROVINCES_GEOJSON_PATH;
    deps.initGeocoder(geojsonPath);
  } catch (error) {
    console.error('[Ingestion] Failed to initialize geocoder:', error);
    await writeMetadata(deps, 'FALLBACK_CACHE', startedAt, rawRows, 0, 0);
    return buildResult('FALLBACK_CACHE', { rawRows, normalizedRows });
  }

  // Geocode each hotspot and filter out those outside Argentina
  const geocodedHotspots: NormalizedHotspot[] = [];
  for (const hotspot of normResult.hotspots) {
    const province = deps.geocode(hotspot.lat, hotspot.lng);
    if (province !== 'Fuera de Argentina') {
      // Attach province to hotspot for later DDB write
      (hotspot as NormalizedHotspot & { province?: string }).province = province;
      geocodedHotspots.push(hotspot);
    }
  }
  const geocodedRows = geocodedHotspots.length;

  // Step 5: Deduplicate
  const dedupResult: DeduplicationResult = deps.deduplicate(geocodedHotspots);
  const deduplicatedRows = dedupResult.outputCount;
  const discardedRows = dedupResult.discardedCount;
  const duplicateCount = dedupResult.duplicateCount;

  // Step 6: Build HotspotItems and persist to DynamoDB
  const nowEpoch = Math.floor(Date.now() / 1000);
  const ttl = nowEpoch + TTL_HOTSPOTS_SECONDS;

  const hotspotItems: HotspotItem[] = dedupResult.hotspots.map((h) => {
    const province = (h as NormalizedHotspot & { province?: string }).province ?? 'Unknown';
    const isoDate = h.date;
    const dateOnly = isoDate.substring(0, 10); // yyyy-mm-dd

    return {
      PK: `HOTSPOT#${province}` as `HOTSPOT#${string}`,
      SK: `TS#${isoDate}#${h.id}` as `TS#${string}#${string}`,
      GSI1PK: `DATE#${dateOnly}` as `DATE#${string}`,
      GSI1SK: `PROV#${province}` as `PROV#${string}`,
      lat: h.lat,
      lng: h.lng,
      brightness: h.brightness,
      confidence: h.confidence,
      satellite: h.satellite,
      province,
      TTL: ttl,
    };
  });

  if (hotspotItems.length > 0) {
    try {
      await deps.persistHotspots(hotspotItems);
    } catch (error) {
      console.error('[Ingestion] Failed to persist hotspots to DynamoDB:', error);
      // Continue to write metadata even if DDB write partially fails
    }
  }

  // Step 7: Write ingestion metadata
  await writeMetadata(
    deps,
    'FIRMS_API',
    startedAt,
    rawRows,
    deduplicatedRows,
    duplicateCount,
  );

  return buildResult('FIRMS_API', {
    rawRows,
    normalizedRows,
    geocodedRows,
    deduplicatedRows,
    discardedRows,
    duplicateCount,
  });
}

// ============================================
// Helpers
// ============================================

/**
 * Writes ingestion metadata to DynamoDB.
 */
async function writeMetadata(
  deps: IngestionDependencies,
  source: IngestionSource,
  startedAt: string,
  rawEntries: number,
  finalCount: number,
  duplicatesRemoved: number,
): Promise<void> {
  const now = new Date().toISOString();
  const durationMs = Date.now() - new Date(startedAt).getTime();
  const nowEpoch = Math.floor(Date.now() / 1000);

  const metaItem: IngestionMetaItem = {
    PK: 'META#INGESTION',
    SK: `RUN#${now}` as `RUN#${string}`,
    rawEntries,
    finalCount,
    duplicatesRemoved,
    source,
    duration_ms: durationMs,
    TTL: nowEpoch + TTL_INGESTION_META_SECONDS,
  };

  try {
    await deps.persistMeta(metaItem);
  } catch (error) {
    console.error('[Ingestion] Failed to write ingestion metadata:', error);
  }
}

/**
 * Handles consecutive failure tracking and CloudWatch alarm triggering.
 * Requirement 2.2: 3 consecutive failures → CloudWatch alarm + SNS notification
 */
async function handleFailureMetrics(failureCount: number): Promise<void> {
  if (failureCount >= FIRMS_MAX_CONSECUTIVE_FAILURES) {
    // Log with structured data for CloudWatch metric filter
    console.error(
      JSON.stringify({
        level: 'ERROR',
        metric: 'FirmsConsecutiveFailures',
        consecutiveFailures: failureCount,
        alarm: true,
        message: `FIRMS API failed ${failureCount} consecutive times. CloudWatch alarm triggered.`,
      }),
    );
  }
}

// ============================================
// Lambda Handler Entry Point
// ============================================

/**
 * Lambda handler invoked by EventBridge scheduled rule.
 * Creates real dependencies and delegates to runIngestionPipeline.
 */
export async function handler(_event: EventBridgeEvent): Promise<IngestionHandlerResult> {
  const deps: IngestionDependencies = {
    fetchFirms: fetchFirmsData,
    saveToS3: saveRawCsvToS3,
    normalize: normalizeCsv,
    initGeocoder: initializeGeocoder,
    geocode: assignProvince,
    deduplicate: detectDuplicates,
    persistHotspots: putHotspots,
    persistMeta: putIngestionMeta,
  };

  return runIngestionPipeline(deps);
}
