import React, { useState } from 'react';
import { FireService } from '../services/api';

interface AlertSubscriptionFormProps {
  provinces: string[];
}

export const AlertSubscriptionForm: React.FC<AlertSubscriptionFormProps> = React.memo(({ provinces }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [selectedProvince, setSelectedProvince] = useState(provinces[0] || 'Córdoba');
  const [agreeNotifications, setAgreeNotifications] = useState(true);

  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !phone || !email) return;

    setLoading(true);
    try {
      const result = await FireService.subscribeToAlerts({
        name,
        phone,
        email,
        province: selectedProvince,
        notificationsEnabled: agreeNotifications,
      });

      if (result.success) {
        setSubmitted(true);
        setSuccessMessage(result.message);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setName('');
    setPhone('');
    setEmail('');
    setSubmitted(false);
    setSuccessMessage('');
  };

  if (submitted) {
    return (
      <div className="p-4 bg-emerald-950/20 border border-emerald-800/40 rounded-xl flex flex-col items-center text-center gap-3 animate-fade-in select-none shrink-0">
        <span className="material-symbols-outlined text-emerald-400 text-3xl animate-bounce">
          check_circle
        </span>
        <div className="font-bold text-emerald-300 text-sm uppercase tracking-wide">
          ¡Suscripción Activada!
        </div>
        <p className="text-[11px] text-zinc-400 leading-relaxed max-w-[280px]">
          {successMessage}
        </p>
        <button
          onClick={handleReset}
          className="mt-2 px-3 py-1 bg-emerald-900/40 hover:bg-emerald-900/60 border border-emerald-800 text-emerald-300 rounded-lg text-[10px] uppercase font-bold tracking-wider transition-colors cursor-pointer"
        >
          Suscribir otra cuenta
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 shrink-0">


      {/* Name Input */}
      <div className="flex flex-col gap-1">
        <label htmlFor="user-name" className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wide">
          Nombre Completo
        </label>
        <div className="relative flex items-center">
          <span className="material-symbols-outlined absolute left-2.5 text-zinc-500 text-sm select-none">
            person
          </span>
          <input
            id="user-name"
            type="text"
            required
            placeholder="Juan Pérez"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-zinc-950/60 text-xs border border-zinc-800/80 rounded-lg focus:outline-none focus:border-orange-500/50 text-zinc-200 placeholder-zinc-600 transition-colors"
          />
        </div>
      </div>

      {/* Phone Input */}
      <div className="flex flex-col gap-1">
        <label htmlFor="user-phone" className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wide">
          Celular (SMS)
        </label>
        <div className="relative flex items-center">
          <span className="material-symbols-outlined absolute left-2.5 text-zinc-500 text-sm select-none">
            phone
          </span>
          <input
            id="user-phone"
            type="tel"
            required
            placeholder="+54 9 351 123 4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-zinc-950/60 text-xs border border-zinc-800/80 rounded-lg focus:outline-none focus:border-orange-500/50 text-zinc-200 placeholder-zinc-600 transition-colors"
          />
        </div>
      </div>

      {/* Email Input */}
      <div className="flex flex-col gap-1">
        <label htmlFor="user-email" className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wide">
          Correo Electrónico
        </label>
        <div className="relative flex items-center">
          <span className="material-symbols-outlined absolute left-2.5 text-zinc-500 text-sm select-none">
            mail
          </span>
          <input
            id="user-email"
            type="email"
            required
            placeholder="juan.perez@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-zinc-950/60 text-xs border border-zinc-800/80 rounded-lg focus:outline-none focus:border-orange-500/50 text-zinc-200 placeholder-zinc-600 transition-colors"
          />
        </div>
      </div>

      {/* Province Select */}
      <div className="flex flex-col gap-1">
        <label htmlFor="province-select" className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wide">
          Provincia de Interés
        </label>
        <select
          id="province-select"
          value={selectedProvince}
          onChange={(e) => setSelectedProvince(e.target.value)}
          className="w-full px-3 py-1.5 bg-zinc-950/60 text-xs border border-zinc-800/80 rounded-lg focus:outline-none focus:border-orange-500/50 text-zinc-200 transition-colors appearance-none cursor-pointer"
        >
          {provinces.map((prov) => (
            <option key={prov} value={prov} className="bg-zinc-900 text-zinc-200">
              {prov}
            </option>
          ))}
        </select>
      </div>

      {/* Checkbox */}
      <label className="flex items-start gap-2 cursor-pointer mt-1.5 select-none">
        <input
          type="checkbox"
          checked={agreeNotifications}
          onChange={(e) => setAgreeNotifications(e.target.checked)}
          className="mt-0.5 w-3.5 h-3.5 rounded border-zinc-800 accent-orange-500 cursor-pointer"
        />
        <span className="text-[10px] text-zinc-400 leading-normal">
          Acepto recibir reportes y alertas tempranas del SMN y satélites.
        </span>
      </label>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={loading}
        className="w-full mt-2 py-2 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-lg hover:shadow-orange-950/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 cursor-pointer"
      >
        {loading ? (
          <>
            <span className="material-symbols-outlined animate-spin text-sm select-none">
              sync
            </span>
            Procesando...
          </>
        ) : (
          'Suscribirse'
        )}
      </button>
    </form>
  );
});

export default AlertSubscriptionForm;
