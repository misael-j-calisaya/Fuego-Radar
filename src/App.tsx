import React, { useEffect, useState, Suspense, useCallback, useMemo } from 'react';
import { TooltipProvider } from "@/components/ui/tooltip";

import {
  FireService,
  mockProvinceRisks,
  mockGridCells,
  mockAlerts
} from './services/api';
import type {
  Hotspot,
  ProvinceRisk,
  GridCell,
  Alert,
  DataSourceStatus as StatusType
} from './services/api';

import ProvinceRiskRanking from './components/ProvinceRiskRanking';
import RiskLegend from './components/RiskLegend';

// Lazy load components including the map
const NationalMap = React.lazy(() => import('./components/NationalMap'));
const AlertPanel = React.lazy(() => import('./components/AlertPanel'));
const AlertSubscriptionForm = React.lazy(() => import('./components/AlertSubscriptionForm'));
const HotspotDetails = React.lazy(() => import('./components/HotspotDetails'));
const DataSourceStatus = React.lazy(() => import('./components/DataSourceStatus'));


export const App: React.FC = () => {
  // Progressive loading states
  const [provincesLoading, setProvincesLoading] = useState(true);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [statusLoading, setStatusLoading] = useState(true);

  // Data states
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [provinceRisks, setProvinceRisks] = useState<ProvinceRisk[]>([]);
  const [gridCells, setGridCells] = useState<GridCell[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [sourceStatuses, setSourceStatuses] = useState<StatusType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  // Interaction states
  const [selectedHotspot, setSelectedHotspot] = useState<Hotspot | null>(null);
  const [selectedProvinceName, setSelectedProvinceName] = useState<string>('');
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  
  // Custom Layer Control Toggles
  const [visibleLayers, setVisibleLayers] = useState({
    hotspots: false,
    clusters: true,
    provinces: true,
    grid: false,
    alerts: true,
  });

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);

  // Collapsible section states
  const [rankingExpanded, setRankingExpanded] = useState(true);
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const [subscriptionExpanded, setSubscriptionExpanded] = useState(false);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);

  // Calculate dynamic freshness timestamp
  const lastFreshness = useMemo(() => {
    if (sourceStatuses.length === 0) return '12:00:00';
    try {
      const times = sourceStatuses.map(s => new Date(s.lastSync).getTime()).filter(t => !isNaN(t));
      if (times.length === 0) return '12:00:00';
      return new Date(Math.max(...times)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      return '12:00:00';
    }
  }, [sourceStatuses]);

  // Fetch data progressively
  const fetchData = useCallback(() => {
    setProvincesLoading(true);
    setAlertsLoading(true);
    setStatusLoading(true);
    setError(null);

    // 1. Fetch province risks
    FireService.getProvinceRisks()
      .then(data => {
        if (!data || data.length === 0) {
          console.log('Backend riskData is empty. Falling back to frontend mock data.');
          setProvinceRisks(mockProvinceRisks);
          setGridCells(mockGridCells);
          setIsDemo(true);
        } else {
          setProvinceRisks(data);
          setIsDemo(false);
        }
      })
      .catch(err => {
        console.error('Error fetching province risks:', err);
        setProvinceRisks(mockProvinceRisks);
        setGridCells(mockGridCells);
        setIsDemo(true);
        setError('Error al obtener datos provinciales.');
      })
      .finally(() => setProvincesLoading(false));

    // 2. Fetch active hotspots
    FireService.getActiveHotspots()
      .then(data => setHotspots(data || []))
      .catch(err => console.error('Error fetching active hotspots:', err));

    // 3. Fetch alerts
    FireService.getAlerts()
      .then(data => setAlerts(data || []))
      .catch(err => {
        console.error('Error fetching alerts:', err);
        setAlerts(mockAlerts);
      })
      .finally(() => setAlertsLoading(false));

    // 4. Fetch grid cells
    FireService.getGridCells()
      .then(data => setGridCells(data || []))
      .catch(err => console.error('Error fetching grid cells:', err));

    // 5. Fetch statuses
    FireService.getSourceStatuses()
      .then(data => setSourceStatuses(data || []))
      .catch(err => console.error('Error fetching statuses:', err))
      .finally(() => setStatusLoading(false));
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Polling interval for hotspots update
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const hsData = await FireService.getActiveHotspots();
        setHotspots(hsData || []);
        
        // Randomise statuses latency slightly to show simulated traffic
        setSourceStatuses(prev => prev.map(s => ({
          ...s,
          lastSync: new Date().toISOString(),
          latencyMs: Math.max(50, s.latencyMs + Math.floor(Math.random() * 30) - 15)
        })));
      } catch (e) {
        console.error('Polling error:', e);
      }
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const handleSelectHotspot = (hotspot: Hotspot | null) => {
    setSelectedHotspot(hotspot);
    if (hotspot) {
      setSelectedAlert(null);
      setSelectedProvinceName(hotspot.province);
    }
  };

  const handleSelectAlert = (alert: Alert) => {
    setSelectedAlert(alert);
    setSelectedHotspot(null);
    setSelectedProvinceName(alert.province);
  };

  const handleSelectProvince = (provinceName: string) => {
    setSelectedProvinceName(provinceName);
    // Find first active hotspot in this province
    const relatedHotspot = hotspots.find(h => h.province.toLowerCase() === provinceName.toLowerCase());
    if (relatedHotspot) {
      setSelectedHotspot(relatedHotspot);
    } else {
      setSelectedHotspot(null);
    }
  };

  const toggleLayer = (layerKey: keyof typeof visibleLayers) => {
    setVisibleLayers((prev) => {
      const next = { ...prev, [layerKey]: !prev[layerKey] };
      // Mutual exclusion for clusters and single hotspots
      if (layerKey === 'hotspots' && next.hotspots) {
        next.clusters = false;
      } else if (layerKey === 'clusters' && next.clusters) {
        next.hotspots = false;
      }
      return next;
    });
  };

  const provincesList = provinceRisks.map(r => r.provinceName).sort();

  return (
    <TooltipProvider>
      <div className="dashboard-container">
        {/* Mobile Toggle Button for Sidebar */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="sidebar-toggle-btn"
          aria-label="Toggle Sidebar"
          aria-expanded={!sidebarCollapsed}
        >
          <span className="material-symbols-outlined select-none text-zinc-200">
            {sidebarCollapsed ? 'menu' : 'close'}
          </span>
        </button>

        {/* Sidebar - Control center */}
        <aside className={`sidebar glass-panel ${sidebarCollapsed ? 'collapsed' : ''}`}>
          {/* Header section (rebuilt compact with LIVE badge & Material Icons) */}
          <div className="sidebar-header flex items-center justify-between w-full">
            <div className="flex items-center gap-3 select-none">
              <div className="relative w-8 h-8 flex items-center justify-center bg-orange-600/10 border border-orange-500/30 rounded-lg">
                <span className="material-symbols-outlined text-orange-500 text-base animate-pulse">
                  local_fire_department
                </span>
              </div>
              <div>
                <h1 className="sidebar-title text-base font-bold flex items-center gap-1.5 text-zinc-100">
                  Alerta Fuego
                </h1>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold">
                  Argentina Dashboard
                </p>
              </div>
            </div>
            <span className="px-1.5 py-0.5 bg-red-500/15 text-red-400 border border-red-500/30 rounded text-[9px] font-extrabold uppercase tracking-wide animate-pulse flex items-center gap-1 select-none">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block animate-ping"></span>
              LIVE
            </span>
          </div>

          {/* Sidebar Content (Scrollable) */}
          <div className="sidebar-content">
            {error ? (
              <div className="p-4 bg-red-950/20 border border-red-500/20 rounded-xl flex flex-col gap-3 text-center">
                <span className="material-symbols-outlined text-red-505 text-3xl select-none">
                  warning
                </span>
                <h2 className="font-bold text-red-300 text-xs uppercase tracking-wider">Error de Carga</h2>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  {error}
                </p>
                <button 
                  onClick={fetchData} 
                  className="mt-1 px-3 py-1 bg-red-900/40 hover:bg-red-900/60 border border-red-800 text-red-355 rounded-lg text-[10px] uppercase font-bold tracking-wider transition-colors cursor-pointer"
                >
                  Reintentar
                </button>
              </div>
            ) : (
              <Suspense fallback={
                <div className="flex justify-center py-6">
                  <span className="material-symbols-outlined animate-spin text-brand-fire-orange">sync</span>
                </div>
              }>
                {/* Executive Summary Card */}
                <div className="p-4 bg-zinc-950/80 border border-zinc-800/80 rounded-2xl flex flex-col gap-3 shadow-lg select-none shrink-0">
                  <h2 className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5 border-b border-zinc-800/60 pb-2">
                    <span className="material-symbols-outlined text-orange-500 text-sm select-none">dashboard</span>
                    Resumen Ejecutivo
                  </h2>
                  <div className="executive-kpi-grid">
                    <div className="executive-kpi-card">
                      <span className="executive-kpi-label">Focos Activos</span>
                      <div className="executive-kpi-value hotspots font-mono">
                        {hotspots.length}
                      </div>
                    </div>
                    <div className="executive-kpi-card">
                      <span className="executive-kpi-label">En Riesgo</span>
                      <div className="executive-kpi-value riesgo font-mono">
                        {provinceRisks.filter(p => p.riskLevel !== 'Bajo').length}
                        <span className="text-[11px] font-bold text-zinc-500 lowercase tracking-normal">provs</span>
                      </div>
                    </div>
                    <div className="executive-kpi-card">
                      <span className="executive-kpi-label">Alertas Críticas</span>
                      <div className="executive-kpi-value alertas font-mono">
                        {alerts.filter(a => a.severity === 'Crítico' || a.severity === 'Alto').length}
                      </div>
                    </div>
                    <div className="executive-kpi-card">
                      <span className="executive-kpi-label">Actualización</span>
                      <div className="executive-kpi-value actualizacion font-mono">
                        <span className="material-symbols-outlined text-[15px] text-emerald-400 shrink-0 select-none">schedule</span>
                        {lastFreshness}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Collapsible Province Ranking */}
                <div className="flex flex-col gap-2 border-b border-zinc-900/80 pb-3">
                  <h2 className="flex w-full">
                    <button
                      onClick={() => setRankingExpanded(!rankingExpanded)}
                      className="flex items-center justify-between w-full py-1.5 text-left cursor-pointer hover:text-zinc-200 transition-colors select-none"
                      aria-expanded={rankingExpanded}
                    >
                      <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-orange-500 text-sm select-none">equalizer</span>
                        Riesgo por Provincia
                      </span>
                      <span className="material-symbols-outlined text-zinc-500 text-sm select-none">
                        {rankingExpanded ? 'expand_less' : 'expand_more'}
                      </span>
                    </button>
                  </h2>
                  {rankingExpanded && (
                    <ProvinceRiskRanking
                      rankings={provinceRisks}
                      onSelectProvince={handleSelectProvince}
                      selectedProvince={selectedProvinceName}
                      isDemo={isDemo}
                      loading={provincesLoading}
                    />
                  )}
                </div>

                {/* Collapsible Active Alerts */}
                <div className="flex flex-col gap-2 border-b border-zinc-900/80 pb-3">
                  <h2 className="flex w-full">
                    <button
                      onClick={() => setAlertsExpanded(!alertsExpanded)}
                      className="flex items-center justify-between w-full py-1.5 text-left cursor-pointer hover:text-zinc-200 transition-colors select-none"
                      aria-expanded={alertsExpanded}
                    >
                      <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-red-505 text-sm select-none">notifications_active</span>
                        Alertas Activas
                      </span>
                      <span className="material-symbols-outlined text-zinc-500 text-sm select-none">
                        {alertsExpanded ? 'expand_less' : 'expand_more'}
                      </span>
                    </button>
                  </h2>
                  {alertsExpanded && (
                    <AlertPanel
                      alerts={alerts}
                      onSelectAlert={handleSelectAlert}
                      selectedAlertId={selectedAlert?.id}
                      isDemo={isDemo}
                      loading={alertsLoading}
                    />
                  )}
                </div>

                {/* Collapsible Subscription */}
                <div className="flex flex-col gap-2 border-b border-zinc-900/80 pb-3">
                  <h2 className="flex w-full">
                    <button
                      onClick={() => setSubscriptionExpanded(!subscriptionExpanded)}
                      className="flex items-center justify-between w-full py-1.5 text-left cursor-pointer hover:text-zinc-200 transition-colors select-none"
                      aria-expanded={subscriptionExpanded}
                    >
                      <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-zinc-400 text-sm select-none">shield_with_heart</span>
                        Suscripción de Alertas
                      </span>
                      <span className="material-symbols-outlined text-zinc-500 text-sm select-none">
                        {subscriptionExpanded ? 'expand_less' : 'expand_more'}
                      </span>
                    </button>
                  </h2>
                  {subscriptionExpanded && (
                    <AlertSubscriptionForm provinces={provincesList} />
                  )}
                </div>

                {/* Collapsible Data Sources */}
                <div className="flex flex-col gap-2">
                  <h2 className="flex w-full">
                    <button
                      onClick={() => setSourcesExpanded(!sourcesExpanded)}
                      className="flex items-center justify-between w-full py-1.5 text-left cursor-pointer hover:text-zinc-200 transition-colors select-none"
                      aria-expanded={sourcesExpanded}
                    >
                      <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-zinc-400 text-sm select-none">sensors</span>
                        Fuentes de Información
                      </span>
                      <span className="material-symbols-outlined text-zinc-500 text-sm select-none">
                        {sourcesExpanded ? 'expand_less' : 'expand_more'}
                      </span>
                    </button>
                  </h2>
                  {sourcesExpanded && (
                    <DataSourceStatus statuses={sourceStatuses} loading={statusLoading} />
                  )}
                </div>
              </Suspense>
            )}
          </div>
        </aside>

        {/* Main Map Visualization */}
        <main className="flex-1 h-full w-full relative">
          {/* Top Floating KPI Strip over Map */}
          <div className="top-kpi-container select-none">
            {/* Focos Activos */}
            <div className="top-kpi-item">
              <span className="top-kpi-icon flex items-center justify-center relative">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping absolute"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 absolute"></span>
              </span>
              <div className="top-kpi-text">
                <span className="top-kpi-label">Focos Activos</span>
                <span className="top-kpi-value hotspots font-mono">{hotspots.length}</span>
              </div>
            </div>

            <div className="top-kpi-divider"></div>

            {/* Provincias en Riesgo */}
            <div className="top-kpi-item">
              <span className="top-kpi-icon text-orange-500 material-symbols-outlined select-none">equalizer</span>
              <div className="top-kpi-text">
                <span className="top-kpi-label">En Riesgo</span>
                <span className="top-kpi-value riesgo font-mono">
                  {provinceRisks.filter(p => p.riskLevel !== 'Bajo').length}
                </span>
              </div>
            </div>

            <div className="top-kpi-divider"></div>

            {/* Alertas Urgentes */}
            <div className="top-kpi-item">
              <span className="top-kpi-icon text-red-400 material-symbols-outlined select-none animate-pulse">warning</span>
              <div className="top-kpi-text">
                <span className="top-kpi-label">Alertas Urgentes</span>
                <span className="top-kpi-value alertas font-mono">
                  {alerts.filter(a => a.severity === 'Crítico' || a.severity === 'Alto').length}
                </span>
              </div>
            </div>

            <div className="top-kpi-divider"></div>

            {/* Satélites */}
            <div className="top-kpi-item">
              <span className="top-kpi-icon text-emerald-400 material-symbols-outlined select-none">satellite_alt</span>
              <div className="top-kpi-text">
                <span className="top-kpi-label">Satélites</span>
                <span className="top-kpi-value satellites font-mono uppercase">VIIRS+MODIS</span>
              </div>
            </div>
          </div>


          <Suspense fallback={
            <div className="w-full h-full bg-[#0c0a09] flex flex-col items-center justify-center gap-4 text-zinc-400 select-none">
              <div className="relative flex items-center justify-center">
                <span className="material-symbols-outlined text-orange-500 text-4xl animate-pulse">
                  map
                </span>
                <span className="material-symbols-outlined text-red-505 text-lg absolute -top-1 -right-1 animate-ping">
                  local_fire_department
                </span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">Cargando Visor Satelital</span>
                <span className="text-[10px] text-zinc-500 font-medium">Cargando base cartográfica nacional...</span>
              </div>
              <span className="material-symbols-outlined animate-spin text-orange-500 mt-2">sync</span>
            </div>
          }>
            <NationalMap
              hotspots={hotspots}
              provinceRisks={provinceRisks}
              gridCells={gridCells}
              alerts={alerts}
              visibleLayers={visibleLayers}
              onSelectHotspot={handleSelectHotspot}
              onSelectProvince={handleSelectProvince}
              selectedHotspot={selectedHotspot}
              selectedProvinceName={selectedProvinceName}
              selectedAlert={selectedAlert}
            />
          </Suspense>

          {/* Custom Layer Control overlay Panel (Top Right) */}
          <div className="absolute top-4 right-4 z-[1000] flex flex-col items-end gap-2 pointer-events-auto">
            <button
              onClick={() => setLayersPanelOpen(!layersPanelOpen)}
              className="p-3 bg-zinc-950/85 hover:bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl text-zinc-300 hover:text-orange-500 transition-all flex items-center gap-2 select-none"
              aria-label="Configurar Capas del Mapa"
              aria-expanded={layersPanelOpen}
            >
              <span className="material-symbols-outlined text-md select-none">layers</span>
              <span className="text-xs font-bold uppercase tracking-wider">Capas</span>
            </button>

            {layersPanelOpen && (
              <div className="glass-panel p-4 w-56 flex flex-col gap-2.5 bg-zinc-950/90 border border-zinc-800/80 rounded-xl shadow-2xl animate-fade-in text-xs">
                <div className="font-semibold text-zinc-400 uppercase tracking-wider text-[10px] pb-1.5 border-b border-zinc-800 flex items-center gap-1.5 select-none">
                  <span className="material-symbols-outlined text-brand-fire-orange text-sm select-none">tune</span>
                  Control de Capas
                </div>
                
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none text-zinc-200">
                    <input
                      type="checkbox"
                      checked={visibleLayers.clusters}
                      onChange={() => toggleLayer('clusters')}
                      className="w-3.5 h-3.5 rounded border-zinc-800 accent-orange-500 cursor-pointer"
                    />
                    <span>Agrupamientos (Clusters)</span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none text-zinc-200">
                    <input
                      type="checkbox"
                      checked={visibleLayers.hotspots}
                      onChange={() => toggleLayer('hotspots')}
                      className="w-3.5 h-3.5 rounded border-zinc-800 accent-orange-500 cursor-pointer"
                    />
                    <span>Focos Activos</span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none text-zinc-200">
                    <input
                      type="checkbox"
                      checked={visibleLayers.provinces}
                      onChange={() => toggleLayer('provinces')}
                      className="w-3.5 h-3.5 rounded border-zinc-800 accent-orange-500 cursor-pointer"
                    />
                    <span>Riesgo por Provincia</span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none text-zinc-200">
                    <input
                      type="checkbox"
                      checked={visibleLayers.grid}
                      onChange={() => toggleLayer('grid')}
                      className="w-3.5 h-3.5 rounded border-zinc-800 accent-orange-500 cursor-pointer"
                    />
                    <span>Grilla de Riesgo (FWI)</span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none text-zinc-200">
                    <input
                      type="checkbox"
                      checked={visibleLayers.alerts}
                      onChange={() => toggleLayer('alerts')}
                      className="w-3.5 h-3.5 rounded border-zinc-800 accent-orange-500 cursor-pointer"
                    />
                    <span>Zonas de Alerta</span>
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Selected Hotspot Details overlay (Floating bottom next to sidebar) */}
          {selectedHotspot && (
            <div className="absolute bottom-6 left-[424px] w-80 z-[1000] pointer-events-auto">
              <Suspense fallback={
                <div className="glass-panel p-4 bg-zinc-950/90 border border-orange-500/30 rounded-xl text-center text-xs">
                  <span className="material-symbols-outlined animate-spin text-brand-fire-orange select-none">sync</span>
                </div>
              }>
                <HotspotDetails
                  hotspot={selectedHotspot}
                  onClose={() => setSelectedHotspot(null)}
                />
              </Suspense>
            </div>
          )}

          {/* Legend Overlay (Bottom Right Overlay) */}
          <div className="floating-widget-bottom-right">
            <RiskLegend />
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
};

export default App;
