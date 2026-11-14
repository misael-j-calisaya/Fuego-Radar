/**
 * Property-based tests for rain suppression (Task 2.7).
 *
 * Property 4: Supresión por lluvia
 * For any RiskInput with rain24h > 10mm, riskScore is at least 30 points less
 * than same input with rain24h = 0.
 *
 * Additional invariants:
 * - Increasing rain24h never increases riskScore (monotone decreasing).
 * - rain24h > 2mm applies at least -15 points.
 * - rain24h > 10mm applies at least -30 points.
 *
 * Validates: Requirement 3.5
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

/** Base input with rain24h = 0 (no suppression) */
const baseInputArb: fc.Arbitrary<RiskInput> = fc.record({
  temperature: fc.double({ min: -20, max: 50, noNaN: true }),
  relativeHumidity: fc.double({ min: 0, max: 100, noNaN: true }),
  windSpeed: fc.double({ min: 0, max: 120, noNaN: true }),
  rain24h: fc.constant(0),
  province: fc.constantFrom(...PROVINCES),
  region: regionArb,
  recentHotspotsCount: fc.integer({ min: 0, max: 50 }),
  historicalFireCount: fc.integer({ min: 0, max: 100 }),
  climateNormal: fc.record({
    avgTemp: fc.double({ min: 5, max: 35, noNaN: true }),
    avgHumidity: fc.double({ min: 20, max: 80, noNaN: true }),
    avgWind: fc.double({ min: 5, max: 40, noNaN: true }),
  }),
  hasCriticalAlert: fc.boolean(),
});

/** Ordered rain pair [lo, hi] for monotonicity tests */
function orderedRainPair(min: number, max: number): fc.Arbitrary<[number, number]> {
  return fc.tuple(
    fc.double({ min, max, noNaN: true }),
    fc.double({ min, max, noNaN: true }),
  ).map(([a, b]) => a <= b ? [a, b] : [b, a]);
}

// ============================================
// Property: Rain monotone suppression
// ============================================

describe('Property: Rain suppression — monotonicity', () => {
  it('increasing rain24h does not increase riskScore (others constant)', () => {
    fc.assert(
      fc.property(
        baseInputArb,
        orderedRainPair(0, 200),
        (input, [rainLo, rainHi]) => {
          const resultLo = evaluateFireRisk({ ...input, rain24h: rainLo });
          const resultHi = evaluateFireRisk({ ...input, rain24h: rainHi });

          assert.ok(
            resultHi.riskScore <= resultLo.riskScore,
            `rain ${rainLo}→${rainHi}: score ${resultLo.riskScore}→${resultHi.riskScore} increased`,
          );
        },
      ),
      { numRuns: 300, seed: 42 },
    );
  });
});

// ============================================
// Property: Heavy rain (>10mm) suppresses by at least 30 points
// ============================================

describe('Property: Rain suppression — heavy rain (>10mm)', () => {
  it('rain24h > 10mm produces score at least 30 points lower than rain24h = 0 (or both clamped)', () => {
    fc.assert(
      fc.property(
        baseInputArb,
        fc.double({ min: 10.01, max: 200, noNaN: true }),
        (input, heavyRain) => {
          const noRainResult = evaluateFireRisk({ ...input, rain24h: 0 });
          const heavyRainResult = evaluateFireRisk({ ...input, rain24h: heavyRain });

          const diff = noRainResult.riskScore - heavyRainResult.riskScore;

          // Due to clamping at [0, 100], the full 30-point suppression may not
          // be observable when the raw score far exceeds 100 (both clamp to 100)
          // or when the raw score with suppression is still ≥ 100.
          // The valid invariant is: diff >= 0 (monotonicity, which is tested separately)
          // AND when the suppression IS observable (noRain < 130), diff >= 30
          // The weaker but always-true invariant: heavyRain score ≤ noRain score
          assert.ok(
            heavyRainResult.riskScore <= noRainResult.riskScore,
            `Heavy rain must not increase score: noRain=${noRainResult.riskScore}, heavy=${heavyRainResult.riskScore}`,
          );
        },
      ),
      { numRuns: 300, seed: 42 },
    );
  });

  it('rain24h > 10mm shows full 30-point suppression when score is below ceiling', () => {
    // Use constrained inputs that keep the no-rain score well below 100
    fc.assert(
      fc.property(
        fc.double({ min: -20, max: 20, noNaN: true }),     // moderate temp
        fc.double({ min: 40, max: 100, noNaN: true }),     // higher humidity (suppresses score)
        fc.double({ min: 0, max: 20, noNaN: true }),       // low wind
        fc.integer({ min: 0, max: 2 }),                    // few hotspots
        fc.double({ min: 10.01, max: 200, noNaN: true }),  // heavy rain
        (temp, hum, wind, hotspots, heavyRain) => {
          const input: RiskInput = {
            temperature: temp,
            relativeHumidity: hum,
            windSpeed: wind,
            rain24h: 0,
            province: 'Córdoba',
            region: 'Centro',
            recentHotspotsCount: hotspots,
            historicalFireCount: 0,
            climateNormal: { avgTemp: 20, avgHumidity: 50, avgWind: 15 },
            hasCriticalAlert: false,
          };

          const noRainResult = evaluateFireRisk(input);
          const heavyRainResult = evaluateFireRisk({ ...input, rain24h: heavyRain });

          // Skip if no-rain already clamped at ceiling
          if (noRainResult.riskScore >= 100) return;

          const diff = noRainResult.riskScore - heavyRainResult.riskScore;
          // Full suppression visible or result hit floor
          assert.ok(
            diff >= 30 || heavyRainResult.riskScore === 0,
            `Expected ≥30pt or floor=0. noRain=${noRainResult.riskScore}, heavy=${heavyRainResult.riskScore}, diff=${diff}`,
          );
        },
      ),
      { numRuns: 200, seed: 42 },
    );
  });
});

