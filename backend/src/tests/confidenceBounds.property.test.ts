/**
 * Property-based tests for confidence score bounds (Task 2.10).
 *
 * Property 6: Cota mínima del Score de Confianza
 * For any valid RiskInput, calculateConfidence returns value ≥ 50 and ≤ 100.
 *
 * Additional invariants:
 * - Stale weather never increases confidence.
 * - Adding anomaly penalties never increases confidence.
 * - Result is always a finite integer.
 *
 * Validates: Requirement 5.6
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { calculateConfidence } from '../services/riskEvaluator.js';
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
// Property: Confidence always in [50, 100]
// ============================================

describe('Property: Confidence score bounds [50, 100]', () => {
  it('confidenceScore is always >= 50 for any valid input (weatherStale=false)', () => {
    fc.assert(
      fc.property(validRiskInputArb, (input) => {
        const result = calculateConfidence(input, false);
        assert.ok(
          result.confidenceScore >= 50,
          `confidenceScore ${result.confidenceScore} < 50`,
        );
      }),
      { numRuns: 500, seed: 42 },
    );
  });

  it('confidenceScore is always >= 50 for any valid input (weatherStale=true)', () => {
    fc.assert(
      fc.property(validRiskInputArb, (input) => {
        const result = calculateConfidence(input, true);
        assert.ok(
          result.confidenceScore >= 50,
          `confidenceScore ${result.confidenceScore} < 50 (stale=true)`,
        );
      }),
      { numRuns: 500, seed: 42 },
    );
  });

  it('confidenceScore is always <= 100 for any valid input', () => {
    fc.assert(
      fc.property(validRiskInputArb, fc.boolean(), (input, stale) => {
        const result = calculateConfidence(input, stale);
        assert.ok(
          result.confidenceScore <= 100,
          `confidenceScore ${result.confidenceScore} > 100`,
        );
      }),
      { numRuns: 500, seed: 42 },
    );
  });

  it('confidenceScore is always a finite integer', () => {
    fc.assert(
      fc.property(validRiskInputArb, fc.boolean(), (input, stale) => {
        const result = calculateConfidence(input, stale);
        assert.ok(Number.isFinite(result.confidenceScore));
        assert.ok(Number.isInteger(result.confidenceScore));
      }),
      { numRuns: 500, seed: 42 },
    );
  });
});

// ============================================
// Property: Stale weather never increases confidence
// ============================================

describe('Property: Stale weather penalty', () => {
  it('weatherStale=true never produces higher confidence than weatherStale=false', () => {
    fc.assert(
      fc.property(validRiskInputArb, (input) => {
        const fresh = calculateConfidence(input, false);
        const stale = calculateConfidence(input, true);

        assert.ok(
          stale.confidenceScore <= fresh.confidenceScore,
          `Stale (${stale.confidenceScore}) > fresh (${fresh.confidenceScore})`,
        );
      }),
      { numRuns: 300, seed: 42 },
    );
  });
});

// ============================================
// Property: Anomaly penalties never increase confidence
// ============================================

describe('Property: Anomaly penalties reduce confidence', () => {
  it('larger temperature deviation never increases confidence', () => {
    fc.assert(
      fc.property(
        validRiskInputArb,
        fc.double({ min: 0, max: 30, noNaN: true }),  // smaller deviation
        fc.double({ min: 30, max: 70, noNaN: true }),  // larger deviation
        (input, smallDev, largeDev) => {
          // Create inputs with small vs large temp deviation from climate normal
          const avgTemp = input.climateNormal.avgTemp;
          const inputSmallDev = { ...input, temperature: avgTemp + smallDev };
          const inputLargeDev = { ...input, temperature: avgTemp + largeDev };

          const resultSmall = calculateConfidence(inputSmallDev, false);
          const resultLarge = calculateConfidence(inputLargeDev, false);

          assert.ok(
            resultLarge.confidenceScore <= resultSmall.confidenceScore,
            `Larger temp deviation should not increase confidence: small=${resultSmall.confidenceScore}, large=${resultLarge.confidenceScore}`,
          );
        },
      ),
      { numRuns: 200, seed: 42 },
    );
  });

  it('larger wind deviation never increases confidence', () => {
    fc.assert(
      fc.property(
        validRiskInputArb,
        fc.double({ min: 0, max: 20, noNaN: true }),
        fc.double({ min: 30, max: 80, noNaN: true }),
        (input, smallDev, largeDev) => {
          const avgWind = input.climateNormal.avgWind;
          const inputSmallDev = { ...input, windSpeed: avgWind + smallDev };
          const inputLargeDev = { ...input, windSpeed: avgWind + largeDev };

          const resultSmall = calculateConfidence(inputSmallDev, false);
          const resultLarge = calculateConfidence(inputLargeDev, false);

          assert.ok(
            resultLarge.confidenceScore <= resultSmall.confidenceScore,
            `Larger wind deviation should not increase confidence: small=${resultSmall.confidenceScore}, large=${resultLarge.confidenceScore}`,
          );
        },
      ),
      { numRuns: 200, seed: 42 },
    );
  });

  it('larger humidity deviation never increases confidence', () => {
    fc.assert(
      fc.property(
        validRiskInputArb,
        fc.double({ min: 0, max: 30, noNaN: true }),
        fc.double({ min: 45, max: 80, noNaN: true }),
        (input, smallDev, largeDev) => {
          const avgHum = input.climateNormal.avgHumidity;
          const inputSmallDev = { ...input, relativeHumidity: Math.min(100, avgHum + smallDev) };
          const inputLargeDev = { ...input, relativeHumidity: Math.min(100, avgHum + largeDev) };

          const resultSmall = calculateConfidence(inputSmallDev, false);
          const resultLarge = calculateConfidence(inputLargeDev, false);

          assert.ok(
            resultLarge.confidenceScore <= resultSmall.confidenceScore,
            `Larger humidity deviation should not increase confidence: small=${resultSmall.confidenceScore}, large=${resultLarge.confidenceScore}`,
          );
        },
      ),
      { numRuns: 200, seed: 42 },
    );
  });

  it('having zero hotspots never increases confidence vs having hotspots', () => {
    fc.assert(
      fc.property(
        validRiskInputArb,
        fc.integer({ min: 1, max: 50 }),
        (input, hotspotCount) => {
          const withHotspots = calculateConfidence({ ...input, recentHotspotsCount: hotspotCount }, false);
          const withoutHotspots = calculateConfidence({ ...input, recentHotspotsCount: 0 }, false);

          assert.ok(
            withoutHotspots.confidenceScore <= withHotspots.confidenceScore,
            `0 hotspots (${withoutHotspots.confidenceScore}) > ${hotspotCount} hotspots (${withHotspots.confidenceScore})`,
          );
        },
      ),
      { numRuns: 200, seed: 42 },
    );
  });
});
