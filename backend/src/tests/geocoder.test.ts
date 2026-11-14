import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  initializeGeocoder,
  assignProvince,
  GeocoderInitializationError,
  _resetGeocoder,
  _isPointInPolygon,
} from '../services/geocoder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_GEOJSON_PATH = path.resolve(__dirname, '../../data/provinces.json');

test('Geocoder Module', async (t) => {
  // Reset before each top-level test group
  _resetGeocoder();

  await t.test('Initialization', async (t) => {
    await t.test('loads valid GeoJSON successfully', () => {
      _resetGeocoder();
      assert.doesNotThrow(() => initializeGeocoder(VALID_GEOJSON_PATH));
    });

    await t.test('throws GeocoderInitializationError for missing file', () => {
      _resetGeocoder();
      const badPath = path.resolve(__dirname, '../../data/nonexistent.json');
      assert.throws(
        () => initializeGeocoder(badPath),
        (err: unknown) => {
          assert.ok(err instanceof GeocoderInitializationError);
          assert.strictEqual(err.code, 'GEOCODER_INIT_FAILED');
          assert.ok(err.message.includes('Failed to load'));
          return true;
        }
      );
    });

    await t.test('throws GeocoderInitializationError for invalid JSON', () => {
      _resetGeocoder();
      const tmpPath = path.resolve(__dirname, '../../data/invalid_test.json');
      fs.writeFileSync(tmpPath, '{ not valid json !!!', 'utf-8');

      try {
        assert.throws(
          () => initializeGeocoder(tmpPath),
          (err: unknown) => {
            assert.ok(err instanceof GeocoderInitializationError);
            assert.ok(err.message.includes('Failed to parse'));
            return true;
          }
        );
      } finally {
        fs.unlinkSync(tmpPath);
      }
    });

    await t.test('throws GeocoderInitializationError for non-FeatureCollection JSON', () => {
      _resetGeocoder();
      const tmpPath = path.resolve(__dirname, '../../data/not_featurecollection_test.json');
      fs.writeFileSync(tmpPath, JSON.stringify({ type: 'Point', coordinates: [0, 0] }), 'utf-8');

      try {
        assert.throws(
          () => initializeGeocoder(tmpPath),
          (err: unknown) => {
            assert.ok(err instanceof GeocoderInitializationError);
            assert.ok(err.message.includes('Invalid GeoJSON'));
            return true;
          }
        );
      } finally {
        fs.unlinkSync(tmpPath);
      }
    });
  });

  await t.test('Bounding Box Pre-Check', async (t) => {
    // Initialize geocoder for all sub-tests
    _resetGeocoder();
    initializeGeocoder(VALID_GEOJSON_PATH);

    await t.test('coordinates outside Argentina bbox return Fuera de Argentina (lat too low)', () => {
      const result = assignProvince(-57.0, -65.0); // lat below -56.0
      assert.strictEqual(result, 'Fuera de Argentina');
    });

    await t.test('coordinates outside Argentina bbox return Fuera de Argentina (lat too high)', () => {
      const result = assignProvince(-20.0, -65.0); // lat above -21.8
      assert.strictEqual(result, 'Fuera de Argentina');
    });

    await t.test('coordinates outside Argentina bbox return Fuera de Argentina (lng too low)', () => {
      const result = assignProvince(-30.0, -74.0); // lng below -73.6
      assert.strictEqual(result, 'Fuera de Argentina');
    });

    await t.test('coordinates outside Argentina bbox return Fuera de Argentina (lng too high)', () => {
      const result = assignProvince(-30.0, -53.0); // lng above -53.5
      assert.strictEqual(result, 'Fuera de Argentina');
    });

    await t.test('far outside (lng=-80.0, lat=-30.0) returns Fuera de Argentina without ray-casting', () => {
      const result = assignProvince(-30.0, -80.0);
      assert.strictEqual(result, 'Fuera de Argentina');
    });

    await t.test('exact boundary values are accepted (within bbox)', () => {
      // Exact boundary: lat=-56.0, lng=-73.6 — inside bbox but likely outside polygons
      const result = assignProvince(-56.0, -73.6);
      // Should NOT throw — it's within the bbox, so ray-casting runs
      assert.strictEqual(typeof result, 'string');
    });

    await t.test('exact max boundary values are accepted (within bbox)', () => {
      // Exact boundary: lat=-21.8, lng=-53.5
      const result = assignProvince(-21.8, -53.5);
      assert.strictEqual(typeof result, 'string');
    });
  });

  await t.test('Province Assignment (ray-casting)', async (t) => {
    _resetGeocoder();
    initializeGeocoder(VALID_GEOJSON_PATH);

    await t.test('CABA centroid returns Ciudad Autónoma de Buenos Aires', () => {
      // CABA centroid: lng=-58.445876, lat=-34.614442
      const result = assignProvince(-34.614442, -58.445876);
      assert.strictEqual(result, 'Ciudad Autónoma de Buenos Aires');
    });

    await t.test('Neuquén centroid returns Neuquén', () => {
      // Neuquén centroid: lng=-70.119897, lat=-38.641982
      const result = assignProvince(-38.641982, -70.119897);
      assert.strictEqual(result, 'Neuquén');
    });

    await t.test('Córdoba area returns Córdoba', () => {
      // Córdoba: lng=-64.49, lat=-31.42
      const result = assignProvince(-31.42, -64.49);
      assert.strictEqual(result, 'Córdoba');
    });

    await t.test('Santiago de Chile (inside bbox but outside polygons) returns Fuera de Argentina', () => {
      // Santiago: lng=-70.66, lat=-33.45
      const result = assignProvince(-33.45, -70.66);
      assert.strictEqual(result, 'Fuera de Argentina');
    });
  });

  await t.test('Determinism (Req 8.2)', async (t) => {
    _resetGeocoder();
    initializeGeocoder(VALID_GEOJSON_PATH);

    await t.test('same coordinates produce same result over multiple calls', () => {
      const coords: Array<[number, number]> = [
        [-34.614442, -58.445876], // CABA
        [-38.641982, -70.119897], // Neuquén
        [-31.42, -64.49],         // Córdoba
        [-33.45, -70.66],         // Chile (Fuera)
        [-30.0, -80.0],           // Outside bbox
      ];

      for (const [lat, lng] of coords) {
        const results = Array.from({ length: 5 }, () => assignProvince(lat, lng));
        const allSame = results.every((r) => r === results[0]);
        assert.ok(allSame, `Determinism failed for (${lat}, ${lng}): got ${JSON.stringify(results)}`);
      }
    });
  });

  await t.test('Uninitialized geocoder throws', async (t) => {
    await t.test('assignProvince throws when geocoder not initialized and point is in bbox', () => {
      _resetGeocoder();
      // Point inside bbox so bounding box check passes
      assert.throws(
        () => assignProvince(-34.0, -60.0),
        (err: unknown) => {
          assert.ok(err instanceof GeocoderInitializationError);
          assert.ok(err.message.includes('not initialized'));
          return true;
        }
      );
    });

    await t.test('assignProvince does NOT throw for points outside bbox (skips ray-casting)', () => {
      _resetGeocoder();
      // Point outside bbox — no need for initialization
      const result = assignProvince(-10.0, -80.0);
      assert.strictEqual(result, 'Fuera de Argentina');
    });
  });

  await t.test('isPointInPolygon basic correctness', async (t) => {
    await t.test('point inside simple square', () => {
      const square: [number, number][] = [
        [-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1],
      ];
      assert.strictEqual(_isPointInPolygon([0, 0], square), true);
    });

    await t.test('point outside simple square', () => {
      const square: [number, number][] = [
        [-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1],
      ];
      assert.strictEqual(_isPointInPolygon([2, 2], square), false);
    });
  });
});
