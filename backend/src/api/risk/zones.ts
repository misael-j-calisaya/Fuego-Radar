import { Request, Response } from 'express';
import { FirmsIngestionService } from '../../services/firmsIngestion.js';
import { WeatherClient } from '../../services/weatherClient.js';
import { RiskEngine, DangerLevel } from '../../services/riskEngine.js';

export interface GridCell {
  id: string;
  bounds: [[number, number], [number, number]];
  fwi: number;
  riskLevel: DangerLevel;
}

export default async function handler(req: Request, res: Response) {
  try {
    const rawHotspots = await FirmsIngestionService.getActiveHotspots();
    const gridCellsMap = new Map<string, GridCell>();

    for (const hs of rawHotspots) {
      // Group coordinates into a 1x1 degree bounding grid cell
      const latFloor = Math.floor(hs.lat);
      const lngFloor = Math.floor(hs.lng);
      
      const gridId = `grid-${latFloor}-${lngFloor}`;

      if (!gridCellsMap.has(gridId)) {
        // Query forecast for the center of the grid cell
        const centerLat = latFloor + 0.5;
        const centerLng = lngFloor + 0.5;
        const weather = await WeatherClient.getForecast(centerLat, centerLng);
        
        const fwi = RiskEngine.calculateFWI(weather);
        const riskLevel = RiskEngine.getDangerLevel(fwi);

        gridCellsMap.set(gridId, {
          id: gridId,
          bounds: [
            [latFloor, lngFloor],
            [latFloor + 1, lngFloor + 1]
          ],
          fwi,
          riskLevel
        });
      }
    }

    const gridCells = Array.from(gridCellsMap.values());
    res.status(200).json(gridCells);
  } catch (err) {
    console.error('Error in risk/zones handler:', err);
    res.status(500).json({ error: 'Failed to retrieve risk zones' });
  }
}
