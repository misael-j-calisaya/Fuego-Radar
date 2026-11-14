/**
 * NASA FIRMS API Client
 * Fetches active fire detection data (CSV) for Argentina with timeout and error handling.
 * On failure, returns a fallback indicator so the pipeline can maintain existing data.
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { FIRMS_API_TIMEOUT_MS, ARGENTINA_BBOX_STRING } from '../shared/constants.js';

// ============================================
// Result Types
// ============================================

/** Discriminated union for FIRMS API call results */
export type FirmsApiResult =
  | { success: true; csvData: string; rawLength: number }
  | {
      success: false;
      reason: 'timeout' | 'http_error' | 'empty_body' | 'non_csv' | 'corrupt_data' | 'network_error';
      statusCode?: number;
      message: string;
    };

// ============================================
// Constants
// ============================================

const FIRMS_BASE_URL = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';

/**
 * Minimal set of expected CSV header fields from FIRMS.
 * Used to validate the response is actual CSV data (not HTML error pages, etc.)
 */
const EXPECTED_CSV_HEADERS = ['latitude', 'longitude', 'bright_ti4'];

let cachedApiKey: string | null = null;

/**
 * Resolves the FIRMS API key by looking up environment variables
 * and reading from AWS SSM Parameter Store if configured.
 */
async function getApiKey(): Promise<string | null> {
  if (cachedApiKey) return cachedApiKey;

  if (process.env.FIRMS_MAP_KEY) {
    cachedApiKey = process.env.FIRMS_MAP_KEY;
    return cachedApiKey;
  }

  const ssmParamName = process.env.FIRMS_MAP_KEY_SSM_NAME;
  if (!ssmParamName) {
    return null;
  }

  try {
    console.info(`[FIRMS API] Retrieving API key from SSM Parameter Store: ${ssmParamName}`);
    const ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const response = await ssmClient.send(
      new GetParameterCommand({
        Name: ssmParamName,
        WithDecryption: true,
      })
    );
    cachedApiKey = response.Parameter?.Value || null;
    return cachedApiKey;
  } catch (error) {
    console.error(`[FIRMS API] Failed to fetch API key from SSM Parameter Store (${ssmParamName}):`, error);
    return null;
  }
}

// ============================================
// API Client
// ============================================

/**
 * Fetches active fire detections from NASA FIRMS API for Argentina.
 *
 * @param options.apiKey - FIRMS MAP KEY (defaults to env variable FIRMS_MAP_KEY)
 * @param options.bbox - Bounding box string (defaults to ARGENTINA_BBOX_STRING)
 * @param options.timeoutMs - Request timeout in ms (defaults to FIRMS_API_TIMEOUT_MS)
 * @returns FirmsApiResult discriminated union indicating success or categorized failure
 */
export async function fetchFirmsData(options?: {
  apiKey?: string;
  bbox?: string;
  timeoutMs?: number;
}): Promise<FirmsApiResult> {
  const apiKey = options?.apiKey ?? await getApiKey();
  const bbox = options?.bbox ?? ARGENTINA_BBOX_STRING;
  const timeoutMs = options?.timeoutMs ?? FIRMS_API_TIMEOUT_MS;

  const isDevelopment = process.env.NODE_ENV !== 'production';
  const isFallbackEnabled = process.env.FIRMS_MOCK_FALLBACK === 'true' && isDevelopment;

  if (isFallbackEnabled) {
    if (!apiKey) {
      console.warn('[FIRMS API] Missing FIRMS_MAP_KEY. Falling back to dev mock raw CSV telemetry.');
    } else {
      console.warn('[FIRMS API] Ingestion running in dev mock fallback mode. Loading mock raw CSV telemetry cache.');
    }
    const today = new Date().toISOString().substring(0, 10);
    const mockCsv = `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
-31.42,-64.49,335.4,0.4,0.4,${today},1420,SNPP,VIIRS,nominal,1,295.5,12.5,D
-31.421,-64.489,336.8,0.4,0.4,${today},1425,SNPP,VIIRS,nominal,1,295.6,13.2,D
-42.98,-71.35,338.5,0.5,0.5,${today},1420,SNPP,VIIRS,high,1,291.2,18.0,D
-41.15,-71.30,318.2,1.2,1.1,${today},1415,Terra,MODIS,72,6.1,289.4,25.4,D
-32.88,-60.62,315.6,1.1,1.1,${today},1415,Aqua,MODIS,65,6.1,288.1,12.8,D
-33.12,-60.35,328.9,0.4,0.4,${today},1420,SNPP,VIIRS,nominal,1,294.0,9.5,D
-28.60,-57.10,322.4,0.4,0.4,${today},1420,SNPP,VIIRS,nominal,1,292.1,8.0,D
-23.78,-64.79,339.0,0.4,0.4,${today},1420,SNPP,VIIRS,high,1,296.0,15.5,D
-24.20,-64.42,320.1,1.1,1.1,${today},1415,Terra,MODIS,70,6.1,289.0,18.2,D
-31.423,-64.505,310.2,0.4,0.4,${today},1420,SNPP,VIIRS,low,1,290.0,3.0,D
-33.45,-70.66,325.2,1.2,1.1,${today},1415,Terra,MODIS,80,6.1,290.1,22.0,D
-45.57,-72.07,315.4,0.4,0.4,${today},1420,SNPP,VIIRS,nominal,1,290.0,6.0,D`;

    return {
      success: true,
      csvData: mockCsv,
      rawLength: mockCsv.length,
    };
  }

  if (!apiKey) {
    return {
      success: false,
      reason: 'network_error',
      message: 'Missing FIRMS_MAP_KEY. Configure the environment variable or SSM Parameter.',
    };
  }

  const url = `${FIRMS_BASE_URL}/${apiKey}/VIIRS_SNPP_NRT/${bbox}/1`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    // Handle HTTP errors (4xx, 5xx)
    if (!response.ok) {
      const statusCode = response.status;
      console.warn(`[FIRMS API] HTTP error: ${statusCode} ${response.statusText}`);
      return {
        success: false,
        reason: 'http_error',
        statusCode,
        message: `HTTP ${statusCode}: ${response.statusText}`,
      };
    }

    // Read response body
    const text = await response.text();

    // Check for empty body
    if (!text || text.trim().length === 0) {
      console.warn('[FIRMS API] Empty response body received');
      return {
        success: false,
        reason: 'empty_body',
        message: 'Response body is empty',
      };
    }

    // Check for non-CSV content (validate headers)
    const lines = text.trim().split('\n');
    const headerLine = lines[0]?.toLowerCase() ?? '';
    const hasExpectedHeaders = EXPECTED_CSV_HEADERS.every((h) =>
      headerLine.includes(h)
    );

    if (!hasExpectedHeaders) {
      console.warn('[FIRMS API] Response is not valid CSV (missing expected headers)');
      return {
        success: false,
        reason: 'non_csv',
        message: 'Response does not contain expected CSV headers',
      };
    }

    // Success: return raw CSV data
    return {
      success: true,
      csvData: text,
      rawLength: text.length,
    };
  } catch (error: unknown) {
    clearTimeout(timeoutId);

    // Timeout detection (AbortError from AbortController)
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`[FIRMS API] Request timed out after ${timeoutMs}ms`);
      return {
        success: false,
        reason: 'timeout',
        message: `Request timed out after ${timeoutMs}ms`,
      };
    }

    // Network errors (DNS failure, connection refused, etc.)
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`[FIRMS API] Network error: ${errorMessage}`);
    return {
      success: false,
      reason: 'network_error',
      message: errorMessage,
    };
  }
}
