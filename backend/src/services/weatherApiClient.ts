/**
 * Real weather API client using Open-Meteo.
 * Fetches current weather for Argentine provinces with timeout, validation, and stale fallback.
 *
 * Requirements: 2.3, 3.1
 */

import { WEATHER_API_TIMEOUT_MS, VALIDATION_RANGES } from '../shared/constants.js';
import type { WeatherData } from '../shared/types.js';

// ============================================
// Types
// ============================================

export interface WeatherFetchResult {
  data: WeatherData;
  stale: boolean;
  province: string;
  fetchedAt: string;
  error?: string;
}

// ============================================
// Province Centroids (representative lat/lng)
// ============================================

const PROVINCE_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  'Buenos Aires': { lat: -36.614, lng: -60.561 },
  'Ciudad Autónoma de Buenos Aires': { lat: -34.614, lng: -58.446 },
  'Catamarca': { lat: -27.339, lng: -66.948 },
  'Chaco': { lat: -26.387, lng: -60.768 },
  'Chubut': { lat: -43.789, lng: -68.527 },
  'Córdoba': { lat: -32.142, lng: -63.802 },
  'Corrientes': { lat: -28.776, lng: -57.839 },
  'Entre Ríos': { lat: -31.775, lng: -59.679 },
  'Formosa': { lat: -24.894, lng: -59.932 },
  'Jujuy': { lat: -23.320, lng: -65.765 },
  'La Pampa': { lat: -37.131, lng: -65.443 },
  'La Rioja': { lat: -29.685, lng: -67.182 },
  'Mendoza': { lat: -34.625, lng: -68.347 },
  'Misiones': { lat: -26.875, lng: -54.666 },
  'Neuquén': { lat: -38.642, lng: -70.120 },
  'Río Negro': { lat: -40.402, lng: -67.229 },
  'Salta': { lat: -24.480, lng: -64.937 },
  'San Juan': { lat: -30.866, lng: -68.889 },
  'San Luis': { lat: -33.761, lng: -66.025 },
  'Santa Cruz': { lat: -48.815, lng: -69.955 },
  'Santa Fe': { lat: -30.709, lng: -60.951 },
  'Santiago del Estero': { lat: -27.782, lng: -63.252 },
  'Tierra del Fuego': { lat: -54.367, lng: -67.847 },
  'Tucumán': { lat: -26.824, lng: -65.217 },
};

// ============================================
// Safe Defaults (used when no fallback cache exists)
// ============================================

const SAFE_DEFAULTS: WeatherData = {
  temperature: 20,
  relativeHumidity: 50,
  windSpeed: 10,
  windDir: 'N',
  rain24h: 0,
};

// ============================================
// Module-level fallback cache
// ============================================

const weatherCache: Map<string, WeatherData> = new Map();

// ============================================
// Validation
// ============================================

function isWeatherValid(data: { temperature: number; humidity: number; windSpeed: number }): boolean {
  return (
    data.temperature >= VALIDATION_RANGES.temperature.min &&
    data.temperature <= VALIDATION_RANGES.temperature.max &&
    data.humidity >= VALIDATION_RANGES.relativeHumidity.min &&
    data.humidity <= VALIDATION_RANGES.relativeHumidity.max &&
    data.windSpeed >= VALIDATION_RANGES.windSpeed.min
  );
}

// ============================================
// Wind direction conversion
// ============================================

function degreesToCardinal(degrees: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
}

// ============================================
// Stale fallback helper
// ============================================

function buildStaleResult(province: string, errorReason: string): WeatherFetchResult {
  const cached = weatherCache.get(province);
  if (cached) {
    return {
      data: cached,
      stale: true,
      province,
      fetchedAt: new Date().toISOString(),
      error: errorReason,
    };
  }
  return {
    data: { ...SAFE_DEFAULTS },
    stale: true,
    province,
    fetchedAt: new Date().toISOString(),
    error: errorReason || 'no fallback available',
  };
}

// ============================================
// Public API
// ============================================

/**
 * Fetch weather data for a province using the Open-Meteo API.
 * Uses native fetch with AbortController for timeout.
 */
export async function fetchWeatherForProvince(province: string): Promise<WeatherFetchResult> {
  return fetchWeatherForProvinceWithDeps(province);
}

/**
 * Fetch weather with injectable fetcher (for testing).
 */
export async function fetchWeatherForProvinceWithDeps(
  province: string,
  fetcher?: (url: string, options: RequestInit) => Promise<Response>,
): Promise<WeatherFetchResult> {
  const centroid = PROVINCE_CENTROIDS[province];
  if (!centroid) {
    return buildStaleResult(province, `unknown province: ${province}`);
  }

  const fetchFn = fetcher ?? fetch;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WEATHER_API_TIMEOUT_MS);

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${centroid.lat}&longitude=${centroid.lng}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation`;

    const response = await fetchFn(url, { signal: controller.signal });

    if (!response.ok) {
      return buildStaleResult(province, `HTTP ${response.status}`);
    }

    const json = await response.json() as {
      current?: {
        temperature_2m?: number;
        relative_humidity_2m?: number;
        wind_speed_10m?: number;
        wind_direction_10m?: number;
        precipitation?: number;
      };
    };

    if (!json.current) {
      return buildStaleResult(province, 'invalid response: missing current object');
    }

    const { temperature_2m, relative_humidity_2m, wind_speed_10m, wind_direction_10m, precipitation } = json.current;

    if (
      temperature_2m === undefined ||
      relative_humidity_2m === undefined ||
      wind_speed_10m === undefined
    ) {
      return buildStaleResult(province, 'invalid response: missing required fields');
    }

    // Validate ranges
    if (!isWeatherValid({
      temperature: temperature_2m,
      humidity: relative_humidity_2m,
      windSpeed: wind_speed_10m,
    })) {
      return buildStaleResult(province, 'out-of-range values detected');
    }

    // Build valid weather data
    const weatherData: WeatherData = {
      temperature: temperature_2m,
      relativeHumidity: relative_humidity_2m,
      windSpeed: wind_speed_10m,
      windDir: degreesToCardinal(wind_direction_10m ?? 0),
      rain24h: precipitation ?? 0,
    };

    // Update cache with valid reading
    weatherCache.set(province, weatherData);

    return {
      data: weatherData,
      stale: false,
      province,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error';
    const reason = message.includes('abort') ? 'timeout (6s exceeded)' : message;
    return buildStaleResult(province, reason);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Get centroid coordinates for a province.
 */
export function getProvinceCentroid(province: string): { lat: number; lng: number } | null {
  return PROVINCE_CENTROIDS[province] ?? null;
}

/**
 * Clear the weather fallback cache (for testing).
 */
export function _clearWeatherCache(): void {
  weatherCache.clear();
}
