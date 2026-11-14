/**
 * Property-based tests for riskScore boundedness (Task 2.5).
 *
 * Property 1: Acotamiento del riskScore
 * For any valid RiskInput, evaluateFireRisk returns riskScore in [0, 100].
 *
 * Validates: Requirement 3.3
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

const provinceArb: fc.Arbitrary<string> = fc.constantFrom(...PROVINCES);

const climateNormalArb = fc.record({
  avgTemp: fc.double({ min: 5, max: 35, noNaN: true }),
  avgHumidity: fc.double({ min: 20, max: 80, noNaN: true }),
  avgWind: fc.double({ min: 5, max: 40, noNaN: true }),
});

const validRiskInputArb: fc.Arbitrary<RiskInput> = fc.record({
  temperature: fc.double({ min: -20, max: 50, noNaN: true }),
  relativeHumidity: fc.double({ min: 0, max: 100, noNaN: true }),
  windSpeed: fc.double({ min: 0, max: 120, noNaN: true }),
  rain24h: fc.double({ min: 0, max: 200, noNaN: true }),
  province: provinceArb,
  region: regionArb,
  recentHotspotsCount: fc.integer({ min: 0, max: 50 }),
  historicalFireCount: fc.integer({ min: 0, max: 100 }),
  climateNormal: climateNormalArb,
  hasCriticalAlert: fc.boolean(),
});

// ============================================
// Property: riskScore always in [0, 100]
// ============================================

describe('Property: riskScore boundedness [0, 100]', () => {
  it('evaluateFireRisk always returns riskScore >= 0 for any valid input', () => {
    fc.assert(
      fc.property(validRiskInputArb, (input) => {
        const result = evaluateFireRisk(input);
        assert.ok(
          result.riskScore >= 0,
          `riskScore ${result.riskScore} < 0 for input ${JSON.stringify(input)}`,
        );
      }),
      { numRuns: 500, seed: 42 },
    );
  });

  it('evaluateFireRisk always returns riskScore <= 100 for any valid input', () => {
    fc.assert(
      fc.property(validRiskInputArb, (input) => {
        const result = evaluateFireRisk(input);
        assert.ok(
          result.riskScore <= 100,
          `riskScore ${result.riskScore} > 100 for input ${JSON.stringify(input)}`,
        );
      }),
      { numRuns: 500, seed: 42 },
    );
  });

  it('riskScore is always a finite integer', () => {
    fc.assert(
      fc.property(validRiskInputArb, (input) => {
        const result = evaluateFireRisk(input);
        assert.ok(
          Number.isFinite(result.riskScore),
          `riskScore is not finite: ${result.riskScore}`,
        );
        assert.ok(
          Number.isInteger(result.riskScore),
          `riskScore is not integer: ${result.riskScore}`,
        );
      }),
      { numRuns: 500, seed: 42 },
    );
  });

  it('riskScore bounds hold even with extreme valid inputs', () => {
    // Test with inputs at the boundaries of their valid ranges
    fc.assert(
      fc.property(
        fc.constantFrom(-20, 50),                   // extreme temperatures
        fc.constantFrom(0, 100),                    // extreme humidity
        fc.constantFrom(0, 120),                    // extreme wind
        fc.constantFrom(0, 200),                    // extreme rain
        fc.integer({ min: 0, max: 50 }),            // hotspot count
        fc.boolean(),                               // critical alert
        (temp, hum, wind, rain, hotspots, critical) => {
          const input: RiskInput = {
            temperature: temp,
            relativeHumidity: hum,
            windSpeed: wind,
            rain24h: rain,
            province: 'Córdoba',
            region: 'Centro',
            recentHotspotsCount: hotspots,
            historicalFireCount: 10,
            climateNormal: { avgTemp: 20, avgHumidity: 50, avgWind: 15 },
            hasCriticalAlert: critical,
          };
          const result = evaluateFireRisk(input);
          assert.ok(result.riskScore >= 0 && result.riskScore <= 100);
        },
      ),
      { numRuns: 200, seed: 42 },
    );
  });
});
