/**
 * Fire Area Estimation (Task 2.11)
 *
 * Estimates the affected fire area in hectares based on satellite
 * brightness, wind speed, FWI, nearby hotspot count, and confidence.
 *
 * Formula (from design spec):
 *   base = (brightness - 300) × 2.2 + windSpeed × 1.8 + fwi × 0.8
 *   nearby_bonus = nearbyHotspots × 5.0
 *   confidence_factor = confidence / 100  (scales result by detection confidence)
 *   area = max(1, round((base + nearby_bonus) × confidence_factor))
 *
 * Clamped to [1, 10000] hectares for realistic bounds.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
 */

// ============================================
// Types
// ============================================

export interface AreaEstimationInput {
  /** Brightness temperature from satellite (Kelvin-like units, typically 290-500) */
  brightness: number;
  /** Wind speed in km/h (≥ 0) */
  windSpeed: number;
  /** Fire Weather Index (0-100) */
  fwi: number;
  /** Number of nearby hotspots within clustering radius (≥ 0) */
  nearbyHotspots: number;
  /** Detection confidence (0-100, from FIRMS satellite) */
  confidence: number;
}

export interface AreaEstimationResult {
  /** Estimated fire area in hectares (always ≥ 1) */
  areaHectares: number;
  /** Breakdown of contributing factors */
  factors: {
    brightnessContribution: number;
    windContribution: number;
    fwiContribution: number;
    nearbyContribution: number;
    confidenceFactor: number;
  };
}

// ============================================
// Constants
// ============================================

/** Minimum output area (hectares) */
const MIN_AREA_HECTARES = 1;

/** Maximum output area (hectares) — realistic upper bound */
const MAX_AREA_HECTARES = 10_000;

/** Brightness baseline (below this, brightness contributes 0) */
const BRIGHTNESS_BASELINE = 300;

/** Weight for brightness above baseline */
const BRIGHTNESS_WEIGHT = 2.2;

/** Weight for wind speed contribution */
const WIND_WEIGHT = 1.8;

/** Weight for FWI contribution */
const FWI_WEIGHT = 0.8;

/** Contribution per nearby hotspot */
const NEARBY_HOTSPOT_WEIGHT = 5.0;

// ============================================
// Estimation Function
// ============================================

/**
 * Estimates fire area in hectares.
 * Deterministic: same inputs always produce same output.
 *
 * @param input - Satellite and meteorological parameters
 * @returns Estimated area clamped to [1, 10000] hectares with factor breakdown
 */
export function estimateFireArea(input: AreaEstimationInput): AreaEstimationResult {
  const { brightness, windSpeed, fwi, nearbyHotspots, confidence } = input;

  // Compute individual contributions
  const brightnessContribution = Math.max(0, (brightness - BRIGHTNESS_BASELINE) * BRIGHTNESS_WEIGHT);
  const windContribution = Math.max(0, windSpeed * WIND_WEIGHT);
  const fwiContribution = Math.max(0, fwi * FWI_WEIGHT);
  const nearbyContribution = Math.max(0, nearbyHotspots * NEARBY_HOTSPOT_WEIGHT);

  // Confidence factor scales the total (0-100 → 0.0-1.0)
  const confidenceFactor = Math.max(0, Math.min(100, confidence)) / 100;

  // Base area before confidence scaling
  const baseArea = brightnessContribution + windContribution + fwiContribution + nearbyContribution;

  // Apply confidence factor
  const rawArea = baseArea * confidenceFactor;

  // Clamp to [MIN, MAX] and round to integer
  const clampedArea = Math.min(MAX_AREA_HECTARES, Math.max(MIN_AREA_HECTARES, Math.round(rawArea)));

  return {
    areaHectares: clampedArea,
    factors: {
      brightnessContribution: Math.round(brightnessContribution * 100) / 100,
      windContribution: Math.round(windContribution * 100) / 100,
      fwiContribution: Math.round(fwiContribution * 100) / 100,
      nearbyContribution: Math.round(nearbyContribution * 100) / 100,
      confidenceFactor: Math.round(confidenceFactor * 100) / 100,
    },
  };
}
