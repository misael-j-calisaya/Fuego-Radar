/**
 * Unit tests for the FIRMS Ingestion Lambda Handler.
 * Uses dependency injection to mock all external services.
 *
 * Requirements tested: 1.1, 1.2, 1.8, 1.9, 2.1, 2.2
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  runIngestionPipeline,
  _resetConsecutiveFailures,
  _getConsecutiveFailures,
} from '../lambdas/firmsIngestion.handler.js';
import type { IngestionDependencies } from '../lambdas/firmsIngestion.handler.js';
import type { FirmsApiResult } from '../services/firmsApiClient.js';
import type { NormalizationResult, NormalizedHotspot } from '../services/csvNormalizer.js';
import type { DeduplicationResult } from '../services/deduplicator.js';
import type { HotspotItem, IngestionMetaItem } from '../shared/types.js';

// ============================================
// Test Helpers
// ============================================

function createMockDeps(overrides: Partial<IngestionDependencies> = {}): IngestionDependencies {
  return {
    fetchFirms: async () => ({
      success: true as const,
      csvData: 'latitude,longitude,bright_ti4,acq_date,acq_time,satellite,confidence\n-31.42,-64.49,335.4,2024-01-15,1420,N,high\n',
      rawLength: 100,
    }),
    saveToS3: async () => {},
    normalize: () => ({
      hotspots: [
        {
          id: 'test-id-1',
          lat: -31.42,
          lng: -64.49,
          brightness: 335.4,
          confidence: 95,
          date: '2024-01-15T14:20:00.000Z',
          satellite: 'VIIRS' as const,
        },
      ],
      rawEntries: 1,
      discarded: 0,
      discardReasons: [],
    }),
    initGeocoder: () => {},
    geocode: () => 'Córdoba',
    deduplicate: (hotspots: NormalizedHotspot[]) => ({
      hotspots,
      inputCount: hotspots.length,
      outputCount: hotspots.length,
      discardedCount: 0,
      duplicateCount: 0,
      discardReasons: [],
    }),
    persistHotspots: async () => ({ written: 1, rejected: 0, errors: [] }),
    persistMeta: async () => {},
    ...overrides,
  };
}

// ============================================
// Tests
// ============================================

test('FIRMS Ingestion Handler Tests', async (t) => {
  // Reset state before each test group
  t.beforeEach(() => {
    _resetConsecutiveFailures();
  });

  await t.test('Successful full pipeline — verifies S3 put, normalize, geocode, deduplicate, DDB write, metadata write', async () => {
    let s3Called = false;
    let s3Key = '';
    let persistHotspotsCalled = false;
    let persistedItems: HotspotItem[] = [];
    let metaCalled = false;
    let metaItem: IngestionMetaItem | undefined = undefined;

    const deps = createMockDeps({
      saveToS3: async (_csvData: string, key: string) => {
        s3Called = true;
        s3Key = key;
      },
      persistHotspots: async (items: HotspotItem[]) => {
        persistHotspotsCalled = true;
        persistedItems = items;
        return { written: items.length, rejected: 0, errors: [] };
      },
      persistMeta: async (item: IngestionMetaItem) => {
        metaCalled = true;
        metaItem = item;
      },
    });

    const result = await runIngestionPipeline(deps);

    // Verify result
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.source, 'FIRMS_API');
    assert.strictEqual(result.body.rawRows, 1);
    assert.strictEqual(result.body.normalizedRows, 1);
    assert.strictEqual(result.body.geocodedRows, 1);
    assert.strictEqual(result.body.deduplicatedRows, 1);
    assert.strictEqual(result.body.duplicateCount, 0);
    assert.ok(result.body.startedAt);
    assert.ok(result.body.finishedAt);
    assert.ok(result.body.durationMs >= 0);

    // Verify S3 was called
    assert.strictEqual(s3Called, true);
    assert.ok(s3Key.startsWith('firms-raw/firms_raw_'));
    assert.ok(s3Key.endsWith('.csv'));

    // Verify DDB persist was called with correct items
    assert.strictEqual(persistHotspotsCalled, true);
    assert.strictEqual(persistedItems.length, 1);
    assert.ok(persistedItems[0].PK.startsWith('HOTSPOT#'));
    assert.ok(persistedItems[0].SK.startsWith('TS#'));
    assert.ok(persistedItems[0].GSI1PK.startsWith('DATE#'));
    assert.ok(persistedItems[0].GSI1SK.startsWith('PROV#'));
    assert.strictEqual(persistedItems[0].province, 'Córdoba');
    assert.strictEqual(persistedItems[0].lat, -31.42);
    assert.strictEqual(persistedItems[0].lng, -64.49);
    assert.strictEqual(persistedItems[0].brightness, 335.4);
    assert.strictEqual(persistedItems[0].confidence, 95);
    assert.strictEqual(persistedItems[0].satellite, 'VIIRS');
    assert.ok(persistedItems[0].TTL > Math.floor(Date.now() / 1000));

    // Verify metadata was written
    assert.strictEqual(metaCalled, true);
    assert.ok(metaItem !== undefined);
    const meta = metaItem as IngestionMetaItem;
    assert.strictEqual(meta.PK, 'META#INGESTION');
    assert.ok(meta.SK.startsWith('RUN#'));
    assert.strictEqual(meta.source, 'FIRMS_API');
    assert.strictEqual(meta.finalCount, 1);
    assert.strictEqual(meta.rawEntries, 1);
    assert.ok(meta.TTL > Math.floor(Date.now() / 1000));
  });

  await t.test('FIRMS API failure — no S3 write, no DDB hotspot write, metadata with source=FALLBACK_CACHE', async () => {
    let s3Called = false;
    let persistHotspotsCalled = false;
    let metaItem: IngestionMetaItem | undefined = undefined;

    const deps = createMockDeps({
      fetchFirms: async (): Promise<FirmsApiResult> => ({
        success: false as const,
        reason: 'timeout',
        message: 'Request timed out after 6000ms',
      }),
      saveToS3: async () => {
        s3Called = true;
      },
      persistHotspots: async () => {
        persistHotspotsCalled = true;
        return { written: 0, rejected: 0, errors: [] };
      },
      persistMeta: async (item: IngestionMetaItem) => {
        metaItem = item;
      },
    });

    const result = await runIngestionPipeline(deps);

    assert.strictEqual(result.statusCode, 202);
    assert.strictEqual(result.body.source, 'FALLBACK_CACHE');
    assert.strictEqual(s3Called, false, 'S3 should NOT be called on API failure');
    assert.strictEqual(persistHotspotsCalled, false, 'DDB hotspot write should NOT be called on API failure');
    assert.ok(metaItem !== undefined);
    assert.strictEqual((metaItem as IngestionMetaItem).source, 'FALLBACK_CACHE');
  });

  await t.test('Empty CSV — metadata with source=EMPTY_RESPONSE, no DDB writes', async () => {
    let persistHotspotsCalled = false;
    let metaItem: IngestionMetaItem | undefined = undefined;

    const deps = createMockDeps({
      fetchFirms: async (): Promise<FirmsApiResult> => ({
        success: true as const,
        csvData: 'latitude,longitude,bright_ti4,acq_date,acq_time,satellite,confidence\n',
        rawLength: 70,
      }),
      normalize: () => ({
        hotspots: [],
        rawEntries: 0,
        discarded: 0,
        discardReasons: [],
      }),
      persistHotspots: async () => {
        persistHotspotsCalled = true;
        return { written: 0, rejected: 0, errors: [] };
      },
      persistMeta: async (item: IngestionMetaItem) => {
        metaItem = item;
      },
    });

    const result = await runIngestionPipeline(deps);

    assert.strictEqual(result.statusCode, 202);
    assert.strictEqual(result.body.source, 'EMPTY_RESPONSE');
    assert.strictEqual(result.body.rawRows, 0);
    assert.strictEqual(persistHotspotsCalled, false, 'DDB hotspot write should NOT be called for empty response');
    assert.ok(metaItem !== undefined);
    assert.strictEqual((metaItem as IngestionMetaItem).source, 'EMPTY_RESPONSE');
  });

  await t.test('Geocoder failure — controlled failure with metadata', async () => {
    let metaItem: IngestionMetaItem | undefined = undefined;

    const deps = createMockDeps({
      initGeocoder: () => {
        throw new Error('Failed to load provinces GeoJSON');
      },
      persistMeta: async (item: IngestionMetaItem) => {
        metaItem = item;
      },
    });

    const result = await runIngestionPipeline(deps);

    assert.strictEqual(result.statusCode, 202);
    assert.strictEqual(result.body.source, 'FALLBACK_CACHE');
    assert.ok(metaItem !== undefined);
    assert.strictEqual((metaItem as IngestionMetaItem).source, 'FALLBACK_CACHE');
  });

  await t.test('Consecutive failure tracking — 3 failures triggers alarm log', async () => {
    const consoleLogs: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      consoleLogs.push(args.map(String).join(' '));
    };

    const failDeps = createMockDeps({
      fetchFirms: async (): Promise<FirmsApiResult> => ({
        success: false as const,
        reason: 'http_error',
        statusCode: 500,
        message: 'HTTP 500: Internal Server Error',
      }),
    });

    // First two failures: no alarm
    await runIngestionPipeline(failDeps);
    assert.strictEqual(_getConsecutiveFailures(), 1);

    await runIngestionPipeline(failDeps);
    assert.strictEqual(_getConsecutiveFailures(), 2);

    // Third failure: should trigger alarm
    consoleLogs.length = 0;
    await runIngestionPipeline(failDeps);
    assert.strictEqual(_getConsecutiveFailures(), 3);

    // Verify alarm log was emitted
    const alarmLog = consoleLogs.find((log) => log.includes('FirmsConsecutiveFailures'));
    assert.ok(alarmLog, 'Alarm log should be emitted on 3rd consecutive failure');
    assert.ok(alarmLog!.includes('"alarm":true'));

    // Restore
    console.error = originalError;
  });

  await t.test('Success after failures resets consecutive counter', async () => {
    const failDeps = createMockDeps({
      fetchFirms: async (): Promise<FirmsApiResult> => ({
        success: false as const,
        reason: 'timeout',
        message: 'Request timed out',
      }),
    });

    // Accumulate 2 failures
    await runIngestionPipeline(failDeps);
    await runIngestionPipeline(failDeps);
    assert.strictEqual(_getConsecutiveFailures(), 2);

    // Now succeed
    const successDeps = createMockDeps();
    await runIngestionPipeline(successDeps);
    assert.strictEqual(_getConsecutiveFailures(), 0);
  });

  await t.test('Points outside Argentina are filtered out during geocoding', async () => {
    let persistedItems: HotspotItem[] = [];

    const deps = createMockDeps({
      normalize: () => ({
        hotspots: [
          {
            id: 'inside-1',
            lat: -31.42,
            lng: -64.49,
            brightness: 335.4,
            confidence: 95,
            date: '2024-01-15T14:20:00.000Z',
            satellite: 'VIIRS' as const,
          },
          {
            id: 'outside-1',
            lat: -33.45,
            lng: -70.66,
            brightness: 320.0,
            confidence: 80,
            date: '2024-01-15T14:20:00.000Z',
            satellite: 'MODIS' as const,
          },
        ],
        rawEntries: 2,
        discarded: 0,
        discardReasons: [],
      }),
      geocode: (lat: number, _lng: number) => {
        // First hotspot is in Argentina, second is in Chile
        if (lat === -31.42) return 'Córdoba';
        return 'Fuera de Argentina';
      },
      persistHotspots: async (items: HotspotItem[]) => {
        persistedItems = items;
        return { written: items.length, rejected: 0, errors: [] };
      },
    });

    const result = await runIngestionPipeline(deps);

    assert.strictEqual(result.body.geocodedRows, 1);
    assert.strictEqual(persistedItems.length, 1);
    assert.strictEqual(persistedItems[0].province, 'Córdoba');
  });

  await t.test('TTL is set to 48h from current time', async () => {
    let persistedItems: HotspotItem[] = [];
    const beforeTime = Math.floor(Date.now() / 1000);

    const deps = createMockDeps({
      persistHotspots: async (items: HotspotItem[]) => {
        persistedItems = items;
        return { written: items.length, rejected: 0, errors: [] };
      },
    });

    await runIngestionPipeline(deps);

    assert.strictEqual(persistedItems.length, 1);
    const ttl = persistedItems[0].TTL;
    const expectedMin = beforeTime + 172_800; // 48h in seconds
    const expectedMax = expectedMin + 5; // Allow 5 seconds tolerance
    assert.ok(ttl >= expectedMin && ttl <= expectedMax, `TTL ${ttl} should be ~48h from now`);
  });
});
