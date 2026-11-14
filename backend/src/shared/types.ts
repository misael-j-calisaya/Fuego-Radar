/**
 * Shared type definitions for the Fire Risk Engine.
 * All DynamoDB entity interfaces, core domain types, and Lambda event/result types.
 */

// ============================================
// Core Domain Types
// ============================================

/** Danger level classification based on risk score thresholds */
export type DangerLevel = 'Bajo' | 'Medio' | 'Alto' | 'Muy Alto' | 'Extremo';

/** Argentine geographic regions for regional risk factor calculation */
export type Region = 'Patagonia' | 'Centro' | 'Norte' | 'Cuyo' | 'Litoral';

/** Alert severity levels */
export type AlertSeverity = 'Bajo' | 'Medio' | 'Alto' | 'Crítico';

/** Alert type classification */
export type AlertType = 'Incendio' | 'Meteorológica' | 'Evacuación' | 'Prevención';

/** Satellite source for hotspot detection */
export type Satellite = 'VIIRS' | 'MODIS';

/** Risk trend direction */
export type Trend = 'up' | 'down' | 'stable';

/** Ingestion data source indicator */
export type IngestionSource = 'FIRMS_API' | 'FALLBACK_CACHE' | 'EMPTY_RESPONSE';

// ============================================
// Weather Data
// ============================================

/** Meteorological data from external weather APIs (SMN/OpenMeteo) */
export interface WeatherData {
  temperature: number;        // °C, range [-20, 50]
  relativeHumidity: number;   // %, range [0, 100]
  windSpeed: number;          // km/h, range ≥ 0
  windDir: string;            // Cardinal direction (N, S, E, O, NE, etc.)
  rain24h?: number;           // mm in last 24 hours, ≥ 0
}

// ============================================
// Risk Calculation Types
// ============================================

/** Climate normal values for confidence calculation */
export interface ClimateNormal {
  avgTemp: number;
  avgHumidity: number;
  avgWind: number;
}

/** Input for the risk evaluation algorithm (8 weighted factors) */
export interface RiskInput {
  temperature: number;          // °C, range [-20, 50]
  relativeHumidity: number;     // %, range [0, 100]
  windSpeed: number;            // km/h, ≥ 0
  rain24h: number;              // mm, ≥ 0
  province: string;
  region: Region;
  recentHotspotsCount: number;  // ≥ 0
  historicalFireCount: number;   // ≥ 0
  climateNormal: ClimateNormal;
  hasCriticalAlert?: boolean;
}

/** Output from the risk evaluation algorithm */
export interface RiskOutput {
  riskScore: number;            // [0, 100]
  riskLevel: DangerLevel;
  explanation: string;
  confidenceScore: number;      // [50, 100]
}

// ============================================
// DynamoDB Single Table Design
// ============================================

/** Base key structure for Single Table Design */
export interface DynamoDBKeyDesign {
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
  TTL?: number;
}

/** DynamoDB entity: Satellite hotspot detection */
export interface HotspotItem extends DynamoDBKeyDesign {
  PK: `HOTSPOT#${string}`;
  SK: `TS#${string}#${string}`;
  GSI1PK: `DATE#${string}`;
  GSI1SK: `PROV#${string}`;
  lat: number;
  lng: number;
  brightness: number;
  confidence: number;
  satellite: Satellite;
  province: string;
  TTL: number;
}

/** DynamoDB entity: Provincial risk score (current) */
export interface RiskScoreItem extends DynamoDBKeyDesign {
  PK: 'RISK#CURRENT';
  SK: `PROVINCE#${string}`;
  GSI1PK: `RISKLEVEL#${string}`;
  GSI1SK: `SCORE#${string}`;
  riskScore: number;
  riskLevel: DangerLevel;
  activeHotspotsCount: number;
  trend: Trend;
  explanation: string;
  confidenceScore: number;
  lastUpdated: string;
  weatherStale: boolean;
  /** Simplified FWI (0-100) used for the province */
  fwi?: number;
  /** Weather snapshot used for the calculation */
  temperature?: number;
  relativeHumidity?: number;
  windSpeed?: number;
  rain24h?: number;
  /** Rolling 7-day hotspot counts keyed by YYYY-MM-DD (historical factor) */
  dailyHotspotCounts?: Record<string, number>;
}

/** DynamoDB entity: Risk zone grid cell */
export interface RiskZoneItem extends DynamoDBKeyDesign {
  PK: 'RISK#ZONES';
  SK: `GRID#${string}`;
  GSI1PK: `PROVINCE#${string}`;
  GSI1SK: `FWI#${string}`;
  bounds: [[number, number], [number, number]];
  fwi: number;
  riskLevel: DangerLevel;
  hotspotsInCell: number;
  lastUpdated: string;
}

/** DynamoDB entity: Fire alert */
export interface AlertItem extends DynamoDBKeyDesign {
  PK: `ALERT#${string}`;
  SK: `TS#${string}#${string}`;
  GSI1PK: `SEVERITY#${string}`;
  GSI1SK: `TS#${string}`;
  title: string;
  description: string;
  severity: AlertSeverity;
  type: AlertType;
  locationName: string;
  coordinates: { lat: number; lng: number };
  radius: number;
  TTL: number;
}

/** DynamoDB entity: User subscription for alerts */
export interface SubscriptionItem extends DynamoDBKeyDesign {
  PK: `SUB#${string}`;
  SK: `PROV#${string}`;
  GSI1PK: `PROVINCE#${string}`;
  GSI1SK: `SEVERITY#${string}`;
  email: string;
  minSeverity: AlertSeverity;
  verified: boolean;
  createdAt: string;
}

/** DynamoDB entity: Ingestion run metadata */
export interface IngestionMetaItem extends DynamoDBKeyDesign {
  PK: 'META#INGESTION';
  SK: `RUN#${string}`;
  rawEntries: number;
  finalCount: number;
  duplicatesRemoved: number;
  source: IngestionSource;
  duration_ms: number;
  TTL: number;
}

// ============================================
// Lambda Handler Types
// ============================================

/** Result from the ingestion Lambda handler */
export interface IngestionResult {
  statusCode: number;
  body: {
    rawEntries: number;
    savedTo: string;
    geocodedArgentina: number;
    duplicatesRemoved: number;
    finalCount: number;
    timestamp: string;
    source: IngestionSource;
  };
}
