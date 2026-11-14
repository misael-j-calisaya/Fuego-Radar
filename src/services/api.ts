// Data types for Alerta Fuego Argentina

export interface Hotspot {
  id: string;
  lat: number;
  lng: number;
  brightness: number; // in Kelvin
  confidence: number; // 0 - 100
  date: string;
  satellite: 'VIIRS' | 'MODIS';
  province: string;
  windSpeed: number; // km/h
  windDir: string;
  fwi: number; // Fire Weather Index (0 - 100)
  dangerLevel: 'Bajo' | 'Medio' | 'Alto' | 'Muy Alto' | 'Extremo';
  area: number; // estimated hectares
}

export interface ProvinceRisk {
  provinceName: string;
  riskScore: number; // 0 - 100
  activeHotspotsCount: number;
  riskLevel: 'Bajo' | 'Medio' | 'Alto' | 'Muy Alto' | 'Extremo';
  trend: 'up' | 'down' | 'stable';
  confidenceScore: number;
}

export interface Alert {
  id: string;
  title: string;
  description: string;
  province: string;
  severity: 'Bajo' | 'Medio' | 'Alto' | 'Crítico';
  date: string;
  type: 'Incendio' | 'Meteorológica' | 'Evacuación' | 'Prevención';
  locationName: string;
  coordinates: { lat: number; lng: number };
  radius: number; // warning radius in meters
}

export interface GridCell {
  id: string;
  bounds: [[number, number], [number, number]]; // Leaflet bounds
  fwi: number;
  riskLevel: 'Bajo' | 'Medio' | 'Alto' | 'Muy Alto' | 'Extremo';
}

export interface DataSourceStatus {
  name: string;
  status: 'online' | 'offline' | 'syncing' | 'degraded' | 'unknown' | 'simulated';
  lastSync: string;
  latencyMs: number;
}

export type AlertSeverity = Alert['severity'];

/** Must match backend `POST /subscriptions` validation (email, provinces[], minSeverity). */
export interface SubscriptionData {
  email: string;
  provinces: string[];
  minSeverity: AlertSeverity;
}

// Helper to determine danger level based on FWI
export function getDangerLevel(fwi: number): 'Bajo' | 'Medio' | 'Alto' | 'Muy Alto' | 'Extremo' {
  if (fwi < 20) return 'Bajo';
  if (fwi < 40) return 'Medio';
  if (fwi < 60) return 'Alto';
  if (fwi < 80) return 'Muy Alto';
  return 'Extremo';
}

