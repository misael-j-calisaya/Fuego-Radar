/**
 * Hardened Fire Weather Index (FWI) calculator.
 * Extracted from riskEngine.ts with input validation and structured results.
 *
 * Formula: FWI = (temperature × 1.0) + ((100 - humidity) × 0.5) + (windSpeed × 0.4)
 * Result clamped to [0, 100] via min(100, max(0, round(rawFWI)))
 */

import type { WeatherData, DangerLevel } from '../shared/types.js';
import { VALIDATION_RANGES } from '../shared/constants.js';

// ============================================
// Types
// ============================================

export interface FWIResult {
  fwiScore: number;          // [0, 100]
  dangerLevel: DangerLevel;  // 'Bajo' | 'Medio' | 'Alto' | 'Muy Alto' | 'Extremo'
  explanation: string;       // Human-readable description
}

export interface FWIValidationError {
  field: string;
  value: number;
  message: string;
}

export type FWICalculationResult =
  | { success: true; result: FWIResult }
  | { success: false; errors: FWIValidationError[] };

// ============================================
// Danger Level Explanations
// ============================================

const DANGER_EXPLANATIONS: Record<DangerLevel, string> = {
  'Bajo': 'Condiciones meteorológicas de bajo riesgo de incendio.',
  'Medio': 'Condiciones meteorológicas de riesgo moderado de incendio.',
  'Alto': 'Condiciones meteorológicas de alto riesgo de incendio.',
  'Muy Alto': 'Condiciones meteorológicas de riesgo muy alto de incendio.',
  'Extremo': 'Condiciones meteorológicas extremas de riesgo de incendio.',
};

// ============================================
// Core Functions
// ============================================

/**
 * Raw FWI calculation without input validation.
 * Useful for property-based tests and internal use where inputs are pre-validated.
 *
 * @param temperature - Temperature in °C
 * @param humidity - Relative humidity in %
 * @param windSpeed - Wind speed in km/h
 * @returns FWI score clamped to [0, 100]
 */
export function calculateFWIUnsafe(temperature: number, humidity: number, windSpeed: number): number {
  const tempFactor = temperature * 1.0;
  const humidityFactor = (100 - humidity) * 0.5;
  const windFactor = windSpeed * 0.4;
  const rawFWI = tempFactor + humidityFactor + windFactor;
  return Math.min(100, Math.max(0, Math.round(rawFWI)));
}

/**
 * Maps an FWI score to a danger level classification.
 *
 * Thresholds:
 *   score < 20  → 'Bajo'
 *   20 ≤ score < 40 → 'Medio'
 *   40 ≤ score < 60 → 'Alto'
 *   60 ≤ score < 80 → 'Muy Alto'
 *   score ≥ 80 → 'Extremo'
 */
export function getDangerLevel(fwi: number): DangerLevel {
  if (fwi < 20) return 'Bajo';
  if (fwi < 40) return 'Medio';
  if (fwi < 60) return 'Alto';
  if (fwi < 80) return 'Muy Alto';
  return 'Extremo';
}

/**
 * Validates meteorological inputs and calculates FWI with structured result.
 *
 * Input validation:
 *   - temperature ∈ [-20, 50]
 *   - relativeHumidity ∈ [0, 100]
 *   - windSpeed ≥ 0
 *
 * @param weather - WeatherData object with temperature, relativeHumidity, windSpeed
 * @returns Structured result with FWI score, danger level, and explanation; or validation errors
 */
export function calculateFWI(weather: WeatherData): FWICalculationResult {
  const errors = validateWeatherInputs(weather);

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const fwiScore = calculateFWIUnsafe(
    weather.temperature,
    weather.relativeHumidity,
    weather.windSpeed,
  );

  const dangerLevel = getDangerLevel(fwiScore);
  const explanation = DANGER_EXPLANATIONS[dangerLevel];

  return {
    success: true,
    result: { fwiScore, dangerLevel, explanation },
  };
}

// ============================================
// Validation Helpers
// ============================================

function validateWeatherInputs(weather: WeatherData): FWIValidationError[] {
  const errors: FWIValidationError[] = [];

  const { temperature, relativeHumidity, windSpeed } = weather;

  if (
    temperature < VALIDATION_RANGES.temperature.min ||
    temperature > VALIDATION_RANGES.temperature.max
  ) {
    errors.push({
      field: 'temperature',
      value: temperature,
      message: `Temperature must be between ${VALIDATION_RANGES.temperature.min} and ${VALIDATION_RANGES.temperature.max} °C, got ${temperature}`,
    });
  }

  if (
    relativeHumidity < VALIDATION_RANGES.relativeHumidity.min ||
    relativeHumidity > VALIDATION_RANGES.relativeHumidity.max
  ) {
    errors.push({
      field: 'relativeHumidity',
      value: relativeHumidity,
      message: `Relative humidity must be between ${VALIDATION_RANGES.relativeHumidity.min} and ${VALIDATION_RANGES.relativeHumidity.max} %, got ${relativeHumidity}`,
    });
  }

  if (windSpeed < VALIDATION_RANGES.windSpeed.min) {
    errors.push({
      field: 'windSpeed',
      value: windSpeed,
      message: `Wind speed must be ≥ ${VALIDATION_RANGES.windSpeed.min} km/h, got ${windSpeed}`,
    });
  }

  return errors;
}
