/**
 * Unit tests for log sanitization (Task 9.2 / 9.3).
 * Verifies PII masking for API keys, emails, coordinates, and tokens.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitize,
  sanitizeObject,
  maskEmail,
  maskApiKey,
  maskCoordinate,
  createLogger,
} from '../shared/logger.js';

describe('Logger - maskEmail', () => {
  it('masks email preserving first 2 chars and domain', () => {
    assert.strictEqual(maskEmail('usuario@example.com'), 'us***@example.com');
  });

  it('masks short local part', () => {
    assert.strictEqual(maskEmail('ab@test.org'), 'ab***@test.org');
  });

  it('handles missing @ gracefully', () => {
    assert.strictEqual(maskEmail('invalid'), '***@***');
  });
});

describe('Logger - maskApiKey', () => {
  it('masks long key showing first 4 and last 4', () => {
    const key = 'abcdefghijklmnop1234567890abcdef';
    assert.strictEqual(maskApiKey(key), 'abcd***cdef');
  });

  it('fully masks short key', () => {
    assert.strictEqual(maskApiKey('short'), '***');
  });

  it('masks exactly 9 char key showing edges', () => {
    assert.strictEqual(maskApiKey('123456789'), '1234***6789');
  });
});

describe('Logger - maskCoordinate', () => {
  it('masks latitude with 4+ decimals', () => {
    const result = maskCoordinate('lat: -34.6037');
    assert.strictEqual(result, 'lat: -34.6***');
  });

  it('masks longitude with high precision', () => {
    const result = maskCoordinate('longitude: -58.38159');
    assert.strictEqual(result, 'longitude: -58.3***');
  });

  it('does not mask short decimal (< 4 places)', () => {
    const result = maskCoordinate('lat: -34.6');
    // Pattern requires 4+ decimal places, so short decimals pass through
    assert.strictEqual(result, 'lat: -34.6');
  });
});

describe('Logger - sanitize', () => {
  it('masks email addresses in text', () => {
    const input = 'User subscribed: maria.garcia@gmail.com for Buenos Aires';
    const result = sanitize(input);
    assert.ok(!result.includes('maria.garcia@gmail.com'));
    assert.ok(result.includes('ma***@gmail.com'));
  });

  it('masks multiple emails in same string', () => {
    const input = 'Notifying admin@fire.gov.ar and user@example.com';
    const result = sanitize(input);
    assert.ok(!result.includes('admin@fire.gov.ar'));
    assert.ok(!result.includes('user@example.com'));
    assert.ok(result.includes('ad***@fire.gov.ar'));
    assert.ok(result.includes('us***@example.com'));
  });

  it('masks FIRMS API key references', () => {
    const input = 'FIRMS_MAP_KEY=abc123def456ghi789jkl012mno345pq';
    const result = sanitize(input);
    assert.ok(!result.includes('abc123def456ghi789jkl012mno345pq'));
    assert.ok(result.includes('abc1***45pq'));
  });

  it('masks bearer tokens', () => {
    const input = 'Authorization: bearer eyJhbGciOiJIUzI1NiJ9.payload.signature';
    const result = sanitize(input);
    assert.ok(!result.includes('eyJhbGciOiJIUzI1NiJ9'));
    assert.ok(result.includes('bearer ***'));
  });

  it('masks subscriber coordinates', () => {
    const input = 'Subscription created: lat: -34.6037, lng: -58.3816';
    const result = sanitize(input);
    assert.ok(!result.includes('-34.6037'));
    assert.ok(!result.includes('-58.3816'));
    assert.ok(result.includes('-34.6***'));
    assert.ok(result.includes('-58.3***'));
  });

  it('masks long alphanumeric API key values (32+ chars)', () => {
    const input = 'x-api-key header value: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
    const result = sanitize(input);
    assert.ok(!result.includes('a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'));
  });

  it('preserves non-sensitive data', () => {
    const input = 'Processing 45 hotspots for province Córdoba';
    const result = sanitize(input);
    assert.strictEqual(result, input);
  });

  it('preserves hotspot coordinates (no subscriber context keyword)', () => {
    // Hotspot coords like "brightness: 340.5" should not be masked
    const input = 'brightness: 340.5, confidence: 85';
    const result = sanitize(input);
    assert.strictEqual(result, input);
  });
});

describe('Logger - sanitizeObject', () => {
  it('sanitizes email in nested object', () => {
    const obj = {
      subscription: { email: 'test@example.com', province: 'Salta' },
    };
    const result = sanitizeObject(obj) as any;
    assert.ok(!JSON.stringify(result).includes('test@example.com'));
    assert.ok(JSON.stringify(result).includes('te***@example.com'));
  });

  it('sanitizes coordinates in object', () => {
    const obj = {
      subscriber: { latitude: -34.6037, name: 'Juan' },
    };
    const result = sanitizeObject(obj) as any;
    const json = JSON.stringify(result);
    assert.ok(!json.includes('-34.6037'));
  });

  it('returns null/undefined as-is', () => {
    assert.strictEqual(sanitizeObject(null), null);
    assert.strictEqual(sanitizeObject(undefined), undefined);
  });

  it('returns primitives as-is', () => {
    assert.strictEqual(sanitizeObject(42), 42);
    assert.strictEqual(sanitizeObject(true), true);
  });
});

describe('Logger - createLogger', () => {
  it('creates logger with context', () => {
    const logger = createLogger('TestContext');
    assert.ok(logger);
  });

  it('emits structured JSON with sanitized content', () => {
    const logger = createLogger('Test');
    const chunks: string[] = [];
    const originalWrite = process.stdout.write;

    process.stdout.write = ((chunk: string) => {
      chunks.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    logger.info('User email: secret@domain.com logged in');

    process.stdout.write = originalWrite;

    assert.ok(chunks.length > 0);
    const parsed = JSON.parse(chunks[0]);
    assert.strictEqual(parsed.level, 'INFO');
    assert.strictEqual(parsed.context, 'Test');
    assert.ok(!parsed.message.includes('secret@domain.com'));
    assert.ok(parsed.message.includes('se***@domain.com'));
    assert.ok(parsed.timestamp);
  });

  it('emits errors to stderr', () => {
    const logger = createLogger('ErrTest');
    const chunks: string[] = [];
    const originalWrite = process.stderr.write;

    process.stderr.write = ((chunk: string) => {
      chunks.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    logger.error('Critical failure with key=abcdefghijklmnopqrstuvwxyz123456');

    process.stderr.write = originalWrite;

    assert.ok(chunks.length > 0);
    const parsed = JSON.parse(chunks[0]);
    assert.strictEqual(parsed.level, 'ERROR');
    assert.ok(!parsed.message.includes('abcdefghijklmnopqrstuvwxyz123456'));
  });

  it('sanitizes data field in log entries', () => {
    const logger = createLogger('DataTest');
    const chunks: string[] = [];
    const originalWrite = process.stdout.write;

    process.stdout.write = ((chunk: string) => {
      chunks.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    logger.info('Subscription', { email: 'private@secret.com', province: 'Mendoza' });

    process.stdout.write = originalWrite;

    const parsed = JSON.parse(chunks[0]);
    assert.ok(!JSON.stringify(parsed.data).includes('private@secret.com'));
    assert.ok(JSON.stringify(parsed.data).includes('pr***@secret.com'));
  });
});
