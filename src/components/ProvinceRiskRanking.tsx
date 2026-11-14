import React, { useState, useMemo } from 'react';
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ProvinceRisk } from '../services/api';

interface ProvinceRiskRankingProps {
  rankings: ProvinceRisk[];
  onSelectProvince: (provinceName: string) => void;
  selectedProvince?: string;
  isDemo?: boolean;
  loading?: boolean;
}

export const ProvinceRiskRanking: React.FC<ProvinceRiskRankingProps> = React.memo(({
  rankings,
  onSelectProvince,
  selectedProvince,
  isDemo,
  loading
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'hotspots' | 'weather'>('all');

  const filteredRankings = useMemo(() => {
    return rankings
      .filter((r) => {
        const matchesSearch = r.provinceName.toLowerCase().includes(searchTerm.toLowerCase());
        if (!matchesSearch) return false;

        if (filterMode === 'hotspots') {
          return r.activeHotspotsCount > 0;
        }
        if (filterMode === 'weather') {
          return r.activeHotspotsCount === 0;
        }
        return true;
      })
      .sort((a, b) => {
        if (b.riskScore !== a.riskScore) {
          return b.riskScore - a.riskScore;
        }
        return b.activeHotspotsCount - a.activeHotspotsCount;
      });
  }, [rankings, searchTerm, filterMode]);

  const getRiskColor = (level: ProvinceRisk['riskLevel']) => {
    switch (level) {
      case 'Extremo':
        return 'bg-red-750';
      case 'Muy Alto':
        return 'bg-red-500';
      case 'Alto':
        return 'bg-orange-500';
      case 'Medio':
        return 'bg-yellow-500';
      case 'Bajo':
        return 'bg-emerald-500';
    }
  };

  const getTrendIcon = (trend: ProvinceRisk['trend']) => {
    switch (trend) {
      case 'up':
        return <span className="material-symbols-outlined text-red-550 text-sm select-none">trending_up</span>;
      case 'down':
        return <span className="material-symbols-outlined text-emerald-400 text-sm select-none">trending_down</span>;
      case 'stable':
        return <span className="material-symbols-outlined text-zinc-500 text-sm select-none">trending_flat</span>;
    }
  };

  return (
    <div className="flex flex-col gap-3 shrink-0">
      {/* Header & Search */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between select-none">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-orange-500 text-[14px]">
              equalizer
            </span>
            Provincias ({loading ? '...' : filteredRankings.length})
            {isDemo && (
              <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-505/20 rounded text-[9px] font-extrabold uppercase tracking-wide">
                Demo
              </span>
            )}
          </div>
          <span className="text-[10px] text-zinc-550 font-medium">Ordenado por FWI</span>
        </div>

        {/* Search Box */}
        <div className="relative flex items-center">
          <span className="material-symbols-outlined absolute left-2.5 text-zinc-500 text-sm select-none">search</span>
          <input
            type="text"
            placeholder="Buscar provincia..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label="Buscar provincia"
            className="w-full pl-8 pr-3 py-1.5 bg-zinc-950/60 text-xs border border-zinc-805 rounded-lg focus:outline-none focus:border-orange-500/50 text-zinc-200 placeholder-zinc-550 transition-colors"
          />
        </div>

        {/* Filters */}
        <div className="flex gap-1 bg-zinc-950/40 p-1 rounded-lg border border-zinc-900/60 mt-1 select-none">
          <button
            onClick={() => setFilterMode('all')}
            aria-label="Mostrar todas las provincias"
            className={`flex-1 py-1 px-2 text-[10px] font-bold uppercase rounded-md transition-all cursor-pointer ${
              filterMode === 'all'
                ? 'bg-orange-600/20 text-orange-400 border border-orange-500/30'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Todas
          </button>
          <button
            onClick={() => setFilterMode('hotspots')}
            aria-label="Mostrar provincias con focos"
            className={`flex-1 py-1 px-2 text-[10px] font-bold uppercase rounded-md transition-all cursor-pointer ${
              filterMode === 'hotspots'
                ? 'bg-red-600/20 text-red-400 border border-red-500/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Con Focos
          </button>
          <button
            onClick={() => setFilterMode('weather')}
            aria-label="Mostrar provincias solo con datos de clima"
            className={`flex-1 py-1 px-2 text-[10px] font-bold uppercase rounded-md transition-all cursor-pointer ${
              filterMode === 'weather'
                ? 'bg-yellow-600/20 text-yellow-400 border border-yellow-500/30'
                : 'text-zinc-450 hover:text-zinc-200'
            }`}
          >
            Solo Clima
          </button>
        </div>
      </div>

      {/* Rankings List */}
      <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-1">
        {loading ? (
          // Inline Skeleton loaders
          [1, 2, 3].map((i) => (
            <Card key={i} className="p-3 bg-zinc-900/40 border border-zinc-800/60 rounded-xl min-h-[70px] animate-pulse">
              <div className="h-3 bg-zinc-850 rounded w-1/2 mb-2" />
              <div className="h-1.5 bg-zinc-850 rounded w-full" />
            </Card>
          ))
        ) : filteredRankings.length === 0 ? (
          <Card className="text-center py-8 text-zinc-550 border border-dashed border-zinc-800/50 rounded-xl text-xs flex flex-col items-center justify-center gap-2 p-4">
            <span className="material-symbols-outlined text-zinc-650 text-2xl select-none">
              location_off
            </span>
            <span>No se encontraron provincias.</span>
          </Card>
        ) : (
          filteredRankings.map((prov, index) => {
            const hasHotspots = prov.activeHotspotsCount > 0;
            const isSelected = selectedProvince === prov.provinceName;
            
            return (
              <Card
                key={prov.provinceName}
                onClick={() => onSelectProvince(prov.provinceName)}
                className={`p-3 bg-zinc-900/40 border rounded-xl transition-all cursor-pointer flex flex-col justify-between min-h-[82px] shrink-0 gap-2 ${
                  isSelected
                    ? 'border-orange-500/80 shadow-lg shadow-orange-950/20 bg-zinc-900/75'
                    : hasHotspots
                      ? 'border-red-500/20 bg-zinc-950/50 hover:bg-zinc-900/60 hover:border-red-505/40'
                      : 'border-dashed border-zinc-800/60 bg-zinc-900/10 hover:bg-zinc-900/30 hover:border-zinc-800'
                }`}
              >
                {/* Row 1: Name and Trend */}
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-black text-orange-500/70 font-mono select-none">
                      #{index + 1}
                    </span>
                    <span className="font-bold text-zinc-100 text-[13px] tracking-wide truncate">{prov.provinceName}</span>
                  </div>
                  <div className="flex items-center shrink-0 select-none">
                    {getTrendIcon(prov.trend)}
                  </div>
                </div>

                {/* Row 2: Badges */}
                <div className="flex items-center justify-between w-full select-none">
                  {hasHotspots ? (
                    <Badge className="bg-red-500/15 text-red-400 border border-red-500/30 text-[8px] font-extrabold px-1.5 py-0.5 uppercase tracking-wider animate-pulse">
                      {prov.activeHotspotsCount} {prov.activeHotspotsCount === 1 ? 'foco' : 'focos'}
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/25 text-[8px] font-extrabold px-1.5 py-0.5 uppercase tracking-wider">
                      Solo Clima
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[8px] font-bold border-zinc-800 text-zinc-350 bg-zinc-950/60 uppercase px-1.5 py-0.5">
                    {prov.riskLevel}
                  </Badge>
                </div>

                {/* Row 3: Progress bar and Score */}
                <div className="flex items-center gap-3 w-full mt-1">
                  <div className="flex-1 h-2 bg-zinc-950 rounded-full overflow-hidden border border-zinc-850">
                    <div
                      className={`h-full ${getRiskColor(prov.riskLevel)} transition-all duration-500`}
                      style={{ width: `${prov.riskScore}%` }}
                    />
                  </div>
                  <span className="text-sm font-black text-zinc-100 font-mono w-6 text-right shrink-0 select-none leading-none">
                    {prov.riskScore}
                  </span>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
});

export default ProvinceRiskRanking;