// ============================================
// Property: Moderate rain (>2mm) suppresses by at least 15 points
// ============================================

describe('Property: Rain suppression — moderate rain (>2mm)', () => {
  it('rain24h > 2mm never increases score (monotone suppression)', () => {
    fc.assert(
      fc.property(
        baseInputArb,
        fc.double({ min: 2.01, max: 10, noNaN: true }),
        (input, moderateRain) => {
          const noRainResult = evaluateFireRisk({ ...input, rain24h: 0 });
          const moderateRainResult = evaluateFireRisk({ ...input, rain24h: moderateRain });

          assert.ok(
            moderateRainResult.riskScore <= noRainResult.riskScore,
            `Moderate rain must not increase score: noRain=${noRainResult.riskScore}, mod=${moderateRainResult.riskScore}`,
          );
        },
      ),
      { numRuns: 300, seed: 42 },
    );
  });

  it('rain24h > 2mm shows full 15-point suppression when score is below ceiling', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -20, max: 20, noNaN: true }),
        fc.double({ min: 40, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 20, noNaN: true }),
        fc.integer({ min: 0, max: 2 }),
        fc.double({ min: 2.01, max: 10, noNaN: true }),
        (temp, hum, wind, hotspots, modRain) => {
          const input: RiskInput = {
            temperature: temp,
            relativeHumidity: hum,
            windSpeed: wind,
            rain24h: 0,
            province: 'Córdoba',
            region: 'Centro',
            recentHotspotsCount: hotspots,
            historicalFireCount: 0,
            climateNormal: { avgTemp: 20, avgHumidity: 50, avgWind: 15 },
            hasCriticalAlert: false,
          };

          const noRainResult = evaluateFireRisk(input);
          const modRainResult = evaluateFireRisk({ ...input, rain24h: modRain });

          if (noRainResult.riskScore >= 100) return;

          const diff = noRainResult.riskScore - modRainResult.riskScore;
          assert.ok(
            diff >= 15 || modRainResult.riskScore === 0,
            `Expected ≥15pt or floor=0. noRain=${noRainResult.riskScore}, mod=${modRainResult.riskScore}, diff=${diff}`,
          );
        },
      ),
      { numRuns: 200, seed: 42 },
    );
  });
});

// ============================================
// Property: No rain means no suppression
// ============================================

describe('Property: Rain suppression — no rain', () => {
  it('rain24h = 0 produces same score as rain24h ≤ 2 (no suppression zone)', () => {
    fc.assert(
      fc.property(
        baseInputArb,
        fc.double({ min: 0, max: 2, noNaN: true }),
        (input, smallRain) => {
          const noRainResult = evaluateFireRisk({ ...input, rain24h: 0 });
          const smallRainResult = evaluateFireRisk({ ...input, rain24h: smallRain });

          assert.strictEqual(
            noRainResult.riskScore,
            smallRainResult.riskScore,
            `rain24h=${smallRain} should produce same score as 0, got ${noRainResult.riskScore} vs ${smallRainResult.riskScore}`,
          );
        },
      ),
      { numRuns: 200, seed: 42 },
    );
  });
});
