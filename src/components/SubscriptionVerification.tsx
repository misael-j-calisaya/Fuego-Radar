import React, { useEffect, useState } from 'react';
import { FireService } from '../services/api';

interface Props {
  token: string;
  email: string;
  onClose: () => void;
}

/** Handles the link emailed by the backend: /?token=...&email=... */
export const SubscriptionVerification: React.FC<Props> = ({ token, email, onClose }) => {
  const [state, setState] = useState<{ status: 'loading' | 'ok' | 'error'; message: string }>({
    status: 'loading',
    message: 'Confirmando suscripción...',
  });

  useEffect(() => {
    let cancelled = false;
    FireService.verifySubscription(token, email)
      .then((r) => !cancelled && setState({ status: 'ok', message: r.message }))
      .catch((e: unknown) =>
        !cancelled &&
        setState({ status: 'error', message: e instanceof Error ? e.message : 'No se pudo confirmar la suscripción.' }),
      );
    return () => {
      cancelled = true;
    };
  }, [token, email]);

  const tone =
    state.status === 'ok' ? 'border-emerald-700 text-emerald-200' : state.status === 'error' ? 'border-red-700 text-red-200' : 'border-zinc-700 text-zinc-200';

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="verify-title" className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 p-4">
      <div className={`max-w-sm w-full rounded-xl border bg-zinc-950 p-5 flex flex-col gap-3 text-center ${tone}`}>
        <h2 id="verify-title" className="font-bold uppercase tracking-wide text-sm">
          {state.status === 'ok' ? 'Suscripción confirmada' : state.status === 'error' ? 'No se pudo confirmar' : 'Verificando'}
        </h2>
        <p className="text-xs text-zinc-300">{state.message}</p>
        {state.status !== 'loading' && (
          <button onClick={onClose} className="mt-1 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-bold uppercase cursor-pointer">
            Ir al mapa
          </button>
        )}
      </div>
    </div>
  );
};

export default SubscriptionVerification;
