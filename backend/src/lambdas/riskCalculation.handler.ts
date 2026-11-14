/**
 * Risk Calculation Lambda Handler
 *
 * Orchestrates the risk calculation pipeline triggered by EventBridge every 30 minutes:
 * Read hotspots → Fetch weather → Calculate FWI → Evaluate risk → Calculate confidence →
 * Persist risk scores → Generate alerts for high severity provinces → Publish to SNS
 *
 * Requirements: 3.1, 3.2, 3.9, 2.3, 2.6, 10.1
 */

import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import {
  queryHotspotsByProvince,
  putRiskScore,
  putAlert,
  getRiskScore,
  queryAlertsByProvince,
  putRiskZones,
} from '../data/repository.js';
import {
  computeTrend,
  updateDailyHotspotCounts,
  historicalFireCount,
  hasRecentCriticalAlert,
  isDuplicateAlert,
  buildRiskZones,
} from '../services/riskContext.js';
import type { ProvinceZoneInput } from '../services/riskContext.js';
import { fetchWeatherForProvince, getProvinceCentroid } from '../services/weatherApiClient.js';
import { calculateFWI } from '../services/fwiCalculator.js';
import { evaluateFireRisk, calculateConfidence } from '../services/riskEvaluator.js';
import { PROVINCES, TTL_ALERTS_SECONDS } from '../shared/constants.js';
import type {
  HotspotItem,
  RiskScoreItem,
  AlertItem,
  DangerLevel,
  AlertSeverity,
  Region,
  ClimateNormal,
  RiskInput,
  RiskZoneItem,
} from '../shared/types.js';
import type { WeatherFetchResult } from '../services/weatherApiClient.js';
import type { FWICalculationResult } from '../services/fwiCalculator.js';

// ============================================
// Types
// ============================================

/** EventBridge scheduled event shape */
export interface RiskCalculationEvent {
  source: string;
  'detail-type': string;
  detail: Record<string, unknown>;
}

/** Result returned by the risk calculation handler */
export interface RiskCalculationResult {
  statusCode: number;
  body: {
    provincesProcessed: number;
    alertsGenerated: number;
    alertsSuppressed: number;
    riskZonesWritten: number;
    staleWeatherCount: number;
    timestamp: string;
    durationMs: number;
  };
}

/** Dependency injection interface for testability */
export interface RiskCalculationDependencies {
  queryHotspotsByProvince: typeof queryHotspotsByProvince;
  fetchWeather: typeof fetchWeatherForProvince;
  calculateFWI: typeof calculateFWI;
  evaluateRisk: typeof evaluateFireRisk;
  calculateConfidence: typeof calculateConfidence;
  putRiskScore: typeof putRiskScore;
  putAlert: typeof putAlert;
  publishToSNS: (message: string, topicArn: string) => Promise<void>;
  /** Previous score for trend + rolling fire history (optional for backwards compatibility) */
  getPreviousRiskScore?: (province: string) => Promise<RiskScoreItem | null>;
  /** Recent alerts for critical-alert factor and de-duplication */
  queryRecentAlerts?: (province: string) => Promise<AlertItem[]>;
  /** Persists the risk-zone grid served by GET /risk/zones */
  putRiskZones?: (zones: RiskZoneItem[]) => Promise<void>;
}

// ============================================
// Province-Region Mapping
// ============================================

const PROVINCE_REGION_MAP: Record<string, Region> = {
  'Buenos Aires': 'Centro',
  'Ciudad Autónoma de Buenos Aires': 'Centro',
  'Córdoba': 'Centro',
  'La Pampa': 'Centro',
  'San Luis': 'Centro',
  'Santa Fe': 'Centro',
  'Entre Ríos': 'Litoral',
  'Corrientes': 'Litoral',
  'Misiones': 'Litoral',
  'Formosa': 'Norte',
  'Chaco': 'Norte',
  'Santiago del Estero': 'Norte',
  'Tucumán': 'Norte',
  'Salta': 'Norte',
  'Jujuy': 'Norte',
  'Catamarca': 'Norte',
  'Mendoza': 'Cuyo',
  'San Juan': 'Cuyo',
  'La Rioja': 'Cuyo',
  'Neuquén': 'Patagonia',
  'Río Negro': 'Patagonia',
  'Chubut': 'Patagonia',
  'Santa Cruz': 'Patagonia',
  'Tierra del Fuego': 'Patagonia',
};

