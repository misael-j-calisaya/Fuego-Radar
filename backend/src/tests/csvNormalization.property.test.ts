/**
 * Property-based tests for CSV normalization field preservation (Task 4.3).
 *
 * Property 10: Normalización preserva campos requeridos
 * For any valid FIRMS CSV row, normalization produces object with all required fields.
 *
 * Additional invariants:
 * - Textual confidence: high=95, nominal=70, low=30
 * - Numeric confidence clamped to [0, 100]
 * - Invalid rows are discarded and counted
 *
 * Validates: Requirement 1.3
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { normalizeCsv } from '../services/csvNormalizer.js';

// ============================================
// Constants
// ============================================

const CSV_HEADER = 'latitude,longitude,bright_ti4,acq_date,acq_time,satellite,confidence';

// ============================================
// Generators
// ============================================

/** Valid latitude in Argentina range */
const latArb = fc.double({ min: -56, max: -21, noNaN: true });

/** Valid longitude in Argentina range */
const lngArb = fc.double({ min: -74, max: -53, noNaN: true });

/** Valid brightness (positive, realistic satellite values) */
const brightnessArb = fc.double({ min: 280, max: 500, noNaN: true });

/** Valid date in YYYY-MM-DD format */
const dateArb = fc.tuple(
  fc.integer({ min: 2020, max: 2026 }),
  fc.integer({ min: 1, max: 12 }),
  fc.integer({ min: 1, max: 28 }),
).map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

/** Valid time in HHMM format */
const timeArb = fc.tuple(
  fc.integer({ min: 0, max: 23 }),
  fc.integer({ min: 0, max: 59 }),
).map(([h, m]) => `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`);

/** Valid satellite code */
const satArb = fc.constantFrom('N', 'T', '1');

/** Textual confidence */
const textConfArb = fc.constantFrom('high', 'nominal', 'low');

/** Numeric confidence (valid) */
const numConfArb = fc.integer({ min: 0, max: 100 });

/** Any valid confidence value */
const validConfArb = fc.oneof(textConfArb, numConfArb.map(String));

/** Builds a valid CSV row */
function buildCsvRow(
  lat: number, lng: number, brightness: number,
  date: string, time: string, sat: string, confidence: string,
): string {
  return `${lat},${lng},${brightness},${date},${time},${sat},${confidence}`;
}

// ============================================
// Property: All required fields preserved
// ============================================

describe('Property: Normalization preserves required fields', () => {
  it('valid rows produce hotspots with lat, lng, brightness, date, satellite, confidence', () => {
    fc.assert(
      fc.property(
        latArb, lngArb, brightnessArb, dateArb, timeArb, satArb, validConfArb,
        (lat, lng, brightness, date, time, sat, conf) => {
          const csv = `${CSV_HEADER}\n${buildCsvRow(lat, lng, brightness, date, time, sat, conf)}`;
          const result = normalizeCsv(csv);

          assert.strictEqual(result.hotspots.length, 1, 'Expected 1 hotspot');
          assert.strictEqual(result.discarded, 0, 'Expected 0 discards');

          const h = result.hotspots[0];

          // lat preserved
          assert.strictEqual(h.lat, lat);
          // lng preserved
          assert.strictEqual(h.lng, lng);
          // brightness preserved
          assert.strictEqual(h.brightness, brightness);
          // date contains original date
          assert.ok(h.date.includes(date), `date ${h.date} should contain ${date}`);
          // satellite mapped
          assert.ok(['VIIRS', 'MODIS'].includes(h.satellite));
          // confidence is a number in [0, 100]
          assert.ok(h.confidence >= 0 && h.confidence <= 100);
          // id exists
          assert.ok(h.id.length > 0);
        },
      ),
      { numRuns: 300, seed: 42 },
    );
  });
});

// ============================================
// Property: Textual confidence conversion
// ============================================

describe('Property: Textual confidence conversion', () => {
  it('high maps to 95', () => {
    fc.assert(
      fc.property(latArb, lngArb, brightnessArb, dateArb, timeArb, satArb,
        (lat, lng, brightness, date, time, sat) => {
          const csv = `${CSV_HEADER}\n${buildCsvRow(lat, lng, brightness, date, time, sat, 'high')}`;
          const result = normalizeCsv(csv);
          assert.strictEqual(result.hotspots[0].confidence, 95);
        },
      ),
      { numRuns: 50, seed: 42 },
    );
  });

  it('nominal maps to 70', () => {
    fc.assert(
      fc.property(latArb, lngArb, brightnessArb, dateArb, timeArb, satArb,
        (lat, lng, brightness, date, time, sat) => {
          const csv = `${CSV_HEADER}\n${buildCsvRow(lat, lng, brightness, date, time, sat, 'nominal')}`;
          const result = normalizeCsv(csv);
          assert.strictEqual(result.hotspots[0].confidence, 70);
        },
      ),
      { numRuns: 50, seed: 42 },
    );
  });

  it('low maps to 30', () => {
    fc.assert(
      fc.property(latArb, lngArb, brightnessArb, dateArb, timeArb, satArb,
        (lat, lng, brightness, date, time, sat) => {
          const csv = `${CSV_HEADER}\n${buildCsvRow(lat, lng, brightness, date, time, sat, 'low')}`;
          const result = normalizeCsv(csv);
          assert.strictEqual(result.hotspots[0].confidence, 30);
        },
      ),
      { numRuns: 50, seed: 42 },
    );
  });
});

