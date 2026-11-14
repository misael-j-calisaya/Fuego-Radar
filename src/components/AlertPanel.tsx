import React, { useState, useMemo } from 'react';
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Alert } from '../services/api';

interface AlertPanelProps {
  alerts: Alert[];
  onSelectAlert: (alert: Alert) => void;
  selectedAlertId?: string;
  isDemo?: boolean;
  loading?: boolean;
}

type FilterType = 'all' | 'critical' | 'warning' | 'info';

export const AlertPanel: React.FC<AlertPanelProps> = React.memo(({ alerts, onSelectAlert, selectedAlertId, isDemo, loading }) => {
  const [filter, setFilter] = useState<FilterType>('all');

  const filteredAlerts = useMemo(() => {
    return alerts.filter(alert => {
      if (filter === 'critical') return alert.severity === 'Crítico';
      if (filter === 'warning') return alert.severity === 'Alto';
      if (filter === 'info') return alert.severity === 'Medio' || alert.severity === 'Bajo';
      return true;
    });
  }, [alerts, filter]);

  const getSeverityBadge = (severity: Alert['severity']) => {
    switch (severity) {
      case 'Crítico':
        return <Badge variant="destructive" className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/25 font-bold text-[8px] uppercase tracking-wider select-none">Crítico</Badge>;
      case 'Alto':
        return <Badge className="bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/25 font-bold text-[8px] uppercase tracking-wider select-none">Alto</Badge>;
      case 'Medio':
        return <Badge className="bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border border-yellow-500/25 font-bold text-[8px] uppercase tracking-wider select-none">Medio</Badge>;
      case 'Bajo':
        return <Badge className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/25 font-bold text-[8px] uppercase tracking-wider select-none">Bajo</Badge>;
    }
  };

  const getAlertIcon = (type: Alert['type']) => {
    switch (type) {
      case 'Incendio':
        return <span className="material-symbols-outlined text-red-505 text-sm select-none">warning</span>;
      case 'Meteorológica':
        return <span className="material-symbols-outlined text-sky-400 text-sm select-none">air</span>;
      case 'Evacuación':
        return <span className="material-symbols-outlined text-red-600 animate-pulse text-sm select-none">notification_important</span>;
      default:
        return <span className="material-symbols-outlined text-zinc-500 text-sm select-none">help</span>;
    }
  };

  const formatTimeAgo = (isoString?: string) => {
    if (!isoString) return 'Hace 1 min'; // safe fallback
    const diffMs = Date.now() - new Date(isoString).getTime();
    if (isNaN(diffMs)) return 'Hace 1 min';
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'Hace instantes';
    if (minutes < 60) return `Hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    return `Hace ${hours} hr${hours > 1 ? 's' : ''}`;
  };

  return (
    <div className="flex flex-col gap-3 shrink-0">
      <div className="flex items-center justify-between select-none">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-red-550 animate-pulse text-[14px]">
            notifications_active
          </span>
          Alertas ({loading ? '...' : filteredAlerts.length})
          {isDemo && (
            <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[8px] font-black uppercase tracking-wider px-1.5 py-0">
              Demo
            </Badge>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1.5 p-1 bg-zinc-950/60 rounded-lg border border-zinc-800/80">
        {(['all', 'critical', 'warning', 'info'] as FilterType[]).map((type) => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            aria-label={`Filtrar alertas por ${type}`}
            className={`flex-1 py-1 text-[10px] font-bold uppercase tracking-wide rounded-md transition-all cursor-pointer ${
              filter === type
                ? 'bg-zinc-800 text-orange-400 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {type === 'all' && 'Todas'}
            {type === 'critical' && 'Críticas'}
            {type === 'warning' && 'Altas'}
            {type === 'info' && 'Bajas'}
          </button>
        ))}
      </div>

      {/* Alerts List */}
      <div className="flex flex-col gap-2 max-h-[260px] overflow-y-auto pr-1">
        {loading ? (
          // Inline Skeleton loaders
          [1, 2].map((i) => (
            <Card key={i} className="p-4 bg-zinc-900/40 border border-zinc-800/60 rounded-xl min-h-[110px] animate-pulse">
              <div className="h-3 bg-zinc-850 rounded w-2/3 mb-2" />
              <div className="h-2 bg-zinc-850 rounded w-full mb-1" />
              <div className="h-2 bg-zinc-850 rounded w-4/5" />
            </Card>
          ))
        ) : filteredAlerts.length === 0 ? (
          <Card className="text-center py-8 bg-[#0a0a0c]/90 text-zinc-400 border border-dashed border-zinc-800/80 rounded-xl text-xs flex flex-col items-center justify-center gap-2 p-4 select-none">
            <span className="material-symbols-outlined text-zinc-600 text-2xl select-none">
              notifications_off
            </span>
            <span>Sin alertas activas bajo este filtro.</span>
          </Card>
        ) : (
          filteredAlerts.map((alert) => (
            <Card
              key={alert.id}
              onClick={() => onSelectAlert(alert)}
              className={`bg-zinc-905/45 hover:bg-zinc-900/70 border transition-all rounded-xl cursor-pointer flex flex-col justify-between min-h-[110px] shrink-0 p-3 ${
                selectedAlertId === alert.id
                  ? 'border-orange-500/70 shadow-lg shadow-orange-950/20'
                  : 'border-zinc-800/60 hover:border-zinc-700/80'
              }`}
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {getAlertIcon(alert.type)}
                    <span className="font-bold text-zinc-150 text-xs leading-snug group-hover:text-orange-400 transition-colors">
                      {alert.title}
                    </span>
                  </div>
                  <span className="text-[9px] text-zinc-500 font-mono shrink-0 select-none">
                    {formatTimeAgo(alert.date)}
                  </span>
                </div>

                <p className="text-[11px] text-zinc-300 leading-relaxed line-clamp-2 mt-1">
                  {alert.description}
                </p>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-zinc-800/50 mt-2 select-none">
                <span className="text-[9px] text-zinc-400 font-mono uppercase">
                  {alert.locationName}
                </span>
                <div className="flex items-center gap-1.5">
                  {getSeverityBadge(alert.severity)}
                  <span className="material-symbols-outlined text-xs text-zinc-500 group-hover:text-orange-500 transition-colors">
                    navigation
                  </span>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
});

export default AlertPanel;
