/**
 * Shared constants for the Fire Risk Engine.
 * Bounding box, TTL values, province list, and validation ranges.
 */

// ============================================
// Argentina Bounding Box
// ============================================

/** Geographic bounding box for Argentina */
export const ARGENTINA_BBOX = {
  lat: { min: -56.0, max: -21.8 },
  lng: { min: -73.6, max: -53.5 },
} as const;

/** FIRMS API bbox string format: West,South,East,North */
export const ARGENTINA_BBOX_STRING = '-73.6,-56.0,-53.5,-21.8';

// ============================================
// TTL Values (in seconds)
// ============================================

/** Hotspot records expire after 48 hours */
export const TTL_HOTSPOTS_SECONDS = 172_800; // 48h

/** Alert records expire after 7 days */
export const TTL_ALERTS_SECONDS = 604_800; // 7d

/** Ingestion metadata expires after 30 days */
export const TTL_INGESTION_META_SECONDS = 2_592_000; // 30d

// ============================================
// Province List (23 provinces + CABA = 24)
// ============================================

export const PROVINCES = [
  'Buenos Aires',
  'Ciudad Autónoma de Buenos Aires',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán',
] as const;

export type ProvinceName = typeof PROVINCES[number];

/** Set for O(1) province validation lookups */
export const PROVINCES_SET: ReadonlySet<string> = new Set(PROVINCES);

// ============================================
// Validation Ranges
// ============================================

export const VALIDATION_RANGES = {
  riskScore: { min: 0, max: 100 },
  confidenceScore: { min: 50, max: 100 },
  temperature: { min: -20, max: 50 },
  relativeHumidity: { min: 0, max: 100 },
  windSpeed: { min: 0 },
  latitude: { min: -56.0, max: -21.8 },
  longitude: { min: -73.6, max: -53.5 },
} as const;

// ============================================
// Risk Level Thresholds
// ============================================

export const RISK_THRESHOLDS = {
  BAJO_MAX: 20,
  MEDIO_MAX: 40,
  ALTO_MAX: 60,
  MUY_ALTO_MAX: 80,
} as const;

// ============================================
// Deduplication Parameters
// ============================================

/** Maximum spatial distance (degrees) for duplicate detection */
export const DEDUP_SPATIAL_THRESHOLD_DEG = 0.015;

/** Maximum temporal distance (milliseconds) for duplicate detection */
export const DEDUP_TEMPORAL_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

// ============================================
// External API Configuration
// ============================================

/** Timeout for NASA FIRMS API requests (milliseconds) */
export const FIRMS_API_TIMEOUT_MS = 6_000;

/** Timeout for weather API requests (milliseconds) */
export const WEATHER_API_TIMEOUT_MS = 6_000;

/** Maximum consecutive FIRMS API failures before alarm */
export const FIRMS_MAX_CONSECUTIVE_FAILURES = 3;

// ============================================
// Risk Calculation Baseline
// ============================================

/** Starting baseline score for risk evaluation */
export const RISK_BASELINE_SCORE = 25;

// ============================================
// Lambda Configuration
// ============================================

export const LAMBDA_CONFIG = {
  ingestion: { memoryMB: 256, timeoutSeconds: 30 },
  query: { memoryMB: 128, timeoutSeconds: 10 },
  calculation: { memoryMB: 256, timeoutSeconds: 30 },
} as const;

// ============================================
// API Gateway Configuration
// ============================================

export const API_CACHE_TTL = {
  riskProvinces: 120,   // seconds
  riskZones: 120,       // seconds
  hotspots: 60,         // seconds
  alerts: 60,           // seconds
} as const;

export const API_THROTTLE = {
  rateLimit: 50,        // requests per second (sustained)
  burstLimit: 100,      // requests per second (burst)
} as const;

// ============================================
// EventBridge Schedule Intervals
// ============================================

export const SCHEDULE_INTERVALS = {
  ingestionMinutes: 15,
  calculationMinutes: 30,
} as const;

// ============================================
// DynamoDB Retry Configuration
// ============================================

export const DYNAMODB_RETRY = {
  maxRetries: 3,
  baseDelayMs: 100,
} as const;
