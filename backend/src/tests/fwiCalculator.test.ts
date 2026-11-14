import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFWI, calculateFWIUnsafe, getDangerLevel } from '../services/fwiCalculator.js';
import type { WeatherData } from '../shared/types.js';

describe('fwiCalculator', () => {
  describe('calculateFWIUnsafe', () => {
    it('should compute raw FWI correctly for known inputs', () => {
      // temp=5, humidity=80, wind=5 → 5 + 10 + 2 = 17
      assert.equal(calculateFWIUnsafe(5, 80, 5), 17);
    });

    it('should clamp negative results to 0', () => {
      // temp=-20, humidity=100, wind=0 → -20 + 0 + 0 = -20 → clamped to 0
      assert.equal(calculateFWIUnsafe(-20, 100, 0), 0);
    });

    it('should clamp results above 100 to 100', () => {
      // temp=50, humidity=0, wind=100 → 50 + 50 + 40 = 140 → clamped to 100
      assert.equal(calculateFWIUnsafe(50, 0, 100), 100);
    });
  });

  describe('getDangerLevel', () => {
    it('should return Bajo for FWI < 20', () => {
      assert.equal(getDangerLevel(0), 'Bajo');
      assert.equal(getDangerLevel(19), 'Bajo');
    });

    it('should return Medio for FWI in [20, 40)', () => {
      assert.equal(getDangerLevel(20), 'Medio');
      assert.equal(getDangerLevel(39), 'Medio');
    });

    it('should return Alto for FWI in [40, 60)', () => {
      assert.equal(getDangerLevel(40), 'Alto');
      assert.equal(getDangerLevel(59), 'Alto');
    });

    it('should return Muy Alto for FWI in [60, 80)', () => {
      assert.equal(getDangerLevel(60), 'Muy Alto');
      assert.equal(getDangerLevel(79), 'Muy Alto');
    });

    it('should return Extremo for FWI >= 80', () => {
      assert.equal(getDangerLevel(80), 'Extremo');
      assert.equal(getDangerLevel(100), 'Extremo');
    });
  });

  describe('calculateFWI (validated)', () => {
    it('should compute low risk weather (Bajo)', () => {
      // temp=5, humidity=80, windSpeed=5 → rawFWI = 5 + 10 + 2 = 17
      const weather: WeatherData = {
        temperature: 5,
        relativeHumidity: 80,
        windSpeed: 5,
        windDir: 'N',
      };
      const result = calculateFWI(weather);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.result.fwiScore, 17);
        assert.equal(result.result.dangerLevel, 'Bajo');
        assert.equal(result.result.explanation, 'Condiciones meteorológicas de bajo riesgo de incendio.');
      }
    });

    it('should compute moderate risk weather (Medio)', () => {
      // temp=15, humidity=60, windSpeed=10 → 15 + 20 + 4 = 39
      const weather: WeatherData = {
        temperature: 15,
        relativeHumidity: 60,
        windSpeed: 10,
        windDir: 'S',
      };
      const result = calculateFWI(weather);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.result.fwiScore, 39);
        assert.equal(result.result.dangerLevel, 'Medio');
        assert.equal(result.result.explanation, 'Condiciones meteorológicas de riesgo moderado de incendio.');
      }
    });

    it('should compute high risk weather (Alto)', () => {
      // temp=20, humidity=40, windSpeed=15 → 20 + 30 + 6 = 56
      const weather: WeatherData = {
        temperature: 20,
        relativeHumidity: 40,
        windSpeed: 15,
        windDir: 'E',
      };
      const result = calculateFWI(weather);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.result.fwiScore, 56);
        assert.equal(result.result.dangerLevel, 'Alto');
        assert.equal(result.result.explanation, 'Condiciones meteorológicas de alto riesgo de incendio.');
      }
    });

    it('should compute extreme risk weather (Extremo)', () => {
      // temp=40, humidity=10, windSpeed=35 → 40 + 45 + 14 = 99
      const weather: WeatherData = {
        temperature: 40,
        relativeHumidity: 10,
        windSpeed: 35,
        windDir: 'O',
      };
      const result = calculateFWI(weather);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.result.fwiScore, 99);
        assert.equal(result.result.dangerLevel, 'Extremo');
        assert.equal(result.result.explanation, 'Condiciones meteorológicas extremas de riesgo de incendio.');
      }
    });

    it('should not be affected by rain24h (FWI only uses temp/humidity/wind)', () => {
      // temp=30, humidity=40, windSpeed=20 → 30 + 30 + 8 = 68
      const weather: WeatherData = {
        temperature: 30,
        relativeHumidity: 40,
        windSpeed: 20,
        windDir: 'NE',
        rain24h: 50,
      };
      const result = calculateFWI(weather);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.result.fwiScore, 68);
      }
    });

    it('should be deterministic (same inputs → same output)', () => {
      const weather: WeatherData = {
        temperature: 25,
        relativeHumidity: 50,
        windSpeed: 10,
        windDir: 'N',
      };
      const result1 = calculateFWI(weather);
      const result2 = calculateFWI(weather);
      assert.deepEqual(result1, result2);
    });

    it('should return validation error for temperature out of range', () => {
      const weather: WeatherData = {
        temperature: 55,
        relativeHumidity: 50,
        windSpeed: 10,
        windDir: 'N',
      };
      const result = calculateFWI(weather);
      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(result.errors.length, 1);
        assert.equal(result.errors[0].field, 'temperature');
        assert.equal(result.errors[0].value, 55);
      }
    });

    it('should return validation error for humidity out of range', () => {
      const weather: WeatherData = {
        temperature: 20,
        relativeHumidity: -5,
        windSpeed: 10,
        windDir: 'N',
      };
      const result = calculateFWI(weather);
      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(result.errors.length, 1);
        assert.equal(result.errors[0].field, 'relativeHumidity');
        assert.equal(result.errors[0].value, -5);
      }
    });

    it('should return validation error for negative wind speed', () => {
      const weather: WeatherData = {
        temperature: 20,
        relativeHumidity: 50,
        windSpeed: -1,
        windDir: 'N',
      };
      const result = calculateFWI(weather);
      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(result.errors.length, 1);
        assert.equal(result.errors[0].field, 'windSpeed');
        assert.equal(result.errors[0].value, -1);
      }
    });

    it('should return multiple validation errors when multiple inputs are invalid', () => {
      const weather: WeatherData = {
        temperature: 55,
        relativeHumidity: -5,
        windSpeed: -1,
        windDir: 'N',
      };
      const result = calculateFWI(weather);
      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(result.errors.length, 3);
        const fields = result.errors.map(e => e.field);
        assert.ok(fields.includes('temperature'));
        assert.ok(fields.includes('relativeHumidity'));
        assert.ok(fields.includes('windSpeed'));
      }
    });

    it('should accept boundary values (min temperature, max humidity, zero wind)', () => {
      // temp=-20, humidity=100, windSpeed=0 → -20 + 0 + 0 = -20 → clamped to 0
      const weather: WeatherData = {
        temperature: -20,
        relativeHumidity: 100,
        windSpeed: 0,
        windDir: 'N',
      };
      const result = calculateFWI(weather);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.result.fwiScore, 0);
        assert.equal(result.result.dangerLevel, 'Bajo');
      }
    });

    it('should accept boundary values (max temperature, min humidity)', () => {
      // temp=50, humidity=0, windSpeed=0 → 50 + 50 + 0 = 100
      const weather: WeatherData = {
        temperature: 50,
        relativeHumidity: 0,
        windSpeed: 0,
        windDir: 'N',
      };
      const result = calculateFWI(weather);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.result.fwiScore, 100);
        assert.equal(result.result.dangerLevel, 'Extremo');
      }
    });

    it('should clamp upper bound when raw FWI exceeds 100', () => {
      // temp=50, humidity=0, windSpeed=100 → 50 + 50 + 40 = 140 → clamped to 100
      const weather: WeatherData = {
        temperature: 50,
        relativeHumidity: 0,
        windSpeed: 100,
        windDir: 'N',
      };
      const result = calculateFWI(weather);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.result.fwiScore, 100);
        assert.equal(result.result.dangerLevel, 'Extremo');
      }
    });
  });
});
