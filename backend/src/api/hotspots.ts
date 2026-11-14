import { Request, Response } from 'express';
import { FirmsIngestionService } from '../services/firmsIngestion.js';
import { WeatherClient } from '../services/weatherClient.js';
import { RiskEngine, EnrichedHotspot } from '../services/riskEngine.js';

export default async function handler(req: Request, res: Response) {
  if (req.method === 'POST') {
    try {
      const apiKey = req.body?.apiKey; // optional API key passed in body
      const stats = await FirmsIngestionService.runIngestionPipeline(apiKey);
      return res.status(200).json({
        message: 'Ingesta finalizada con éxito',
        stats
      });
    } catch (err) {
      console.error('Error triggering ingestion pipeline:', err);
      return res.status(500).json({ error: 'Failed to run ingestion pipeline' });
    }
  }

  // GET (default)
  try {
    const rawHotspots = await FirmsIngestionService.getActiveHotspots();
    
    // Enrich all hotspots with weather data and risk scores
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

    // Optional query parameter filtering by province (case-insensitive)
    const provinceQuery = req.query.province;
    if (provinceQuery && typeof provinceQuery === 'string') {
      const filtered = enrichedHotspots.filter(
        (h) => h.province.toLowerCase() === provinceQuery.toLowerCase()
      );
      return res.status(200).json(filtered);
    }

    res.status(200).json(enrichedHotspots);
  } catch (err) {
    console.error('Error in hotspots handler:', err);
    res.status(500).json({ error: 'Failed to retrieve hotspots' });
  }
}
