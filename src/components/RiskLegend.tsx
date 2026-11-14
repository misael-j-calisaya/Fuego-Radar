import React from 'react';

export const RiskLegend: React.FC = React.memo(() => {
  const levels = [
    { label: 'Bajo', color: 'bg-emerald-500', range: '< 20 FWI' },
    { label: 'Medio', color: 'bg-yellow-500', range: '20 - 40 FWI' },
    { label: 'Alto', color: 'bg-orange-500', range: '40 - 60 FWI' },
    { label: 'Muy Alto', color: 'bg-red-500', range: '60 - 80 FWI' },
    { label: 'Extremo', color: 'bg-red-700', range: '80 - 100 FWI' },
  ];

  return (
    <div className="p-4 w-60 flex flex-col gap-3 text-xs bg-[#0a0a0c]/92 backdrop-blur-md border border-zinc-800/80 rounded-xl shadow-2xl select-none">
      <div className="flex items-center gap-1.5 border-b border-zinc-800/80 pb-2">
        <span className="material-symbols-outlined text-orange-500 text-base select-none">legend_toggle</span>
        <span className="font-extrabold text-zinc-100 uppercase tracking-wider text-[10px]">Leyenda de Riesgo</span>
      </div>

      {/* Colors scale */}
      <div className="flex flex-col gap-2">
        <span className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider">Nivel de Riesgo (FWI)</span>
        <div className="flex flex-col gap-1.5">
          {levels.map((lvl) => (
            <div key={lvl.label} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${lvl.color} shadow-sm`} />
                <span className="font-semibold text-zinc-200">{lvl.label}</span>
              </div>
              <span className="text-[10px] text-zinc-500 font-mono">{lvl.range}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-zinc-800/50 pt-2.5 flex flex-col gap-2">
        <span className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider">Simbología del Mapa</span>
        <div className="flex flex-col gap-2">
          {/* Active Hotspot */}
          <div className="flex items-center gap-2.5">
            <div className="relative w-4 h-4 flex items-center justify-center">
              <span className="absolute w-3 h-3 rounded-full bg-red-500 animate-ping opacity-75" />
              <span className="relative w-2 h-2 rounded-full bg-red-650 border border-red-400" />
            </div>
            <span className="text-zinc-300 text-[11px]">Foco Activo (Satelital)</span>
          </div>

          {/* Clusters */}
          <div className="flex items-center gap-2.5">
            <div className="w-4 h-4 rounded-full bg-orange-600/30 border border-orange-500/60 flex items-center justify-center text-[8px] text-orange-400 font-extrabold">
              5+
            </div>
            <span className="text-zinc-300 text-[11px]">Agrupamiento (Cluster)</span>
          </div>

          {/* Warning radius */}
          <div className="flex items-center gap-2.5">
            <div className="w-4 h-4 rounded-full border border-dashed border-red-500/50 bg-red-950/10" />
            <span className="text-zinc-300 text-[11px]">Zona de Alerta Activa</span>
          </div>
        </div>
      </div>
    </div>
  );
});

export default RiskLegend;
