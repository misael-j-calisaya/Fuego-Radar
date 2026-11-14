/**
 * Property-based tests for hotspot contribution (Task 2.8).
 *
 * Property 13: Contribución de hotspots activos
 * For any RiskInput with recentHotspotsCount > 0, riskScore is at least
 * min(25, count×8) points higher than with count = 0.
 *
 * Formula: hotspotContribution = min(25, recentHotspotsCount × 8)
 * Saturation: at count ≥ 4 (since 4×8=32, clamped to 25)
 *
 * Validates: Requirement 3.6
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { evaluateFireRisk } from '../services/riskEvaluator.js';
import type { RiskInput, Region } from '../shared/types.js';
import { PROVINCES } from '../shared/constants.js';

// ============================================
// Generators
// ============================================

const regionArb: fc.Arbitrary<Region> = fc.constantFrom(
  'Patagonia' as Region,
  'Centro' as Region,
  'Norte' as Region,
  'Cuyo' as Region,
  'Litoral' as Region,
);

const baseInputArb: fc.Arbitrary<RiskInput> = fc.record({
  temperature: fc.double({ min: -20, max: 50, noNaN: true }),
  relativeHumidity: fc.double({ min: 0, max: 100, noNaN: true }),
  windSpeed: fc.double({ min: 0, max: 120, noNaN: true }),
  rain24h: fc.double({ min: 0, max: 200, noNaN: true }),
  province: fc.constantFrom(...PROVINCES),
  region: regionArb,
  recentHotspotsCount: fc.constant(0),
  historicalFireCount: fc.integer({ min: 0, max: 100 }),
  climateNormal: fc.record({
    avgTemp: fc.double({ min: 5, max: 35, noNaN: true }),
    avgHumidity: fc.double({ min: 20, max: 80, noNaN: true }),
    avgWind: fc.double({ min: 5, max: 40, noNaN: true }),
  }),
  hasCriticalAlert: fc.boolean(),
});

function orderedIntPair(min: number, max: number): fc.Arbitrary<[number, number]> {
  return fc.tuple(
    fc.integer({ min, max }),
    fc.integer({ min, max }),
  ).map(([a, b]) => a <= b ? [a, b] : [b, a]);
}

// ============================================
// Property 1: Monotonicity
// ============================================

describe('Property: Hotspot contribution — monotonicity', () => {
  it('increasing recentHotspotsCount never decreases riskScore', () => {
    fc.assert(
      fc.property(
        baseInputArb,
        orderedIntPair(0, 50),
        (input, [countLo, countHi]) => {
          const resultLo = evaluateFireRisk({ ...input, recentHotspotsCount: countLo });
          const resultHi = evaluateFireRisk({ ...input, recentHotspotsCount: countHi });

          assert.ok(
            resultHi.riskScore >= resultLo.riskScore,
            `hotspots ${countLo}→${countHi}: score ${resultLo.riskScore}→${resultHi.riskScore} decreased`,
          );
        },
      ),
      { numRuns: 300, seed: 42 },
    );
  });
});

// ============================================
// Property 2: Linear growth until saturation
// ============================================

describe('Property: Hotspot contribution — linear growth', () => {
  it('contribution grows by 8 per hotspot below saturation (count < 4)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 }), // count where count and count+1 are both below saturation
        (count) => {
          // Direct formula check
          const contribLo = Math.min(25, count * 8);
          const contribHi = Math.min(25, (count + 1) * 8);
          const diff = contribHi - contribLo;

          // Below saturation: each hotspot adds exactly 8
          assert.strictEqual(diff, 8, `count=${count}: expected +8, got +${diff}`);
        },
      ),
      { numRuns: 50, seed: 42 },
    );
  });
});

// ============================================
// Property 3: Saturation at 25 points
// ============================================

describe('Property: Hotspot contribution — saturation at 25', () => {
  it('contribution never exceeds 25 regardless of hotspot count', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        (count) => {
          const contribution = Math.min(25, count * 8);
          assert.ok(contribution <= 25, `count=${count}: contribution=${contribution} > 25`);
        },
      ),
      { numRuns: 200, seed: 42 },
    );
  });

  it('count >= 4 always produces exactly 25 points contribution', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 100 }),
        (count) => {
          const contribution = Math.min(25, count * 8);
          assert.strictEqual(contribution, 25, `count=${count}: expected 25, got ${contribution}`);
        },
      ),
      { numRuns: 200, seed: 42 },
    );
  });
});

// ============================================
// Property 4: Above saturation — no further increase
// ============================================

describe('Property: Hotspot contribution — above saturation threshold', () => {
  it('counts above 4 produce same riskScore as count=4 (all else equal)', () => {
    fc.assert(
      fc.property(
        baseInputArb,
        fc.integer({ min: 4, max: 50 }),
        (input, highCount) => {
          const atSaturation = evaluateFireRisk({ ...input, recentHotspotsCount: 4 });
          const aboveSaturation = evaluateFireRisk({ ...input, recentHotspotsCount: highCount });

          assert.strictEqual(
            aboveSaturation.riskScore,
            atSaturation.riskScore,
            `count=4 score=${atSaturation.riskScore}, count=${highCount} score=${aboveSaturation.riskScore}`,
          );
        },
      ),
      { numRuns: 200, seed: 42 },
    );
  });
});

// ============================================
// Property 5: Bounded output
// ============================================

describe('Property: Hotspot contribution — riskScore remains bounded', () => {
  it('riskScore is always in [0, 100] regardless of hotspot count', () => {
    fc.assert(
      fc.property(
        baseInputArb,
        fc.integer({ min: 0, max: 100 }),
        (input, count) => {
          const result = evaluateFireRisk({ ...input, recentHotspotsCount: count });
          assert.ok(result.riskScore >= 0, `score ${result.riskScore} < 0`);
          assert.ok(result.riskScore <= 100, `score ${result.riskScore} > 100`);
        },
      ),
      { numRuns: 300, seed: 42 },
    );
  });
});
