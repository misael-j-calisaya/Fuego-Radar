import test from 'node:test';
import assert from 'node:assert';
import {
  fetchWeatherForProvinceWithDeps,
  _clearWeatherCache,
  getProvinceCentroid,
} from '../services/weatherApiClient.js';

// ============================================
// Helpers
// ============================================

/** Standard valid weather response from Open-Meteo */
const VALID_CURRENT = {
  temperature_2m: 25.3,
  relative_humidity_2m: 45,
  wind_speed_10m: 12.5,
  wind_direction_10m: 180,
  precipitation: 2.1,
};

function makeFetcher(current: Record<string, unknown>, ok = true, status = 200) {
  return async (_url: string, _opts: RequestInit): Promise<Response> => {
    return {
      ok,
      status,
      json: async () => ({ current }),
    } as unknown as Response;
  };
}

// ============================================
// Unit Tests for Weather API Client
// ============================================

test('successful weather fetch returns valid data with stale=false', async () => {
  _clearWeatherCache();
  const fetcher = makeFetcher(VALID_CURRENT);
  const result = await fetchWeatherForProvinceWithDeps('Córdoba', fetcher);

  assert.strictEqual(result.stale, false, 'expected stale=false for valid data');
  assert.strictEqual(result.province, 'Córdoba');
  assert.strictEqual(result.data.temperature, 25.3);
  assert.strictEqual(result.data.relativeHumidity, 45);
  assert.strictEqual(result.data.windSpeed, 12.5);
  assert.strictEqual(result.data.windDir, 'S');
  assert.strictEqual(result.data.rain24h, 2.1);
  assert.strictEqual(result.error, undefined);
  assert.ok(result.fetchedAt, 'fetchedAt should be set');
});

test('timeout returns stale fallback or safe default', async () => {
  _clearWeatherCache();
  const fetcher = async (_url: string, _opts: RequestInit): Promise<Response> => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    throw error;
  };

  const result = await fetchWeatherForProvinceWithDeps('Buenos Aires', fetcher);

  assert.strictEqual(result.stale, true, 'expected stale=true on abort');
  assert.strictEqual(result.province, 'Buenos Aires');
  assert.strictEqual(result.data.temperature, 20, 'safe default temperature');
  assert.strictEqual(result.data.relativeHumidity, 50, 'safe default humidity');
  assert.strictEqual(result.data.windSpeed, 10, 'safe default wind speed');
  assert.strictEqual(result.data.windDir, 'N', 'safe default wind dir');
  assert.strictEqual(result.data.rain24h, 0, 'safe default rain');
  assert.ok(result.error?.includes('timeout'), `error should mention timeout, got: ${result.error}`);
});

test('invalid temperature out of range uses fallback', async () => {
  _clearWeatherCache();
  const fetcher = makeFetcher({ ...VALID_CURRENT, temperature_2m: 55 });
  const result = await fetchWeatherForProvinceWithDeps('Salta', fetcher);

  assert.strictEqual(result.stale, true, 'temp=55 should fail validation → stale=true');
  assert.ok(result.error?.includes('out-of-range'), `error should mention out-of-range, got: ${result.error}`);
});

test('invalid humidity negative uses fallback', async () => {
  _clearWeatherCache();
  const fetcher = makeFetcher({ ...VALID_CURRENT, relative_humidity_2m: -5 });
  const result = await fetchWeatherForProvinceWithDeps('Mendoza', fetcher);

  assert.strictEqual(result.stale, true, 'humidity=-5 should fail validation → stale=true');
  assert.ok(result.error?.includes('out-of-range'), `error should mention out-of-range, got: ${result.error}`);
});

test('invalid wind speed negative uses fallback', async () => {
  _clearWeatherCache();
  const fetcher = makeFetcher({ ...VALID_CURRENT, wind_speed_10m: -3 });
  const result = await fetchWeatherForProvinceWithDeps('Chaco', fetcher);

  assert.strictEqual(result.stale, true, 'windSpeed=-3 should fail validation → stale=true');
  assert.ok(result.error?.includes('out-of-range'), `error should mention out-of-range, got: ${result.error}`);
});

test('stale fallback uses cached value after successful fetch', async () => {
  _clearWeatherCache();
  const successFetcher = makeFetcher(VALID_CURRENT);
  const first = await fetchWeatherForProvinceWithDeps('Santa Fe', successFetcher);
  assert.strictEqual(first.stale, false, 'first fetch should succeed');

  const failFetcher = async (_url: string, _opts: RequestInit): Promise<Response> => {
    throw new Error('network failure');
  };
  const second = await fetchWeatherForProvinceWithDeps('Santa Fe', failFetcher);

  assert.strictEqual(second.stale, true, 'second fetch should be stale');
  assert.strictEqual(second.data.temperature, 25.3, 'cached temperature');
  assert.strictEqual(second.data.relativeHumidity, 45, 'cached humidity');
  assert.strictEqual(second.data.windSpeed, 12.5, 'cached windSpeed');
  assert.ok(second.error?.includes('network failure'), `error should include network failure, got: ${second.error}`);
});

test('no fallback available returns safe defaults with stale=true', async () => {
  _clearWeatherCache();
  const fetcher = async (_url: string, _opts: RequestInit): Promise<Response> => {
    throw new Error('connection refused');
  };

  const result = await fetchWeatherForProvinceWithDeps('Tucumán', fetcher);

  assert.strictEqual(result.stale, true, 'should be stale when no cache');
  assert.strictEqual(result.data.temperature, 20);
  assert.strictEqual(result.data.relativeHumidity, 50);
  assert.strictEqual(result.data.windSpeed, 10);
  assert.strictEqual(result.data.windDir, 'N');
  assert.strictEqual(result.data.rain24h, 0);
  assert.ok(result.error?.includes('connection refused'), `error should include reason, got: ${result.error}`);
});

test('HTTP error response returns stale fallback', async () => {
  _clearWeatherCache();
  const fetcher = makeFetcher({}, false, 503);
  const result = await fetchWeatherForProvinceWithDeps('Jujuy', fetcher);

  assert.strictEqual(result.stale, true, 'HTTP 503 should return stale');
  assert.ok(result.error?.includes('503'), `error should mention 503, got: ${result.error}`);
});

test('unknown province returns stale result with error', async () => {
  _clearWeatherCache();
  const fetcher = makeFetcher(VALID_CURRENT);
  const result = await fetchWeatherForProvinceWithDeps('Atlantida', fetcher);

  assert.strictEqual(result.stale, true, 'unknown province should return stale');
  assert.ok(result.error?.includes('unknown province'), `error should mention unknown province, got: ${result.error}`);
});

test('getProvinceCentroid returns coordinates for valid province', () => {
  const centroid = getProvinceCentroid('Córdoba');
  assert.ok(centroid, 'centroid should exist');
  assert.strictEqual(centroid.lat, -32.142);
  assert.strictEqual(centroid.lng, -63.802);
});

test('getProvinceCentroid returns null for invalid province', () => {
  const centroid = getProvinceCentroid('Mordor');
  assert.strictEqual(centroid, null);
});
