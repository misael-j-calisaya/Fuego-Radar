import React, { useState } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FireService } from '../services/api';
import type { Hotspot } from '../services/api';

interface HotspotDetailsProps {
  hotspot: Hotspot;
  onClose: () => void;
}

export const HotspotDetails: React.FC<HotspotDetailsProps> = React.memo(({ hotspot, onClose }) => {
  const [verificationStatus, setVerificationStatus] = useState<'none' | 'loading' | 'verified' | 'refuted'>('none');
  const [feedbackMsg, setFeedbackMsg] = useState('');

  const kelvinToCelsius = (k: number) => {
    return (k - 273.15).toFixed(1);
  };

  const handleVerify = async (verified: boolean) => {
    setVerificationStatus('loading');
    try {
      const result = await FireService.reportVerification(hotspot.id, verified);
      if (result.success) {
        setVerificationStatus(verified ? 'verified' : 'refuted');
        setFeedbackMsg(result.message);
      }
    } catch (err) {
      console.error(err);
      setVerificationStatus('none');
    }
  };

  const handleShare = () => {
    const coords = `${hotspot.lat.toFixed(5)}, ${hotspot.lng.toFixed(5)}`;
    navigator.clipboard.writeText(coords);
    alert(`Coordenadas copiadas al portapapeles: ${coords}`);
  };

  const getDangerLevelBadge = (level: Hotspot['dangerLevel']) => {
    switch (level) {
      case 'Extremo':
        return 'text-red-400 bg-red-950/40 border-red-800/60';
      case 'Muy Alto':
        return 'text-red-400 bg-red-950/20 border-red-900/50';
      case 'Alto':
        return 'text-orange-400 bg-orange-950/20 border-orange-900/50';
      case 'Medio':
        return 'text-yellow-400 bg-yellow-950/20 border-yellow-900/50';
      case 'Bajo':
        return 'text-emerald-400 bg-emerald-950/20 border-emerald-900/50';
    }
  };

  return (
    <Card className="border-orange-500/30 bg-zinc-950/90 backdrop-blur-xl rounded-xl overflow-hidden shadow-2xl animate-slide-up">
      <CardContent className="p-4 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-zinc-800/60 pb-3 select-none">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-red-500 animate-pulse text-xl">
              local_fire_department
            </span>
            <div>
              <h2 className="font-extrabold text-zinc-150 text-xs uppercase tracking-wider">
                Detalles de Anomalía Térmica
              </h2>
              <span className="text-[9px] text-zinc-500 font-mono">ID: {hotspot.id}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar detalles de anomalía"
            className="text-zinc-500 hover:text-zinc-300 transition-colors p-1 hover:bg-zinc-900 rounded-md cursor-pointer"
          >
            <span className="material-symbols-outlined text-base select-none">close</span>
          </button>
        </div>

        {/* Grid of details */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          {/* Location */}
          <div className="flex items-start gap-2 bg-zinc-900/30 p-2.5 rounded-xl border border-zinc-850">
            <span className="material-symbols-outlined text-orange-500 text-md shrink-0 mt-0.5 select-none">
              location_on
            </span>
            <div className="flex flex-col">
              <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wide">Ubicación</span>
              <span className="font-bold text-zinc-200">{hotspot.province}</span>
              <span className="text-[9px] text-zinc-400 font-mono mt-0.5">
                {hotspot.lat.toFixed(4)}, {hotspot.lng.toFixed(4)}
              </span>
            </div>
          </div>

          {/* Temperature */}
          <div className="flex items-start gap-2 bg-zinc-900/30 p-2.5 rounded-xl border border-zinc-850">
            <span className="material-symbols-outlined text-red-500 text-md shrink-0 mt-0.5 select-none">
              thermostat
            </span>
            <div className="flex flex-col">
              <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wide">Temperatura</span>
              <span className="font-bold text-zinc-200">{kelvinToCelsius(hotspot.brightness)}°C</span>
              <span className="text-[9px] text-zinc-400 font-mono mt-0.5">{hotspot.brightness} K</span>
            </div>
          </div>

          {/* Confidence & Satellite */}
          <div className="flex items-start gap-2 bg-zinc-900/30 p-2.5 rounded-xl border border-zinc-850">
            <span className="material-symbols-outlined text-sky-400 text-md shrink-0 mt-0.5 select-none">
              satellite_alt
            </span>
            <div className="flex flex-col">
              <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wide">Satélite & Conf.</span>
              <span className="font-bold text-zinc-200">{hotspot.satellite} Sat</span>
              <span className="text-[9px] text-zinc-400 font-mono mt-0.5">Confianza: {hotspot.confidence}%</span>
            </div>
          </div>

          {/* Area */}
          <div className="flex items-start gap-2 bg-zinc-900/30 p-2.5 rounded-xl border border-zinc-850">
            <span className="material-symbols-outlined text-amber-500 text-md shrink-0 mt-0.5 select-none">
              grid_view
            </span>
            <div className="flex flex-col">
              <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wide">Área Estimada</span>
              <span className="font-bold text-zinc-200">~{hotspot.area} ha</span>
              <span className="text-[9px] text-zinc-400 font-mono mt-0.5">Foco Activo</span>
            </div>
          </div>

          {/* Weather Conditions / Wind / FWI */}
          <div className="flex items-start gap-2 bg-zinc-900/30 p-2.5 rounded-xl border border-zinc-850 col-span-2">
            <span className="material-symbols-outlined text-emerald-400 text-md shrink-0 mt-0.5 select-none">
              weather_mix
            </span>
            <div className="grid grid-cols-3 gap-2 w-full">
              <div className="flex flex-col">
                <span className="text-[8px] text-zinc-500 uppercase font-bold tracking-wide">Viento</span>
                <span className="font-bold text-zinc-200">{hotspot.windSpeed} km/h</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[8px] text-zinc-500 uppercase font-bold tracking-wide">Dirección</span>
                <span className="font-bold text-zinc-200 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[10px] text-zinc-500">explore</span>
                  {hotspot.windDir}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[8px] text-zinc-500 uppercase font-bold tracking-wide">Riesgo FWI</span>
                <span className="font-bold text-orange-400 font-mono">{hotspot.fwi} pts</span>
              </div>
            </div>
          </div>
        </div>

        {/* Danger Level Banner */}
        <div className={`p-2 border rounded-xl text-center font-black text-[10px] uppercase tracking-wider ${getDangerLevelBadge(hotspot.dangerLevel)} select-none`}>
          Peligro Estimado: {hotspot.dangerLevel}
        </div>

        {/* Verification / Community feedback */}
        <div className="border-t border-zinc-850 pt-3 flex flex-col gap-2 select-none">
          <span className="text-[9px] text-zinc-400 font-extrabold uppercase tracking-wide">
            Validación Comunitaria / Brigadista
          </span>

          {verificationStatus === 'none' && (
            <div className="flex gap-2">
              <Button
                onClick={() => handleVerify(true)}
                aria-label="Confirmar existencia de fuego"
                size="sm"
                className="flex-1 py-1 bg-emerald-950/30 hover:bg-emerald-900/30 border border-emerald-800/60 hover:border-emerald-700 text-emerald-400 text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-xs">check</span>
                Confirmar Fuego
              </Button>
              <Button
                onClick={() => handleVerify(false)}
                aria-label="Reportar como falsa alarma"
                size="sm"
                className="flex-1 py-1 bg-red-950/30 hover:bg-red-900/30 border border-red-800/60 hover:border-red-700 text-red-400 text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-xs">close</span>
                Falsa Alarma
              </Button>
            </div>
          )}

          {verificationStatus === 'loading' && (
            <div className="text-center py-2 text-zinc-500 text-xs font-mono flex items-center justify-center gap-2">
              <span className="material-symbols-outlined animate-spin text-sm">sync</span>
              Enviando reporte de verificación...
            </div>
          )}

          {(verificationStatus === 'verified' || verificationStatus === 'refuted') && (
            <div className={`p-2 text-[10px] leading-relaxed rounded-lg text-center ${
              verificationStatus === 'verified'
                ? 'bg-emerald-950/30 text-emerald-400 border border-emerald-900/50'
                : 'bg-amber-950/20 text-amber-400 border border-amber-900/40'
            }`}>
              {feedbackMsg}
            </div>
          )}
        </div>

        {/* Share Button */}
        <div className="flex gap-2 border-t border-zinc-850 pt-3">
          <Button
            onClick={handleShare}
            aria-label="Copiar coordenadas del foco"
            variant="outline"
            className="w-full py-1 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 hover:border-zinc-700 text-zinc-200 text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <span className="material-symbols-outlined text-xs text-zinc-400">share</span>
            Copiar Coordenadas
          </Button>
        </div>
      </CardContent>
    </Card>
  );
});

export default HotspotDetails;
