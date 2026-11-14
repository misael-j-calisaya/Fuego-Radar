/**
 * Fire Risk Evaluation Service.
 * Implements the 8-factor weighted risk scoring algorithm with clamping and danger level classification.
 *
 * Factors:
 *   1. Temperature (±20 pts)
 *   2. Humidity (±30 pts) — highest weight
 *   3. Wind (+20 pts)
 *   4. Precipitation (-30 pts) — suppressor
 *   5. Hotspots (+25 pts max)
 *   6. History (+10 pts max)
 *   7. Critical Alert (+15 pts)
 *   8. Regional Factors (+5 pts)
 */

import type { RiskInput, DangerLevel } from '../shared/types.js';
import { RISK_THRESHOLDS, RISK_BASELINE_SCORE } from '../shared/constants.js';

// ============================================
// Types
// ============================================

/** A single contributing factor to the risk score */
export interface ContributingFactor {
  name: string;         // e.g., 'temperature', 'humidity', 'wind', etc.
  points: number;       // points contributed (can be negative)
  description: string;  // explanation of why this factor contributed
}

/** Factor that reduced confidence */
export interface ConfidenceFactor {
  name: string;
  penalty: number;       // always negative
  description: string;
}

/** Result from confidence calculation */
export interface ConfidenceResult {
  confidenceScore: number;       // [50, 100]
  factors: ConfidenceFactor[];   // what reduced confidence
  weatherStale: boolean;         // whether stale weather penalty was applied
}

/** Result from the fire risk evaluation */
export interface RiskEvaluationResult {
  riskScore: number;                    // [0, 100]
  riskLevel: DangerLevel;               // 'Bajo' | 'Medio' | 'Alto' | 'Muy Alto' | 'Extremo'
  explanation: string;                  // Human-readable combined explanation
  contributingFactors: ContributingFactor[];
}

// ============================================
// Danger Level Classification
// ============================================

/**
 * Maps a numeric risk score to a danger level classification.
 *
 * Thresholds:
 *   score < 20  → 'Bajo'
 *   20 ≤ score < 40 → 'Medio'
 *   40 ≤ score < 60 → 'Alto'
 *   60 ≤ score < 80 → 'Muy Alto'
 *   score ≥ 80 → 'Extremo'
 */
export function getDangerLevel(score: number): DangerLevel {
  if (score < RISK_THRESHOLDS.BAJO_MAX) return 'Bajo';
  if (score < RISK_THRESHOLDS.MEDIO_MAX) return 'Medio';
  if (score < RISK_THRESHOLDS.ALTO_MAX) return 'Alto';
  if (score < RISK_THRESHOLDS.MUY_ALTO_MAX) return 'Muy Alto';
  return 'Extremo';
}

// ============================================
// Fire Risk Evaluator
// ============================================

/**
 * Evaluates fire risk integrating 8 weighted factors.
 * Starting from a baseline of 25 points, adds/subtracts based on conditions,
 * then clamps final score to [0, 100].
 *
 * @param input - RiskInput containing meteorological, regional, and historical data
 * @returns RiskEvaluationResult with score, level, explanation, and contributing factors
 */
