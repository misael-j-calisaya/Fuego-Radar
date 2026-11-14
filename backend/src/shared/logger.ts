/**
 * Structured logger with PII sanitization for CloudWatch.
 *
 * Masks sensitive data before emitting logs:
 * - API keys (x-api-key headers, FIRMS_MAP_KEY values)
 * - Email addresses
 * - Subscriber coordinates (lat/lng in subscription context)
 * - Tokens (JWT, bearer tokens)
 *
 * Task 9.2 — Requirements: 11.6, 11.7
 */

// ============================================
// Types
// ============================================

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: string;
  data?: Record<string, unknown>;
}

// ============================================
// Sanitization Patterns
// ============================================

/** Matches email addresses */
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

/** Matches API key header values (32+ hex/alnum characters) */
const API_KEY_PATTERN = /\b([A-Za-z0-9]{32,})\b/g;

/** Matches bearer/token patterns */
const TOKEN_PATTERN = /(?:bearer\s+|token[=:]\s*)[A-Za-z0-9._-]+/gi;

/** Matches FIRMS MAP KEY patterns (env variable values) */
const FIRMS_KEY_PATTERN = /(?:FIRMS_MAP_KEY|firms_map_key|api[_-]?key)[=:]\s*['"]?([A-Za-z0-9._-]+)['"]?/gi;

/** Matches coordinate pairs that might be subscriber locations */
const COORDINATE_PAIR_PATTERN = /(?:lat(?:itude)?|lng|lon(?:gitude)?)["\s]*[=:]\s*-?\d+\.\d{4,}/gi;

// ============================================
// Sanitization Functions
// ============================================

/**
 * Masks an email address: first 2 chars + *** + @domain
 * Example: "user@example.com" → "us***@example.com"
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***@***';
  const visible = local.slice(0, 2);
  return `${visible}***@${domain}`;
}

/**
 * Masks an API key: first 4 chars + *** + last 4 chars
 * Example: "abcdefghijklmnop1234567890abcdef" → "abcd***cdef"
 */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return '***';
  return `${key.slice(0, 4)}***${key.slice(-4)}`;
}

/**
 * Masks a coordinate value: replaces decimal places beyond 1 with *
 * Example: "lat: -34.6037" → "lat: -34.6***"
 */
export function maskCoordinate(coordStr: string): string {
  return coordStr.replace(/-?\d+\.\d{4,}/g, (match) => {
    const dotIndex = match.indexOf('.');
    return match.slice(0, dotIndex + 2) + '***';
  });
}

/**
 * Sanitizes a string by replacing all PII patterns with masked versions.
 * This is the main entry point for log sanitization.
 */
export function sanitize(input: string): string {
  let result = input;

  // Mask FIRMS API keys (specific pattern first)
  result = result.replace(FIRMS_KEY_PATTERN, (match, key) => {
    return match.replace(key, maskApiKey(key));
  });

  // Mask bearer tokens
  result = result.replace(TOKEN_PATTERN, (match) => {
    const parts = match.split(/[\s=:]+/);
    const prefix = parts[0];
    return `${prefix} ***`;
  });

  // Mask generic API keys (long alphanumeric strings)
  result = result.replace(API_KEY_PATTERN, (match) => {
    // Only mask if it looks like a key (32+ chars, not a known safe value)
    if (match.length >= 32) {
      return maskApiKey(match);
    }
    return match;
  });

  // Mask emails
  result = result.replace(EMAIL_PATTERN, (match) => maskEmail(match));

  // Mask coordinates in subscriber context
  result = result.replace(COORDINATE_PAIR_PATTERN, (match) => maskCoordinate(match));

  return result;
}

/**
 * Deep-sanitizes an object by converting to JSON, sanitizing, and parsing back.
 * Use for structured log data objects.
 */
export function sanitizeObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitize(obj);
  if (typeof obj !== 'object') return obj;

  const json = JSON.stringify(obj);
  const sanitized = sanitize(json);
  try {
    return JSON.parse(sanitized);
  } catch {
    return sanitized;
  }
}

// ============================================
// Logger Class
// ============================================

export class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  private emit(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      level,
      message: sanitize(message),
      timestamp: new Date().toISOString(),
      context: this.context,
    };

    if (data) {
      entry.data = sanitizeObject(data) as Record<string, unknown>;
    }

    const output = JSON.stringify(entry);

    switch (level) {
      case 'ERROR':
      case 'CRITICAL':
        process.stderr.write(output + '\n');
        break;
      default:
        process.stdout.write(output + '\n');
        break;
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.emit('DEBUG', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.emit('INFO', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.emit('WARN', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.emit('ERROR', message, data);
  }

  critical(message: string, data?: Record<string, unknown>): void {
    this.emit('CRITICAL', message, data);
  }
}

// ============================================
// Factory
// ============================================

/**
 * Creates a scoped logger instance.
 * @param context - Component name (e.g., 'Ingestion', 'RiskCalculation', 'API')
 */
export function createLogger(context: string): Logger {
  return new Logger(context);
}
