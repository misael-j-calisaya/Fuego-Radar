/**
 * Hotspot Deduplication Service.
 * Detects and removes duplicate hotspot detections based on spatial proximity,
 * temporal proximity, and satellite source. Handles invalid timestamps gracefully.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 1.7
 */

import type { NormalizedHotspot } from './csvNormalizer.js';
import {
  DEDUP_SPATIAL_THRESHOLD_DEG,
  DEDUP_TEMPORAL_THRESHOLD_MS,
} from '../shared/constants.js';

// ============================================
// Types
// ============================================

/** Result of the deduplication process */
export interface DeduplicationResult {
  hotspots: NormalizedHotspot[];
  inputCount: number;
  outputCount: number;
  discardedCount: number;
  duplicateCount: number;
  discardReasons: Array<{ id: string; reason: string }>;
}

// ============================================
// Implementation
// ============================================

/**
 * Calculates Euclidean distance in degrees between two coordinate pairs.
 */
function euclideanDistanceDeg(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  return Math.sqrt((lat1 - lat2) ** 2 + (lng1 - lng2) ** 2);
}

/**
 * Validates whether a date string is parseable to a valid timestamp.
 * Returns the epoch ms if valid, or NaN if invalid.
 */
function parseTimestamp(dateStr: string): number {
  const ts = new Date(dateStr).getTime();
  return ts;
}

/**
 * Detects and removes duplicate hotspots from a list.
 *
 * Algorithm:
 * 1. Filter out hotspots with invalid/unparseable timestamps → tracked as discarded
 * 2. For each valid hotspot, compare against a "clean" list of accepted hotspots
 * 3. If a match is found (dist ≤ 0.015° AND timeDiff ≤ 30min AND same satellite),
 *    merge by keeping the better one (highest confidence → highest brightness → first processed)
 * 4. Otherwise, add to the clean list
 *
 * @param hotspots - Array of normalized hotspots to deduplicate
 * @returns DeduplicationResult with deduplicated hotspots and metadata
 */
export function detectDuplicates(hotspots: NormalizedHotspot[]): DeduplicationResult {
  const inputCount = hotspots.length;

  // Requirement 7.5: empty input → empty result
  if (inputCount === 0) {
    return {
      hotspots: [],
      inputCount: 0,
      outputCount: 0,
      discardedCount: 0,
      duplicateCount: 0,
      discardReasons: [],
    };
  }

  const discardReasons: Array<{ id: string; reason: string }> = [];
  const validHotspots: Array<{ hotspot: NormalizedHotspot; timestamp: number }> = [];

  // Step 1: Separate valid from invalid timestamps (Requirement 7.6)
  for (const h of hotspots) {
    const ts = parseTimestamp(h.date);
    if (isNaN(ts)) {
      discardReasons.push({ id: h.id, reason: 'Invalid or unparseable timestamp' });
    } else {
      validHotspots.push({ hotspot: h, timestamp: ts });
    }
  }

  // Step 2: Deduplicate valid hotspots
  const clean: Array<{ hotspot: NormalizedHotspot; timestamp: number }> = [];

  for (const candidate of validHotspots) {
    let isDuplicate = false;

    for (let i = 0; i < clean.length; i++) {
      const existing = clean[i];

      // Check all three duplication conditions (Requirement 7.1)
      const dist = euclideanDistanceDeg(
        candidate.hotspot.lat,
        candidate.hotspot.lng,
        existing.hotspot.lat,
        existing.hotspot.lng,
      );

      if (dist > DEDUP_SPATIAL_THRESHOLD_DEG) continue;

      const timeDiff = Math.abs(candidate.timestamp - existing.timestamp);
      if (timeDiff > DEDUP_TEMPORAL_THRESHOLD_MS) continue;

      if (candidate.hotspot.satellite !== existing.hotspot.satellite) continue;

      // All three conditions met → duplicate found
      isDuplicate = true;

      // Merge logic (Requirement 7.2): keep the better one
      if (candidate.hotspot.confidence > existing.hotspot.confidence) {
        // Candidate has higher confidence → replace existing
        clean[i] = candidate;
      } else if (candidate.hotspot.confidence === existing.hotspot.confidence) {
        // Tie on confidence → check brightness
        if (candidate.hotspot.brightness > existing.hotspot.brightness) {
          clean[i] = candidate;
        }
        // On both tie, keep existing (first processed)
      }
      // Else: existing has higher confidence → keep existing

      break;
    }

    if (!isDuplicate) {
      clean.push(candidate);
    }
  }

  const discardedCount = discardReasons.length;
  const duplicateCount = validHotspots.length - clean.length;
  const outputHotspots = clean.map((entry) => entry.hotspot);

  return {
    hotspots: outputHotspots,
    inputCount,
    outputCount: outputHotspots.length,
    discardedCount,
    duplicateCount,
    discardReasons,
  };
}
