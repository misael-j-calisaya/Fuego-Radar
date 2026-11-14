export interface WeatherData {
  temperature: number; // in Celsius
  relativeHumidity: number; // percentage 0 - 100
  windSpeed: number; // km/h
  windDir: string;
}

export class WeatherClient {
  /**
   * Simulates fetching meteorological telemetry from SMN or open weather APIs for a given point.
   */
  static async getForecast(lat: number, lng: number): Promise<WeatherData> {
    return new Promise((resolve) => {
      setTimeout(() => {
        // Patagonia (Chubut, Río Negro, Santa Cruz)
        if (lat < -40) {
          resolve({
            temperature: 12.5,
            relativeHumidity: 22,
            windSpeed: 28,
            windDir: 'O' // West winds
          });
        }
        // Centro (Córdoba, San Luis)
        else if (lat < -30 && lat > -33 && lng < -63) {
          resolve({
            temperature: 31.8,
            relativeHumidity: 9, // extreme dry
            windSpeed: 32, // strong wind
            windDir: 'N' // North winds
          });
        }
        // Delta / Litoral (Entre Ríos, Santa Fe)
        else if (lat < -31 && lat > -34 && lng >= -63) {
          resolve({
            temperature: 24.0,
            relativeHumidity: 38,
            windSpeed: 15,
            windDir: 'NE'
          });
        }
        // Noroeste (Jujuy, Salta)
        else if (lat < -22 && lat > -26) {
          resolve({
            temperature: 28.5,
            relativeHumidity: 12,
            windSpeed: 20,
            windDir: 'NE'
          });
        }
        // Default values
        else {
          resolve({
            temperature: 20.0,
            relativeHumidity: 45,
            windSpeed: 12,
            windDir: 'SE'
          });
        }
      }, 100);
    });
  }
}
