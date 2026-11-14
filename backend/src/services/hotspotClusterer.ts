import { EnrichedHotspot } from './riskEngine.js';

export interface HotspotCluster {
  id: string;
  lat: number;
  lng: number;
  count: number;
  hotspots: EnrichedHotspot[];
}

export class HotspotClusterer {
  /**
   * Clusters active hotspots dynamically if their spatial distance is within the threshold.
   * Useful for reducing load and rendering density on map views.
   * 
   * @param hotspots List of enriched hotspots to cluster
   * @param threshold Distance threshold in decimal degrees
   */
  static cluster(hotspots: EnrichedHotspot[], threshold: number = 0.5): (EnrichedHotspot | HotspotCluster)[] {
    const results: (EnrichedHotspot | HotspotCluster)[] = [];
    const visited = new Set<string>();

    for (let i = 0; i < hotspots.length; i++) {
      const h = hotspots[i];
      if (visited.has(h.id)) continue;

      // Find neighbors that haven't been grouped yet and are within threshold distance
      const neighbors = hotspots.filter(other => {
        if (visited.has(other.id)) return false;
        // Euclidean distance in degrees (sufficient for regional clustering)
        const dist = Math.sqrt(Math.pow(h.lat - other.lat, 2) + Math.pow(h.lng - other.lng, 2));
        return dist <= threshold;
      });

      if (neighbors.length > 1) {
        // Average coordinates for the cluster center
        const avgLat = neighbors.reduce((sum, n) => sum + n.lat, 0) / neighbors.length;
        const avgLng = neighbors.reduce((sum, n) => sum + n.lng, 0) / neighbors.length;

        results.push({
          id: `cluster-${h.id}`,
          lat: avgLat,
          lng: avgLng,
          count: neighbors.length,
          hotspots: neighbors
        });

        // Mark all neighbors as clustered
        neighbors.forEach(n => visited.add(n.id));
      } else {
        // Standalone hotspot
        results.push(h);
        visited.add(h.id);
      }
    }

    return results;
  }
}
