/**
 * Unit tests for the Hotspot Deduplication Service.
 * Tests cover: empty input, no duplicates, duplicate detection,
 * different satellite exclusion, time threshold, merge logic,
 * invalid timestamps, and mixed scenarios.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectDuplicates } from '../services/deduplicator.js';
import type { NormalizedHotspot } from '../services/csvNormalizer.js';

// ============================================
// Test Helpers
// ============================================

function makeHotspot(overrides: Partial<NormalizedHotspot> = {}): NormalizedHotspot {
  return {
    id: 'test-' + Math.random().toString(36).slice(2, 8),
    lat: -34.6,
    lng: -58.4,
    brightness: 320,
    confidence: 80,
    date: '2024-01-15T12:00:00Z',
    satellite: 'VIIRS',
    ...overrides,
  };
}

// ============================================
// Tests
// ============================================

describe('detectDuplicates', () => {
  it('returns empty result for empty input (Req 7.5)', () => {
    const result = detectDuplicates([]);

    assert.deepEqual(result, {
      hotspots: [],
      inputCount: 0,
      outputCount: 0,
      discardedCount: 0,
      duplicateCount: 0,
      discardReasons: [],
    });
  });

  it('keeps all hotspots when no duplicates exist', () => {
    const hotspots: NormalizedHotspot[] = [
      makeHotspot({ id: 'h1', lat: -34.0, lng: -58.0, date: '2024-01-15T10:00:00Z' }),
      makeHotspot({ id: 'h2', lat: -35.0, lng: -59.0, date: '2024-01-15T10:00:00Z' }),
      makeHotspot({ id: 'h3', lat: -36.0, lng: -60.0, date: '2024-01-15T10:00:00Z' }),
    ];

    const result = detectDuplicates(hotspots);

    assert.equal(result.outputCount, 3);
    assert.equal(result.duplicateCount, 0);
    assert.equal(result.discardedCount, 0);
  });

  it('detects duplicate by distance/time/satellite (Req 7.1)', () => {
    const hotspots: NormalizedHotspot[] = [
      makeHotspot({ id: 'h1', lat: -34.600, lng: -58.400, date: '2024-01-15T12:00:00Z', satellite: 'VIIRS', confidence: 80 }),
      makeHotspot({ id: 'h2', lat: -34.605, lng: -58.405, date: '2024-01-15T12:10:00Z', satellite: 'VIIRS', confidence: 90 }),
    ];
    // Distance: sqrt((0.005)^2 + (0.005)^2) ≈ 0.00707 < 0.015
    // Time diff: 10 min < 30 min
    // Same satellite

    const result = detectDuplicates(hotspots);

    assert.equal(result.outputCount, 1);
    assert.equal(result.duplicateCount, 1);
    // Should keep the one with higher confidence (h2, confidence 90)
    assert.equal(result.hotspots[0].id, 'h2');
  });

  it('does not consider duplicates with different satellite', () => {
    const hotspots: NormalizedHotspot[] = [
      makeHotspot({ id: 'h1', lat: -34.600, lng: -58.400, date: '2024-01-15T12:00:00Z', satellite: 'VIIRS' }),
      makeHotspot({ id: 'h2', lat: -34.605, lng: -58.405, date: '2024-01-15T12:10:00Z', satellite: 'MODIS' }),
    ];

    const result = detectDuplicates(hotspots);

    assert.equal(result.outputCount, 2);
    assert.equal(result.duplicateCount, 0);
  });

  it('does not consider duplicates when time > 30 min apart', () => {
    const hotspots: NormalizedHotspot[] = [
      makeHotspot({ id: 'h1', lat: -34.600, lng: -58.400, date: '2024-01-15T12:00:00Z', satellite: 'VIIRS' }),
      makeHotspot({ id: 'h2', lat: -34.605, lng: -58.405, date: '2024-01-15T12:31:00Z', satellite: 'VIIRS' }),
    ];

    const result = detectDuplicates(hotspots);

    assert.equal(result.outputCount, 2);
    assert.equal(result.duplicateCount, 0);
  });

  it('retains highest confidence on duplicate (Req 7.2)', () => {
    const hotspots: NormalizedHotspot[] = [
      makeHotspot({ id: 'h1', lat: -34.600, lng: -58.400, date: '2024-01-15T12:00:00Z', confidence: 60, brightness: 300 }),
      makeHotspot({ id: 'h2', lat: -34.601, lng: -58.401, date: '2024-01-15T12:05:00Z', confidence: 95, brightness: 280 }),
    ];

    const result = detectDuplicates(hotspots);

    assert.equal(result.outputCount, 1);
    assert.equal(result.hotspots[0].id, 'h2');
    assert.equal(result.hotspots[0].confidence, 95);
  });

  it('retains highest brightness on confidence tie (Req 7.2)', () => {
    const hotspots: NormalizedHotspot[] = [
      makeHotspot({ id: 'h1', lat: -34.600, lng: -58.400, date: '2024-01-15T12:00:00Z', confidence: 80, brightness: 300 }),
      makeHotspot({ id: 'h2', lat: -34.601, lng: -58.401, date: '2024-01-15T12:05:00Z', confidence: 80, brightness: 350 }),
    ];

    const result = detectDuplicates(hotspots);

    assert.equal(result.outputCount, 1);
    assert.equal(result.hotspots[0].id, 'h2');
    assert.equal(result.hotspots[0].brightness, 350);
  });

  it('retains first processed on both tie (Req 7.2)', () => {
    const hotspots: NormalizedHotspot[] = [
      makeHotspot({ id: 'h1', lat: -34.600, lng: -58.400, date: '2024-01-15T12:00:00Z', confidence: 80, brightness: 300 }),
      makeHotspot({ id: 'h2', lat: -34.601, lng: -58.401, date: '2024-01-15T12:05:00Z', confidence: 80, brightness: 300 }),
    ];

    const result = detectDuplicates(hotspots);

    assert.equal(result.outputCount, 1);
    assert.equal(result.hotspots[0].id, 'h1');
  });

  it('discards hotspot with invalid timestamp (Req 7.6)', () => {
    const hotspots: NormalizedHotspot[] = [
      makeHotspot({ id: 'h1', date: 'not-a-date' }),
      makeHotspot({ id: 'h2', date: '2024-01-15T12:00:00Z' }),
    ];

    const result = detectDuplicates(hotspots);

    assert.equal(result.outputCount, 1);
    assert.equal(result.discardedCount, 1);
    assert.equal(result.discardReasons[0].id, 'h1');
    assert.equal(result.discardReasons[0].reason, 'Invalid or unparseable timestamp');
    assert.equal(result.hotspots[0].id, 'h2');
  });

  it('handles mixed scenario: valid, duplicates, and invalid', () => {
    const hotspots: NormalizedHotspot[] = [
      // Valid, unique
      makeHotspot({ id: 'h1', lat: -34.000, lng: -58.000, date: '2024-01-15T10:00:00Z', satellite: 'VIIRS', confidence: 80 }),
      // Duplicate of h1 (close, same satellite, within 30min), higher confidence → replaces h1
      makeHotspot({ id: 'h2', lat: -34.005, lng: -58.005, date: '2024-01-15T10:10:00Z', satellite: 'VIIRS', confidence: 95 }),
      // Valid, different location (far from others)
      makeHotspot({ id: 'h3', lat: -40.000, lng: -65.000, date: '2024-01-15T10:00:00Z', satellite: 'MODIS', confidence: 70 }),
      // Invalid timestamp → discarded
      makeHotspot({ id: 'h4', lat: -35.000, lng: -59.000, date: 'invalid-date' }),
      // Valid, close to h1/h2 but different satellite → not duplicate
      makeHotspot({ id: 'h5', lat: -34.001, lng: -58.001, date: '2024-01-15T10:05:00Z', satellite: 'MODIS', confidence: 60 }),
    ];

    const result = detectDuplicates(hotspots);

    assert.equal(result.inputCount, 5);
    assert.equal(result.discardedCount, 1);
    assert.equal(result.duplicateCount, 1);
    assert.equal(result.outputCount, 3);
    // Requirement 7.3: output ≤ input
    assert(result.outputCount <= result.inputCount);

    // Check the kept hotspots
    const keptIds = result.hotspots.map((h) => h.id);
    assert(keptIds.includes('h2'), 'h2 should be kept (higher confidence than h1)');
    assert(keptIds.includes('h3'), 'h3 should be kept (unique location)');
    assert(keptIds.includes('h5'), 'h5 should be kept (different satellite)');
    assert(!keptIds.includes('h1'), 'h1 should be removed (replaced by h2)');
    assert(!keptIds.includes('h4'), 'h4 should be discarded (invalid timestamp)');
  });

  it('output count is always ≤ input count (Req 7.3)', () => {
    const hotspots: NormalizedHotspot[] = [
      makeHotspot({ id: 'h1' }),
      makeHotspot({ id: 'h2' }),
      makeHotspot({ id: 'h3' }),
    ];

    const result = detectDuplicates(hotspots);

    assert(result.outputCount <= result.inputCount);
  });
});