// Generate realistic mock data for Argentina
export const mockHotspots: Hotspot[] = [
  // Patagonia
  {
    id: 'hs-1',
    lat: -42.98,
    lng: -71.35,
    brightness: 338.5,
    confidence: 89,
    date: new Date(Date.now() - 35 * 60000).toISOString(),
    satellite: 'VIIRS',
    province: 'Chubut',
    windSpeed: 28,
    windDir: 'O',
    fwi: 83,
    dangerLevel: 'Extremo',
    area: 120,
  },
  {
    id: 'hs-2',
    lat: -41.15,
    lng: -71.30,
    brightness: 318.2,
    confidence: 72,
    date: new Date(Date.now() - 120 * 60000).toISOString(),
    satellite: 'MODIS',
    province: 'Río Negro',
    windSpeed: 18,
    windDir: 'SO',
    fwi: 58,
    dangerLevel: 'Alto',
    area: 45,
  },
  {
    id: 'hs-3',
    lat: -41.22,
    lng: -71.28,
    brightness: 342.1,
    confidence: 95,
    date: new Date(Date.now() - 10 * 60000).toISOString(),
    satellite: 'VIIRS',
    province: 'Río Negro',
    windSpeed: 22,
    windDir: 'O',
    fwi: 81,
    dangerLevel: 'Extremo',
    area: 95,
  },
  // Córdoba
  {
    id: 'hs-4',
    lat: -31.42,
    lng: -64.49,
    brightness: 335.4,
    confidence: 85,
    date: new Date(Date.now() - 15 * 60000).toISOString(),
    satellite: 'VIIRS',
    province: 'Córdoba',
    windSpeed: 32,
    windDir: 'N',
    fwi: 91,
    dangerLevel: 'Extremo',
    area: 210,
  },
  {
    id: 'hs-5',
    lat: -31.65,
    lng: -64.60,
    brightness: 325.0,
    confidence: 78,
    date: new Date(Date.now() - 75 * 60000).toISOString(),
    satellite: 'MODIS',
    province: 'Córdoba',
    windSpeed: 25,
    windDir: 'N',
    fwi: 76,
    dangerLevel: 'Muy Alto',
    area: 60,
  },
  // Delta del Paraná / Santa Fe / Entre Ríos
  {
    id: 'hs-6',
    lat: -32.88,
    lng: -60.62,
    brightness: 315.6,
    confidence: 65,
    date: new Date(Date.now() - 210 * 60000).toISOString(),
    satellite: 'MODIS',
    province: 'Entre Ríos',
    windSpeed: 12,
    windDir: 'E',
    fwi: 38,
    dangerLevel: 'Medio',
    area: 15,
  },
  {
    id: 'hs-7',
    lat: -33.12,
    lng: -60.35,
    brightness: 328.9,
    confidence: 81,
    date: new Date(Date.now() - 50 * 60000).toISOString(),
    satellite: 'VIIRS',
    province: 'Entre Ríos',
    windSpeed: 15,
    windDir: 'NE',
    fwi: 52,
    dangerLevel: 'Alto',
    area: 38,
  },
  // Misiones / Corrientes
  {
    id: 'hs-8',
    lat: -28.60,
    lng: -57.10,
    brightness: 322.4,
    confidence: 74,
    date: new Date(Date.now() - 90 * 60000).toISOString(),
    satellite: 'VIIRS',
    province: 'Corrientes',
    windSpeed: 10,
    windDir: 'NE',
    fwi: 45,
    dangerLevel: 'Alto',
    area: 25,
  },
  // Yungas / Salta / Jujuy
  {
    id: 'hs-9',
    lat: -23.78,
    lng: -64.79,
    brightness: 339.0,
    confidence: 92,
    date: new Date(Date.now() - 5 * 60000).toISOString(),
    satellite: 'VIIRS',
    province: 'Jujuy',
    windSpeed: 20,
    windDir: 'NE',
    fwi: 88,
    dangerLevel: 'Extremo',
    area: 150,
  },
  {
    id: 'hs-10',
    lat: -24.20,
    lng: -64.42,
    brightness: 320.1,
    confidence: 70,
    date: new Date(Date.now() - 180 * 60000).toISOString(),
    satellite: 'MODIS',
    province: 'Salta',
    windSpeed: 15,
    windDir: 'N',
    fwi: 64,
    dangerLevel: 'Muy Alto',
    area: 50,
  }
];