export function evaluateFireRisk(input: RiskInput): RiskEvaluationResult {
  let score = RISK_BASELINE_SCORE;
  const factors: ContributingFactor[] = [];

  // Factor 1: Temperature (±20 pts)
  const tempPoints = evaluateTemperature(input.temperature);
  if (tempPoints !== 0) {
    score += tempPoints;
    factors.push({
      name: 'temperature',
      points: tempPoints,
      description: getTemperatureDescription(input.temperature, tempPoints),
    });
  }

  // Factor 2: Humidity (±30 pts) — HIGHEST WEIGHT
  const humidityPoints = evaluateHumidity(input.relativeHumidity);
  if (humidityPoints !== 0) {
    score += humidityPoints;
    factors.push({
      name: 'humidity',
      points: humidityPoints,
      description: getHumidityDescription(input.relativeHumidity, humidityPoints),
    });
  }

  // Factor 3: Wind (+20 pts)
  const windPoints = evaluateWind(input.windSpeed);
  if (windPoints !== 0) {
    score += windPoints;
    factors.push({
      name: 'wind',
      points: windPoints,
      description: getWindDescription(input.windSpeed, windPoints),
    });
  }

  // Factor 4: Precipitation — Suppressor (-30 pts)
  const rainPoints = evaluatePrecipitation(input.rain24h);
  if (rainPoints !== 0) {
    score += rainPoints;
    factors.push({
      name: 'precipitation',
      points: rainPoints,
      description: getPrecipitationDescription(input.rain24h, rainPoints),
    });
  }

  // Factor 5: Hotspots (+25 pts max)
  const hotspotPoints = evaluateHotspots(input.recentHotspotsCount);
  if (hotspotPoints !== 0) {
    score += hotspotPoints;
    factors.push({
      name: 'hotspots',
      points: hotspotPoints,
      description: `${input.recentHotspotsCount} foco(s) de calor detectado(s) por satélite en las cercanías.`,
    });
  }

  // Factor 6: History (+10 pts max)
  const historyPoints = evaluateHistory(input.historicalFireCount);
  if (historyPoints !== 0) {
    score += historyPoints;
    factors.push({
      name: 'history',
      points: historyPoints,
      description: `Historial de ${input.historicalFireCount} incendio(s) previo(s) en la zona.`,
    });
  }

  // Factor 7: Critical Alert (+15 pts)
  if (input.hasCriticalAlert) {
    score += 15;
    factors.push({
      name: 'criticalAlert',
      points: 15,
      description: 'Región bajo alerta crítica meteorológica o civil activa.',
    });
  }

  // Factor 8: Regional Factors (+5 pts)
  const regionalPoints = evaluateRegionalFactors(input.region, input.relativeHumidity, input.windSpeed);
  if (regionalPoints !== 0) {
    score += regionalPoints;
    factors.push({
      name: 'regional',
      points: regionalPoints,
      description: getRegionalDescription(input.region),
    });
  }

  // Clamp to [0, 100]
  const finalScore = Math.min(100, Math.max(0, Math.round(score)));
  const riskLevel = getDangerLevel(finalScore);

  // Build explanation from contributing factors
  const explanation = factors.length > 0
    ? factors.map(f => f.description).join(' ')
    : 'Condiciones normales dentro del promedio climático regional.';

  return {
    riskScore: finalScore,
    riskLevel,
    explanation,
    contributingFactors: factors,
  };
}

// ============================================
// Factor Evaluation Helpers
// ============================================

function evaluateTemperature(temperature: number): number {
  if (temperature > 32) return 20;
  if (temperature > 24) return 10;
  if (temperature < 15) return -10;
  return 0;
}

function evaluateHumidity(relativeHumidity: number): number {
  if (relativeHumidity < 15) return 30;
  if (relativeHumidity < 30) return 15;
  if (relativeHumidity > 60) return -15;
  return 0;
}

function evaluateWind(windSpeed: number): number {
  if (windSpeed > 30) return 20;
  if (windSpeed > 18) return 10;
  return 0;
}

function evaluatePrecipitation(rain24h: number): number {
  if (rain24h > 10) return -30;
  if (rain24h > 2) return -15;
  return 0;
}

function evaluateHotspots(recentHotspotsCount: number): number {
  return Math.min(25, recentHotspotsCount * 8);
}

function evaluateHistory(historicalFireCount: number): number {
  return Math.min(10, historicalFireCount * 0.5);
}

function evaluateRegionalFactors(region: string, relativeHumidity: number, windSpeed: number): number {
  let points = 0;
  if (region === 'Centro' && relativeHumidity < 20) points += 5;
  if (region === 'Patagonia' && windSpeed > 25) points += 5;
  return points;
}

// ============================================
// Description Helpers
// ============================================

function getTemperatureDescription(temperature: number, points: number): string {
  if (points > 0 && temperature > 32) return 'Temperaturas extremas registradas en la región.';
  if (points > 0) return 'Ambiente templado/cálido favorable a la sequedad.';
  return 'Bajas temperaturas mitigan la evaporación del combustible.';
}

