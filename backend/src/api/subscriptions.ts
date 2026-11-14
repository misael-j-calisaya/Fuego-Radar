import { Request, Response } from 'express';

export default async function handler(req: Request, res: Response) {
  try {
    const { name, phone, email, province } = req.body;

    // Basic input validation
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Nombre es requerido' });
    }
    if (!phone || typeof phone !== 'string' || phone.trim() === '') {
      return res.status(400).json({ error: 'Número de celular es requerido' });
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Correo electrónico válido es requerido' });
    }
    if (!province || typeof province !== 'string' || province.trim() === '') {
      return res.status(400).json({ error: 'Provincia es requerida' });
    }

    // Simulate database write / trigger event
    console.log(`[Subscription Activated] User: ${name}, Contact: ${phone} | ${email}, Target: ${province}`);

    res.status(201).json({
      success: true,
      message: `Suscripción activada con éxito. Recibirás alertas críticas para ${province} en el número ${phone} y correo ${email}.`
    });
  } catch (err) {
    console.error('Error in subscriptions handler:', err);
    res.status(500).json({ error: 'Failed to register subscription' });
  }
}
