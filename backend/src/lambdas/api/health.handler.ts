/**
 * GET /health — Public health check endpoint.
 *
 * Does NOT require API key validation (public endpoint).
 * Returns service status, timestamp, and version.
 */

import { success, internalError } from './apiUtils.js';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from './apiUtils.js';

// ============================================
// Handler
// ============================================

export async function handler(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    return success({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
  } catch (error) {
    return internalError(error);
  }
}
