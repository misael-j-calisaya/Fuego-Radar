import { handler as healthHandler } from './api/health.handler.js';
import { handler as riskProvincesHandler } from './api/riskProvinces.handler.js';
import { handler as riskZonesHandler } from './api/riskZones.handler.js';
import { handler as hotspotsHandler } from './api/hotspots.handler.js';
import { handler as alertsHandler } from './api/alerts.handler.js';
import { handler as subscriptionsHandler, verifyHandler } from './api/subscriptions.handler.js';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from './api/apiUtils.js';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const routed = event as APIGatewayProxyEvent & { path?: string; httpMethod?: string };
  const path = routed.path || '';
  const httpMethod = routed.httpMethod || '';

  console.log(`[Router] Routing request: ${httpMethod} ${path}`);

  try {
    if (path.endsWith('/health') && httpMethod === 'GET') {
      return await healthHandler(event);
    } else if (path.endsWith('/risk/provinces') && httpMethod === 'GET') {
      return await riskProvincesHandler(event);
    } else if (path.endsWith('/risk/zones') && httpMethod === 'GET') {
      return await riskZonesHandler(event);
    } else if (path.endsWith('/hotspots') && httpMethod === 'GET') {
      return await hotspotsHandler(event);
    } else if (path.endsWith('/alerts') && httpMethod === 'GET') {
      return await alertsHandler(event);
    } else if (path.endsWith('/subscriptions/verify') && httpMethod === 'GET') {
      return await verifyHandler(event);
    } else if (path.endsWith('/subscriptions') && httpMethod === 'POST') {
      return await subscriptionsHandler(event);
    } else {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.CORS_ORIGIN ?? '*',
        },
        body: JSON.stringify({ error: `Route not found: ${httpMethod} ${path}` }),
      };
    }
  } catch (error) {
    console.error('[Router] Error routing request:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.CORS_ORIGIN ?? '*',
      },
      body: JSON.stringify({ error: 'Internal server error in router' }),
    };
  }
}
