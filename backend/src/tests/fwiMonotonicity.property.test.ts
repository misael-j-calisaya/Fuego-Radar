/**
 * Property-based tests for FWI monotonicity (Task 2.3).
 *
 * Property 3: Monotonía del FWI
 * - If temperature increases (others constant), FWI increases or stays equal.
 * - If humidity increases (others constant), FWI decreases or stays equal.
 * - If wind increases (others constant), FWI increases or stays equal.
 *
 * Validates: Requirements 4.2, 4.3, 4.4
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { calculateFWIUnsafe } from '../services/fwiCalculator.js';

// ============================================
// Generators
// ============================================

/** Generates an ordered pair [lo, hi] within a range (lo <= hi) */
function orderedPair(min: number, max: number): fc.Arbitrary<[number, number]> {
  return fc.tuple(
    fc.double({ min, max, noNaN: true }),
    fc.double({ min, max, noNaN: true }),
  ).map(([a, b]) => a <= b ? [a, b] : [b, a]);
}

// ============================================
// Property: Temperature monotonicity
// ============================================

describe('Property: FWI monotonicity — temperature', () => {
  it('increasing temperature does not decrease FWI (humidity and wind constant)', () => {
    fc.assert(
      fc.property(
        orderedPair(-20, 50),                              // [tempLo, tempHi]
        fc.double({ min: 0, max: 100, noNaN: true }),      // humidity (constant)
        fc.double({ min: 0, max: 150, noNaN: true }),      // windSpeed (constant)
        ([tempLo, tempHi], humidity, wind) => {
          const fwiLo = calculateFWIUnsafe(tempLo, humidity, wind);
          const fwiHi = calculateFWIUnsafe(tempHi, humidity, wind);

          assert.ok(
            fwiHi >= fwiLo,
            `temp ${tempLo}→${tempHi}: FWI ${fwiLo}→${fwiHi} decreased (hum=${humidity}, wind=${wind})`,
          );
        },
      ),
      { numRuns: 300, seed: 42 },
    );
  });
});

// ============================================
// Property: Wind speed monotonicity
// ============================================

describe('Property: FWI monotonicity — windSpeed', () => {
  it('increasing windSpeed does not decrease FWI (temperature and humidity constant)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -20, max: 50, noNaN: true }),     // temperature (constant)
        fc.double({ min: 0, max: 100, noNaN: true }),      // humidity (constant)
        orderedPair(0, 150),                                // [windLo, windHi]
        (temp, humidity, [windLo, windHi]) => {
          const fwiLo = calculateFWIUnsafe(temp, humidity, windLo);
          const fwiHi = calculateFWIUnsafe(temp, humidity, windHi);

          assert.ok(
            fwiHi >= fwiLo,
            `wind ${windLo}→${windHi}: FWI ${fwiLo}→${fwiHi} decreased (temp=${temp}, hum=${humidity})`,
          );
        },
      ),
      { numRuns: 300, seed: 42 },
    );
  });
});

// ============================================
// Property: Humidity inverse monotonicity
// ============================================

describe('Property: FWI monotonicity — humidity (inverse)', () => {
  it('increasing humidity does not increase FWI (temperature and wind constant)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -20, max: 50, noNaN: true }),     // temperature (constant)
        orderedPair(0, 100),                                // [humLo, humHi]
        fc.double({ min: 0, max: 150, noNaN: true }),      // windSpeed (constant)
        (temp, [humLo, humHi], wind) => {
          const fwiLo = calculateFWIUnsafe(temp, humLo, wind);
          const fwiHi = calculateFWIUnsafe(temp, humHi, wind);

          // Higher humidity → lower or equal FWI
          assert.ok(
            fwiHi <= fwiLo,
            `humidity ${humLo}→${humHi}: FWI ${fwiLo}→${fwiHi} increased (temp=${temp}, wind=${wind})`,
          );
        },
      ),
      { numRuns: 300, seed: 42 },
    );
  });
});
