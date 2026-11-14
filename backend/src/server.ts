import express from 'express';
import healthHandler from './api/health.js';
import hotspotsHandler from './api/hotspots.js';
import riskProvincesHandler from './api/risk/provinces.js';
import riskZonesHandler from './api/risk/zones.js';
import alertsHandler from './api/alerts.js';
import subscriptionsHandler, { verify as verifySubscription } from './api/subscriptions.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Built-in body parser middleware
app.use(express.json());

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Map serverless endpoints
app.get('/api/health', healthHandler);
app.get('/api/hotspots', hotspotsHandler);
app.post('/api/hotspots/ingest', hotspotsHandler);
app.get('/api/risk/provinces', riskProvincesHandler);
app.get('/api/risk/zones', riskZonesHandler);
app.get('/api/alerts', alertsHandler);
app.post('/api/subscriptions', subscriptionsHandler);
app.get('/api/subscriptions/verify', verifySubscription);

// Fallback route handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🔥 Alerta Fuego Argentina — servidor LOCAL SIMULADO (no usa los handlers Lambda)`);
  console.log(`📍 Local URL: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
