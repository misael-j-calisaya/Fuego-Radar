import test from 'node:test';
import assert from 'node:assert';
import { normalizeCsv, type NormalizedHotspot, type NormalizationResult } from '../services/csvNormalizer.js';

// ============================================
// Unit Tests for CSV Normalizer
// ============================================

const VALID_HEADER = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight';

test('csvNormalizer Tests', async (t) => {

  await t.test('valid CSV with multiple rows normalizes correctly', () => {
    const csv = [
      VALID_HEADER,
      '-31.4200,-64.4900,335.4,0.39,0.36,2024-01-15,1430,N,high,2.0NRT,290.1,12.3,D',
      '-42.9800,-71.3500,318.2,0.45,0.40,2024-01-15,0830,1,nominal,2.0NRT,285.0,8.5,D',
      '-23.7800,-64.7900,339.0,0.38,0.35,2024-01-16,2215,T,85,2.0NRT,295.2,15.1,N',
    ].join('\n');

    const result = normalizeCsv(csv);

    assert.strictEqual(result.rawEntries, 3);
    assert.strictEqual(result.hotspots.length, 3);
    assert.strictEqual(result.discarded, 0);
    assert.strictEqual(result.discardReasons.length, 0);

    // First hotspot
    const h1 = result.hotspots[0];
    assert.strictEqual(h1.lat, -31.42);
    assert.strictEqual(h1.lng, -64.49);
    assert.strictEqual(h1.brightness, 335.4);
    assert.strictEqual(h1.confidence, 95); // high → 95
    assert.strictEqual(h1.date, '2024-01-15T14:30:00.000Z');
    assert.strictEqual(h1.satellite, 'VIIRS'); // N → VIIRS

    // Second hotspot
    const h2 = result.hotspots[1];
    assert.strictEqual(h2.lat, -42.98);
    assert.strictEqual(h2.lng, -71.35);
    assert.strictEqual(h2.brightness, 318.2);
    assert.strictEqual(h2.confidence, 70); // nominal → 70
    assert.strictEqual(h2.date, '2024-01-15T08:30:00.000Z');
    assert.strictEqual(h2.satellite, 'MODIS'); // 1 → MODIS

    // Third hotspot
    const h3 = result.hotspots[2];
    assert.strictEqual(h3.lat, -23.78);
    assert.strictEqual(h3.lng, -64.79);
    assert.strictEqual(h3.brightness, 339.0);
    assert.strictEqual(h3.confidence, 85); // numeric pass-through
    assert.strictEqual(h3.date, '2024-01-16T22:15:00.000Z');
    assert.strictEqual(h3.satellite, 'MODIS'); // T → MODIS

    // All IDs should be unique UUIDs
    const ids = new Set(result.hotspots.map((h) => h.id));
    assert.strictEqual(ids.size, 3);
    for (const hotspot of result.hotspots) {
      assert.match(hotspot.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  await t.test('textual confidence conversion: high=95, nominal=70, low=30', () => {
    const csv = [
      VALID_HEADER,
      '-31.42,-64.49,335.4,0.39,0.36,2024-01-15,1430,N,high,2.0NRT,290.1,12.3,D',
      '-31.42,-64.49,335.4,0.39,0.36,2024-01-15,1430,N,nominal,2.0NRT,290.1,12.3,D',
      '-31.42,-64.49,335.4,0.39,0.36,2024-01-15,1430,N,low,2.0NRT,290.1,12.3,D',
    ].join('\n');

    const result = normalizeCsv(csv);

    assert.strictEqual(result.hotspots[0].confidence, 95);
    assert.strictEqual(result.hotspots[1].confidence, 70);
    assert.strictEqual(result.hotspots[2].confidence, 30);
  });

  await t.test('textual confidence is case-insensitive', () => {
    const csv = [
      VALID_HEADER,
      '-31.42,-64.49,335.4,0.39,0.36,2024-01-15,1430,N,HIGH,2.0NRT,290.1,12.3,D',
      '-31.42,-64.49,335.4,0.39,0.36,2024-01-15,1430,N,Nominal,2.0NRT,290.1,12.3,D',
      '-31.42,-64.49,335.4,0.39,0.36,2024-01-15,1430,N,LOW,2.0NRT,290.1,12.3,D',
    ].join('\n');

    const result = normalizeCsv(csv);

    assert.strictEqual(result.hotspots[0].confidence, 95);
    assert.strictEqual(result.hotspots[1].confidence, 70);
    assert.strictEqual(result.hotspots[2].confidence, 30);
  });

  await t.test('numeric confidence passes through with clamping to [0, 100]', () => {
    const csv = [
      VALID_HEADER,
      '-31.42,-64.49,335.4,0.39,0.36,2024-01-15,1430,N,50,2.0NRT,290.1,12.3,D',
      '-31.42,-64.49,335.4,0.39,0.36,2024-01-15,1430,N,0,2.0NRT,290.1,12.3,D',
      '-31.42,-64.49,335.4,0.39,0.36,2024-01-15,1430,N,100,2.0NRT,290.1,12.3,D',
      '-31.42,-64.49,335.4,0.39,0.36,2024-01-15,1430,N,150,2.0NRT,290.1,12.3,D',
      '-31.42,-64.49,335.4,0.39,0.36,2024-01-15,1430,N,-10,2.0NRT,290.1,12.3,D',
    ].join('\n');

    const result = normalizeCsv(csv);

    assert.strictEqual(result.hotspots.length, 5);
    assert.strictEqual(result.hotspots[0].confidence, 50);
    assert.strictEqual(result.hotspots[1].confidence, 0);
    assert.strictEqual(result.hotspots[2].confidence, 100);
    assert.strictEqual(result.hotspots[3].confidence, 100); // clamped from 150
    assert.strictEqual(result.hotspots[4].confidence, 0);   // clamped from -10
  });

  await t.test('invalid rows are skipped with reasons tracked', () => {
    const csv = [
      VALID_HEADER,
      'abc,-64.49,335.4,0.39,0.36,2024-01-15,1430,N,high,2.0NRT,290.1,12.3,D',  // NaN latitude
      '-31.42,-64.49,-5.0,0.39,0.36,2024-01-15,1430,N,high,2.0NRT,290.1,12.3,D', // brightness <= 0
      '-31.42,-64.49,335.4,0.39,0.36,invalid-date,1430,N,high,2.0NRT,290.1,12.3,D', // invalid date
      '-31.42,-64.49,335.4,0.39,0.36,2024-01-15,1430,N,unknown_text,2.0NRT,290.1,12.3,D', // unparseable confidence
    ].join('\n');

    const result = normalizeCsv(csv);

    assert.strictEqual(result.rawEntries, 4);
    assert.strictEqual(result.hotspots.length, 0);
    assert.strictEqual(result.discarded, 4);
    assert.strictEqual(result.discardReasons.length, 4);

    // Verify reasons are informative
    assert.ok(result.discardReasons[0].reason.includes('latitude'));
    assert.ok(result.discardReasons[1].reason.includes('bright_ti4'));
    assert.ok(result.discardReasons[2].reason.includes('date'));
    assert.ok(result.discardReasons[3].reason.includes('confidence'));

    // Row numbers should be correct (header is row 1, data starts at row 2)
    assert.strictEqual(result.discardReasons[0].row, 2);
    assert.strictEqual(result.discardReasons[1].row, 3);
    assert.strictEqual(result.discardReasons[2].row, 4);
    assert.strictEqual(result.discardReasons[3].row, 5);
  });

  await t.test('empty CSV (header only) returns empty result', () => {
    const csv = VALID_HEADER;

    const result = normalizeCsv(csv);

    assert.strictEqual(result.hotspots.length, 0);
    assert.strictEqual(result.rawEntries, 0);
    assert.strictEqual(result.discarded, 0);
    assert.strictEqual(result.discardReasons.length, 0);
  });

  await t.test('mixed valid and invalid rows: valid normalized, invalid discarded', () => {
    const csv = [
      VALID_HEADER,
      '-31.42,-64.49,335.4,0.39,0.36,2024-01-15,1430,N,high,2.0NRT,290.1,12.3,D',     // valid
      'not_a_number,-64.49,335.4,0.39,0.36,2024-01-15,1430,N,high,2.0NRT,290.1,12.3,D', // invalid lat
      '-42.98,-71.35,318.2,0.45,0.40,2024-01-15,0830,N,70,2.0NRT,285.0,8.5,D',          // valid
      '-23.78,-64.79,0,0.38,0.35,2024-01-16,2215,N,85,2.0NRT,295.2,15.1,N',             // invalid brightness (0)
      '-28.60,-57.10,322.4,0.41,0.38,2024-02-01,1200,N,low,2.0NRT,288.3,10.0,D',        // valid
    ].join('\n');

    const result = normalizeCsv(csv);

    assert.strictEqual(result.rawEntries, 5);
    assert.strictEqual(result.hotspots.length, 3);
    assert.strictEqual(result.discarded, 2);

    // Verify valid rows are correct
    assert.strictEqual(result.hotspots[0].lat, -31.42);
    assert.strictEqual(result.hotspots[0].confidence, 95);
    assert.strictEqual(result.hotspots[1].lat, -42.98);
    assert.strictEqual(result.hotspots[1].confidence, 70);
    assert.strictEqual(result.hotspots[2].lat, -28.60);
    assert.strictEqual(result.hotspots[2].confidence, 30);
  });

  await t.test('satellite mapping: N→VIIRS, 1→MODIS, T→MODIS, unknown→VIIRS', () => {
    const csv = [
      VALID_HEADER,
      '-31.42,-64.49,335.4,0.39,0.36,2024-01-15,1430,N,80,2.0NRT,290.1,12.3,D',
      '-31.42,-64.49,335.4,0.39,0.36,2024-01-15,1430,1,80,2.0NRT,290.1,12.3,D',
      '-31.42,-64.49,335.4,0.39,0.36,2024-01-15,1430,T,80,2.0NRT,290.1,12.3,D',
      '-31.42,-64.49,335.4,0.39,0.36,2024-01-15,1430,X,80,2.0NRT,290.1,12.3,D',
    ].join('\n');

    const result = normalizeCsv(csv);

    assert.strictEqual(result.hotspots[0].satellite, 'VIIRS');
    assert.strictEqual(result.hotspots[1].satellite, 'MODIS');
    assert.strictEqual(result.hotspots[2].satellite, 'MODIS');
    assert.strictEqual(result.hotspots[3].satellite, 'VIIRS'); // unknown defaults to VIIRS
  });

  await t.test('date/time parsing produces correct ISO format', () => {
    const csv = [
      VALID_HEADER,
      '-31.42,-64.49,335.4,0.39,0.36,2024-01-15,0000,N,80,2.0NRT,290.1,12.3,D',
      '-31.42,-64.49,335.4,0.39,0.36,2024-12-31,2359,N,80,2.0NRT,290.1,12.3,D',
      '-31.42,-64.49,335.4,0.39,0.36,2024-06-15,530,N,80,2.0NRT,290.1,12.3,D',
    ].join('\n');

    const result = normalizeCsv(csv);

    assert.strictEqual(result.hotspots[0].date, '2024-01-15T00:00:00.000Z');
    assert.strictEqual(result.hotspots[1].date, '2024-12-31T23:59:00.000Z');
    assert.strictEqual(result.hotspots[2].date, '2024-06-15T05:30:00.000Z'); // padded from '530' to '0530'
  });
});
