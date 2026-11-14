/**
 * Property-based tests for deduplication conservation (Task 4.8).
 *
 * Property 8: Conservación en deduplicación
 * For any hotspot list, detectDuplicates result size ≤ input size.
 * Every input is accounted for: kept, duplicated, or discarded.
 *
 * Validates: Requirement 7.3
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { detectDuplicates } from '../services/deduplicator.js';
import type { NormalizedHotspot } from '../services/csvNormalizer.js';

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

/** Generates hotspots that are guaranteed NOT to be duplicates of each other
 *  (widely separated in space — each 2° apart) */
const nonDuplicateListArb: fc.Arbitrary<NormalizedHotspot[]> = fc.integer({ min: 1, max: 10 }).chain(count =>
  fc.tuple(
    fc.array(
      fc.tuple(fc.integer({ min: 0, max: count - 1 }), validHotspotArb),
      { minLength: count, maxLength: count },
    ),
  ).map(([items]) =>
    items.map(([idx, h], i) => ({
      ...h,
      // Spread hotspots 3° apart in latitude to guarantee no spatial overlap
      lat: -50 + i * 3,
      lng: -65 + i * 2,
      // Spread dates 2 hours apart to guarantee no temporal overlap
      date: new Date(Date.UTC(2024, 6, 1, i * 2, 0, 0)).toISOString(),
    })),
  ),
);

/** Mixed list with some valid, some invalid */
const mixedListArb = fc.tuple(
  fc.array(validHotspotArb, { minLength: 0, maxLength: 10 }),
  fc.array(invalidTimestampHotspotArb, { minLength: 0, maxLength: 5 }),
).map(([valid, invalid]) => [...valid, ...invalid]);

// ============================================
// Property: Every input is accounted for
// ============================================

describe('Property: Deduplication conservation — every input accounted', () => {
  it('duplicateCount + outputCount + discardedCount = inputCount', () => {
    fc.assert(
      fc.property(mixedListArb, (hotspots) => {
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
});

// ============================================
// Property: duplicateCount never exceeds inputCount
// ============================================

describe('Property: Deduplication conservation — duplicateCount bounded', () => {
  it('duplicateCount <= inputCount', () => {
    fc.assert(
      fc.property(mixedListArb, (hotspots) => {
        const result = detectDuplicates(hotspots);
        assert.ok(
          result.duplicateCount <= result.inputCount,
          `duplicateCount=${result.duplicateCount} > inputCount=${result.inputCount}`,
        );
      }),
      { numRuns: 300, seed: 42 },
    );
  });
});

// ============================================
// Property: discardedCount equals invalid timestamps
// ============================================

describe('Property: Deduplication conservation — discardedCount matches invalids', () => {
  it('discardedCount equals the number of hotspots with unparseable timestamps', () => {
    fc.assert(
      fc.property(mixedListArb, (hotspots) => {
        const result = detectDuplicates(hotspots);
        const invalidCount = hotspots.filter(h => isNaN(new Date(h.date).getTime())).length;
        assert.strictEqual(
          result.discardedCount,
          invalidCount,
          `discardedCount=${result.discardedCount} ≠ invalidTimestamps=${invalidCount}`,
        );
      }),
      { numRuns: 300, seed: 42 },
    );
  });
});

// ============================================
// Property: Output hotspots come from original input
// ============================================

describe('Property: Deduplication conservation — output IDs from input', () => {
  it('every output hotspot ID exists in the original input', () => {
    fc.assert(
      fc.property(mixedListArb, (hotspots) => {
        const result = detectDuplicates(hotspots);
        const inputIds = new Set(hotspots.map(h => h.id));

        for (const outputH of result.hotspots) {
          assert.ok(
            inputIds.has(outputH.id),
            `Output hotspot id="${outputH.id}" not found in input`,
          );
        }
      }),
      { numRuns: 300, seed: 42 },
    );
  });
});

// ============================================
// Property: No duplicates + valid timestamps → lossless pass-through
// ============================================

describe('Property: Deduplication conservation — lossless when no duplicates', () => {
  it('non-duplicate inputs with valid timestamps produce outputCount === inputCount', () => {
    fc.assert(
      fc.property(nonDuplicateListArb, (hotspots) => {
        const result = detectDuplicates(hotspots);

        assert.strictEqual(
          result.outputCount,
          result.inputCount,
          `outputCount=${result.outputCount} ≠ inputCount=${result.inputCount}`,
        );
        assert.strictEqual(result.duplicateCount, 0, `duplicateCount should be 0`);
        assert.strictEqual(result.discardedCount, 0, `discardedCount should be 0`);
      }),
      { numRuns: 200, seed: 42 },
    );
  });
});
