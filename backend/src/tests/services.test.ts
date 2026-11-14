import test from 'node:test';
import assert from 'node:assert';

// Import services to test (using JS extensions for ESM compatibility)
import { RiskEngine } from '../services/riskEngine.js';
import { FirmsClient } from '../services/firmsClient.js';
import { WeatherClient } from '../services/weatherClient.js';
import { HotspotClusterer } from '../services/hotspotClusterer.js';
import { AlertEngine } from '../services/alertEngine.js';
import { FirmsIngestionService, isPointInPolygon } from '../services/firmsIngestion.js';

test('RiskEngine Tests', async (t) => {
  await t.test('calculateFWI - should compute correct index score', () => {
    const fwiExtreme = RiskEngine.calculateFWI({
      temperature: 31.8,
      relativeHumidity: 9,
      windSpeed: 32,
      windDir: 'N'
    });
    assert.strictEqual(fwiExtreme, 90);

    const fwiLow = RiskEngine.calculateFWI({
      temperature: 15.0,
      relativeHumidity: 85,
      windSpeed: 10,
      windDir: 'S'
    });
    assert.strictEqual(fwiLow, 27);
  });

  await t.test('getDangerLevel - should map FWI score to correct danger category', () => {
    assert.strictEqual(RiskEngine.getDangerLevel(10), 'Bajo');
    assert.strictEqual(RiskEngine.getDangerLevel(25), 'Medio');
    assert.strictEqual(RiskEngine.getDangerLevel(50), 'Alto');
    assert.strictEqual(RiskEngine.getDangerLevel(70), 'Muy Alto');
    assert.strictEqual(RiskEngine.getDangerLevel(90), 'Extremo');
  });

  await t.test('estimateFireArea - should estimate higher hectares for hotter/windier fires', () => {
    const smallFire = RiskEngine.estimateFireArea(310, 10, 30);
    const bigFire = RiskEngine.estimateFireArea(350, 35, 90);
    
    assert.ok(bigFire > smallFire, 'Area for big fire should be significantly larger');
    assert.ok(smallFire > 0, 'Area estimation must be positive');
  });

  await t.test('evaluateRisk - Case 1: Clima normal', () => {
    const normalInput = {
      temperature: 20,
      relativeHumidity: 50,
      windSpeed: 12,
      rain24h: 0,
      province: 'Córdoba',
      region: 'Centro' as const,
      recentHotspotsCount: 0,
      historicalFireCount: 2,
      climateNormal: { avgTemp: 19, avgHumidity: 55, avgWind: 10 }
    };
    const output = RiskEngine.evaluateRisk(normalInput);
    assert.ok(output.riskScore >= 20 && output.riskScore <= 35, `Risk score ${output.riskScore} should be in low/medium range`);
    assert.ok(output.confidenceScore >= 90);
  });

  await t.test('evaluateRisk - Case 2: Viento alto', () => {
    const windInput = {
      temperature: 20,
      relativeHumidity: 50,
      windSpeed: 35,
      rain24h: 0,
      province: 'Córdoba',
      region: 'Centro' as const,
      recentHotspotsCount: 0,
      historicalFireCount: 2,
      climateNormal: { avgTemp: 19, avgHumidity: 55, avgWind: 10 }
    };
    const output = RiskEngine.evaluateRisk(windInput);
    assert.ok(output.riskScore > 35, `Risk score ${output.riskScore} should increase due to wind`);
    assert.ok(output.explanation.includes('vientos') || output.explanation.includes('Vientos'));
  });

  await t.test('evaluateRisk - Case 3: Humedad baja', () => {
    const humidityInput = {
      temperature: 20,
      relativeHumidity: 10,
      windSpeed: 12,
      rain24h: 0,
      province: 'Córdoba',
      region: 'Centro' as const,
      recentHotspotsCount: 0,
      historicalFireCount: 2,
      climateNormal: { avgTemp: 19, avgHumidity: 55, avgWind: 10 }
    };
    const output = RiskEngine.evaluateRisk(humidityInput);
    assert.ok(output.riskScore >= 60, `Risk score ${output.riskScore} should be high/extreme due to dry air`);
    assert.ok(output.explanation.includes('humedad') || output.explanation.includes('Humedad'));
  });

  await t.test('evaluateRisk - Case 4: Foco satelital cercano', () => {
    const hotspotInput = {
      temperature: 20,
      relativeHumidity: 50,
      windSpeed: 12,
      rain24h: 0,
      province: 'Córdoba',
      region: 'Centro' as const,
      recentHotspotsCount: 3,
      historicalFireCount: 2,
      climateNormal: { avgTemp: 19, avgHumidity: 55, avgWind: 10 }
    };
    const output = RiskEngine.evaluateRisk(hotspotInput);
    assert.ok(output.riskScore > 30, 'Risk score should increase due to nearby active hotspots');
    assert.ok(output.explanation.includes('focos') || output.explanation.includes('Focos'));
  });

  await t.test('evaluateRisk - Case 5: Alerta crítica', () => {
    const alertInput = {
      temperature: 20,
      relativeHumidity: 50,
      windSpeed: 12,
      rain24h: 0,
      province: 'Córdoba',
      region: 'Centro' as const,
      recentHotspotsCount: 0,
      historicalFireCount: 2,
      climateNormal: { avgTemp: 19, avgHumidity: 55, avgWind: 10 },
      hasCriticalAlert: true
    };
    const output = RiskEngine.evaluateRisk(alertInput);
    assert.ok(output.riskScore > 35, 'Risk score should increase due to active critical alert');
    assert.ok(output.explanation.includes('alerta') || output.explanation.includes('Alerta'));
  });
});

