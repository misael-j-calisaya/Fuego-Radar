/**
 * Property-based tests for deduplication invariants (Task 4.7).
 *
 * Property 5: Invariante de no-duplicados en resultado
 * For any two hotspots in the result, at least one duplicate condition fails:
 * dist > 0.015° OR timeDiff > 30min OR different satellite.
 *
 * Additional invariants:
 * - outputCount <= inputCount
 * - duplicateCount + outputCount + discardedCount = inputCount
 * - Determinism: same input → same result
 * - Invalid timestamps tracked in discardReasons
 *
 * Validates: Requirement 7.4
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { detectDuplicates } from '../services/deduplicator.js';
import type { NormalizedHotspot } from '../services/csvNormalizer.js';
import {
  DEDUP_SPATIAL_THRESHOLD_DEG,
  DEDUP_TEMPORAL_THRESHOLD_MS,
} from '../shared/constants.js';

// ============================================
// Generators
// ============================================

const satelliteArb = fc.constantFrom('VIIRS' as const, 'MODIS' as const);

/** Generates a valid normalized hotspot */
const validHotspotArb: fc.Arbitrary<NormalizedHotspot> = fc.record({
  id: fc.uuid(),
  lat: fc.double({ min: -56, max: -21, noNaN: true }),
  lng: fc.double({ min: -74, max: -53, noNaN: true }),
  brightness: fc.double({ min: 280, max: 500, noNaN: true }),
  confidence: fc.integer({ min: 0, max: 100 }),
  date: fc.date({ min: new Date('2023-01-01'), max: new Date('2026-12-31') })
    .map(d => d.toISOString()),
  satellite: satelliteArb,
});

/** Generates a hotspot with invalid timestamp */
const invalidTimestampHotspotArb: fc.Arbitrary<NormalizedHotspot> = fc.record({
  id: fc.uuid(),
  lat: fc.double({ min: -56, max: -21, noNaN: true }),
  lng: fc.double({ min: -74, max: -53, noNaN: true }),
  brightness: fc.double({ min: 280, max: 500, noNaN: true }),
  confidence: fc.integer({ min: 0, max: 100 }),
  date: fc.constantFrom('not-a-date', 'invalid', '9999-99-99T99:99:99Z', ''),
  satellite: satelliteArb,
});

/** Generates a list of valid hotspots */
const hotspotListArb = fc.array(validHotspotArb, { minLength: 0, maxLength: 20 });

/** Generates a mixed list (valid + invalid timestamps) */
const mixedListArb = fc.tuple(
  fc.array(validHotspotArb, { minLength: 0, maxLength: 10 }),
  fc.array(invalidTimestampHotspotArb, { minLength: 1, maxLength: 5 }),
).map(([valid, invalid]) => [...valid, ...invalid]);

// ============================================
// Helper: Euclidean distance in degrees
// ============================================

function distDeg(h1: NormalizedHotspot, h2: NormalizedHotspot): number {
  return Math.sqrt((h1.lat - h2.lat) ** 2 + (h1.lng - h2.lng) ** 2);
}

// ============================================
// Property: outputCount <= inputCount
// ============================================

describe('Property: Deduplication — outputCount <= inputCount', () => {
  it('output never exceeds input size', () => {
    fc.assert(
      fc.property(hotspotListArb, (hotspots) => {
        const result = detectDuplicates(hotspots);
        assert.ok(
          result.outputCount <= result.inputCount,
          `output=${result.outputCount} > input=${result.inputCount}`,
        );
      }),
      { numRuns: 300, seed: 42 },
    );
  });
});

// ============================================
// Property: Conservation law
// ============================================

