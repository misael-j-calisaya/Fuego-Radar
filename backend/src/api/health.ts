import { Request, Response } from 'express';

// Same shape as the production /health Lambda, flagged as simulated.
export default async function handler(_req: Request, res: Response) {
  const now = new Date().toISOString();
  res.status(200).json({
    status: 'simulated',
    timestamp: now,
    version: 'local',
    services: {
      firms: { status: 'simulated', lastIngestion: now, lastSource: 'simulator', hotspots: null },
      weather: { status: 'simulated', staleProvinces: 0 },
      riskEngine: { status: 'simulated', lastCalculation: now, provinces: null },
    },
  });
}