test('FirmsClient Tests', async (t) => {
  await t.test('getActiveDetections - should retrieve active raw hotspots with proper fields', async () => {
    const rawHotspots = await FirmsClient.getActiveDetections();
    
    assert.ok(Array.isArray(rawHotspots), 'Detections list must be an array');
    assert.ok(rawHotspots.length > 0, 'Detections list should not be empty');
    
    const sample = rawHotspots[0];
    assert.strictEqual(typeof sample.id, 'string');
    assert.strictEqual(typeof sample.lat, 'number');
    assert.strictEqual(typeof sample.lng, 'number');
    assert.strictEqual(typeof sample.brightness, 'number');
    assert.strictEqual(typeof sample.confidence, 'number');
    assert.strictEqual(typeof sample.date, 'string');
    assert.ok(sample.satellite === 'VIIRS' || sample.satellite === 'MODIS');
  });
});

test('WeatherClient Tests', async (t) => {
  await t.test('getForecast - should simulate distinct regional weather models', async () => {
    const patagoniaWeather = await WeatherClient.getForecast(-43.0, -71.5);
    const cordobaWeather = await WeatherClient.getForecast(-31.5, -64.5);
    
    assert.strictEqual(patagoniaWeather.temperature, 12.5);
    assert.strictEqual(patagoniaWeather.windDir, 'O');

    assert.strictEqual(cordobaWeather.temperature, 31.8);
    assert.ok(cordobaWeather.relativeHumidity < 15, 'Córdoba humidity should be critically low');
  });
});

test('HotspotClusterer Tests', async (t) => {
  await t.test('cluster - should group close hotspots and leave far ones isolated', () => {
    const mockHotspots = [
      { id: 'h1', lat: -31.42, lng: -64.49, brightness: 335, confidence: 80, date: '', satellite: 'VIIRS' as const, province: 'Córdoba', windSpeed: 20, windDir: 'N', fwi: 80, dangerLevel: 'Extremo' as const, area: 100 },
      { id: 'h2', lat: -31.43, lng: -64.50, brightness: 330, confidence: 80, date: '', satellite: 'VIIRS' as const, province: 'Córdoba', windSpeed: 20, windDir: 'N', fwi: 80, dangerLevel: 'Extremo' as const, area: 90 },
      { id: 'h3', lat: -42.98, lng: -71.35, brightness: 320, confidence: 70, date: '', satellite: 'MODIS' as const, province: 'Chubut', windSpeed: 25, windDir: 'O', fwi: 60, dangerLevel: 'Muy Alto' as const, area: 50 },
    ];

    const clustered = HotspotClusterer.cluster(mockHotspots, 0.1);
    assert.strictEqual(clustered.length, 2, 'Should result in 1 cluster + 1 isolated hotspot');

    const first = clustered[0];
    const second = clustered[1];

    if ('count' in first) {
      assert.strictEqual(first.count, 2);
      assert.deepStrictEqual(second, mockHotspots[2]);
    } else if ('count' in second) {
      assert.strictEqual(second.count, 2);
      assert.deepStrictEqual(first, mockHotspots[2]);
    } else {
      assert.fail('One of the returned elements must be a cluster object');
    }
  });
});