// ============================================
// Default Climate Normals (by region)
// ============================================

const REGION_CLIMATE_NORMALS: Record<Region, ClimateNormal> = {
  'Centro': { avgTemp: 22, avgHumidity: 50, avgWind: 12 },
  'Litoral': { avgTemp: 24, avgHumidity: 65, avgWind: 10 },
  'Norte': { avgTemp: 26, avgHumidity: 55, avgWind: 8 },
  'Cuyo': { avgTemp: 20, avgHumidity: 40, avgWind: 15 },
  'Patagonia': { avgTemp: 10, avgHumidity: 55, avgWind: 25 },
};

// ============================================
// Risk Level to Alert Severity Mapping
// ============================================

function mapRiskLevelToSeverity(riskLevel: DangerLevel): AlertSeverity {
  switch (riskLevel) {
    case 'Alto':
      return 'Alto';
    case 'Muy Alto':
      return 'Alto';
    case 'Extremo':
      return 'Crítico';
    default:
      return 'Medio';
  }
}

// ============================================
// Stale Hotspot Detection (Req 2.6)
// ============================================

const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours in milliseconds

/**
 * Checks if the most recent hotspot in the list is older than 48h.
 * Returns true if hotspots are stale, indicating reduced confidence.
 */
function areHotspotsStale(hotspots: HotspotItem[]): boolean {
  if (hotspots.length === 0) return false;

  const now = Date.now();
  let newestTimestamp = 0;

  for (const hotspot of hotspots) {
    // SK format: TS#{isoDate}#{id}
    const skParts = hotspot.SK.split('#');
    if (skParts.length >= 2) {
      const dateStr = skParts[1];
      const ts = new Date(dateStr).getTime();
      if (ts > newestTimestamp) {
        newestTimestamp = ts;
      }
    }
  }

  if (newestTimestamp === 0) return false;
  return (now - newestTimestamp) > STALE_THRESHOLD_MS;
}

// ============================================
// Date Helpers
// ============================================

function getDateStrings(): { today: string; yesterday: string } {
  const now = new Date();
  const today = now.toISOString().substring(0, 10);
  const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterday = yesterdayDate.toISOString().substring(0, 10);
  return { today, yesterday };
}

// ============================================
// Core Pipeline Logic (testable via DI)
// ============================================

/**
 * Runs the risk calculation pipeline with injected dependencies.
 * For each province: query hotspots → fetch weather → calculate FWI →
 * evaluate risk → calculate confidence → persist → generate alerts.
 */
