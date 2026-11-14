/**
 * Property-based tests for danger level consistency (Task 2.6).
 *
 * Property 2: Consistencia nivel-score
 * For any result, riskLevel corresponds exactly to getDangerLevel(riskScore).
 *
 * Thresholds:
 *   score < 20  → 'Bajo'
 *   20 ≤ score < 40 → 'Medio'
 *   40 ≤ score < 60 → 'Alto'
 *   60 ≤ score < 80 → 'Muy Alto'
 *   score ≥ 80 → 'Extremo'
 *
 * Validates: Requirement 3.4
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { getDangerLevel } from '../services/fwiCalculator.js';
import { evaluateFireRisk } from '../services/riskEvaluator.js';
import type { RiskInput, DangerLevel, Region } from '../shared/types.js';
import { PROVINCES } from '../shared/constants.js';

// ============================================
// Reference implementation for verification
// ============================================

function expectedDangerLevel(score: number): DangerLevel {
  if (score < 20) return 'Bajo';
  if (score < 40) return 'Medio';
  if (score < 60) return 'Alto';
  if (score < 80) return 'Muy Alto';
  return 'Extremo';
}

// ============================================
// Generators
// ============================================

const scoreArb = fc.integer({ min: 0, max: 100 });

const regionArb: fc.Arbitrary<Region> = fc.constantFrom(
  'Patagonia' as Region,
  'Centro' as Region,
  'Norte' as Region,
  'Cuyo' as Region,
  'Litoral' as Region,
);

const validRiskInputArb: fc.Arbitrary<RiskInput> = fc.record({
  temperature: fc.double({ min: -20, max: 50, noNaN: true }),
  relativeHumidity: fc.double({ min: 0, max: 100, noNaN: true }),
  windSpeed: fc.double({ min: 0, max: 120, noNaN: true }),
  rain24h: fc.double({ min: 0, max: 200, noNaN: true }),
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

// ============================================
// Property: getDangerLevel matches threshold rules
// ============================================

describe('Property: Danger level consistency — getDangerLevel', () => {
  it('getDangerLevel returns correct level for any score in [0, 100]', () => {
    fc.assert(
      fc.property(scoreArb, (score) => {
        const actual = getDangerLevel(score);
        const expected = expectedDangerLevel(score);
        assert.strictEqual(
          actual,
          expected,
          `score=${score}: expected '${expected}', got '${actual}'`,
        );
      }),
      { numRuns: 500, seed: 42 },
    );
  });
});

// ============================================
// Property: evaluateFireRisk result level matches its score
// ============================================

describe('Property: Danger level consistency — evaluateFireRisk', () => {
  it('riskLevel always corresponds to getDangerLevel(riskScore)', () => {
    fc.assert(
      fc.property(validRiskInputArb, (input) => {
        const result = evaluateFireRisk(input);
        const expectedLevel = expectedDangerLevel(result.riskScore);
        assert.strictEqual(
          result.riskLevel,
          expectedLevel,
          `score=${result.riskScore}: expected '${expectedLevel}', got '${result.riskLevel}'`,
        );
      }),
      { numRuns: 500, seed: 42 },
    );
  });
});

// ============================================
// Exact boundary values
// ============================================

describe('Danger level consistency — exact boundaries', () => {
  const boundaryTests: Array<{ score: number; expected: DangerLevel }> = [
    { score: 0, expected: 'Bajo' },
    { score: 19, expected: 'Bajo' },
    { score: 20, expected: 'Medio' },
    { score: 39, expected: 'Medio' },
    { score: 40, expected: 'Alto' },
    { score: 59, expected: 'Alto' },
    { score: 60, expected: 'Muy Alto' },
    { score: 79, expected: 'Muy Alto' },
    { score: 80, expected: 'Extremo' },
    { score: 100, expected: 'Extremo' },
  ];

  for (const { score, expected } of boundaryTests) {
    it(`score ${score} → '${expected}'`, () => {
      assert.strictEqual(getDangerLevel(score), expected);
    });
  }
});