test('AlertEngine Tests', async (t) => {
  await t.test('generateAlerts - should trigger critical bulletins for extreme danger inputs', () => {
    const highRiskMock = [
      {
        id: 'hs-test',
        lat: -31.42,
        lng: -64.49,
        brightness: 335,
        confidence: 90,
        date: new Date().toISOString(),
        satellite: 'VIIRS' as const,
        province: 'Córdoba',
        windSpeed: 32,
        windDir: 'N',
        fwi: 91,
        dangerLevel: 'Extremo' as const,
        area: 150
      }
    ];

    const alerts = AlertEngine.generateAlerts(highRiskMock);
    assert.ok(alerts.length >= 1, 'Should trigger alerts');
    const cordobaAlert = alerts.find(a => a.province === 'Córdoba');
    assert.ok(cordobaAlert, 'Alert for Córdoba must be triggered');
    assert.strictEqual(cordobaAlert?.severity, 'Crítico');
  });
});

test('FirmsIngestionService Tests', async (t) => {
  await t.test('isPointInPolygon - should check polygon containment correctly', () => {
    // Simple 2x2 square polygon centered at (0,0)
    const square: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1]
    ];
    
    assert.strictEqual(isPointInPolygon([0, 0], square), true, 'Center point should be inside');
    assert.strictEqual(isPointInPolygon([2, 2], square), false, 'Outside point should be outside');
  });

  await t.test('assignProvince - should correctly reverse-geocode coordinates in Argentina', () => {
    // Córdoba centroid
    const cordobaProv = FirmsIngestionService.assignProvince(-31.42, -64.49);
    assert.strictEqual(cordobaProv, 'Córdoba');

    // Chubut/Esquel area
    const chubutProv = FirmsIngestionService.assignProvince(-42.98, -71.35);
    assert.strictEqual(chubutProv, 'Chubut');

    // Santiago de Chile
    const chileProv = FirmsIngestionService.assignProvince(-33.45, -70.66);
    assert.strictEqual(chileProv, 'Fuera de Argentina');
  });

  await t.test('normalizeDetections - should parse and normalize raw CSV data fields', () => {
    const rawCsv = `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
-31.42,-64.49,335.4,0.4,0.4,2026-06-13,1420,SNPP,VIIRS,high,1,295.5,12.5,D`;

    const normalized = FirmsIngestionService.normalizeDetections(rawCsv);
    assert.strictEqual(normalized.length, 1);
    
    const item = normalized[0];
    assert.strictEqual(item.lat, -31.42);
    assert.strictEqual(item.lng, -64.49);
    assert.strictEqual(item.brightness, 335.4);
    assert.strictEqual(item.confidence, 95, 'VIIRS high confidence should translate to 95%');
    assert.strictEqual(item.date, '2026-06-13T14:20:00Z');
    assert.strictEqual(item.satellite, 'VIIRS');
  });

  await t.test('detectDuplicates - should remove overlapping records within thresholds', () => {
    const today = new Date().toISOString().substring(0, 10);
    const mockDetections = [
      // Close coordinates and close times
      { id: 'h1', lat: -31.42, lng: -64.49, brightness: 335.4, confidence: 70, date: `${today}T14:20:00Z`, satellite: 'VIIRS' as const, province: 'Córdoba' },
      { id: 'h2', lat: -31.421, lng: -64.489, brightness: 336.8, confidence: 95, date: `${today}T14:25:00Z`, satellite: 'VIIRS' as const, province: 'Córdoba' }, // duplicate (keeps h2 due to higher confidence)
      
      // Far coordinates (isolated)
      { id: 'h3', lat: -42.98, lng: -71.35, brightness: 320.0, confidence: 80, date: `${today}T14:20:00Z`, satellite: 'VIIRS' as const, province: 'Chubut' }
    ];

    const pruned = FirmsIngestionService.detectDuplicates(mockDetections);
    assert.strictEqual(pruned.length, 2, 'Should prune 1 duplicate, leaving 2 items');
    
    // The cordoba item left should be the one with higher confidence (95) and coordinates of the winning duplicate
    const cordobaItem = pruned.find(p => p.province === 'Córdoba');
    assert.ok(cordobaItem);
    assert.strictEqual(cordobaItem?.confidence, 95);
    assert.strictEqual(cordobaItem?.brightness, 336.8);
  });

  await t.test('runIngestionPipeline - should execute fully and return stats', async () => {
    const stats = await FirmsIngestionService.runIngestionPipeline();
    
    assert.strictEqual(typeof stats.rawEntries, 'number');
    assert.strictEqual(typeof stats.geocodedArgentina, 'number');
    assert.strictEqual(typeof stats.duplicatesRemoved, 'number');
    assert.strictEqual(typeof stats.finalCount, 'number');

    // From our mock CSV payload:
    // 12 raw entries, 2 in Chile (outside), 2 duplicates in Cordoba
    // Outside removed => 10 geocoded in Argentina.
    // 2 duplicates removed => finalCount = 8.
    assert.strictEqual(stats.rawEntries, 12);
    assert.strictEqual(stats.geocodedArgentina, 10);
    assert.strictEqual(stats.duplicatesRemoved, 1);
  });
});

