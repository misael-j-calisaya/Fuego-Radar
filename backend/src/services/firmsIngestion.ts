import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { RawHotspot } from './firmsClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Bounding Box for Argentina: [West, South, East, North]
const ARGENTINA_BBOX = '-73.6,-56.0,-53.5,-21.8';

// Point-in-polygon ray casting implementation
export function isPointInPolygon(point: [number, number], vs: [number, number][]): boolean {
  const x = point[0];
  const y = point[1];
  let inside = false;
  
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0];
    const yi = vs[i][1];
    const xj = vs[j][0];
    const yj = vs[j][1];
    
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
      
    if (intersect) inside = !inside;
  }
  return inside;
}

// Check polygon or multipolygon containment
export function isPointInGeometry(lng: number, lat: number, geometry: any): boolean {
  const point: [number, number] = [lng, lat];
  
  if (geometry.type === 'Polygon') {
    // Check if inside the outer ring boundary ring (coordinates[0])
    return isPointInPolygon(point, geometry.coordinates[0]);
  }
  
  if (geometry.type === 'MultiPolygon') {
    for (const polygonCoords of geometry.coordinates) {
      if (isPointInPolygon(point, polygonCoords[0])) {
        return true;
      }
    }
  }
  
  return false;
}

// In-memory cache for ingested active hotspots
let ingestedHotspotsStore: RawHotspot[] = [];

export class FirmsIngestionService {
  private static provincesGeoJson: any = null;

  /**
   * Lazily loads the boundary coordinates of Argentine provinces from backend data directory.
   */
  private static loadProvincesGeoJson() {
    if (!this.provincesGeoJson) {
      try {
        // Correct path pointing to backend/data/provinces.json
        const dataPath = path.resolve(__dirname, '../../data/provinces.json');
        const fileContent = fs.readFileSync(dataPath, 'utf-8');
        this.provincesGeoJson = JSON.parse(fileContent);
      } catch (err) {
        console.error('Failed to load provinces GeoJSON:', err);
      }
    }
    return this.provincesGeoJson;
  }

  /**
   * Performs reverse geocoding to find the Argentine province for a given coordinate.
   * Returns province name, or "Fuera de Argentina" if coordinate falls outside boundaries.
   */
  static assignProvince(lat: number, lng: number): string {
    const geojson = this.loadProvincesGeoJson();
    if (!geojson || !geojson.features) return 'Fuera de Argentina';

    for (const feature of geojson.features) {
      if (isPointInGeometry(lng, lat, feature.geometry)) {
        const name = feature.properties.nombre;
        if (name.startsWith('Tierra del Fuego')) {
          return 'Tierra del Fuego';
        }
        return name;
      }
    }
    return 'Fuera de Argentina';
  }

