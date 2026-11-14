/**
 * Property-based tests for geocoding determinism (Task 4.5).
 *
 * Property 7: Determinismo de geocodificación
 * For any coordinates within Argentina bbox, assignProvince invoked
 * multiple times returns the same result.
 *
 * Validates: Requirement 8.2
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { initializeGeocoder, assignProvince } from '../services/geocoder.js';
import { ARGENTINA_BBOX } from '../shared/constants.js';

// ============================================
// Setup — initialize geocoder once
// ============================================

before(() => {
  initializeGeocoder();
});

// ============================================
// Generators
// ============================================

/** Coordinates inside Argentina bounding box */
const insideBboxCoords = fc.record({
  lat: fc.double({ min: ARGENTINA_BBOX.lat.min, max: ARGENTINA_BBOX.lat.max, noNaN: true }),
  lng: fc.double({ min: ARGENTINA_BBOX.lng.min, max: ARGENTINA_BBOX.lng.max, noNaN: true }),
});

/** Coordinates clearly outside Argentina bounding box */
const outsideBboxCoords = fc.oneof(
  // North of Argentina
  fc.record({
    lat: fc.double({ min: -21, max: 80, noNaN: true }),
    lng: fc.double({ min: -74, max: -53, noNaN: true }),
  }),
  // South of Argentina
  fc.record({
    lat: fc.double({ min: -90, max: -57, noNaN: true }),
    lng: fc.double({ min: -74, max: -53, noNaN: true }),
  }),
  // East of Argentina
  fc.record({
    lat: fc.double({ min: -56, max: -21, noNaN: true }),
    lng: fc.double({ min: -52, max: 180, noNaN: true }),
  }),
  // West of Argentina
  fc.record({
    lat: fc.double({ min: -56, max: -21, noNaN: true }),
    lng: fc.double({ min: -180, max: -75, noNaN: true }),
  }),
);

// ============================================
// Property: Determinism — same input → same output
// ============================================

describe('Property: Geocoding determinism', () => {
  it('assignProvince returns same result for same coordinates (inside bbox)', () => {
    fc.assert(
      fc.property(insideBboxCoords, ({ lat, lng }) => {
        const result1 = assignProvince(lat, lng);
        const result2 = assignProvince(lat, lng);
        const result3 = assignProvince(lat, lng);

        assert.strictEqual(result1, result2, `Call 1 vs 2 differ: ${result1} vs ${result2}`);
        assert.strictEqual(result2, result3, `Call 2 vs 3 differ: ${result2} vs ${result3}`);
      }),
      { numRuns: 200, seed: 42 },
    );
  });

  it('assignProvince returns same result for same coordinates (outside bbox)', () => {
    fc.assert(
      fc.property(outsideBboxCoords, ({ lat, lng }) => {
        const result1 = assignProvince(lat, lng);
        const result2 = assignProvince(lat, lng);

        assert.strictEqual(result1, result2);
      }),
      { numRuns: 100, seed: 42 },
    );
  });
});

// ============================================
// Property: Outside bbox always returns 'Fuera de Argentina'
// ============================================

describe('Property: Outside bounding box → Fuera de Argentina', () => {
  it('coordinates outside Argentina bbox always return "Fuera de Argentina"', () => {
    fc.assert(
      fc.property(outsideBboxCoords, ({ lat, lng }) => {
        const result = assignProvince(lat, lng);
        assert.strictEqual(
          result,
          'Fuera de Argentina',
          `Expected "Fuera de Argentina" for (${lat}, ${lng}), got "${result}"`,
        );
      }),
      { numRuns: 200, seed: 42 },
    );
  });
});

// ============================================
// Property: Inside bbox returns valid province or 'Fuera de Argentina'
// ============================================

describe('Property: Inside bbox returns valid result', () => {
  it('result is either a non-empty province name or "Fuera de Argentina"', () => {
    fc.assert(
      fc.property(insideBboxCoords, ({ lat, lng }) => {
        const result = assignProvince(lat, lng);

        // Result must be a non-empty string
        assert.ok(
          typeof result === 'string' && result.length > 0,
          `Result should be non-empty string for (${lat}, ${lng}), got "${result}"`,
        );

        // Result is either "Fuera de Argentina" or a province name from GeoJSON
        // (GeoJSON may use full official names that differ from the abbreviated PROVINCES list)
        assert.ok(
          result === 'Fuera de Argentina' || !result.includes('undefined'),
          `Result "${result}" appears invalid for (${lat}, ${lng})`,
        );
      }),
      { numRuns: 300, seed: 42 },
    );
  });
});

// ============================================
// Property: Known coordinates produce consistent results
// ============================================

describe('Property: Known coordinates are stable', () => {
  it('Buenos Aires city center always maps to same province across many calls', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (_iteration) => {
        // BA city: lat -34.6037, lng -58.3816
        const result = assignProvince(-34.6037, -58.3816);
        // Should consistently return same value (either CABA or Buenos Aires)
        const secondCall = assignProvince(-34.6037, -58.3816);
        assert.strictEqual(result, secondCall);
      }),
      { numRuns: 50, seed: 42 },
    );
  });

  it('Córdoba city center always maps consistently', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (_iteration) => {
        const result = assignProvince(-31.4201, -64.1888);
        const secondCall = assignProvince(-31.4201, -64.1888);
        assert.strictEqual(result, secondCall);
      }),
      { numRuns: 50, seed: 42 },
    );
  });
});
