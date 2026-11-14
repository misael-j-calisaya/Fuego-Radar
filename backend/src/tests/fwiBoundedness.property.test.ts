/**
 * Property-based tests for FWI boundedness (Task 2.2).
 *
 * Property 12: Acotamiento del FWI
 * For any valid meteorological input, calculateFWI produces a result in [0, 100].
 * Invalid inputs return validation errors without crashing.
 *
 * Validates: Requirement 4.1
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { calculateFWI, calculateFWIUnsafe } from '../services/fwiCalculator.js';
import type { WeatherData } from '../shared/types.js';

// ============================================
// Generators
// ============================================

/** Valid weather inputs within accepted ranges */
const validWeatherArb: fc.Arbitrary<WeatherData> = fc.record({
  temperature: fc.double({ min: -20, max: 50, noNaN: true }),
  relativeHumidity: fc.double({ min: 0, max: 100, noNaN: true }),
  windSpeed: fc.double({ min: 0, max: 150, noNaN: true }),
  windDir: fc.constantFrom('N', 'S', 'E', 'O', 'NE', 'NO', 'SE', 'SO'),
  rain24h: fc.double({ min: 0, max: 200, noNaN: true }),
});

/** Invalid temperature (out of [-20, 50] range) */
const invalidTempArb: fc.Arbitrary<number> = fc.oneof(
  fc.double({ min: -100, max: -20.01, noNaN: true }),
  fc.double({ min: 50.01, max: 200, noNaN: true }),
);

/** Invalid humidity (out of [0, 100] range) */
const invalidHumidityArb: fc.Arbitrary<number> = fc.oneof(
  fc.double({ min: -50, max: -0.01, noNaN: true }),
  fc.double({ min: 100.01, max: 200, noNaN: true }),
);

/** Invalid wind speed (negative) */
const invalidWindArb: fc.Arbitrary<number> = fc.double({ min: -100, max: -0.01, noNaN: true });

// ============================================
// Property: FWI always in [0, 100] for valid inputs
// ============================================

describe('Property: FWI boundedness [0, 100]', () => {
  it('calculateFWI returns score in [0, 100] for any valid weather input', () => {
    fc.assert(
      fc.property(validWeatherArb, (weather) => {
        const result = calculateFWI(weather);

        assert.strictEqual(result.success, true, 'Expected success for valid input');
        if (result.success) {
          assert.ok(
            result.result.fwiScore >= 0,
            `FWI score ${result.result.fwiScore} < 0 for input ${JSON.stringify(weather)}`,
          );
          assert.ok(
            result.result.fwiScore <= 100,
            `FWI score ${result.result.fwiScore} > 100 for input ${JSON.stringify(weather)}`,
          );
        }
      }),
      { numRuns: 500, seed: 42 },
    );
  });

  it('calculateFWIUnsafe returns score in [0, 100] for any valid parameters', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -20, max: 50, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 150, noNaN: true }),
        (temp, humidity, wind) => {
          const score = calculateFWIUnsafe(temp, humidity, wind);
          assert.ok(score >= 0, `Score ${score} < 0`);
          assert.ok(score <= 100, `Score ${score} > 100`);
        },
      ),
      { numRuns: 500, seed: 42 },
    );
  });

  it('FWI score is always a finite integer', () => {
    fc.assert(
      fc.property(validWeatherArb, (weather) => {
        const result = calculateFWI(weather);
        if (result.success) {
          assert.ok(Number.isFinite(result.result.fwiScore));
          assert.ok(Number.isInteger(result.result.fwiScore));
        }
      }),
      { numRuns: 500, seed: 42 },
    );
  });
});

// ============================================
// Property: Invalid inputs return errors (no crash)
// ============================================

describe('Property: FWI invalid inputs return validation errors', () => {
  it('invalid temperature returns error without crashing', () => {
    fc.assert(
      fc.property(
        invalidTempArb,
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        (temp, humidity, wind) => {
          const weather: WeatherData = {
            temperature: temp,
            relativeHumidity: humidity,
            windSpeed: wind,
            windDir: 'N',
          };
          const result = calculateFWI(weather);
          assert.strictEqual(result.success, false);
          if (!result.success) {
            assert.ok(result.errors.length > 0);
            assert.ok(result.errors.some(e => e.field === 'temperature'));
          }
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });

  it('invalid humidity returns error without crashing', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -20, max: 50, noNaN: true }),
        invalidHumidityArb,
        fc.double({ min: 0, max: 100, noNaN: true }),
        (temp, humidity, wind) => {
          const weather: WeatherData = {
            temperature: temp,
            relativeHumidity: humidity,
            windSpeed: wind,
            windDir: 'S',
          };
          const result = calculateFWI(weather);
          assert.strictEqual(result.success, false);
          if (!result.success) {
            assert.ok(result.errors.length > 0);
            assert.ok(result.errors.some(e => e.field === 'relativeHumidity'));
          }
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });

  it('negative wind speed returns error without crashing', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -20, max: 50, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        invalidWindArb,
        (temp, humidity, wind) => {
          const weather: WeatherData = {
            temperature: temp,
            relativeHumidity: humidity,
            windSpeed: wind,
            windDir: 'E',
          };
          const result = calculateFWI(weather);
          assert.strictEqual(result.success, false);
          if (!result.success) {
            assert.ok(result.errors.length > 0);
            assert.ok(result.errors.some(e => e.field === 'windSpeed'));
          }
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });

  it('multiple invalid fields return multiple errors', () => {
    fc.assert(
      fc.property(
        invalidTempArb,
        invalidHumidityArb,
        invalidWindArb,
        (temp, humidity, wind) => {
          const weather: WeatherData = {
            temperature: temp,
            relativeHumidity: humidity,
            windSpeed: wind,
            windDir: 'O',
          };
          const result = calculateFWI(weather);
          assert.strictEqual(result.success, false);
          if (!result.success) {
            assert.ok(result.errors.length >= 2, `Expected multiple errors, got ${result.errors.length}`);
          }
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });
});
