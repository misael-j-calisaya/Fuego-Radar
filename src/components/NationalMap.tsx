import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, GeoJSON, Rectangle, Circle, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Hotspot, ProvinceRisk, GridCell, Alert } from '../services/api';
import { FireService } from '../services/api';
import provincesData from '../data/provinces.json';
import type { Feature, FeatureCollection } from 'geojson';

const provincesGeoJson = provincesData as unknown as FeatureCollection;

// Tracks zoom so client-side clustering can adapt
const MapEventsTracker: React.FC<{ onZoom: (zoom: number) => void }> = ({ onZoom }) => {
  const map = useMap();
  useEffect(() => {
    const onZoomEnd = () => onZoom(map.getZoom());
    map.on('zoomend', onZoomEnd);
    return () => {
      map.off('zoomend', onZoomEnd);
    };
  }, [map, onZoom]);
  return null;
};

// Name normalizer helper to align different province representations
const normalizeProvinceName = (name: string): string => {
  if (!name) return '';
  const trimmed = name.trim();
  if (trimmed.startsWith('Tierra del Fuego')) {
    return 'Tierra del Fuego';
  }
  return trimmed;
};

// Risk level color helper for premium tooltips
const getRiskLevelColor = (level?: string) => {
  switch (level) {
    case 'Extremo': return '#ef4444';
    case 'Muy Alto': return '#f87171';
    case 'Alto': return '#fb923c';
    case 'Medio': return '#facc15';
    case 'Bajo': return '#34d399';
    default: return '#a1a1aa';
  }
};

// Fix Leaflet default icon issues in React
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface NationalMapProps {
  hotspots: Hotspot[];
  provinceRisks: ProvinceRisk[];
  gridCells: GridCell[];
  alerts: Alert[];
  visibleLayers: {
    hotspots: boolean;
    clusters: boolean;
    provinces: boolean;
    grid: boolean;
    alerts: boolean;
  };
  onSelectHotspot: (hotspot: Hotspot | null) => void;
  onSelectProvince: (provinceName: string) => void;
  selectedHotspot: Hotspot | null;
  selectedProvinceName: string;
  selectedAlert: Alert | null;
}

// Map viewport controller to handle external flyTo triggers
const MapController: React.FC<{
  selectedHotspot: Hotspot | null;
  selectedProvinceName: string;
  selectedAlert: Alert | null;
}> = ({ selectedHotspot, selectedProvinceName, selectedAlert }) => {
  const map = useMap();

  useEffect(() => {
    if (selectedHotspot) {
      map.flyTo([selectedHotspot.lat, selectedHotspot.lng], 9, {
        animate: true,
        duration: 1.5,
      });
    }
  }, [selectedHotspot, map]);

  useEffect(() => {
    if (selectedAlert) {
      map.flyTo([selectedAlert.coordinates.lat, selectedAlert.coordinates.lng], 8, {
        animate: true,
        duration: 1.5,
      });
    }
  }, [selectedAlert, map]);

  useEffect(() => {
    if (selectedProvinceName) {
      // Search for province centroid in the geojson features
      const features = provincesGeoJson.features;
      const provinceFeature = features.find((f: Feature) => 
        normalizeProvinceName(f.properties?.nombre).toLowerCase() === selectedProvinceName.toLowerCase()
      );

      const centroide = provinceFeature?.properties?.centroide;
      if (centroide) {
        const { lat, lon } = centroide;
        // Zoom levels: Buenos Aires might need lower zoom, Tucuman higher. Set average 6.
        map.flyTo([lat, lon], 6, {
          animate: true,
          duration: 1.5,
        });
      }
    }
  }, [selectedProvinceName, map]);

  return null;
};

