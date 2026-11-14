import { Request, Response } from 'express';
import { FirmsIngestionService } from '../services/firmsIngestion.js';
import { WeatherClient } from '../services/weatherClient.js';
import { RiskEngine, EnrichedHotspot } from '../services/riskEngine.js';
import { AlertEngine } from '../services/alertEngine.js';

export default async function handler(req: Request, res: Response) {
  try {
    const rawHotspots = await FirmsIngestionService.getActiveHotspots();
    
    // Enrich hotspots to get FWI and danger levels
    const enrichedHotspots: EnrichedHotspot[] = await Promise.all(
      rawHotspots.map(async (raw) => {
        const weather = await WeatherClient.getForecast(raw.lat, raw.lng);
        const fwi = RiskEngine.calculateFWI(weather);
        const dangerLevel = RiskEngine.getDangerLevel(fwi);
        const area = RiskEngine.estimateFireArea(raw.brightness, weather.windSpeed, fwi);

        return {
          ...raw,
          windSpeed: weather.windSpeed,
          windDir: weather.windDir,
          fwi,
          dangerLevel,
          area
        };
      })
    );

    // Generate alerts from hotspots
    const alerts = AlertEngine.generateAlerts(enrichedHotspots);
    res.status(200).json(alerts);
  } catch (err) {
    console.error('Error in alerts handler:', err);
    res.status(500).json({ error: 'Failed to retrieve active alerts' });
  }
}
