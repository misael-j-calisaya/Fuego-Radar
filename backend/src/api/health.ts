import { Request, Response } from 'express';

export default async function handler(req: Request, res: Response) {
  res.status(200).json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    services: {
      firmsMock: 'online',
      weatherMock: 'online',
      smnSync: 'online',
      conaeSync: 'online'
    }
  });
}
