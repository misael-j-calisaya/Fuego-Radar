/**
 * CSV Normalizer for NASA FIRMS hotspot data.
 * Parses raw CSV, extracts relevant fields, converts textual confidence to numeric,
 * and produces normalized hotspot objects with ISO dates.
 *
 * Requirements: 1.3, 1.4
 */

import { randomUUID } from 'node:crypto';
import type { Satellite } from '../shared/types.js';

// ============================================
// Types
// ============================================

/** Normalized hotspot intermediate type (before geocoding/DynamoDB keys) */
export interface NormalizedHotspot {
  id: string;
  lat: number;
  lng: number;
  brightness: number;
  confidence: number;
  date: string;
  satellite: Satellite;
}

/** Result of the CSV normalization process */
export interface NormalizationResult {
  hotspots: NormalizedHotspot[];
  rawEntries: number;
  discarded: number;
  discardReasons: Array<{ row: number; reason: string }>;
}

// ============================================
// Constants
// ============================================

/** Textual confidence to numeric mapping */
const CONFIDENCE_TEXT_MAP: Record<string, number> = {
  high: 95,
  nominal: 70,
  low: 30,
};

/** Satellite code mapping from FIRMS CSV values */
const SATELLITE_MAP: Record<string, Satellite> = {
  N: 'VIIRS',
  '1': 'MODIS',
  T: 'MODIS',
};

// ============================================
// Helpers
// ============================================

/**
 * Converts textual or numeric confidence to a numeric value [0-100].
 * Returns null if unparseable.
 */
function parseConfidence(value: string): number | null {
  const trimmed = value.trim().toLowerCase();

  // Check textual mapping first
  if (trimmed in CONFIDENCE_TEXT_MAP) {
    return CONFIDENCE_TEXT_MAP[trimmed];
  }

  // Try numeric parse
  const num = parseInt(trimmed, 10);
  if (isNaN(num)) {
    return null;
  }

  // Clamp to [0, 100]
  return Math.max(0, Math.min(100, num));
}

/**
 * Combines acq_date (YYYY-MM-DD) and acq_time (HHMM) into an ISO timestamp.
 * Returns null if the resulting date is invalid.
 */
function parseDateTime(acqDate: string, acqTime: string): string | null {
  const dateTrimmed = acqDate.trim();
  const timeTrimmed = acqTime.trim().padStart(4, '0');

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateTrimmed)) {
    return null;
  }

  // Validate time format
  if (!/^\d{4}$/.test(timeTrimmed)) {
    return null;
  }

  const hours = timeTrimmed.slice(0, 2);
  const minutes = timeTrimmed.slice(2, 4);

  const isoString = `${dateTrimmed}T${hours}:${minutes}:00.000Z`;

  // Validate that this produces a real date
  const parsed = new Date(isoString);
  if (isNaN(parsed.getTime())) {
    return null;
  }

  return isoString;
}

/**
 * Maps satellite code to Satellite type.
 * Defaults to 'VIIRS' for unrecognized codes.
 */
function parseSatellite(code: string): Satellite {
  const trimmed = code.trim();
  return SATELLITE_MAP[trimmed] ?? 'VIIRS';
}

// ============================================
// Main Normalizer
// ============================================

/**
 * Normalizes raw NASA FIRMS CSV data into structured hotspot objects.
 *
 * @param csvData - Raw CSV string from FIRMS API
 * @returns NormalizationResult with normalized hotspots and discard metadata
 */