export const mockProvinceRisks: ProvinceRisk[] = [
  { provinceName: 'Córdoba', riskScore: 92, activeHotspotsCount: 5, riskLevel: 'Extremo', trend: 'up', confidenceScore: 95 },
  { provinceName: 'Jujuy', riskScore: 88, activeHotspotsCount: 2, riskLevel: 'Extremo', trend: 'up', confidenceScore: 92 },
  { provinceName: 'Chubut', riskScore: 82, activeHotspotsCount: 1, riskLevel: 'Muy Alto', trend: 'stable', confidenceScore: 88 },
  { provinceName: 'Salta', riskScore: 78, activeHotspotsCount: 3, riskLevel: 'Muy Alto', trend: 'up', confidenceScore: 90 },
  { provinceName: 'Río Negro', riskScore: 74, activeHotspotsCount: 4, riskLevel: 'Muy Alto', trend: 'down', confidenceScore: 89 },
  { provinceName: 'San Luis', riskScore: 68, activeHotspotsCount: 0, riskLevel: 'Alto', trend: 'stable', confidenceScore: 72 },
  { provinceName: 'La Rioja', riskScore: 65, activeHotspotsCount: 0, riskLevel: 'Alto', trend: 'up', confidenceScore: 72 },
  { provinceName: 'Catamarca', riskScore: 62, activeHotspotsCount: 0, riskLevel: 'Alto', trend: 'stable', confidenceScore: 72 },
  { provinceName: 'Corrientes', riskScore: 52, activeHotspotsCount: 2, riskLevel: 'Alto', trend: 'down', confidenceScore: 85 },
  { provinceName: 'Entre Ríos', riskScore: 48, activeHotspotsCount: 3, riskLevel: 'Medio', trend: 'stable', confidenceScore: 86 },
  { provinceName: 'Santiago del Estero', riskScore: 45, activeHotspotsCount: 0, riskLevel: 'Medio', trend: 'up', confidenceScore: 72 },
  { provinceName: 'Neuquén', riskScore: 42, activeHotspotsCount: 0, riskLevel: 'Medio', trend: 'down', confidenceScore: 72 },
  { provinceName: 'Mendoza', riskScore: 40, activeHotspotsCount: 0, riskLevel: 'Medio', trend: 'stable', confidenceScore: 72 },
  { provinceName: 'Santa Fe', riskScore: 35, activeHotspotsCount: 1, riskLevel: 'Medio', trend: 'down', confidenceScore: 80 },
  { provinceName: 'Tucumán', riskScore: 34, activeHotspotsCount: 0, riskLevel: 'Medio', trend: 'stable', confidenceScore: 72 },
  { provinceName: 'Chaco', riskScore: 30, activeHotspotsCount: 0, riskLevel: 'Bajo', trend: 'down', confidenceScore: 72 },
  { provinceName: 'Formosa', riskScore: 28, activeHotspotsCount: 0, riskLevel: 'Bajo', trend: 'stable', confidenceScore: 72 },
  { provinceName: 'La Pampa', riskScore: 25, activeHotspotsCount: 0, riskLevel: 'Bajo', trend: 'down', confidenceScore: 72 },
  { provinceName: 'Buenos Aires', riskScore: 22, activeHotspotsCount: 0, riskLevel: 'Bajo', trend: 'stable', confidenceScore: 72 },
  { provinceName: 'San Juan', riskScore: 20, activeHotspotsCount: 0, riskLevel: 'Bajo', trend: 'down', confidenceScore: 72 },
  { provinceName: 'Misiones', riskScore: 18, activeHotspotsCount: 0, riskLevel: 'Bajo', trend: 'stable', confidenceScore: 72 },
  { provinceName: 'Santa Cruz', riskScore: 12, activeHotspotsCount: 0, riskLevel: 'Bajo', trend: 'stable', confidenceScore: 72 },
  { provinceName: 'Tierra del Fuego', riskScore: 8, activeHotspotsCount: 0, riskLevel: 'Bajo', trend: 'stable', confidenceScore: 72 }
];