export async function runRiskCalculation(
  deps: RiskCalculationDependencies,
): Promise<RiskCalculationResult> {
  const startTime = Date.now();
  let provincesProcessed = 0;
  let alertsGenerated = 0;
  let alertsSuppressed = 0;
  let riskZonesWritten = 0;
  const zoneInputs: ProvinceZoneInput[] = [];
  let staleWeatherCount = 0;

  const { today, yesterday } = getDateStrings();
  const alertTopicArn = process.env.ALERTS_TOPIC_ARN ?? '';

  for (const province of PROVINCES) {
    try {
      // Step 1: Query hotspots for this province (today + yesterday for 24h window)
      const [hotspotsToday, hotspotsYesterday] = await Promise.all([
        deps.queryHotspotsByProvince(province, today),
        deps.queryHotspotsByProvince(province, yesterday),
      ]);
      const allHotspots = [...hotspotsToday, ...hotspotsYesterday];

      const [previousScore, recentAlerts] = await Promise.all([
        deps.getPreviousRiskScore ? deps.getPreviousRiskScore(province).catch(() => null) : Promise.resolve(null),
        deps.queryRecentAlerts ? deps.queryRecentAlerts(province).catch(() => [] as AlertItem[]) : Promise.resolve([] as AlertItem[]),
      ]);
      const dailyHotspotCounts = updateDailyHotspotCounts(
        previousScore?.dailyHotspotCounts,
        today,
        hotspotsToday.length,
        { [yesterday]: hotspotsYesterday.length },
      );

      // Step 3: Fetch weather for this province
      const weatherResult: WeatherFetchResult = await deps.fetchWeather(province);

      if (weatherResult.stale) {
        staleWeatherCount++;
      }

      // Step 4: Calculate FWI from weather data
      const fwiResult: FWICalculationResult = deps.calculateFWI(weatherResult.data);

      // If FWI calculation fails validation, skip province (shouldn't happen with stale fallback)
      if (!fwiResult.success) {
        console.warn(`[RiskCalculation] FWI validation failed for ${province}:`, fwiResult.errors);
        continue;
      }

      // Step 5: Build RiskInput and evaluate fire risk
      const region = PROVINCE_REGION_MAP[province] ?? 'Centro';
      const climateNormal = REGION_CLIMATE_NORMALS[region];
      const hotspotCount = allHotspots.length;

      const riskInput: RiskInput = {
        temperature: weatherResult.data.temperature,
        relativeHumidity: weatherResult.data.relativeHumidity,
        windSpeed: weatherResult.data.windSpeed,
        rain24h: weatherResult.data.rain24h ?? 0,
        province,
        region,
        recentHotspotsCount: hotspotCount,
        historicalFireCount: historicalFireCount(dailyHotspotCounts, today),
        climateNormal,
        hasCriticalAlert: hasRecentCriticalAlert(recentAlerts),
      };

      const riskResult = deps.evaluateRisk(riskInput);
      // Alerts are decided on conditions alone; otherwise our own critical alert
      // would keep re-boosting the score and re-issuing critical alerts forever.
      const alertLevel = riskInput.hasCriticalAlert
        ? deps.evaluateRisk({ ...riskInput, hasCriticalAlert: false }).riskLevel
        : riskResult.riskLevel;

      // Step 6: Calculate confidence
      const confidenceResult = deps.calculateConfidence(riskInput, weatherResult.stale);
      let confidenceScore = confidenceResult.confidenceScore;

      // Step 6b: Handle stale hotspots (Req 2.6) — reduce confidence by 20
      const hotspotsStale = areHotspotsStale(allHotspots);
      if (hotspotsStale) {
        confidenceScore = Math.max(50, confidenceScore - 20);
        console.warn(
          JSON.stringify({
            level: 'WARN',
            province,
            staleHotspots: true,
            message: `Hotspot data >48h old for province ${province}. Confidence reduced by 20.`,
          }),
        );
      }

      // Step 7: Build RiskScoreItem and persist to DynamoDB
      const { riskScore, riskLevel, explanation } = riskResult;
      const paddedScore = riskScore.toString().padStart(3, '0');

      const riskScoreItem: RiskScoreItem = {
        PK: 'RISK#CURRENT',
        SK: `PROVINCE#${province}` as `PROVINCE#${string}`,
        GSI1PK: `RISKLEVEL#${riskLevel}` as `RISKLEVEL#${string}`,
        GSI1SK: `SCORE#${paddedScore}` as `SCORE#${string}`,
        riskScore,
        riskLevel,
        activeHotspotsCount: hotspotCount,
        trend: computeTrend(previousScore?.riskScore, riskScore),
        explanation,
        confidenceScore,
        lastUpdated: new Date().toISOString(),
        weatherStale: weatherResult.stale,
        fwi: fwiResult.result.fwiScore,
        temperature: weatherResult.data.temperature,
        relativeHumidity: weatherResult.data.relativeHumidity,
        windSpeed: weatherResult.data.windSpeed,
        rain24h: weatherResult.data.rain24h ?? 0,
        dailyHotspotCounts,
      };

      await deps.putRiskScore(riskScoreItem);
      provincesProcessed++;

      zoneInputs.push({
        province,
        fwi: fwiResult.result.fwiScore,
        centroid: getProvinceCentroid(province) ?? undefined,
        hotspots: allHotspots,
      });

      // Step 8: Generate alerts for severity ≥ 'Alto' (Req 10.1), skipping duplicates
      const isAlertLevel = ['Alto', 'Muy Alto', 'Extremo'].includes(alertLevel);
      const duplicate = isAlertLevel && isDuplicateAlert(recentAlerts, mapRiskLevelToSeverity(alertLevel));
      if (duplicate) alertsSuppressed++;

      if (isAlertLevel && !duplicate) {
        const now = new Date().toISOString();
        const nowEpoch = Math.floor(Date.now() / 1000);
        const alertId = `${province}-${Date.now()}`;
        const severity = mapRiskLevelToSeverity(alertLevel);
        const centroid = getProvinceCentroid(province);

        const alertItem: AlertItem = {
          PK: `ALERT#${province}` as `ALERT#${string}`,
          SK: `TS#${now}#${alertId}` as `TS#${string}#${string}`,
          GSI1PK: `SEVERITY#${severity}` as `SEVERITY#${string}`,
          GSI1SK: `TS#${now}` as `TS#${string}`,
          title: `Alerta de incendio - ${province}`,
          description: explanation,
          severity,
          type: 'Incendio',
          locationName: province,
          coordinates: centroid ?? { lat: -38.4, lng: -63.6 },
          radius: 50, // km
          TTL: nowEpoch + TTL_ALERTS_SECONDS,
        };

        // Publish first: a persisted-but-unpublished alert would suppress the retry via dedup.
        await deps.publishToSNS(JSON.stringify(alertItem), alertTopicArn);
        await deps.putAlert(alertItem);
        alertsGenerated++;
      }
    } catch (error) {
      console.error(
        `[RiskCalculation] Error processing province ${province}:`,
        error instanceof Error ? error.message : error,
      );
      // Continue processing other provinces even if one fails
    }
  }

  if (deps.putRiskZones && zoneInputs.length > 0) {
    try {
      const zones = buildRiskZones(zoneInputs);
      await deps.putRiskZones(zones);
      riskZonesWritten = zones.length;
    } catch (error) {
      console.error(
        '[RiskCalculation] Failed to persist risk zones:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  const durationMs = Date.now() - startTime;

  return {
    statusCode: 200,
    body: {
      provincesProcessed,
      alertsGenerated,
      alertsSuppressed,
      riskZonesWritten,
      staleWeatherCount,
      timestamp: new Date().toISOString(),
      durationMs,
    },
  };
}

// ============================================
// SNS Helper
// ============================================

const snsClient = new SNSClient({});

async function publishToSNS(message: string, topicArn: string): Promise<void> {
  await snsClient.send(new PublishCommand({ TopicArn: topicArn, Message: message }));
}

// ============================================
// Lambda Handler Entry Point
// ============================================

/**
 * Lambda handler invoked by EventBridge scheduled rule (every 30 minutes).
 * Creates real dependencies and delegates to runRiskCalculation.
 */
export async function handler(_event: RiskCalculationEvent): Promise<RiskCalculationResult> {
  const deps: RiskCalculationDependencies = {
    queryHotspotsByProvince,
    fetchWeather: fetchWeatherForProvince,
    calculateFWI,
    evaluateRisk: evaluateFireRisk,
    calculateConfidence,
    putRiskScore,
    putAlert,
    publishToSNS,
    getPreviousRiskScore: getRiskScore,
    queryRecentAlerts: queryAlertsByProvince,
    putRiskZones,
  };

  return runRiskCalculation(deps);
}