export function normalizeCsv(csvData: string): NormalizationResult {
  const result: NormalizationResult = {
    hotspots: [],
    rawEntries: 0,
    discarded: 0,
    discardReasons: [],
  };

  const lines = csvData.trim().split('\n');

  // Need at least a header row
  if (lines.length < 1) {
    return result;
  }

  const headerLine = lines[0];
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());

  // Find column indices
  const colIdx = {
    latitude: headers.indexOf('latitude'),
    longitude: headers.indexOf('longitude'),
    bright_ti4: headers.indexOf('bright_ti4'),
    acq_date: headers.indexOf('acq_date'),
    acq_time: headers.indexOf('acq_time'),
    satellite: headers.indexOf('satellite'),
    confidence: headers.indexOf('confidence'),
  };

  // Data rows start at index 1
  const dataLines = lines.slice(1).filter((line) => line.trim().length > 0);
  result.rawEntries = dataLines.length;

  for (let i = 0; i < dataLines.length; i++) {
    const rowNumber = i + 2; // 1-based, accounting for header
    const fields = dataLines[i].split(',');

    // --- latitude ---
    const latRaw = colIdx.latitude >= 0 ? fields[colIdx.latitude] : undefined;
    if (latRaw === undefined || latRaw.trim() === '') {
      result.discarded++;
      result.discardReasons.push({ row: rowNumber, reason: 'Missing latitude field' });
      continue;
    }
    const lat = parseFloat(latRaw);
    if (isNaN(lat)) {
      result.discarded++;
      result.discardReasons.push({ row: rowNumber, reason: 'Invalid latitude (NaN)' });
      continue;
    }

    // --- longitude ---
    const lngRaw = colIdx.longitude >= 0 ? fields[colIdx.longitude] : undefined;
    if (lngRaw === undefined || lngRaw.trim() === '') {
      result.discarded++;
      result.discardReasons.push({ row: rowNumber, reason: 'Missing longitude field' });
      continue;
    }
    const lng = parseFloat(lngRaw);
    if (isNaN(lng)) {
      result.discarded++;
      result.discardReasons.push({ row: rowNumber, reason: 'Invalid longitude (NaN)' });
      continue;
    }

    // --- bright_ti4 ---
    const brightnessRaw = colIdx.bright_ti4 >= 0 ? fields[colIdx.bright_ti4] : undefined;
    if (brightnessRaw === undefined || brightnessRaw.trim() === '') {
      result.discarded++;
      result.discardReasons.push({ row: rowNumber, reason: 'Missing bright_ti4 field' });
      continue;
    }
    const brightness = parseFloat(brightnessRaw);
    if (isNaN(brightness) || brightness <= 0) {
      result.discarded++;
      result.discardReasons.push({ row: rowNumber, reason: 'Invalid bright_ti4 (NaN or <= 0)' });
      continue;
    }

    // --- acq_date + acq_time ---
    const dateRaw = colIdx.acq_date >= 0 ? fields[colIdx.acq_date] : undefined;
    const timeRaw = colIdx.acq_time >= 0 ? fields[colIdx.acq_time] : undefined;
    if (dateRaw === undefined || timeRaw === undefined) {
      result.discarded++;
      result.discardReasons.push({ row: rowNumber, reason: 'Missing acq_date or acq_time field' });
      continue;
    }
    const isoDate = parseDateTime(dateRaw, timeRaw);
    if (isoDate === null) {
      result.discarded++;
      result.discardReasons.push({ row: rowNumber, reason: 'Invalid date/time format' });
      continue;
    }

    // --- satellite ---
    const satRaw = colIdx.satellite >= 0 ? fields[colIdx.satellite] : '';
    const satellite = parseSatellite(satRaw ?? '');

    // --- confidence ---
    const confRaw = colIdx.confidence >= 0 ? fields[colIdx.confidence] : undefined;
    if (confRaw === undefined || confRaw.trim() === '') {
      result.discarded++;
      result.discardReasons.push({ row: rowNumber, reason: 'Missing confidence field' });
      continue;
    }
    const confidence = parseConfidence(confRaw);
    if (confidence === null) {
      result.discarded++;
      result.discardReasons.push({ row: rowNumber, reason: 'Unparseable confidence value' });
      continue;
    }

    // All validations passed — create normalized hotspot
    result.hotspots.push({
      id: randomUUID(),
      lat,
      lng,
      brightness,
      confidence,
      date: isoDate,
      satellite,
    });
  }

  return result;
}