export const mockAlerts: Alert[] = [
  {
    id: 'alert-1',
    title: 'Riesgo Extremo de Incendio en Valle de Punilla',
    description: 'Baja humedad ambiental extrema (<10%), ráfagas de viento del sector norte superiores a 50 km/h y temperaturas que rozan los 32°C configuran condiciones extremas.',
    province: 'Córdoba',
    severity: 'Crítico',
    date: new Date(Date.now() - 40 * 60000).toISOString(),
    type: 'Meteorológica',
    locationName: 'Valle de Punilla & Calamuchita',
    coordinates: { lat: -31.42, lng: -64.49 },
    radius: 40000 // 40km
  },
  {
    id: 'alert-2',
    title: 'Fuego activo en Parque Nacional Los Alerces',
    description: 'Frente de fuego de 3 kilómetros activo y en avance rápido impulsado por ráfagas del oeste. Brigadistas y dos aviones hidrantes trabajando en la zona.',
    province: 'Chubut',
    severity: 'Crítico',
    date: new Date(Date.now() - 60 * 60000).toISOString(),
    type: 'Incendio',
    locationName: 'Parque Nacional Los Alerces',
    coordinates: { lat: -42.98, lng: -71.35 },
    radius: 15000 // 15km
  },
  {
    id: 'alert-3',
    title: 'Evacuación preventiva en Parque Nacional Calilegua',
    description: 'Debido a la densidad del humo en la Ruta Provincial 83 y cercanía de focos ígneos en las Yungas, se restringe el acceso al parque nacional y se evacúan senderos.',
    province: 'Jujuy',
    severity: 'Crítico',
    date: new Date(Date.now() - 15 * 60000).toISOString(),
    type: 'Evacuación',
    locationName: 'Parque Nacional Calilegua',
    coordinates: { lat: -23.78, lng: -64.79 },
    radius: 10000 // 10km
  },
  {
    id: 'alert-4',
    title: 'Alerta por Humo en Gran Rosario',
    description: 'Humo denso proveniente de la quema de pastizales en las islas del Delta del Paraná afecta la visibilidad en las autopistas a Buenos Aires y Santa Fe.',
    province: 'Santa Fe',
    severity: 'Alto',
    date: new Date(Date.now() - 180 * 60000).toISOString(),
    type: 'Prevención',
    locationName: 'Rosario y cercanías',
    coordinates: { lat: -32.95, lng: -60.64 },
    radius: 25000
  }
];

// Generate simple 1x1 degree grid cells overlaying risk zones in Argentina for FWI visualisation
export const mockGridCells: GridCell[] = [
  { id: 'grid-cba-1', bounds: [[-32, -65], [-31, -64]], fwi: 91, riskLevel: 'Extremo' },
  { id: 'grid-cba-2', bounds: [[-32, -66], [-31, -65]], fwi: 78, riskLevel: 'Muy Alto' },
  { id: 'grid-cba-3', bounds: [[-31, -65], [-30, -64]], fwi: 85, riskLevel: 'Extremo' },
  { id: 'grid-pat-1', bounds: [[-43, -72], [-42, -71]], fwi: 83, riskLevel: 'Extremo' },
  { id: 'grid-pat-2', bounds: [[-42, -72], [-41, -71]], fwi: 75, riskLevel: 'Muy Alto' },
  { id: 'grid-pat-3', bounds: [[-41, -72], [-40, -71]], fwi: 58, riskLevel: 'Alto' },
  { id: 'grid-nea-1', bounds: [[-29, -58], [-28, -57]], fwi: 45, riskLevel: 'Alto' },
  { id: 'grid-nea-2', bounds: [[-33, -61], [-32, -60]], fwi: 38, riskLevel: 'Medio' },
  { id: 'grid-nwa-1', bounds: [[-24, -65], [-23, -64]], fwi: 88, riskLevel: 'Extremo' },
  { id: 'grid-nwa-2', bounds: [[-25, -65], [-24, -64]], fwi: 64, riskLevel: 'Muy Alto' }
];

export const mockSourceStatuses: DataSourceStatus[] = [
  { name: 'NASA FIRMS (Satelital)', status: 'simulated', lastSync: new Date().toISOString(), latencyMs: 0 },
  { name: 'Open-Meteo (Meteorología)', status: 'simulated', lastSync: new Date().toISOString(), latencyMs: 0 },
  { name: 'Motor de Riesgo', status: 'simulated', lastSync: new Date().toISOString(), latencyMs: 0 },
];

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const API_KEY = import.meta.env.VITE_API_KEY ?? '';
export const DEMO_FALLBACK_ENABLED = import.meta.env.VITE_ENABLE_DEMO_FALLBACK !== 'false';
const REQUEST_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_BASE) {
    throw new ApiError('VITE_API_BASE_URL no está configurada', 0);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
        ...init.headers,
      },
    });
    const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
    const body = isJson ? await response.json().catch(() => null) : null;
    if (response.ok && body === null) {
      throw new ApiError('Respuesta inesperada del servidor', response.status);
    }
    if (!response.ok) {
      const message = (body && (body.message || body.error)) || `HTTP ${response.status}`;
      throw new ApiError(String(message), response.status);
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error instanceof Error ? error.message : 'Error de red', 0);
  } finally {
    clearTimeout(timer);
  }
}

