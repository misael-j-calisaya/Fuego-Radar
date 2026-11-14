/**
 * Provincial Geocoder Module
 *
 * Determines which Argentine province a geographic coordinate falls within,
 * using ray-casting over GeoJSON provincial boundary polygons.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ARGENTINA_BBOX } from '../shared/constants.js';

// ============================================
// Custom Error
// ============================================

/**
 * Thrown when the GeoJSON file cannot be loaded or is invalid.
 * Requirement 8.6: log critical error and fail with descriptive error code.
 */
export class GeocoderInitializationError extends Error {
  public readonly code = 'GEOCODER_INIT_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'GeocoderInitializationError';
  }
}

// ============================================
// Module-level cached state (ensures determinism per Req 8.2)
// ============================================

let provincesGeoJson: GeoJSONFeatureCollection | null = null;

// ============================================
// GeoJSON type definitions (minimal, matching provinces.json structure)
// ============================================

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

interface GeoJSONFeature {
  type: 'Feature';
  geometry: GeoJSONGeometry;
  properties: {
    nombre: string;
    [key: string]: unknown;
  };
}

interface GeoJSONGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

// ============================================
// Initialization
// ============================================

/**
 * Loads and validates the provinces GeoJSON file.
 * Must be called before assignProvince.
 *
 * @param geojsonPath - Optional override path (defaults to backend/data/provinces.json)
 * @throws GeocoderInitializationError if file is missing or invalid
 */
export function initializeGeocoder(geojsonPath?: string): void {
  const resolvedPath =
    geojsonPath ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/provinces.json');

  let fileContent: string;
  try {
    fileContent = fs.readFileSync(resolvedPath, 'utf-8');
  } catch (err) {
    const message = `Failed to load provinces GeoJSON from "${resolvedPath}": ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[CRITICAL] ${message}`);
    throw new GeocoderInitializationError(message);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch (err) {
    const message = `Failed to parse provinces GeoJSON: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[CRITICAL] ${message}`);
    throw new GeocoderInitializationError(message);
  }

  // Validate FeatureCollection structure
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as Record<string, unknown>).type !== 'FeatureCollection' ||
    !Array.isArray((parsed as Record<string, unknown>).features)
  ) {
    const message = 'Invalid GeoJSON: expected a FeatureCollection with a features array';
    console.error(`[CRITICAL] ${message}`);
    throw new GeocoderInitializationError(message);
  }

  provincesGeoJson = parsed as GeoJSONFeatureCollection;
}

// ============================================
// Province Assignment (main export)
// ============================================

/**
 * Determines which Argentine province contains the given coordinates.
 *
 * Req 8.5: If outside Argentina bounding box, returns 'Fuera de Argentina' without ray-casting.
 * Req 8.3: If inside bbox but not in any polygon, returns 'Fuera de Argentina'.
 * Req 8.2: Deterministic — same coordinates always return the same result.
 * Req 8.1: Uses ray-casting algorithm over GeoJSON polygons.
 *
 * @param lat - Latitude of the point
 * @param lng - Longitude of the point
 * @returns Province name or 'Fuera de Argentina'
 * @throws GeocoderInitializationError if geocoder has not been initialized
 */
export function assignProvince(lat: number, lng: number): string {
  // Bounding box pre-check (Req 8.4, 8.5)
  if (
    lat < ARGENTINA_BBOX.lat.min ||
    lat > ARGENTINA_BBOX.lat.max ||
    lng < ARGENTINA_BBOX.lng.min ||
    lng > ARGENTINA_BBOX.lng.max
  ) {
    return 'Fuera de Argentina';
  }

  // Ensure geocoder is initialized
  if (!provincesGeoJson) {
    const message = 'Geocoder not initialized. Call initializeGeocoder() before assignProvince().';
    console.error(`[CRITICAL] ${message}`);
    throw new GeocoderInitializationError(message);
  }

  // Ray-casting over each province (Req 8.1)
  for (const feature of provincesGeoJson.features) {
    if (isPointInGeometry(lng, lat, feature.geometry)) {
      const name = feature.properties.nombre;
      if (name.startsWith('Tierra del Fuego')) {
        return 'Tierra del Fuego';
      }
      return name;
    }
  }

  // Inside bbox but outside all polygons (Req 8.3)
  return 'Fuera de Argentina';
}

// ============================================
// Internal Helpers — Ray-Casting Algorithm
// ============================================

/**
 * Ray-casting point-in-polygon test.
 * Determines if a point lies inside a polygon ring.
 */
function isPointInPolygon(point: [number, number], vs: [number, number][]): boolean {
  const x = point[0];
  const y = point[1];
  let inside = false;

  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0];
    const yi = vs[i][1];
    const xj = vs[j][0];
    const yj = vs[j][1];

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Checks if a point (lng, lat) falls within a Polygon or MultiPolygon geometry.
 */
function isPointInGeometry(lng: number, lat: number, geometry: GeoJSONGeometry): boolean {
  const point: [number, number] = [lng, lat];

  if (geometry.type === 'Polygon') {
    // Check outer ring (coordinates[0])
    return isPointInPolygon(point, geometry.coordinates[0] as [number, number][]);
  }

  if (geometry.type === 'MultiPolygon') {
    for (const polygonCoords of geometry.coordinates as number[][][][]) {
      if (isPointInPolygon(point, polygonCoords[0] as [number, number][])) {
        return true;
      }
    }
  }

  return false;
}

// ============================================
// Testing Helpers (exported for unit test access)
// ============================================

/** Resets the internal GeoJSON cache. For testing only. */
export function _resetGeocoder(): void {
  provincesGeoJson = null;
}

/** Exposes isPointInPolygon for unit testing. */
export { isPointInPolygon as _isPointInPolygon };
