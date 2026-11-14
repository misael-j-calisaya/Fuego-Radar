export interface RawHotspot {
  id: string;
  lat: number;
  lng: number;
  brightness: number; // in Kelvin
  confidence: number; // 0 - 100
  date: string;
  satellite: 'VIIRS' | 'MODIS';
  province: string;
}

// Pre-defined base hotspot coordinates across Argentina
const baseHotspots: Omit<RawHotspot, 'date'>[] = [
  { id: 'hs-1', lat: -42.98, lng: -71.35, brightness: 338.5, confidence: 89, satellite: 'VIIRS', province: 'Chubut' },
  { id: 'hs-2', lat: -41.15, lng: -71.30, brightness: 318.2, confidence: 72, satellite: 'MODIS', province: 'Río Negro' },
  { id: 'hs-3', lat: -41.22, lng: -71.28, brightness: 342.1, confidence: 95, satellite: 'VIIRS', province: 'Río Negro' },
  { id: 'hs-4', lat: -31.42, lng: -64.49, brightness: 335.4, confidence: 85, satellite: 'VIIRS', province: 'Córdoba' },
  { id: 'hs-5', lat: -31.65, lng: -64.60, brightness: 325.0, confidence: 78, satellite: 'MODIS', province: 'Córdoba' },
  { id: 'hs-6', lat: -32.88, lng: -60.62, brightness: 315.6, confidence: 65, satellite: 'MODIS', province: 'Entre Ríos' },
  { id: 'hs-7', lat: -33.12, lng: -60.35, brightness: 328.9, confidence: 81, satellite: 'VIIRS', province: 'Entre Ríos' },
  { id: 'hs-8', lat: -28.60, lng: -57.10, brightness: 322.4, confidence: 74, satellite: 'VIIRS', province: 'Corrientes' },
  { id: 'hs-9', lat: -23.78, lng: -64.79, brightness: 339.0, confidence: 92, satellite: 'VIIRS', province: 'Jujuy' },
  { id: 'hs-10', lat: -24.20, lng: -64.42, brightness: 320.1, confidence: 70, satellite: 'MODIS', province: 'Salta' }
];

export class FirmsClient {
  /**
   * Simulates fetching active fire coordinates from NASA FIRMS API.
   * Dynamically adjusts timestamps so they appear fresh.
   */
  static async getActiveDetections(): Promise<RawHotspot[]> {
    return new Promise((resolve) => {
      // Simulate slight network latency
      setTimeout(() => {
        const now = Date.now();
        const results = baseHotspots.map((hs, index) => {
          // Stagger detection dates (e.g. 5 minutes, 15 minutes, 2 hours ago)
          const ageMinutes = (index * 25) + 5;
          return {
            ...hs,
            date: new Date(now - ageMinutes * 60000).toISOString()
          };
        });
        resolve(results);
      }, 150);
    });
  }
}