type BackendSourceStatus = 'ok' | 'degraded' | 'down' | 'unknown' | 'simulated';

interface HealthResponse {
  status: string;
  timestamp: string;
  services?: {
    firms?: { status: BackendSourceStatus; lastIngestion: string | null };
    weather?: { status: BackendSourceStatus; staleProvinces: number };
    riskEngine?: { status: BackendSourceStatus; lastCalculation: string | null };
  };
}

function toUiStatus(status: BackendSourceStatus | undefined): DataSourceStatus['status'] {
  switch (status) {
    case 'ok': return 'online';
    case 'degraded': return 'degraded';
    case 'down': return 'offline';
    case 'simulated': return 'simulated';
    default: return 'unknown';
  }
}

// Service layer: every method throws on failure. Callers decide whether to fall
// back to demo data, and must label it as such in the UI.
export class FireService {
  static isConfigured(): boolean {
    return Boolean(API_BASE);
  }

  static async getActiveHotspots(): Promise<Hotspot[]> {
    type RawHotspot = Omit<Hotspot, 'id' | 'windDir'> & Partial<Pick<Hotspot, 'id' | 'windDir'>>;
    const data = await request<RawHotspot[]>('/hotspots');
    return data.map((h, i) => ({
      ...h,
      id: h.id ?? `hs-${h.lat}-${h.lng}-${h.date ?? i}`,
      windDir: h.windDir ?? '',
    }));
  }

  static getProvinceRisks(): Promise<ProvinceRisk[]> {
    return request<ProvinceRisk[]>('/risk/provinces');
  }

  static getAlerts(): Promise<Alert[]> {
    return request<Alert[]>('/alerts');
  }

  static getGridCells(): Promise<GridCell[]> {
    return request<GridCell[]>('/risk/zones');
  }

  static async getSourceStatuses(): Promise<DataSourceStatus[]> {
    const started = performance.now();
    const data = await request<HealthResponse>('/health');
    const latencyMs = Math.round(performance.now() - started);
    const s = data.services ?? {};
    return [
      { name: 'NASA FIRMS (Satelital)', status: toUiStatus(s.firms?.status), lastSync: s.firms?.lastIngestion ?? data.timestamp, latencyMs },
      { name: 'Open-Meteo (Meteorología)', status: toUiStatus(s.weather?.status), lastSync: data.timestamp, latencyMs },
      { name: 'Motor de Riesgo', status: toUiStatus(s.riskEngine?.status), lastSync: s.riskEngine?.lastCalculation ?? data.timestamp, latencyMs },
    ];
  }

  /** POST /subscriptions — creates an unverified subscription and emails a confirmation link. */
  static async subscribeToAlerts(data: SubscriptionData): Promise<{ message: string }> {
    const body = await request<{ message?: string }>('/subscriptions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return { message: body?.message ?? 'Te enviamos un email para confirmar la suscripción.' };
  }

  /** GET /subscriptions/verify — confirms the token received by email. */
  static async verifySubscription(token: string, email: string): Promise<{ message: string }> {
    const params = new URLSearchParams({ token, email });
    const body = await request<{ message?: string }>(`/subscriptions/verify?${params}`);
    return { message: body?.message ?? 'Suscripción confirmada.' };
  }

  /**
   * Community ground-truth report. There is no backend endpoint yet, so this is
   * acknowledged locally only and the message says so explicitly.
   */
  static async reportVerification(hotspotId: string, verified: boolean): Promise<{ success: boolean; message: string }> {
    console.info(`Hotspot report (local only) ${hotspotId}:`, verified);
    return {
      success: true,
      message: verified
        ? 'Gracias. Tu confirmación quedó registrada en este dispositivo (aún no se envía al servidor).'
        : 'Gracias. Marcaste el foco como posible falsa alarma (registro local, aún no se envía al servidor).',
    };
  }
}
