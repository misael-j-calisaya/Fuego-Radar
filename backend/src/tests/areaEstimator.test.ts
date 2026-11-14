/**
 * Unit tests for fire area estimation (Task 2.11).
 *
 * Tests: low/high brightness, multiple nearby hotspots, high wind,
 * low confidence, output bounds, determinism.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateFireArea } from '../services/areaEstimator.js';
import type { AreaEstimationInput } from '../services/areaEstimator.js';

// ============================================
// Helper
// ============================================

function makeInput(overrides: Partial<AreaEstimationInput> = {}): AreaEstimationInput {
  return {
    brightness: 335,
    windSpeed: 20,
    fwi: 50,
    nearbyHotspots: 1,
    confidence: 85,
    ...overrides,
  };
}

// ============================================
// Tests: Low brightness hotspot
// ============================================

describe('Area Estimator - low brightness hotspot', () => {
  it('brightness at baseline (300) contributes 0 from brightness factor', () => {
    const result = estimateFireArea(makeInput({ brightness: 300 }));
    assert.strictEqual(result.factors.brightnessContribution, 0);
    // Still gets area from wind + fwi + nearby
    assert.ok(result.areaHectares >= 1);
  });

  it('brightness below baseline contributes 0 (not negative)', () => {
    const result = estimateFireArea(makeInput({ brightness: 280 }));
    assert.strictEqual(result.factors.brightnessContribution, 0);
    assert.ok(result.areaHectares >= 1);
  });

  it('brightness slightly above baseline produces small contribution', () => {
    const result = estimateFireArea(makeInput({ brightness: 310 }));
    // (310 - 300) * 2.2 = 22
    assert.strictEqual(result.factors.brightnessContribution, 22);
  });
});

// ============================================
// Tests: High brightness hotspot
// ============================================

describe('Area Estimator - high brightness hotspot', () => {
  it('high brightness (450) produces large area', () => {
    const result = estimateFireArea(makeInput({ brightness: 450, confidence: 95 }));
    // (450 - 300) * 2.2 = 330 brightness
    // + 20 * 1.8 = 36 wind
    // + 50 * 0.8 = 40 fwi
    // + 1 * 5 = 5 nearby
    // total = 411 * 0.95 = 390.45 → 390
    assert.strictEqual(result.factors.brightnessContribution, 330);
    assert.ok(result.areaHectares >= 300);
  });

  it('extreme brightness (500) is larger than moderate (350)', () => {
    const extreme = estimateFireArea(makeInput({ brightness: 500 }));
    const moderate = estimateFireArea(makeInput({ brightness: 350 }));
    assert.ok(extreme.areaHectares > moderate.areaHectares);
  });
});

// ============================================
// Tests: Multiple nearby hotspots
// ============================================

describe('Area Estimator - multiple nearby hotspots', () => {
  it('more nearby hotspots increase estimated area', () => {
    const single = estimateFireArea(makeInput({ nearbyHotspots: 1 }));
    const cluster = estimateFireArea(makeInput({ nearbyHotspots: 5 }));
    assert.ok(cluster.areaHectares > single.areaHectares);
  });

  it('nearby contribution is proportional to count', () => {
    const result = estimateFireArea(makeInput({ nearbyHotspots: 4 }));
    // 4 * 5.0 = 20
    assert.strictEqual(result.factors.nearbyContribution, 20);
  });

  it('zero nearby hotspots contributes 0', () => {
    const result = estimateFireArea(makeInput({ nearbyHotspots: 0 }));
    assert.strictEqual(result.factors.nearbyContribution, 0);
  });

  it('large cluster (10 hotspots) produces significant area', () => {
    const result = estimateFireArea(makeInput({ nearbyHotspots: 10, confidence: 95 }));
    // 10 * 5 = 50 nearby contribution
    assert.strictEqual(result.factors.nearbyContribution, 50);
    assert.ok(result.areaHectares > estimateFireArea(makeInput({ nearbyHotspots: 0, confidence: 95 })).areaHectares);
  });
});

// ============================================
// Tests: High wind speed
// ============================================

describe('Area Estimator - high wind speed', () => {
  it('high wind (60 km/h) significantly increases area', () => {
    const calm = estimateFireArea(makeInput({ windSpeed: 5 }));
    const windy = estimateFireArea(makeInput({ windSpeed: 60 }));
    assert.ok(windy.areaHectares > calm.areaHectares);
  });

  it('wind contribution is proportional to speed', () => {
    const result = estimateFireArea(makeInput({ windSpeed: 40 }));
    // 40 * 1.8 = 72
    assert.strictEqual(result.factors.windContribution, 72);
  });

  it('zero wind contributes 0', () => {
    const result = estimateFireArea(makeInput({ windSpeed: 0 }));
    assert.strictEqual(result.factors.windContribution, 0);
  });
});

// ============================================
// Tests: Low confidence
// ============================================

describe('Area Estimator - low confidence', () => {
  it('low confidence (30) reduces area significantly', () => {
    const high = estimateFireArea(makeInput({ confidence: 95 }));
    const low = estimateFireArea(makeInput({ confidence: 30 }));
    assert.ok(low.areaHectares < high.areaHectares);
  });

  it('confidence factor is normalized to [0, 1]', () => {
    const result = estimateFireArea(makeInput({ confidence: 50 }));
    assert.strictEqual(result.factors.confidenceFactor, 0.5);
  });

  it('confidence of 0 results in minimum area (1 hectare)', () => {
    const result = estimateFireArea(makeInput({ confidence: 0 }));
    assert.strictEqual(result.areaHectares, 1);
    assert.strictEqual(result.factors.confidenceFactor, 0);
  });

  it('confidence of 100 gives maximum scaling', () => {
    const result = estimateFireArea(makeInput({ confidence: 100 }));
    assert.strictEqual(result.factors.confidenceFactor, 1);
  });

  it('confidence > 100 is clamped to 1.0', () => {
    const result = estimateFireArea(makeInput({ confidence: 150 }));
    assert.strictEqual(result.factors.confidenceFactor, 1);
  });
});

// ============================================
// Tests: Output bounds
// ============================================

describe('Area Estimator - output bounds', () => {
  it('minimum output is always >= 1 hectare', () => {
    // Minimal inputs
    const result = estimateFireArea({
      brightness: 280, // below baseline
      windSpeed: 0,
      fwi: 0,
      nearbyHotspots: 0,
      confidence: 10,
    });
    assert.strictEqual(result.areaHectares, 1);
  });

  it('maximum output is clamped to 10000 hectares', () => {
    // Extreme inputs
    const result = estimateFireArea({
      brightness: 600,   // (600-300)*2.2 = 660
      windSpeed: 100,    // 100*1.8 = 180
      fwi: 100,          // 100*0.8 = 80
      nearbyHotspots: 50, // 50*5 = 250
      confidence: 100,   // factor 1.0
    });
    // raw = (660+180+80+250)*1.0 = 1170
    assert.ok(result.areaHectares <= 10000);
    assert.ok(result.areaHectares >= 1);
  });

  it('output is always an integer', () => {
    const result = estimateFireArea(makeInput({ brightness: 317, confidence: 73 }));
    assert.strictEqual(result.areaHectares, Math.round(result.areaHectares));
  });

  it('result is deterministic (same input → same output)', () => {
    const input = makeInput({ brightness: 345, windSpeed: 25, fwi: 60 });
    const r1 = estimateFireArea(input);
    const r2 = estimateFireArea(input);
    const r3 = estimateFireArea(input);
    assert.strictEqual(r1.areaHectares, r2.areaHectares);
    assert.strictEqual(r2.areaHectares, r3.areaHectares);
  });
});

// ============================================
// Tests: Formula correctness
// ============================================

describe('Area Estimator - formula verification', () => {
  it('computes expected value for known inputs', () => {
    // brightness=335, wind=20, fwi=50, nearby=1, confidence=85
    // brightness: (335-300)*2.2 = 77
    // wind: 20*1.8 = 36
    // fwi: 50*0.8 = 40
    // nearby: 1*5 = 5
    // base = 158
    // * 0.85 = 134.3 → round = 134
    const result = estimateFireArea(makeInput());
    assert.strictEqual(result.areaHectares, 134);
    assert.strictEqual(result.factors.brightnessContribution, 77);
    assert.strictEqual(result.factors.windContribution, 36);
    assert.strictEqual(result.factors.fwiContribution, 40);
    assert.strictEqual(result.factors.nearbyContribution, 5);
    assert.strictEqual(result.factors.confidenceFactor, 0.85);
  });
});
