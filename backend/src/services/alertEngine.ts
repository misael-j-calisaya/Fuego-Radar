import { EnrichedHotspot } from './riskEngine.js';

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

export class AlertEngine {
  /**
   * Examines active hotspots and synthesizes dynamic alert boundaries
   * and warning notifications.
   */
  static generateAlerts(hotspots: EnrichedHotspot[]): Alert[] {
    const alerts: Alert[] = [];
    const now = new Date().toISOString();

    // Check if there are extreme hotspots in Córdoba
    const cordobaExtremes = hotspots.filter(h => h.province === 'Córdoba' && h.dangerLevel === 'Extremo');
    if (cordobaExtremes.length > 0) {
      const lead = cordobaExtremes[0];
      alerts.push({
        id: 'alert-cba-evt',
        title: 'Riesgo Extremo de Incendio en Valle de Punilla',
        description: `Condiciones extremas con ráfagas del sector norte superiores a ${lead.windSpeed} km/h y humedad crítica. Peligro de propagación inmediata de incendios.`,
        province: 'Córdoba',
        severity: 'Crítico',
        date: now,
        type: 'Meteorológica',
        locationName: 'Valle de Punilla & Calamuchita',
        coordinates: { lat: lead.lat, lng: lead.lng },
        radius: 40000 // 40km
      });
    }

    // Check if there are extreme/high hotspots in Patagonia (Chubut / Rio Negro)
    const patagoniaHotspots = hotspots.filter(h => (h.province === 'Chubut' || h.province === 'Río Negro') && h.fwi > 70);
    if (patagoniaHotspots.length > 0) {
      const lead = patagoniaHotspots[0];
      alerts.push({
        id: 'alert-pat-inc',
        title: `Fuego activo en Parque Nacional Los Alerces (${lead.province})`,
        description: `Detección confirmada por satélite ${lead.satellite} con ${lead.confidence}% de confianza. Brigadistas desplegados ante viento del oeste de ${lead.windSpeed} km/h.`,
        province: lead.province,
        severity: 'Crítico',
        date: now,
        type: 'Incendio',
        locationName: 'Parque Nacional Los Alerces',
        coordinates: { lat: lead.lat, lng: lead.lng },
        radius: 15000 // 15km
      });
    }

    // Check if there are extreme/high hotspots in Jujuy / Salta
    const northwestHotspots = hotspots.filter(h => (h.province === 'Jujuy' || h.province === 'Salta') && h.fwi > 75);
    if (northwestHotspots.length > 0) {
      const lead = northwestHotspots[0];
      alerts.push({
        id: 'alert-nwa-eva',
        title: 'Evacuación preventiva en Parque Nacional Calilegua',
        description: `Visibilidad reducida por humo en Ruta Provincial 83 ante proximidad de focos ígneos en zona de Yungas. Se insta a evacuar senderos.`,
        province: lead.province,
        severity: 'Crítico',
        date: now,
        type: 'Evacuación',
        locationName: 'Parque Nacional Calilegua',
        coordinates: { lat: lead.lat, lng: lead.lng },
        radius: 10000 // 10km
      });
    }

    // Check if there are hotspots in Entre Ríos / Santa Fe (Parana delta)
    const deltaHotspots = hotspots.filter(h => h.province === 'Entre Ríos' || h.province === 'Santa Fe');
    if (deltaHotspots.length > 0) {
      const lead = deltaHotspots[0];
      alerts.push({
        id: 'alert-delta-smoke',
        title: 'Alerta por Humo en Gran Rosario',
        description: 'Presencia de humo proveniente de quema de pastizales en las islas del Delta del Paraná afectando visibilidad de tránsito vehicular.',
        province: 'Santa Fe',
        severity: 'Alto',
        date: now,
        type: 'Prevención',
        locationName: 'Rosario y cercanías',
        coordinates: { lat: -32.95, lng: -60.64 },
        radius: 25000 // 25km
      });
    }

    // Fallback default warning if database is quiet
    if (alerts.length === 0) {
      alerts.push({
        id: 'alert-gen-prev',
        title: 'Alerta de Prevención de Incendios Nacional',
        description: 'Condiciones de temporada seca vigentes. Evite encender fuegos en zonas boscosas o pastizales secos.',
        province: 'Nacional',
        severity: 'Medio',
        date: now,
        type: 'Prevención',
        locationName: 'Zonas Rurales de Argentina',
        coordinates: { lat: -38.4, lng: -63.6 },
        radius: 100000
      });
    }

    return alerts;
  }
}
