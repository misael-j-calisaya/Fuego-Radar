/**
 * Validation rules for DynamoDB items before persistence.
 * Each validator checks fields and returns structured errors.
 *
 * Requirements: 9.7, 9.8
 */

import { PROVINCES_SET, VALIDATION_RANGES } from '../shared/constants.js';
import type { HotspotItem, RiskScoreItem, AlertItem, IngestionMetaItem } from '../shared/types.js';

// ============================================
// Validation Types
// ============================================

/** Describes a single validation failure */
export interface ValidationError {
  field: string;
  value: unknown;
  message: string;
}

/** Result of a validation check */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ============================================
// Individual Field Validators
// ============================================

function validateRiskScore(value: unknown, field = 'riskScore'): ValidationError | null {
  if (typeof value !== 'number' || value < VALIDATION_RANGES.riskScore.min || value > VALIDATION_RANGES.riskScore.max) {
    return { field, value, message: `${field} must be a number in [${VALIDATION_RANGES.riskScore.min}, ${VALIDATION_RANGES.riskScore.max}]` };
  }
  return null;
}

function validateConfidenceScore(value: unknown, field = 'confidenceScore'): ValidationError | null {
  if (typeof value !== 'number' || value < VALIDATION_RANGES.confidenceScore.min || value > VALIDATION_RANGES.confidenceScore.max) {
    return { field, value, message: `${field} must be a number in [${VALIDATION_RANGES.confidenceScore.min}, ${VALIDATION_RANGES.confidenceScore.max}]` };
  }
  return null;
}

function validateTTL(value: unknown, field = 'TTL'): ValidationError | null {
  const now = Math.floor(Date.now() / 1000);
  if (typeof value !== 'number' || value <= now) {
    return { field, value, message: `${field} must be a future Unix timestamp (> ${now})` };
  }
  return null;
}

function validateProvince(value: unknown, field = 'province'): ValidationError | null {
  if (typeof value !== 'string' || !PROVINCES_SET.has(value)) {
    return { field, value, message: `${field} must be one of the 24 valid Argentine provinces` };
  }
  return null;
}

function validateLatitude(value: unknown, field = 'lat'): ValidationError | null {
  if (typeof value !== 'number' || value < VALIDATION_RANGES.latitude.min || value > VALIDATION_RANGES.latitude.max) {
    return { field, value, message: `${field} must be a number in [${VALIDATION_RANGES.latitude.min}, ${VALIDATION_RANGES.latitude.max}]` };
  }
  return null;
}

function validateLongitude(value: unknown, field = 'lng'): ValidationError | null {
  if (typeof value !== 'number' || value < VALIDATION_RANGES.longitude.min || value > VALIDATION_RANGES.longitude.max) {
    return { field, value, message: `${field} must be a number in [${VALIDATION_RANGES.longitude.min}, ${VALIDATION_RANGES.longitude.max}]` };
  }
  return null;
}

// ============================================
// Entity-Level Validators
// ============================================

/** Validate a HotspotItem before writing to DynamoDB */
export function validateHotspot(item: HotspotItem): ValidationResult {
  const errors: ValidationError[] = [];

  const latErr = validateLatitude(item.lat);
  if (latErr) errors.push(latErr);

  const lngErr = validateLongitude(item.lng);
  if (lngErr) errors.push(lngErr);

  const provErr = validateProvince(item.province);
  if (provErr) errors.push(provErr);

  const ttlErr = validateTTL(item.TTL);
  if (ttlErr) errors.push(ttlErr);

  return { valid: errors.length === 0, errors };
}

/** Validate a RiskScoreItem before writing to DynamoDB */
export function validateRiskScoreItem(item: RiskScoreItem): ValidationResult {
  const errors: ValidationError[] = [];

  const scoreErr = validateRiskScore(item.riskScore);
  if (scoreErr) errors.push(scoreErr);

  const confErr = validateConfidenceScore(item.confidenceScore);
  if (confErr) errors.push(confErr);

  return { valid: errors.length === 0, errors };
}

/** Validate an AlertItem before writing to DynamoDB */
export function validateAlert(item: AlertItem): ValidationResult {
  const errors: ValidationError[] = [];

  const latErr = validateLatitude(item.coordinates?.lat, 'coordinates.lat');
  if (latErr) errors.push(latErr);

  const lngErr = validateLongitude(item.coordinates?.lng, 'coordinates.lng');
  if (lngErr) errors.push(lngErr);

  const ttlErr = validateTTL(item.TTL);
  if (ttlErr) errors.push(ttlErr);

  return { valid: errors.length === 0, errors };
}

/** Validate an IngestionMetaItem before writing to DynamoDB */
export function validateIngestionMeta(item: IngestionMetaItem): ValidationResult {
  const errors: ValidationError[] = [];

  const ttlErr = validateTTL(item.TTL);
  if (ttlErr) errors.push(ttlErr);

  return { valid: errors.length === 0, errors };
}