  /**
   * Queries the NASA FIRMS Active Fire Area API.
   * If the API key is missing or the request fails, falls back to a mock raw CSV payload.
   */
  static async fetchFirmsData(apiKey?: string): Promise<string> {
    const activeApiKey = apiKey || process.env.FIRMS_API_KEY;
    const isDevelopment = process.env.NODE_ENV !== 'production';

    const isFallbackEnabled = !activeApiKey || (process.env.FIRMS_MOCK_FALLBACK === 'true' && isDevelopment);

    if (isFallbackEnabled) {
      if (!activeApiKey) {
        console.warn('NASA FIRMS Ingest: No API key configured. Loading mock raw telemetry cache.');
      } else {
        console.warn('NASA FIRMS Ingest: Ingestion running in dev mock fallback mode. Loading mock raw telemetry cache.');
      }
      return this.getMockRawCsv();
    }

    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${activeApiKey}/VIIRS_SNPP_NRT/${ARGENTINA_BBOX}/1`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`NASA API returned status ${response.status}`);
      }

      return await response.text();
    } catch (err) {
      console.error('NASA FIRMS query failed. Falling back to mock raw telemetry cache. Error:', err);
      return this.getMockRawCsv();
    }
  }

  /**
   * Saves the raw text payload to backend/data/raw/ directory for audit logging.
   */
  static saveRawData(rawData: string): string {
    try {
      const rawDir = path.resolve(__dirname, '../../data/raw');
      if (!fs.existsSync(rawDir)) {
        fs.mkdirSync(rawDir, { recursive: true });
      }

      const filename = `firms_raw_${Date.now()}.csv`;
      const filePath = path.join(rawDir, filename);
      fs.writeFileSync(filePath, rawData, 'utf-8');
      
      return filePath;
    } catch (err) {
      console.error('Failed to save raw CSV file:', err);
      return 'not-saved';
    }
  }

  /**
   * Parses and normalizes raw FIRMS CSV detections.
   */
  static normalizeDetections(csvData: string): Omit<RawHotspot, 'province'>[] {
    const lines = csvData.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length <= 1) return [];

    const headers = lines[0].toLowerCase().split(',');
    
    // Find column indexes
    const latIdx = headers.indexOf('latitude');
    const lngIdx = headers.indexOf('longitude');
    const brightIdx = headers.indexOf('bright_ti4') !== -1 ? headers.indexOf('bright_ti4') : headers.indexOf('brightness');
    const dateIdx = headers.indexOf('acq_date');
    const timeIdx = headers.indexOf('acq_time');
    const satelliteIdx = headers.indexOf('satellite');
    const instrumentIdx = headers.indexOf('instrument');
    const confidenceIdx = headers.indexOf('confidence');

    const normalized: Omit<RawHotspot, 'province'>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < headers.length) continue;

      const lat = parseFloat(cols[latIdx]);
      const lng = parseFloat(cols[lngIdx]);
      const brightness = parseFloat(cols[brightIdx]);
      
      // Acq time standardizer: firms gives HHMM (e.g. "0430" or "430" or "2300")
      let timeStr = cols[timeIdx] || '0000';
      if (timeStr.length === 3) timeStr = '0' + timeStr;
      const hours = timeStr.substring(0, 2);
      const minutes = timeStr.substring(2, 4);
      const isoDate = `${cols[dateIdx]}T${hours}:${minutes}:00Z`;

      // Confidence standardizer: VIIRS gives high/nominal/low, MODIS gives 0-100%
      const rawConf = cols[confidenceIdx] || 'nominal';
      let confidenceVal = 70;
      if (rawConf.toLowerCase() === 'high') confidenceVal = 95;
      else if (rawConf.toLowerCase() === 'low') confidenceVal = 30;
      else if (rawConf.toLowerCase() === 'nominal') confidenceVal = 70;
      else {
        const parsed = parseFloat(rawConf);
        if (!isNaN(parsed)) confidenceVal = parsed;
      }

      const instrument = cols[instrumentIdx] || 'VIIRS';
      const sat = cols[satelliteIdx] || 'SNPP';

      const hotspotId = `firms-${lat.toFixed(4)}-${lng.toFixed(4)}-${cols[dateIdx]}-${timeStr}`;

      normalized.push({
        id: hotspotId,
        lat,
        lng,
        brightness,
        confidence: confidenceVal,
        date: isoDate,
        satellite: instrument.toUpperCase().includes('VIIRS') ? 'VIIRS' : 'MODIS'
      });
    }

    return normalized;
  }

  /**
   * Filters out duplicate hotspot detections within close proximity.
   * If coordinates are within 0.015 degrees (~1.6km) and times within 30 minutes, they are merged.
   */
  static detectDuplicates(hotspots: RawHotspot[]): RawHotspot[] {
    const clean: RawHotspot[] = [];
    
    for (const h of hotspots) {
      let isDup = false;
      
      for (const existing of clean) {
        // Spatial check
        const dist = Math.sqrt(Math.pow(h.lat - existing.lat, 2) + Math.pow(h.lng - existing.lng, 2));
        // Temporal check (30 minutes in milliseconds)
        const timeDiff = Math.abs(new Date(h.date).getTime() - new Date(existing.date).getTime());
        
        if (dist <= 0.015 && timeDiff <= 30 * 60 * 1000 && h.satellite === existing.satellite) {
          isDup = true;
          // Keep the record with higher confidence or higher brightness
          if (h.confidence > existing.confidence || (h.confidence === existing.confidence && h.brightness > existing.brightness)) {
            existing.brightness = h.brightness;
            existing.confidence = h.confidence;
            existing.date = h.date;
          }
          break;
        }
      }
      
      if (!isDup) {
        clean.push(h);
      }
    }
    
    return clean;
  }

  /**
   * Runs the full ingestion pipeline: fetch, save raw, normalize, geocode bounds, and de-duplicate.
   */
  static async runIngestionPipeline(apiKey?: string): Promise<{
    rawEntries: number;
    savedTo: string;
    geocodedArgentina: number;
    duplicatesRemoved: number;
    finalCount: number;
  }> {
    const rawData = await this.fetchFirmsData(apiKey);
    const savedPath = this.saveRawData(rawData);
    
    const normalized = this.normalizeDetections(rawData);
    
    // Geocode province and filter out those that fall outside Argentina
    const geocoded: RawHotspot[] = normalized
      .map(norm => {
        const province = this.assignProvince(norm.lat, norm.lng);
        return { ...norm, province };
      })
      .filter(h => h.province !== 'Fuera de Argentina');

    const deDuplicated = this.detectDuplicates(geocoded);

    // Save final list to in-memory store
    ingestedHotspotsStore = deDuplicated;

    return {
      rawEntries: normalized.length,
      savedTo: savedPath,
      geocodedArgentina: geocoded.length,
      duplicatesRemoved: geocoded.length - deDuplicated.length,
      finalCount: deDuplicated.length
    };
  }

  /**
   * Returns the current list of ingested active hotspots.
   * If store is empty, triggers a run with fallback mock data.
   */
  static async getActiveHotspots(): Promise<RawHotspot[]> {
    if (ingestedHotspotsStore.length === 0) {
      await this.runIngestionPipeline();
    }
    return ingestedHotspotsStore;
  }

  /**
   * Simulated FIRMS raw CSV payload. Contains coordinate points:
   * 8 points inside Argentina (Córdoba, Patagonia, Entre Ríos, Salta, Jujuy)
   * 2 duplicate points close to others
   * 2 points in Chile (outside Argentina bbox or province boundaries)
   */
  private static getMockRawCsv(): string {
    const today = new Date().toISOString().substring(0, 10);
    return `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
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
  }
}
