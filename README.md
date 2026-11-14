# Fuego Radar — Alerta Fuego Argentina

Plataforma serverless de monitoreo de incendios forestales en Argentina. Combina detecciones satelitales
de **NASA FIRMS**, meteorología de **Open-Meteo** y un motor de riesgo por provincia para mostrar en un mapa
focos activos, riesgo provincial, una grilla de riesgo y alertas verificadas por email.

## Arquitectura

```
EventBridge (15 min) ─► Lambda Ingestion ──► NASA FIRMS (VIIRS/MODIS, bbox AR)
                              │ normaliza, asigna provincia, deduplica (TTL 48 h)
                              ▼
                         DynamoDB (single table) ◄── Lambda Query  ◄── API Gateway ◄── CloudFront ◄── SPA (S3)
                              ▲                    ◄── Lambda Subscriptions (POST /subscriptions, GET /subscriptions/verify)
EventBridge (30 min) ─► Lambda Risk Calculation ──► Open-Meteo
                              │ FWI + 8 factores, tendencia, historial 7 días, grilla 1°×1°
                              ▼
                         Alertas (TTL 7 días, dedup 6 h) ─► SNS ─► Lambda Notification ─► SES (reintentos 1s/2s/4s)
```

| Carpeta | Contenido |
|---|---|
| `src/` | Frontend React 19 + Vite + Tailwind + Leaflet |
| `backend/src/lambdas/` | Handlers Lambda (lo que corre en producción) |
| `backend/src/services/` | Lógica de dominio: clientes FIRMS/Open-Meteo, FWI, evaluador de riesgo, alertas |
| `backend/src/server.ts` + `backend/src/api/` | **Simulador local** (Express) con datos sintéticos |
| `infrastructure/` | Stack AWS CDK v2 (DynamoDB, Lambdas, API Gateway, CloudFront, EventBridge, SNS/SES, alarmas) |
| `scripts/ops/` | Scripts operativos (consultas, logs, smoke test). Configurados por variables de entorno |
| `.kiro/specs/fire-risk-engine/` | Requisitos, diseño y plan de tareas |

### Reglas principales

- **FWI** = `clamp(0, 100, round(T + (100 − HR) · 0.5 + viento · 0.4))`; niveles Bajo / Medio / Alto / Muy Alto / Extremo.
- **Riesgo** 0–100 con confianza 50–100. Si el clima está desactualizado se reduce la confianza y `/health` lo reporta.
- **Tendencia**: `up`/`down` si el puntaje cambia ±5 respecto del cálculo anterior.
- **Alertas**: severidad Bajo / Medio / Alto / Crítico; no se repite una alerta de igual o menor severidad para la misma provincia en 6 h.
- **Suscripciones**: solo email, con doble opt-in (enlace válido 72 h) y filtro por provincias y severidad mínima.
- **Transparencia**: si la API falla y `VITE_ENABLE_DEMO_FALLBACK` está activo, la UI muestra datos simulados **con un aviso visible**.

## Desarrollo local

Requisitos: Node.js 20 y npm. Cada paquete tiene su propio `package-lock.json`.

```bash
npm ci && (cd backend && npm ci) && (cd infrastructure && npm ci)
cp .env.example .env.local          # ajustar VITE_API_BASE_URL

# Simulador local (puerto 3001)
cd backend && npm start
# Frontend (puerto 5173)
npm run dev
```

El simulador local reproduce los contratos de la API pero no usa DynamoDB, FIRMS ni SES; responde `simulated` en `/health`.

## Verificación

```bash
npm run lint && npm run build                       # frontend + lint de todo el repo
(cd backend && npm run typecheck && npm test)       # tests unitarios, de integración y property-based
(cd infrastructure && npm test)                     # aserciones CDK
```

GitHub Actions (`.github/workflows/ci.yml`) corre lo mismo en cada PR.

## Despliegue

1. Crear los parámetros en SSM (una vez):
   ```bash
   aws ssm put-parameter --name /fuegoradar/prod/FIRMS_MAP_KEY --type SecureString --value <MAP_KEY>
   aws ssm put-parameter --name /fuegoradar/prod/API_KEY --type String --value <API_KEY>
   ```
2. Verificar en SES el remitente (`FROM_EMAIL`) y salir del sandbox si se envía a direcciones arbitrarias.
3. Compilar y desplegar:
   ```bash
   (cd backend && npm run build)
   cd infrastructure && FRONTEND_ORIGIN=https://tu-dominio npx cdk deploy
   ```
4. Compilar el frontend con `VITE_API_BASE_URL`, `VITE_API_KEY` y `VITE_ENABLE_DEMO_FALLBACK=false`, y subir `dist/` al bucket.

Ver [`FIRMS_CONFIG.md`](FIRMS_CONFIG.md) para la configuración de FIRMS y el modo mock.

## Seguridad

- No se versionan credenciales: la MAP_KEY de FIRMS y la API key viven en SSM.
- La API key del frontend viaja en el bundle del navegador, así que **no es un secreto**: sirve para el usage plan
  (throttling y cuota). La protección real es el throttling de API Gateway, CORS por origen y, recomendado, AWS WAF.
- Cada Lambda tiene su propio rol con permisos mínimos (la Lambda de consulta es de solo lectura).
