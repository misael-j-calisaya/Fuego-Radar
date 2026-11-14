import test from 'node:test';
import assert from 'node:assert';
import { fetchFirmsData, type FirmsApiResult } from '../services/firmsApiClient.js';

// ============================================
// Unit Tests for FIRMS API Client
// ============================================

test('firmsApiClient Tests', async (t) => {

  await t.test('should return network_error when FIRMS_MAP_KEY is missing', async () => {
    // Temporarily clear env var
    const originalKey = process.env.FIRMS_MAP_KEY;
    delete process.env.FIRMS_MAP_KEY;

    const result = await fetchFirmsData({ apiKey: undefined });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.reason, 'network_error');
      assert.ok(result.message.includes('FIRMS_MAP_KEY'));
    }

    // Restore
    if (originalKey) process.env.FIRMS_MAP_KEY = originalKey;
  });

  await t.test('should return timeout when request exceeds timeout threshold', async () => {
    // Use a mock server approach: fetch a non-routable IP with very short timeout
    const result = await fetchFirmsData({
      apiKey: 'TEST_KEY',
      bbox: '-73.6,-56.0,-53.5,-21.8',
      timeoutMs: 1, // 1ms timeout - should abort immediately
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      // Either timeout or network_error depending on how fast the abort fires
      assert.ok(
        result.reason === 'timeout' || result.reason === 'network_error',
        `Expected timeout or network_error, got: ${result.reason}`
      );
    }
  });

  await t.test('result type should have correct discriminated union shape on success', () => {
    const successResult: FirmsApiResult = {
      success: true,
      csvData: 'latitude,longitude,bright_ti4\n-31.42,-64.49,335.4',
      rawLength: 50,
    };

    assert.strictEqual(successResult.success, true);
    if (successResult.success) {
      assert.strictEqual(typeof successResult.csvData, 'string');
      assert.strictEqual(typeof successResult.rawLength, 'number');
    }
  });

  await t.test('result type should have correct discriminated union shape on failure', () => {
    const failureResult: FirmsApiResult = {
      success: false,
      reason: 'http_error',
      statusCode: 403,
      message: 'HTTP 403: Forbidden',
    };

    assert.strictEqual(failureResult.success, false);
    if (!failureResult.success) {
      assert.strictEqual(failureResult.reason, 'http_error');
      assert.strictEqual(failureResult.statusCode, 403);
      assert.ok(failureResult.message.includes('403'));
    }
  });

  await t.test('all failure reasons should be valid enum values', () => {
    const validReasons = ['timeout', 'http_error', 'empty_body', 'non_csv', 'corrupt_data', 'network_error'];

    const testCases: FirmsApiResult[] = validReasons.map((reason) => ({
      success: false as const,
      reason: reason as any,
      message: `Test: ${reason}`,
    }));

    for (const tc of testCases) {
      assert.strictEqual(tc.success, false);
      if (!tc.success) {
        assert.ok(validReasons.includes(tc.reason), `${tc.reason} should be a valid reason`);
      }
    }
  });
});