// Custom icons
const createHotspotIcon = (dangerLevel: string) => {
  const levelClass = dangerLevel.toLowerCase().replace(/\s+/g, '');
  return L.divIcon({
    className: 'custom-hotspot-marker',
    html: `
      <div class="pulse-marker">
        <div class="pulse-marker-ring ${levelClass}"></div>
        <div class="pulse-marker-dot ${levelClass}"></div>
      </div>
    `,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
};

const createClusterIcon = (count: number) => {
  return L.divIcon({
    className: 'custom-cluster-marker',
    html: `
      <div class="w-8 h-8 rounded-full bg-orange-600/40 border-2 border-orange-500/70 flex items-center justify-center text-[10px] text-orange-200 font-extrabold shadow-lg shadow-orange-950/40 animate-pulse">
        ${count}
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
};

const HotspotPopupContent: React.FC<{
  hs: Hotspot;
  onSelectHotspot: (hs: Hotspot | null) => void;
  kelvinToCelsius: (k: number) => string;
}> = ({ hs, onSelectHotspot, kelvinToCelsius }) => {
  const [verificationStatus, setVerificationStatus] = useState<'none' | 'loading' | 'verified' | 'refuted'>('none');
  const [feedbackMsg, setFeedbackMsg] = useState('');

  const handleVerify = async (e: React.MouseEvent, verified: boolean) => {
    e.stopPropagation();
    setVerificationStatus('loading');
    try {
      const result = await FireService.reportVerification(hs.id, verified);
      if (result.success) {
        setVerificationStatus(verified ? 'verified' : 'refuted');
        setFeedbackMsg(result.message);
      }
    } catch (err) {
      console.error(err);
      setVerificationStatus('none');
    }
  };

  return (
    <div className="font-sans text-xs p-2 min-w-[210px] flex flex-col gap-1.5 select-none">
      <div className="flex items-center gap-1.5 border-b border-zinc-800 pb-1.5 mb-1 select-none">
        <span className="material-symbols-outlined text-red-505 animate-pulse text-sm select-none">local_fire_department</span>
        <b className="text-red-400 text-[10px] font-bold uppercase tracking-wider">Foco Activo</b>
      </div>
      <div className="flex flex-col gap-1.5 text-zinc-305">
        <div className="flex justify-between gap-2">
          <span className="text-zinc-500 flex items-center gap-1"><span className="material-symbols-outlined text-[10px] select-none">location_on</span>Provincia:</span>
          <b className="text-zinc-200">{hs.province}</b>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-zinc-500 flex items-center gap-1"><span className="material-symbols-outlined text-[10px] select-none">explore</span>Coordenadas:</span>
          <code className="bg-zinc-950 px-1 py-0.5 rounded text-orange-400 font-mono text-[9px]">{hs.lat.toFixed(4)}, {hs.lng.toFixed(4)}</code>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-zinc-500 flex items-center gap-1"><span className="material-symbols-outlined text-[10px] select-none">satellite_alt</span>Satélite:</span>
          <span className="bg-zinc-800 px-1.5 py-0.2 rounded text-blue-400 text-[9px] font-bold uppercase">{hs.satellite}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-zinc-500 flex items-center gap-1"><span className="material-symbols-outlined text-[10px] select-none">verified</span>Confianza:</span>
          <b className="text-emerald-400">{hs.confidence}%</b>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-zinc-500 flex items-center gap-1"><span className="material-symbols-outlined text-[10px] select-none">thermostat</span>Temperatura:</span>
          <b className="text-red-400 font-mono">{kelvinToCelsius(hs.brightness)}°C</b>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-zinc-500 flex items-center gap-1"><span className="material-symbols-outlined text-[10px] select-none">weather_mix</span>FWI Clima:</span>
          <b className="text-orange-450 font-mono">{hs.fwi} pts</b>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-zinc-500 flex items-center gap-1"><span className="material-symbols-outlined text-[10px] select-none">grid_view</span>Área Est.:</span>
          <b className="text-zinc-200">~{hs.area} ha</b>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-zinc-500 flex items-center gap-1"><span className="material-symbols-outlined text-[10px] select-none">database</span>Origen:</span>
          <span className="text-[10px] text-sky-400 font-bold uppercase">FIRMS Real</span>
        </div>
      </div>
      
      {verificationStatus === 'none' && (
        <div className="flex gap-1.5 mt-2 border-t border-zinc-800/60 pt-2 select-none">
          <button
            onClick={(e) => handleVerify(e, true)}
            className="flex-1 py-1 px-1.5 bg-emerald-950/30 hover:bg-emerald-900/40 border border-emerald-800/60 text-emerald-400 text-[9px] font-bold rounded-md transition-all flex items-center justify-center gap-1 cursor-pointer"
            aria-label="Confirmar existencia de fuego en popup"
          >
            <span className="material-symbols-outlined text-[11px] select-none">check</span>
            Confirmar
          </button>
          <button
            onClick={(e) => handleVerify(e, false)}
            className="flex-1 py-1 px-1.5 bg-red-950/20 hover:bg-red-900/30 border border-red-900/40 text-red-400 text-[9px] font-bold rounded-md transition-all flex items-center justify-center gap-1 cursor-pointer"
            aria-label="Reportar falsa alarma en popup"
          >
            <span className="material-symbols-outlined text-[11px] select-none">close</span>
            Falsa Alarma
          </button>
        </div>
      )}

      {verificationStatus === 'loading' && (
        <div className="text-center py-2 text-zinc-500 text-[10px] font-mono flex items-center justify-center gap-1.5 mt-2 border-t border-zinc-800/60 pt-2">
          <span className="material-symbols-outlined animate-spin text-[10px]">sync</span>
          Enviando reporte...
        </div>
      )}

      {(verificationStatus === 'verified' || verificationStatus === 'refuted') && (
        <div className={`p-1.5 text-[9px] leading-relaxed rounded-md text-center mt-2 border ${
          verificationStatus === 'verified'
            ? 'bg-emerald-950/30 text-emerald-400 border-emerald-900/50'
            : 'bg-amber-950/25 text-amber-400 border-amber-900/40'
        }`}>
          {feedbackMsg}
        </div>
      )}

      <div className="flex gap-1.5 mt-1 border-t border-zinc-800/40 pt-1.5 select-none">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelectHotspot(hs);
          }}
          className="flex-1 py-1 px-1.5 bg-orange-600/20 hover:bg-orange-600/35 border border-orange-500/30 text-orange-400 text-[10px] font-bold rounded-md transition-all flex items-center justify-center gap-1 cursor-pointer"
        >
          <span className="material-symbols-outlined text-[11px] select-none">info</span>
          Detalles
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            const coords = `${hs.lat.toFixed(5)}, ${hs.lng.toFixed(5)}`;
            navigator.clipboard.writeText(coords);
            alert(`Coordenadas copiadas: ${coords}`);
          }}
          className="py-1 px-1.5 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-350 hover:text-zinc-200 text-[10px] font-bold rounded-md transition-all flex items-center justify-center gap-1 cursor-pointer"
        >
          <span className="material-symbols-outlined text-[11px] select-none">share</span>
          Copiar
        </button>
      </div>
    </div>
  );
};

export const NationalMap: React.FC<NationalMapProps> = React.memo(({
  hotspots,
  provinceRisks,
  gridCells,
  alerts,
  visibleLayers,
  onSelectHotspot,
  onSelectProvince,
  selectedHotspot,
  selectedProvinceName,
  selectedAlert,
}) => {
  const [mapZoom, setMapZoom] = useState(4);
  const geoJsonRef = useRef<L.GeoJSON>(null);
  
  // Ref to prevent stale closures in event listeners without detaching/re-binding
  const selectedProvinceNameRef = useRef(selectedProvinceName);
  useEffect(() => {
    selectedProvinceNameRef.current = selectedProvinceName;
  }, [selectedProvinceName]);

  const provinceRisksRef = useRef(provinceRisks);
  useEffect(() => {
    provinceRisksRef.current = provinceRisks;
  }, [provinceRisks]);

  // Custom client-side clustering logic based on zoom level (memoized)
  const clusteredNodes = useMemo(() => {
    if (mapZoom >= 7) return hotspots.map(h => ({ type: 'hotspot' as const, data: h }));

    // Threshold in degrees
    const threshold = 1.6 / Math.pow(1.6, mapZoom - 3);
    const results: ({ type: 'hotspot', data: Hotspot } | { type: 'cluster', lat: number; lng: number; count: number; hotspots: Hotspot[] })[] = [];
    const visited = new Set<string>();

    for (let i = 0; i < hotspots.length; i++) {
      const h = hotspots[i];
      if (visited.has(h.id)) continue;

      const neighbors = hotspots.filter(other => {
        if (visited.has(other.id)) return false;
        const dist = Math.sqrt(Math.pow(h.lat - other.lat, 2) + Math.pow(h.lng - other.lng, 2));
        return dist <= threshold;
      });

      if (neighbors.length > 1) {
        const avgLat = neighbors.reduce((sum, n) => sum + n.lat, 0) / neighbors.length;
        const avgLng = neighbors.reduce((sum, n) => sum + n.lng, 0) / neighbors.length;
        results.push({
          type: 'cluster',
          lat: avgLat,
          lng: avgLng,
          count: neighbors.length,
          hotspots: neighbors,
        });
        neighbors.forEach(n => visited.add(n.id));
      } else {
        results.push({ type: 'hotspot', data: h });
        visited.add(h.id);
      }
    }
    return results;
  }, [hotspots, mapZoom]);

  // Choropleth coloring for provinces
  const getProvinceColor = useCallback((provName: string) => {
    const currentRisks = provinceRisksRef.current;
    const risk = currentRisks.find(r => normalizeProvinceName(r.provinceName).toLowerCase() === provName.toLowerCase());
    if (!risk) return '#18181b'; // Zinc-900 fallback

    switch (risk.riskLevel) {
      case 'Extremo': return '#7f1d1d'; // Crimson/Critical
      case 'Muy Alto': return '#ef4444'; // Red
      case 'Alto': return '#f97316'; // Orange
      case 'Medio': return '#eab308'; // Yellow
      case 'Bajo': return '#10b981'; // Emerald
      default: return '#18181b';
    }
  }, []);

  // Style helper for GeoJSON feature representation
  const geojsonStyle = useCallback((feature?: Feature) => {
    const rawProvName = feature?.properties?.nombre;
    const provName = normalizeProvinceName(rawProvName);
    const currentRisks = provinceRisksRef.current;
    const risk = currentRisks.find(r => normalizeProvinceName(r.provinceName).toLowerCase() === provName.toLowerCase());
    const hasHotspots = risk ? risk.activeHotspotsCount > 0 : false;
    const isSelected = selectedProvinceName.toLowerCase() === provName.toLowerCase();
    
    // Base style properties
    const fillColor = getProvinceColor(provName);
    let fillOpacity = isSelected ? 0.6 : 0.22;
    let color = isSelected ? '#f97316' : '#3f3f46';
    let weight = isSelected ? 2.5 : 1.2;
    let dashArray = isSelected ? '0' : '0';

    if (risk) {
      if (hasHotspots) {
        if (!isSelected) {
          color = '#ef4444'; // Red border for active fire hotspots
          weight = 1.6;
        }
      } else {
        if (!isSelected) {
          dashArray = '3, 5';
          color = '#71717a'; // Muted border
          fillOpacity = 0.12; // lower opacity for weather only
        } else {
          dashArray = '3, 5';
        }
      }
    }

    return {
      fillColor,
      fillOpacity,
      color,
      weight,
      dashArray,
      className: isSelected 
        ? 'selected-province-path' 
        : hasHotspots 
          ? 'active-hotspot-province-path' 
          : 'weather-only-province-path'
    };
  }, [selectedProvinceName, getProvinceColor]);

  // In-place styling update loop to prevent map lag during selection/hover changes
  useEffect(() => {
    if (geoJsonRef.current) {
      geoJsonRef.current.eachLayer((layer: L.Layer) => {
        const path = layer as L.Path & { feature?: Feature };
        if (path.feature) {
          path.setStyle(geojsonStyle(path.feature));
        }
      });
    }
  }, [selectedProvinceName, provinceRisks, geojsonStyle]);

  const onEachFeature = useCallback((feature: Feature, layer: L.Layer) => {
    const rawProvName = feature?.properties?.nombre;
    const provName = normalizeProvinceName(rawProvName);

    layer.on({
      mouseover: (e) => {
        const l = e.target;
        l.setStyle({
          fillOpacity: 0.45,
          color: '#f97316',
          weight: 2,
        });
        
        const currentRisks = provinceRisksRef.current;
        const risk = currentRisks.find(r => normalizeProvinceName(r.provinceName).toLowerCase() === provName.toLowerCase());
        const hotspotsCount = risk?.activeHotspotsCount ?? 0;
        const confidence = risk?.confidenceScore ?? 70;
        const dataSource = hotspotsCount > 0 ? 'Focos + Clima' : 'Solo Clima';
        
        // Show detailed premium tooltip
        const tooltipHtml = `
          <div style="font-family: 'Outfit', sans-serif; font-size: 12px; padding: 8px; background: #09090b; border: 1px solid #27272a; border-radius: 6px; color: #f4f4f5; line-height: 1.5; pointer-events: none; min-width: 140px;">
            <b style="font-size: 13px; color: #fff; display: block; border-bottom: 1px solid #27272a; padding-bottom: 4px; margin-bottom: 6px;">${provName}</b>
            <span style="color: #a1a1aa;">Riesgo FWI:</span> <b style="color: #f97316;">${risk?.riskScore ?? 0} pts</b><br/>
            <span style="color: #a1a1aa;">Nivel:</span> <span style="font-weight: 700; color: ${getRiskLevelColor(risk?.riskLevel)};">${risk?.riskLevel ?? 'Bajo'}</span><br/>
            <span style="color: #a1a1aa;">Focos Activos:</span> <b>${hotspotsCount}</b><br/>
            <span style="color: #a1a1aa;">Confianza:</span> <b>${confidence}%</b><br/>
            <span style="color: #a1a1aa;">Origen:</span> <span style="font-weight: 600; color: ${hotspotsCount ? '#38bdf8' : '#fbbf24'}">${dataSource}</span>
          </div>
        `;

        l.bindTooltip(tooltipHtml, { sticky: true, className: 'custom-tooltip' }).openTooltip();
      },
      mouseout: (e) => {
        const l = e.target;
        const currentSelected = selectedProvinceNameRef.current;
        const isSelected = currentSelected.toLowerCase() === provName.toLowerCase();
        const currentRisks = provinceRisksRef.current;
        const risk = currentRisks.find(r => normalizeProvinceName(r.provinceName).toLowerCase() === provName.toLowerCase());
        const hasHotspots = risk ? risk.activeHotspotsCount > 0 : false;
        
        let fillOpacity = isSelected ? 0.6 : 0.22;
        let color = isSelected ? '#f97316' : '#3f3f46';
        let weight = isSelected ? 2.5 : 1.2;
        let dashArray = isSelected ? '0' : '0';

        if (risk) {
          if (hasHotspots) {
            if (!isSelected) {
              color = '#ef4444';
              weight = 1.6;
            }
          } else {
            if (!isSelected) {
              dashArray = '3, 5';
              color = '#71717a';
              fillOpacity = 0.12;
            } else {
              dashArray = '3, 5';
            }
          }
        }

        l.setStyle({
          fillOpacity,
          color,
          weight,
          dashArray,
        });
      },
      click: () => {
        onSelectProvince(provName);
      },
    });
  }, [onSelectProvince]);


  // Grid Cell coloring helper
  const getGridColor = (level: string) => {
    switch (level) {
      case 'Extremo': return '#b91c1c';
      case 'Muy Alto': return '#ef4444';
      case 'Alto': return '#f97316';
      case 'Medio': return '#eab308';
      default: return '#10b981';
    }
  };

  const kelvinToCelsius = (k: number) => (k - 273.15).toFixed(1);

  // Memoized GeoJSON Layer to prevent re-building on zoom and hover transitions
  const geoJsonLayer = useMemo(() => {
    return (
      <GeoJSON
        ref={geoJsonRef}
        key="geojson-argentina-provinces"
        data={provincesGeoJson}
        style={geojsonStyle}
        onEachFeature={onEachFeature}
      />
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onEachFeature]);

  return (
    <MapContainer
      center={[-38.0, -64.0]}
      zoom={4}
      zoomSnap={0.5}
      zoomControl={false}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        className="map-tiles-dark"
      />

      <MapController
        selectedHotspot={selectedHotspot}
        selectedProvinceName={selectedProvinceName}
        selectedAlert={selectedAlert}
      />
      <MapEventsTracker onZoom={setMapZoom} />

      {/* Layer 1: Province Choropleth Risk */}
      {visibleLayers.provinces && geoJsonLayer}

      {/* Layer 2: Grid Risk Heatmap Overlay */}
      {visibleLayers.grid &&
        gridCells.map(cell => (
          <Rectangle
            key={cell.id}
            bounds={cell.bounds}
            pathOptions={{
              fillColor: getGridColor(cell.riskLevel),
              fillOpacity: 0.2,
              color: getGridColor(cell.riskLevel),
              weight: 0.8,
              dashArray: '2,4',
            }}
          >
            <Popup>
              <div className="font-sans text-xs">
                <div className="font-bold text-zinc-100 mb-1">Celdas de Riesgo Meteorológico</div>
                <p className="text-zinc-400">FWI Estimado: <b className="text-orange-400">{cell.fwi} pts</b></p>
                <p className="text-zinc-400">Peligro: <b className="text-red-400">{cell.riskLevel}</b></p>
              </div>
            </Popup>
          </Rectangle>
        ))}

      {/* Layer 3: Warning/Alert Radii */}
      {visibleLayers.alerts &&
        alerts.map(alert => (
          <Circle
            key={alert.id}
            center={[alert.coordinates.lat, alert.coordinates.lng]}
            radius={alert.radius}
            pathOptions={{
              fillColor: alert.severity === 'Crítico' ? '#ef4444' : '#f97316',
              fillOpacity: 0.08,
              color: alert.severity === 'Crítico' ? '#b91c1c' : '#ea580c',
              weight: 1.5,
              dashArray: '4,6',
            }}
          >
            <Popup>
              <div className="font-sans text-xs max-w-[200px]">
                <div className="font-bold text-red-400 mb-1">{alert.title}</div>
                <p className="text-zinc-300 leading-normal mb-1">{alert.description}</p>
                <p className="text-zinc-500 text-[10px] font-mono">Radio: {alert.radius / 1000}km</p>
              </div>
            </Popup>
          </Circle>
        ))}

      {/* Layer 4 & 5: Active Hotspots & Clusters (toggled/computed) */}
      {visibleLayers.clusters && !visibleLayers.hotspots &&
        clusteredNodes.map((node, index) => {
          if (node.type === 'cluster') {
            return (
              <Marker
                key={`cluster-${index}`}
                position={[node.lat, node.lng]}
                icon={createClusterIcon(node.count)}
                eventHandlers={{
                  click: (e) => {
                    e.target._map.setView(e.latlng, e.target._map.getZoom() + 2);
                  }
                }}
              >
                <Popup>
                  <div className="font-sans text-xs max-h-40 overflow-y-auto">
                    <div className="font-bold text-orange-400 mb-1.5">{node.count} Focos Agrupados</div>
                    <div className="flex flex-col gap-1">
                      {node.hotspots.map(hs => (
                        <div key={hs.id} className="flex justify-between border-b border-zinc-800/40 pb-0.5">
                          <span className="text-zinc-300">{hs.province}</span>
                          <span className="text-red-400 font-bold font-mono">{kelvinToCelsius(hs.brightness)}°C</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          } else {
            const hs = node.data;
            const isSelected = selectedHotspot?.id === hs.id;
            return (
              <Marker
                key={hs.id}
                position={[hs.lat, hs.lng]}
                icon={createHotspotIcon(hs.dangerLevel)}
                eventHandlers={{
                  click: () => onSelectHotspot(hs),
                  popupclose: () => onSelectHotspot(null)
                }}
              >
                {isSelected && (
                  <Popup>
                    <HotspotPopupContent hs={hs} onSelectHotspot={onSelectHotspot} kelvinToCelsius={kelvinToCelsius} />
                  </Popup>
                )}
              </Marker>
            );
          }
        })}

      {visibleLayers.hotspots &&
        hotspots.map(hs => {
          const isSelected = selectedHotspot?.id === hs.id;
          return (
            <Marker
              key={`hotspot-ind-${hs.id}`}
              position={[hs.lat, hs.lng]}
              icon={createHotspotIcon(hs.dangerLevel)}
              eventHandlers={{
                click: () => onSelectHotspot(hs),
                popupclose: () => onSelectHotspot(null)
              }}
            >
              {isSelected && (
                <Popup>
                  <HotspotPopupContent hs={hs} onSelectHotspot={onSelectHotspot} kelvinToCelsius={kelvinToCelsius} />
                </Popup>
              )}
            </Marker>
          );
        })}
    </MapContainer>
  );
});

export default NationalMap;
