import { WeatherData } from './weatherClient.js';

export type DangerLevel = 'Bajo' | 'Medio' | 'Alto' | 'Muy Alto' | 'Extremo';

export interface RiskInput {
  temperature: number; // °C
  relativeHumidity: number; // % (0-100)
  windSpeed: number; // km/h
  rain24h: number; // mm
  province: string;
  region: 'Patagonia' | 'Centro' | 'Norte' | 'Cuyo' | 'Litoral';
  recentHotspotsCount: number;
  historicalFireCount: number;
  climateNormal: {
    avgTemp: number;
    avgHumidity: number;
    avgWind: number;
  };
  hasCriticalAlert?: boolean;
}

export interface RiskOutput {
  riskScore: number; // 0 - 100
  riskLevel: DangerLevel;
  explanation: string;
  confidenceScore: number; // 0 - 100
}

export interface EnrichedHotspot {
  id: string;
  lat: number;
  lng: number;
  brightness: number; // Kelvin
  confidence: number; // 0 - 100
  date: string;
  satellite: 'VIIRS' | 'MODIS';
  province: string;
  windSpeed: number;
  windDir: string;
  fwi: number;
  dangerLevel: DangerLevel;
  area: number; // hectares
}

export class RiskEngine {
  /**
   * Calculates the Fire Weather Index (FWI) on a scale of 0 to 100
   * based on temperature, humidity, and wind speed. (Simple backward compatibility)
   */
  static calculateFWI(weather: WeatherData): number {
    const { temperature, relativeHumidity, windSpeed } = weather;
    const tempFactor = temperature * 1.0;
    const humidityFactor = (100 - relativeHumidity) * 0.5;
    const windFactor = windSpeed * 0.4;
    return Math.min(100, Math.max(0, Math.round(tempFactor + humidityFactor + windFactor)));
  }

  /**
   * Maps FWI index score to danger level text labels.
   */
  static getDangerLevel(fwi: number): DangerLevel {
    if (fwi < 20) return 'Bajo';
    if (fwi < 40) return 'Medio';
    if (fwi < 60) return 'Alto';
    if (fwi < 80) return 'Muy Alto';
    return 'Extremo';
  }

  /**
   * Estimates active burning area (in hectares) based on
   * hotspot fire brightness, local wind velocity, and fire danger index.
   */
  static estimateFireArea(brightness: number, windSpeed: number, fwi: number): number {
    const thermalPower = Math.max(0, brightness - 300);
    return Math.max(1, Math.round((thermalPower * 2.2) + (windSpeed * 1.8) + (fwi * 0.8)));
  }

  /**
   * Comprehensive fire risk evaluator taking meteorological, regional, historical,
   * and satellite parameters.
   */
  static evaluateRisk(input: RiskInput): RiskOutput {
    const {
      temperature,
      relativeHumidity,
      windSpeed,
      rain24h,
      region,
      recentHotspotsCount,
      historicalFireCount,
      climateNormal,
      hasCriticalAlert
    } = input;

    let score = 25; // baseline average risk
    const explanations: string[] = [];

    // 1. Temperature Analysis
    if (temperature > 32) {
      score += 20;
      explanations.push('Temperaturas extremas registradas en la región.');
    } else if (temperature > 24) {
      score += 10;
      explanations.push('Ambiente templado/cálido favorable a la sequedad.');
    } else if (temperature < 15) {
      score -= 10;
      explanations.push('Bajas temperaturas mitigan la evaporación del combustible.');
    }

    // 2. Relative Humidity Analysis (Highest weight)
    if (relativeHumidity < 15) {
      score += 30;
      explanations.push('Humedad relativa extremadamente baja crítica (<15%).');
    } else if (relativeHumidity < 30) {
      score += 15;
      explanations.push('Humedad del aire baja que acelera la sequedad del combustible fino.');
    } else if (relativeHumidity > 60) {
      score -= 15;
      explanations.push('Humedad relativa del aire elevada que dificulta la ignición.');
    }

    // 3. Wind speed Analysis
    if (windSpeed > 30) {
      score += 20;
      explanations.push('Vientos intensos registrados que facilitan la rápida propagación.');
    } else if (windSpeed > 18) {
      score += 10;
      explanations.push('Viento moderado que aporta oxígeno al frente de fuego.');
    }

    // 4. Precipitation Suppressor
    if (rain24h > 10) {
      score -= 30;
      explanations.push('Lluvias copiosas en las últimas 24 horas humedecen el suelo de forma significativa.');
    } else if (rain24h > 2) {
      score -= 15;
      explanations.push('Precipitaciones leves que amortiguan temporalmente el peligro.');
    }

    // 5. Active Satellite Hotspots (Direct danger)
    if (recentHotspotsCount > 0) {
      const added = Math.min(25, recentHotspotsCount * 8);
      score += added;
      explanations.push(`Presencia de ${recentHotspotsCount} focos ígneos detectados por satélite en las cercanías.`);
    }

    // 6. Historical Context (Vulnerability)
    if (historicalFireCount > 0) {
      score += Math.min(10, historicalFireCount * 0.5);
    }

    // 7. Active Critical Alerts
    if (hasCriticalAlert) {
      score += 15;
      explanations.push('Región bajo alerta crítica meteorológica o civil activa.');
    }

    // 8. Regional Factors
    if (region === 'Centro' && relativeHumidity < 20) {
      score += 5;
      explanations.push('Bioma de monte serrano y pastizal en la región Centro bajo sequía extrema.');
    }
    if (region === 'Patagonia' && windSpeed > 25) {
      score += 5;
      explanations.push('Sotobosque andino-patagónico vulnerable a ráfagas de viento seco del oeste.');
    }

    // Final clamp to 0-100
    const finalScore = Math.min(100, Math.max(0, Math.round(score)));
    const riskLevel = this.getDangerLevel(finalScore);

    // Default explanation if empty
    if (explanations.length === 0) {
      explanations.push('Condiciones normales dentro del promedio climático regional.');
    }

    // Confidence score calculation (representing telemetry validation quality)
    let confidence = 95;
    
    // Deduct confidence if extreme deviations from normal climate exist
    const tempDev = Math.abs(temperature - climateNormal.avgTemp);
    const windDev = Math.abs(windSpeed - climateNormal.avgWind);
    const humDev = Math.abs(relativeHumidity - climateNormal.avgHumidity);

    if (tempDev > 15) confidence -= 5;
    if (windDev > 25) confidence -= 5;
    if (humDev > 40) confidence -= 5;

    // Deduct slightly if no recent satellite passes validated the area
    if (recentHotspotsCount === 0) {
      confidence -= 3;
    }

    return {
      riskScore: finalScore,
      riskLevel,
      explanation: explanations.join(' '),
      confidenceScore: Math.min(100, Math.max(50, confidence))
    };
  }
}
