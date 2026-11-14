import React, { useState } from 'react';
import { FireService } from '../services/api';
import type { AlertSeverity } from '../services/api';

interface AlertSubscriptionFormProps {
  provinces: string[];
}

const SEVERITIES: { value: AlertSeverity; label: string }[] = [
  { value: 'Medio', label: 'Medio o superior' },
  { value: 'Alto', label: 'Alto o superior' },
  { value: 'Crítico', label: 'Solo Crítico' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const AlertSubscriptionForm: React.FC<AlertSubscriptionFormProps> = React.memo(({ provinces }) => {
  const [email, setEmail] = useState('');
  const [selectedProvinces, setSelectedProvinces] = useState<string[]>([]);
  const [minSeverity, setMinSeverity] = useState<AlertSeverity>('Alto');
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const toggleProvince = (prov: string) => {
    setSelectedProvinces((prev) =>
      prev.includes(prov) ? prev.filter((p) => p !== prov) : [...prev, prov],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!EMAIL_RE.test(email)) {
      setErrorMessage('Ingresá un correo electrónico válido.');
      return;
    }
    if (selectedProvinces.length === 0) {
      setErrorMessage('Elegí al menos una provincia.');
      return;
    }
    setLoading(true);
    try {
      const result = await FireService.subscribeToAlerts({
        email: email.trim(),
        provinces: selectedProvinces,
        minSeverity,
      });
      setSuccessMessage(result.message);
    } catch (err) {
      setErrorMessage(
        `No se pudo registrar la suscripción: ${err instanceof Error ? err.message : 'error desconocido'}. Intentá nuevamente.`,
      );
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setEmail('');
    setSelectedProvinces([]);
    setSuccessMessage(null);
    setErrorMessage(null);
  };

  if (successMessage) {
    return (
      <div className="p-4 bg-emerald-950/20 border border-emerald-800/40 rounded-xl flex flex-col items-center text-center gap-3 animate-fade-in select-none shrink-0" role="status">
        <span className="material-symbols-outlined text-emerald-400 text-3xl">mark_email_unread</span>
        <div className="font-bold text-emerald-300 text-sm uppercase tracking-wide">
          Revisá tu correo
        </div>
        <p className="text-[11px] text-zinc-400 leading-relaxed max-w-[280px]">
          {successMessage} La suscripción queda pendiente hasta que confirmes el enlace (válido por 72 horas).
        </p>
        <button
          onClick={handleReset}
          className="mt-2 px-3 py-1 bg-emerald-900/40 hover:bg-emerald-900/60 border border-emerald-800 text-emerald-300 rounded-lg text-[10px] uppercase font-bold tracking-wider transition-colors cursor-pointer"
        >
          Suscribir otro correo
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="p-3 bg-zinc-900/30 border border-zinc-850 rounded-xl flex flex-col gap-2.5 shrink-0">
      <p className="text-[10px] text-zinc-400 leading-relaxed">
        Recibí alertas por email cuando el riesgo de incendio supere el nivel elegido en tus provincias.
      </p>

      <div className="flex flex-col gap-1">
        <label htmlFor="user-email" className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wide">
          Correo Electrónico
        </label>
        <div className="relative flex items-center">
          <span className="material-symbols-outlined absolute left-2.5 text-zinc-500 text-sm select-none">mail</span>
          <input
            id="user-email"
            type="email"
            required
            autoComplete="email"
            placeholder="nombre@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-zinc-950/60 text-xs border border-zinc-800/80 rounded-lg focus:outline-none focus:border-orange-500/50 text-zinc-200 placeholder-zinc-600 transition-colors"
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wide mb-1">
          Provincias ({selectedProvinces.length} seleccionadas)
        </legend>
        <div className="max-h-32 overflow-y-auto grid grid-cols-2 gap-x-2 gap-y-1 p-2 bg-zinc-950/60 border border-zinc-800/80 rounded-lg">
          {provinces.map((prov) => (
            <label key={prov} className="flex items-center gap-1.5 text-[10px] text-zinc-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={selectedProvinces.includes(prov)}
                onChange={() => toggleProvince(prov)}
                className="w-3 h-3 accent-orange-500 cursor-pointer"
              />
              <span className="truncate">{prov}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="severity-select" className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wide">
          Severidad mínima
        </label>
        <select
          id="severity-select"
          value={minSeverity}
          onChange={(e) => setMinSeverity(e.target.value as AlertSeverity)}
          className="w-full px-3 py-1.5 bg-zinc-950/60 text-xs border border-zinc-800/80 rounded-lg focus:outline-none focus:border-orange-500/50 text-zinc-200 transition-colors cursor-pointer"
        >
          {SEVERITIES.map((s) => (
            <option key={s.value} value={s.value} className="bg-zinc-900 text-zinc-200">{s.label}</option>
          ))}
        </select>
      </div>

      {errorMessage && (
        <p role="alert" className="text-[10px] text-red-300 bg-red-950/30 border border-red-900/50 rounded-lg px-2 py-1.5">
          {errorMessage}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full mt-1 py-2 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 cursor-pointer"
      >
        {loading ? (
          <>
            <span className="material-symbols-outlined animate-spin text-sm select-none">sync</span>
            Enviando...
          </>
        ) : (
          'Suscribirse por email'
        )}
      </button>
      <p className="text-[9px] text-zinc-500 leading-relaxed">
        Te enviaremos un enlace de confirmación. No compartimos tu correo.
      </p>
    </form>
  );
});

export default AlertSubscriptionForm;