describe('Property: Deduplication — conservation law', () => {
  it('duplicateCount + outputCount + discardedCount = inputCount', () => {
    fc.assert(
      fc.property(hotspotListArb, (hotspots) => {
        const result = detectDuplicates(hotspots);
        const sum = result.duplicateCount + result.outputCount + result.discardedCount;
        assert.strictEqual(
          sum,
          result.inputCount,
          `${result.duplicateCount} + ${result.outputCount} + ${result.discardedCount} = ${sum} ≠ ${result.inputCount}`,
        );
      }),
      { numRuns: 300, seed: 42 },
    );
  });

  it('conservation holds with mixed valid/invalid inputs', () => {
    fc.assert(
      fc.property(mixedListArb, (hotspots) => {
        const result = detectDuplicates(hotspots);
        const sum = result.duplicateCount + result.outputCount + result.discardedCount;
        assert.strictEqual(sum, result.inputCount);
      }),
      { numRuns: 200, seed: 42 },
    );
  });
});

// ============================================
// Property: No-duplicates invariant in output
// ============================================

describe('Property: Deduplication — no duplicates in output', () => {
  it('no two output hotspots satisfy ALL duplicate conditions simultaneously', () => {
    fc.assert(
      fc.property(hotspotListArb, (hotspots) => {
        const result = detectDuplicates(hotspots);
        const output = result.hotspots;

        // Check every pair in the output
        for (let i = 0; i < output.length; i++) {
          for (let j = i + 1; j < output.length; j++) {
            const h1 = output[i];
            const h2 = output[j];

            const dist = distDeg(h1, h2);
            const timeDiff = Math.abs(
              new Date(h1.date).getTime() - new Date(h2.date).getTime()
            );
            const sameSat = h1.satellite === h2.satellite;

            // At least one condition must FAIL for it NOT to be a duplicate
            const allConditionsMet =
              dist <= DEDUP_SPATIAL_THRESHOLD_DEG &&
              timeDiff <= DEDUP_TEMPORAL_THRESHOLD_MS &&
              sameSat;

            assert.ok(
              !allConditionsMet,
              `Duplicate pair in output: h[${i}] and h[${j}] — dist=${dist.toFixed(5)}°, time=${timeDiff}ms, sameSat=${sameSat}`,
            );
          }
        }
      }),
      { numRuns: 200, seed: 42 },
    );
  });
});

// ============================================
// Property: Determinism
// ============================================

describe('Property: Deduplication — determinism', () => {
  it('same input always produces same output (ids, order, counts)', () => {
    fc.assert(
      fc.property(hotspotListArb, (hotspots) => {
        const result1 = detectDuplicates(hotspots);
        const result2 = detectDuplicates(hotspots);

        assert.strictEqual(result1.outputCount, result2.outputCount);
        assert.strictEqual(result1.duplicateCount, result2.duplicateCount);
        assert.strictEqual(result1.discardedCount, result2.discardedCount);

        // Same hotspot IDs in output (same order)
        const ids1 = result1.hotspots.map(h => h.id);
        const ids2 = result2.hotspots.map(h => h.id);
        assert.deepStrictEqual(ids1, ids2);
      }),
      { numRuns: 200, seed: 42 },
    );
  });
});

// ============================================
// Property: Invalid timestamps tracked
// ============================================

describe('Property: Deduplication — invalid timestamps', () => {
  it('invalid timestamps are always discarded and tracked in discardReasons', () => {
    fc.assert(
      fc.property(mixedListArb, (hotspots) => {
        const result = detectDuplicates(hotspots);

        // Count how many inputs have invalid dates
        const invalidCount = hotspots.filter(h => isNaN(new Date(h.date).getTime())).length;

        assert.strictEqual(
          result.discardedCount,
          invalidCount,
          `discardedCount=${result.discardedCount} ≠ invalidTimestamps=${invalidCount}`,
        );

        // Each discarded entry should have a reason
        assert.strictEqual(result.discardReasons.length, invalidCount);
        for (const reason of result.discardReasons) {
          assert.ok(reason.id.length > 0, 'Discard reason should have an id');
          assert.ok(reason.reason.length > 0, 'Discard reason should have a message');
        }
      }),
      { numRuns: 200, seed: 42 },
    );
  });
});