// ============================================
// Property: Numeric confidence clamped to [0, 100]
// ============================================

describe('Property: Numeric confidence clamping', () => {
  it('numeric confidence within [0, 100] is preserved as-is', () => {
    fc.assert(
      fc.property(
        latArb, lngArb, brightnessArb, dateArb, timeArb, satArb, numConfArb,
        (lat, lng, brightness, date, time, sat, conf) => {
          const csv = `${CSV_HEADER}\n${buildCsvRow(lat, lng, brightness, date, time, sat, String(conf))}`;
          const result = normalizeCsv(csv);
          assert.strictEqual(result.hotspots[0].confidence, conf);
        },
      ),
      { numRuns: 200, seed: 42 },
    );
  });

  it('numeric confidence > 100 is clamped to 100', () => {
    fc.assert(
      fc.property(
        latArb, lngArb, brightnessArb, dateArb, timeArb, satArb,
        fc.integer({ min: 101, max: 999 }),
        (lat, lng, brightness, date, time, sat, conf) => {
          const csv = `${CSV_HEADER}\n${buildCsvRow(lat, lng, brightness, date, time, sat, String(conf))}`;
          const result = normalizeCsv(csv);
          assert.strictEqual(result.hotspots[0].confidence, 100);
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });

  it('numeric confidence < 0 is clamped to 0', () => {
    fc.assert(
      fc.property(
        latArb, lngArb, brightnessArb, dateArb, timeArb, satArb,
        fc.integer({ min: -100, max: -1 }),
        (lat, lng, brightness, date, time, sat, conf) => {
          const csv = `${CSV_HEADER}\n${buildCsvRow(lat, lng, brightness, date, time, sat, String(conf))}`;
          const result = normalizeCsv(csv);
          assert.strictEqual(result.hotspots[0].confidence, 0);
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });
});

// ============================================
// Property: Invalid rows discarded and counted
// ============================================

describe('Property: Invalid rows are discarded and counted', () => {
  it('rows with non-numeric latitude are discarded', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 5 }).filter(s => isNaN(parseFloat(s))),
        lngArb, brightnessArb, dateArb, timeArb, satArb, validConfArb,
        (badLat, lng, brightness, date, time, sat, conf) => {
          const csv = `${CSV_HEADER}\n${badLat},${lng},${brightness},${date},${time},${sat},${conf}`;
          const result = normalizeCsv(csv);
          assert.strictEqual(result.hotspots.length, 0);
          assert.strictEqual(result.discarded, 1);
          assert.strictEqual(result.rawEntries, 1);
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });

  it('rows with missing fields are discarded', () => {
    // CSV with only 3 fields (missing most columns)
    fc.assert(
      fc.property(
        latArb, lngArb, brightnessArb,
        (lat, lng, brightness) => {
          const csv = `${CSV_HEADER}\n${lat},${lng},${brightness}`;
          const result = normalizeCsv(csv);
          assert.strictEqual(result.hotspots.length, 0);
          assert.strictEqual(result.discarded, 1);
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });

  it('mixed valid and invalid rows: valid count + discard count = rawEntries', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),  // valid row count
        fc.integer({ min: 1, max: 5 }),  // invalid row count
        (validCount, invalidCount) => {
          const validRows = Array.from({ length: validCount },
            () => buildCsvRow(-34.6, -58.4, 335, '2024-01-15', '1420', 'N', 'high'));
          const invalidRows = Array.from({ length: invalidCount },
            () => 'invalid,data,only');

          const allRows = [...validRows, ...invalidRows];
          const csv = `${CSV_HEADER}\n${allRows.join('\n')}`;
          const result = normalizeCsv(csv);

          assert.strictEqual(result.rawEntries, validCount + invalidCount);
          assert.strictEqual(
            result.hotspots.length + result.discarded,
            result.rawEntries,
            'hotspots + discarded must equal rawEntries',
          );
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });
});
