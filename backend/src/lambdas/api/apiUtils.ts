/**
 * Shared API utilities for Lambda handlers.
 * Provides auth validation, standard response helpers, and CORS headers.
 *
 * Requirements: 6.2, 6.3, 6.8
 */

// ============================================
// Types (simplified API Gateway event/result)
// ============================================

export interface APIGatewayProxyEvent {
  headers: Record<string, string | undefined>;
  body: string | null;
  pathParameters?: Record<string, string> | null;
  queryStringParameters?: Record<string, string> | null;
}

export interface APIGatewayProxyResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

// ============================================
// Standard Headers
// ============================================

function responseHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN ?? '*',
  };
}

// ============================================
// API Key Validation (Req 6.2)
// ============================================

/**
 * Validates the x-api-key header against configured valid keys.
 * Keys are stored as a comma-separated list in API_KEYS env var.
 */
export function validateApiKey(event: APIGatewayProxyEvent): boolean {
  const apiKey = event.headers?.['x-api-key'] || event.headers?.['X-Api-Key'];
  if (!apiKey) return false;
  const validKeys = (process.env.API_KEYS ?? '').split(',').filter(Boolean);
  return validKeys.includes(apiKey);
}

// ============================================
// Response Helpers
// ============================================

/** Returns 403 Forbidden — generic message, does not reveal if key exists (Req 6.3) */
export function forbidden(): APIGatewayProxyResult {
  return {
    statusCode: 403,
    headers: responseHeaders(),
    body: JSON.stringify({ error: 'Forbidden' }),
  };
}

/** Returns 200 with JSON body */
export function success(body: unknown): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: responseHeaders(),
    body: JSON.stringify(body),
  };
}

/** Returns 400 Bad Request with error message */
export function badRequest(message: string): APIGatewayProxyResult {
  return {
    statusCode: 400,
    headers: responseHeaders(),
    body: JSON.stringify({ error: message }),
  };
}

/** Logs full error, returns generic 500 (Req 6.8) */
export function internalError(error: unknown): APIGatewayProxyResult {
  console.error('[API] Internal error:', error);
  return {
    statusCode: 500,
    headers: responseHeaders(),
    body: JSON.stringify({ error: 'Internal server error' }),
  };
}