test('RiskCalculation Lambda Handler - 24 Provinces Validation', async (t) => {
  await t.test('runRiskCalculation - should calculate and persist risk scores for all 24 provinces', async () => {
    const persistedScores: any[] = [];
    const generatedAlerts: any[] = [];
    
    const { runRiskCalculation } = await import('../lambdas/riskCalculation.handler.js');

    const mockDeps = {
      queryHotspotsByProvince: async (province: string, date: string) => {
        return []; // No active hotspots
      },
      fetchWeather: async (province: string) => {
        return {
          data: {
            temperature: 20,
            relativeHumidity: 50,
            windSpeed: 10,
            windDir: 'N',
            rain24h: 0,
          },
          stale: false,
          province,
          fetchedAt: new Date().toISOString(),
        };
      },
      calculateFWI: (weather: any) => {
        return { success: true, fwi: 30, errors: [] };
      },
      evaluateRisk: (input: any) => {
        return {
          riskScore: 25,
          riskLevel: 'Medio' as const,
          explanation: 'Mocked risk evaluation',
          contributingFactors: [],
        };
      },
      calculateConfidence: (input: any, stale: boolean) => {
        return { confidenceScore: 92, factors: [], weatherStale: false };
      },
      putRiskScore: async (item: any) => {
        persistedScores.push(item);
      },
      putAlert: async (item: any) => {
        generatedAlerts.push(item);
      },
      publishToSNS: async (message: string, topicArn: string) => {},
    };

    const result = await runRiskCalculation(mockDeps);

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.provincesProcessed, 24, 'All 24 provinces must be processed');
    assert.strictEqual(persistedScores.length, 24, '24 risk score records must be persisted');
    assert.strictEqual(result.body.alertsGenerated, 0, 'No alerts should be generated for Medio risk');

    // Check that each province is represented
    const provinceNames = persistedScores.map(p => p.SK.replace('PROVINCE#', ''));
    assert.strictEqual(provinceNames.length, 24);
    assert.ok(provinceNames.includes('Córdoba'));
    assert.ok(provinceNames.includes('Ciudad Autónoma de Buenos Aires'));
    
    // Verify that activeHotspotsCount is 0 for empty provinces
    const cordobaRecord = persistedScores.find(p => p.SK === 'PROVINCE#Córdoba');
    assert.ok(cordobaRecord);
    assert.strictEqual(cordobaRecord.activeHotspotsCount, 0);
    assert.strictEqual(cordobaRecord.riskLevel, 'Medio');
  });
});
