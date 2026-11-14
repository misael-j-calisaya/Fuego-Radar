import { Request, Response } from 'express';

const SEVERITIES = ['Bajo', 'Medio', 'Alto', 'Crítico'];

// Local simulator: mirrors the production contract (email, provinces[], minSeverity)
// without persisting anything or sending email.
export default async function handler(req: Request, res: Response) {
  const { email, provinces, minSeverity } = req.body ?? {};

  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Correo electrónico válido es requerido' });
  }
  if (!Array.isArray(provinces) || provinces.length === 0 || provinces.some((p) => typeof p !== 'string')) {
    return res.status(400).json({ error: 'Se requiere al menos una provincia' });
  }
  if (!SEVERITIES.includes(minSeverity)) {
    return res.status(400).json({ error: `minSeverity debe ser uno de: ${SEVERITIES.join(', ')}` });
  }

  console.log(`[Local subscription] ${provinces.length} provincia(s), minSeverity=${minSeverity}`);
  res.status(201).json({
    message: 'Simulación local: en producción se enviaría un email de confirmación.',
    status: 'pending_verification',
  });
}

export async function verify(req: Request, res: Response) {
  if (!req.query.token || !req.query.email) {
    return res.status(400).json({ error: 'token y email son requeridos' });
  }
  res.status(200).json({ status: 'verified', message: 'Simulación local: suscripción confirmada.' });
}