function getHumidityDescription(relativeHumidity: number, points: number): string {
  if (points > 0 && relativeHumidity < 15) return 'Humedad relativa extremadamente baja crítica (<15%).';
  if (points > 0) return 'Humedad del aire baja que acelera la sequedad del combustible fino.';
  return 'Humedad relativa del aire elevada que dificulta la ignición.';
}

function getWindDescription(windSpeed: number, points: number): string {
  if (windSpeed > 30) return 'Vientos intensos registrados que facilitan la rápida propagación.';
  return 'Viento moderado que aporta oxígeno al frente de fuego.';
}

function getPrecipitationDescription(rain24h: number, points: number): string {
  if (rain24h > 10) return 'Lluvias copiosas en las últimas 24 horas humedecen el suelo de forma significativa.';
  return 'Precipitaciones leves que amortiguan temporalmente el peligro.';
}

function getRegionalDescription(region: string): string {
  if (region === 'Centro') return 'Bioma de monte serrano y pastizal en la región Centro bajo sequía extrema.';
  if (region === 'Patagonia') return 'Sotobosque andino-patagónico vulnerable a ráfagas de viento seco del oeste.';
  return 'Factor regional activo.';
}


// ============================================
// Confidence Score Calculation
// ============================================

/**
 * Calculates the confidence score based on deviation from climate normals
 * and data quality indicators.
 *
 * Algorithm:
 *   - Start at 95
 *   - Reduce 5 pts for each extreme deviation:
 *     - |temperature - climateNormal.avgTemp| > 15 → -5
 *     - |windSpeed - climateNormal.avgWind| > 25 → -5
 *     - |relativeHumidity - climateNormal.avgHumidity| > 40 → -5
 *   - Reduce 3 pts if recentHotspotsCount === 0
 *   - Reduce 10 pts if weather data is stale
 *   - Clamp to [50, 100]
 *
 * @param input - RiskInput with climateNormal, meteorological data, and hotspot count
 * @param weatherStale - Whether the weather data is stale (from weather client)
 * @returns ConfidenceResult with score, factors, and stale flag
 */
export function calculateConfidence(input: RiskInput, weatherStale?: boolean): ConfidenceResult {
  let confidence = 95;
  const factors: ConfidenceFactor[] = [];

  // Deviation penalties (5 pts each)
  const tempDev = Math.abs(input.temperature - input.climateNormal.avgTemp);
  if (tempDev > 15) {
    confidence -= 5;
    factors.push({
      name: 'temperatureDeviation',
      penalty: -5,
      description: `Desviación extrema de temperatura: ${tempDev.toFixed(1)}°C respecto a la normal climática.`,
    });
  }

  const windDev = Math.abs(input.windSpeed - input.climateNormal.avgWind);
  if (windDev > 25) {
    confidence -= 5;
    factors.push({
      name: 'windDeviation',
      penalty: -5,
      description: `Desviación extrema de viento: ${windDev.toFixed(1)} km/h respecto a la normal climática.`,
    });
  }

  const humDev = Math.abs(input.relativeHumidity - input.climateNormal.avgHumidity);
  if (humDev > 40) {
    confidence -= 5;
    factors.push({
      name: 'humidityDeviation',
      penalty: -5,
      description: `Desviación extrema de humedad: ${humDev.toFixed(1)}% respecto a la normal climática.`,
    });
  }

  // No recent hotspots penalty (3 pts)
  if (input.recentHotspotsCount === 0) {
    confidence -= 3;
    factors.push({
      name: 'noRecentHotspots',
      penalty: -3,
      description: 'Sin focos de calor recientes detectados por satélite para corroborar el riesgo.',
    });
  }

  // Weather stale penalty (10 pts) — from Requirement 2.3
  if (weatherStale) {
    confidence -= 10;
    factors.push({
      name: 'weatherStale',
      penalty: -10,
      description: 'Datos meteorológicos desactualizados; se utilizó caché o fallback.',
    });
  }

  // Clamp to [50, 100]
  const confidenceScore = Math.min(100, Math.max(50, confidence));

  return {
    confidenceScore,
    factors,
    weatherStale: weatherStale ?? false,
  };
}
