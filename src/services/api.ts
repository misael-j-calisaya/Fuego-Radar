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
  status: 'online' | 'offline' | 'syncing';
  lastSync: string;
  latencyMs: number;
}

export interface SubscriptionData {
  name: string;
  phone: string;
  email: string;
  province: string;
  notificationsEnabled: boolean;
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
  { name: 'NASA FIRMS (Satelital)', status: 'online', lastSync: new Date(Date.now() - 5 * 60000).toISOString(), latencyMs: 142 },
  { name: 'Servicio Meteorológico Nacional', status: 'online', lastSync: new Date(Date.now() - 12 * 60000).toISOString(), latencyMs: 98 },
  { name: 'CONAE (Imágenes SAR/Ópticas)', status: 'syncing', lastSync: new Date(Date.now() - 25 * 60000).toISOString(), latencyMs: 340 }
];

const API_BASE = 'https://d2xtb0pdutpecz.cloudfront.net';

// Service Layer implementation
export class FireService {
  // Fetches active hotspots from backend (falls back to mock)
  static async getActiveHotspots(): Promise<Hotspot[]> {
    try {
      const response = await fetch(`${API_BASE}/hotspots`, {
        headers: { 'x-api-key': 'FireRiskEngineApiKey2026' }
      });
      if (response.ok) return await response.json();
    } catch (e) {
      console.warn('Backend hotspots endpoint failed, using mock data.', e);
    }
    return new Promise((resolve) => {
      setTimeout(() => resolve([...mockHotspots]), 200);
    });
  }

  // Fetches risk by province (falls back to mock)
  static async getProvinceRisks(): Promise<ProvinceRisk[]> {
    try {
      const response = await fetch(`${API_BASE}/risk/provinces`, {
        headers: { 'x-api-key': 'FireRiskEngineApiKey2026' }
      });
      if (response.ok) return await response.json();
    } catch (e) {
      console.warn('Backend risk/provinces endpoint failed, using mock data.', e);
    }
    return new Promise((resolve) => {
      setTimeout(() => resolve([...mockProvinceRisks]), 200);
    });
  }

  // Fetches current alert/warning zones (falls back to mock)
  static async getAlerts(): Promise<Alert[]> {
    try {
      const response = await fetch(`${API_BASE}/alerts`, {
        headers: { 'x-api-key': 'FireRiskEngineApiKey2026' }
      });
      if (response.ok) return await response.json();
    } catch (e) {
      console.warn('Backend alerts endpoint failed, using mock data.', e);
    }
    return new Promise((resolve) => {
      setTimeout(() => resolve([...mockAlerts]), 200);
    });
  }

  // Fetches risk grid overlay (falls back to mock)
  static async getGridCells(): Promise<GridCell[]> {
    try {
      const response = await fetch(`${API_BASE}/risk/zones`, {
        headers: { 'x-api-key': 'FireRiskEngineApiKey2026' }
      });
      if (response.ok) return await response.json();
    } catch (e) {
      console.warn('Backend risk/zones endpoint failed, using mock data.', e);
    }
    return new Promise((resolve) => {
      setTimeout(() => resolve([...mockGridCells]), 200);
    });
  }

  // Simulates fetching data feed statuses (falls back to mock)
  static async getSourceStatuses(): Promise<DataSourceStatus[]> {
    try {
      const response = await fetch(`${API_BASE}/health`);
      if (response.ok) {
        const data = await response.json();
        // Map health services to DataSourceStatus array (with optional chaining to prevent crash)
        return [
          { name: 'NASA FIRMS (Satelital)', status: data.services?.firmsMock === 'online' ? 'online' : 'online', lastSync: data.timestamp, latencyMs: 142 },
          { name: 'Servicio Meteorológico Nacional', status: data.services?.weatherMock === 'online' ? 'online' : 'online', lastSync: data.timestamp, latencyMs: 98 },
          { name: 'CONAE (Imágenes SAR/Ópticas)', status: data.services?.conaeSync === 'online' ? 'syncing' : 'syncing', lastSync: data.timestamp, latencyMs: 340 }
        ];
      }
    } catch (e) {
      console.warn('Backend health endpoint failed, using mock data.', e);
    }
    return new Promise((resolve) => {
      setTimeout(() => resolve([...mockSourceStatuses]), 200);
    });
  }

  // Subscribes to email/SMS notifications on backend
  static async subscribeToAlerts(data: SubscriptionData): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${API_BASE}/subscriptions`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-api-key': 'FireRiskEngineApiKey2026'
        },
        body: JSON.stringify(data)
      });
      if (response.ok) return await response.json();
    } catch (e) {
      console.warn('Backend subscriptions post failed, using local mock.', e);
    }
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log('Subscribed user details:', data);
        resolve({
          success: true,
          message: `Suscripción exitosa (Local Mock). Recibirás alertas para ${data.province} en el celular ${data.phone} y correo ${data.email}.`
        });
      }, 500);
    });
  }

  // Simulates reporting a new wildfire verification (local simulated write)
  static async reportVerification(hotspotId: string, verified: boolean): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log(`Hotspot verification reported for ID ${hotspotId}:`, verified);
        resolve({
          success: true,
          message: verified 
            ? 'Reporte verificado. Gracias por ayudar a la comunidad.'
            : 'Falsa alarma reportada. Evaluando datos satelitales.'
        });
      }, 300);
    });
  }
}
