/**
 * Property-based tests for fire area estimation bounds and monotonicity (Task 2.12).
 *
 * Property 9: Cota mínima del área estimada y monotonía
 * For any valid inputs:
 * - result >= 1 hectare
 * - result <= 10000 hectares
 * - result is a finite integer
 * - monotonically increasing in each parameter (holding others constant)
 *
 * Validates: Requirements 12.2, 12.4
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { estimateFireArea } from '../services/areaEstimator.js';
import type { AreaEstimationInput } from '../services/areaEstimator.js';

// ============================================
// Generators
// ============================================

/** Generates valid area estimation inputs */
const validInputArb: fc.Arbitrary<AreaEstimationInput> = fc.record({
  brightness: fc.double({ min: 250, max: 600, noNaN: true }),
  windSpeed: fc.double({ min: 0, max: 120, noNaN: true }),
  fwi: fc.double({ min: 0, max: 100, noNaN: true }),
  nearbyHotspots: fc.integer({ min: 0, max: 50 }),
  confidence: fc.double({ min: 0, max: 100, noNaN: true }),
});

/** Generates a pair of values where second >= first (for monotonicity) */
function orderedPair(min: number, max: number): fc.Arbitrary<[number, number]> {
  return fc.tuple(
    fc.double({ min, max, noNaN: true }),
    fc.double({ min, max, noNaN: true }),
  ).map(([a, b]) => a <= b ? [a, b] : [b, a]);
}

function orderedIntPair(min: number, max: number): fc.Arbitrary<[number, number]> {
  return fc.tuple(
    fc.integer({ min, max }),
    fc.integer({ min, max }),
  ).map(([a, b]) => a <= b ? [a, b] : [b, a]);
}

// ============================================
// Property: Output bounds
// ============================================

describe('Property: Area estimation output bounds', () => {
  it('area is always >= 1 hectare for any valid input', () => {
    fc.assert(
      fc.property(validInputArb, (input) => {
        const result = estimateFireArea(input);
        assert.ok(
          result.areaHectares >= 1,
          `Expected >= 1, got ${result.areaHectares} for input ${JSON.stringify(input)}`,
        );
      }),
      { numRuns: 500, seed: 42 },
    );
  });

  it('area is always <= 10000 hectares for any valid input', () => {
    fc.assert(
      fc.property(validInputArb, (input) => {
        const result = estimateFireArea(input);
        assert.ok(
          result.areaHectares <= 10000,
          `Expected <= 10000, got ${result.areaHectares} for input ${JSON.stringify(input)}`,
        );
      }),
      { numRuns: 500, seed: 42 },
    );
  });

  it('area is always a finite integer', () => {
    fc.assert(
      fc.property(validInputArb, (input) => {
        const result = estimateFireArea(input);
        assert.ok(Number.isFinite(result.areaHectares), `Not finite: ${result.areaHectares}`);
        assert.ok(Number.isInteger(result.areaHectares), `Not integer: ${result.areaHectares}`);
      }),
      { numRuns: 500, seed: 42 },
    );
  });
});

// ============================================
// Property: Monotonicity in each parameter
// ============================================

describe('Property: Area estimation monotonicity', () => {
  it('increasing brightness does not decrease area (others constant)', () => {
    fc.assert(
      fc.property(
        validInputArb,
        orderedPair(250, 600),
        (baseInput, [lo, hi]) => {
          const resultLo = estimateFireArea({ ...baseInput, brightness: lo });
          const resultHi = estimateFireArea({ ...baseInput, brightness: hi });
          assert.ok(
            resultHi.areaHectares >= resultLo.areaHectares,
            `brightness ${lo}→${hi}: area ${resultLo.areaHectares}→${resultHi.areaHectares} decreased`,
          );
        },
      ),
      { numRuns: 200, seed: 42 },
    );
  });

  it('increasing windSpeed does not decrease area (others constant)', () => {
    fc.assert(
      fc.property(
        validInputArb,
        orderedPair(0, 120),
        (baseInput, [lo, hi]) => {
          const resultLo = estimateFireArea({ ...baseInput, windSpeed: lo });
          const resultHi = estimateFireArea({ ...baseInput, windSpeed: hi });
          assert.ok(
            resultHi.areaHectares >= resultLo.areaHectares,
            `windSpeed ${lo}→${hi}: area ${resultLo.areaHectares}→${resultHi.areaHectares} decreased`,
          );
        },
      ),
      { numRuns: 200, seed: 42 },
    );
  });

  it('increasing fwi does not decrease area (others constant)', () => {
    fc.assert(
      fc.property(
        validInputArb,
        orderedPair(0, 100),
        (baseInput, [lo, hi]) => {
          const resultLo = estimateFireArea({ ...baseInput, fwi: lo });
          const resultHi = estimateFireArea({ ...baseInput, fwi: hi });
          assert.ok(
            resultHi.areaHectares >= resultLo.areaHectares,
            `fwi ${lo}→${hi}: area ${resultLo.areaHectares}→${resultHi.areaHectares} decreased`,
          );
        },
      ),
      { numRuns: 200, seed: 42 },
    );
  });

  it('increasing nearbyHotspots does not decrease area (others constant)', () => {
    fc.assert(
      fc.property(
        validInputArb,
        orderedIntPair(0, 50),
        (baseInput, [lo, hi]) => {
          const resultLo = estimateFireArea({ ...baseInput, nearbyHotspots: lo });
          const resultHi = estimateFireArea({ ...baseInput, nearbyHotspots: hi });
          assert.ok(
            resultHi.areaHectares >= resultLo.areaHectares,
            `nearbyHotspots ${lo}→${hi}: area ${resultLo.areaHectares}→${resultHi.areaHectares} decreased`,
          );
        },
      ),
      { numRuns: 200, seed: 42 },
    );
  });

  it('increasing confidence does not decrease area (others constant)', () => {
    fc.assert(
      fc.property(
        validInputArb,
        orderedPair(0, 100),
        (baseInput, [lo, hi]) => {
          const resultLo = estimateFireArea({ ...baseInput, confidence: lo });
          const resultHi = estimateFireArea({ ...baseInput, confidence: hi });
          assert.ok(
            resultHi.areaHectares >= resultLo.areaHectares,
            `confidence ${lo}→${hi}: area ${resultLo.areaHectares}→${resultHi.areaHectares} decreased`,
          );
        },
      ),
      { numRuns: 200, seed: 42 },
    );
  });
});
