import React from 'react';
import type { DataSourceStatus as StatusType } from '../services/api';

interface DataSourceStatusProps {
  statuses: StatusType[];
  loading: boolean;
}

export const DataSourceStatus: React.FC<DataSourceStatusProps> = React.memo(({ statuses, loading }) => {
  const getStatusPill = (status: StatusType['status']) => {
    switch (status) {
      case 'online':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/35 text-[9px] font-bold uppercase tracking-wider select-none filter brightness-110 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-ping"></span>
            Activo
          </span>
        );
      case 'syncing':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/35 text-[9px] font-bold uppercase tracking-wider select-none filter brightness-110 shrink-0">
            <span className="material-symbols-outlined text-[10px] animate-spin">sync</span>
            Sinc.
          </span>
        );
      case 'offline':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/35 text-[9px] font-bold uppercase tracking-wider select-none filter brightness-110 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block animate-pulse"></span>
            Offline
          </span>
        );
    }
  };

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return '12:00:00';
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      return '12:00:00';
    }
  };

  return (
    <div className="p-3 bg-zinc-900/30 border border-zinc-850 rounded-xl flex flex-col gap-2.5 w-full shrink-0">
      {loading && (
        <div className="flex items-center justify-center gap-1.5 py-1 text-zinc-550 text-[10px] select-none">
          <span className="material-symbols-outlined animate-spin text-xs">sync</span>
          Sincronizando fuentes...
        </div>
      )}
      <div className="flex flex-col gap-2">
        {statuses.map((src) => (
          <div key={src.name} className="p-2.5 bg-zinc-950/40 border border-zinc-850/50 rounded-lg flex flex-col gap-1.5 hover:border-zinc-800 transition-colors">
            <div className="flex items-center justify-between gap-2">
              <span className="font-extrabold text-zinc-100 text-xs tracking-wide truncate">{src.name}</span>
              <div className="flex items-center gap-2 select-none">
                <span className="text-[10px] text-zinc-200 font-mono font-bold">{src.latencyMs}ms</span>
                {getStatusPill(src.status)}
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono select-none">
              <span className="font-medium text-zinc-500">Actualizado</span>
              <span className="text-zinc-200 font-bold">{formatTime(src.lastSync)} hs</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

export default DataSourceStatus;
