import { Request, Response } from 'express';
import { FirmsIngestionService } from '../../services/firmsIngestion.js';
import { WeatherClient } from '../../services/weatherClient.js';
import { RiskEngine, DangerLevel } from '../../services/riskEngine.js';

export interface ProvinceRisk {
  provinceName: string;
  riskScore: number; // 0 - 100
  activeHotspotsCount: number;
  riskLevel: DangerLevel;
  trend: 'up' | 'down' | 'stable';
  confidenceScore: number;
}

const baselineRisks: Record<string, number> = {
  'Córdoba': 70,
  'Jujuy': 65,
  'Chubut': 60,
  'Salta': 56,
  'Río Negro': 52,
  'San Luis': 48,
  'La Rioja': 46,
  'Catamarca': 44,
  'Corrientes': 40,
  'Entre Ríos': 36,
  'Santiago del Estero': 35,
  'Neuquén': 32,
  'Mendoza': 30,
  'Santa Fe': 26,
  'Tucumán': 25,
  'Chaco': 22,
  'Formosa': 20,
  'La Pampa': 18,
  'Buenos Aires': 15,
  'Ciudad Autónoma de Buenos Aires': 15,
  'San Juan': 14,
  'Misiones': 12,
  'Santa Cruz': 8,
  'Tierra del Fuego': 5,
};

export default async function handler(req: Request, res: Response) {
  try {
    const rawHotspots = await FirmsIngestionService.getActiveHotspots();
    
    // Group active hotspots by province
    const hotspotsByProvince: Record<string, number> = {};
    rawHotspots.forEach(hs => {
      hotspotsByProvince[hs.province] = (hotspotsByProvince[hs.province] || 0) + 1;
    });

    const results: ProvinceRisk[] = Object.keys(baselineRisks).map(provName => {
      const count = hotspotsByProvince[provName] || 0;
      const baseline = baselineRisks[provName] || 10;
      
      // Calculate dynamic risk score based on baseline + active hotspots
      const riskScore = Math.min(100, baseline + (count * 6));
      const riskLevel = RiskEngine.getDangerLevel(riskScore);
      
      // Set trend direction
      let trend: ProvinceRisk['trend'] = 'stable';
      if (count > 2) {
        trend = 'up';
      } else if (count > 0) {
        trend = 'stable';
      } else if (baseline < 25) {
        trend = 'down';
      }

      return {
        provinceName: provName,
        riskScore,
        activeHotspotsCount: count,
        riskLevel,
        trend,
        confidenceScore: count > 0 ? 88 : 72
      };
    });

    // Sort by riskScore descending
    results.sort((a, b) => b.riskScore - a.riskScore);

    res.status(200).json(results);
  } catch (err) {
    console.error('Error in risk/provinces handler:', err);
    res.status(500).json({ error: 'Failed to retrieve provincial risks' });
  }
}
