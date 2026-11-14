# Requirements Document

## Introduction

Este documento define los requisitos funcionales y no funcionales del **Fire Risk Engine**, el motor central de cálculo de riesgo de incendio para "Alerta Fuego Argentina". El sistema ingiere datos satelitales de NASA FIRMS, los combina con datos meteorológicos, calcula un índice de peligro de incendio (FWI) por zona y provincia, y genera alertas automáticas para la población.

Los requisitos se derivan del documento de diseño aprobado y cubren: ingesta de datos FIRMS, cálculo de riesgo con 8 factores ponderados, capa de consulta API con throttling y caché, notificaciones, persistencia en DynamoDB con Single Table Design, y tolerancia a fallas de fuentes externas.

## Glossary

- **Motor_de_Riesgo**: Componente Lambda que calcula el índice compuesto de riesgo de incendio combinando factores meteorológicos, satelitales, históricos y regionales.
- **Pipeline_de_Ingesta**: Proceso automatizado que consulta NASA FIRMS, normaliza detecciones, asigna provincia y persiste hotspots en DynamoDB.
- **FWI**: Fire Weather Index — índice simplificado de peligro meteorológico de incendio basado en temperatura, humedad y viento.
- **Hotspot**: Punto de calor detectado por satélite (VIIRS o MODIS) que indica posible foco ígneo activo.
- **Nivel_de_Peligro**: Clasificación categórica del riesgo: Bajo, Medio, Alto, Muy Alto, Extremo.
- **Score_de_Confianza**: Valor [50-100] que indica la calidad/frescura de los datos usados en el cálculo de riesgo.
- **Deduplicador**: Algoritmo que filtra detecciones redundantes del mismo foco usando proximidad espacial (< 0.015°) y temporal (< 30 min).
- **Geocodificador_Provincial**: Función que asigna una provincia argentina a un punto geográfico mediante ray-casting sobre polígonos GeoJSON.
- **API_de_Consulta**: Conjunto de endpoints REST que sirven datos pre-calculados de riesgo al frontend.
- **Despachador_de_Notificaciones**: Componente que envía alertas a suscriptores filtrados por provincia y severidad mínima.
- **Single_Table_Design**: Patrón de modelado DynamoDB donde todas las entidades comparten una sola tabla con claves compuestas.
- **EventBridge_Scheduler**: Servicio AWS que dispara ejecuciones programadas de las Lambdas de ingesta y cálculo.

## Requirements

### Requirement 1: Ingesta de Datos Satelitales FIRMS

**User Story:** Como operador del sistema, quiero que los datos de focos de calor se ingieran automáticamente desde NASA FIRMS cada 15 minutos, para que el sistema tenga información actualizada de detecciones satelitales.

#### Acceptance Criteria

1. WHEN el EventBridge_Scheduler dispara el evento programado cada 15 minutos, THEN el Pipeline_de_Ingesta SHALL consultar la NASA FIRMS API con el bounding box de Argentina (-73.6, -56.0, -53.5, -21.8) y un timeout de 6 segundos.
2. WHEN la NASA FIRMS API responde con datos CSV válidos (respuesta HTTP 200 con al menos un header row y una fila de datos parseables con campos: latitude, longitude, bright_ti4, acq_date, acq_time, satellite, confidence), THEN el Pipeline_de_Ingesta SHALL almacenar el CSV raw en S3 con nombre `firms_raw_{timestamp}.csv` para auditoría.
3. WHEN se reciben datos raw del CSV, THEN el Pipeline_de_Ingesta SHALL normalizar cada detección extrayendo: latitud, longitud, brillo (bright_ti4), fecha ISO, satélite (VIIRS/MODIS) y confianza numérica (0-100).
4. WHEN la confianza viene en formato textual (high/nominal/low), THEN el Pipeline_de_Ingesta SHALL convertirla a valores numéricos: high=95, nominal=70, low=30.
5. WHEN se normalizan las detecciones, THEN el Geocodificador_Provincial SHALL asignar la provincia argentina correspondiente a cada punto mediante point-in-polygon sobre el GeoJSON de provincias.
6. WHEN un punto cae fuera de todos los polígonos provinciales, THEN el Geocodificador_Provincial SHALL asignarle el valor 'Fuera de Argentina' y el Pipeline_de_Ingesta SHALL excluirlo del dataset final.
7. WHEN existen detecciones dentro de 0.015 grados de distancia espacial Y menos de 30 minutos de diferencia temporal Y del mismo satélite, THEN el Deduplicador SHALL retener únicamente la detección con mayor confianza (o mayor brillo en caso de empate de confianza).
8. WHEN la normalización y deduplicación completan, THEN el Pipeline_de_Ingesta SHALL persistir los hotspots en DynamoDB con un TTL de 48 horas.
9. IF la NASA FIRMS API responde con un CSV vacío (solo header, sin filas de datos), THEN el Pipeline_de_Ingesta SHALL registrar un log de nivel INFO indicando respuesta vacía, mantener los datos previos válidos en DynamoDB sin modificarlos, y registrar `source: 'EMPTY_RESPONSE'` en el ítem de metadata de ingesta.

---

### Requirement 2: Tolerancia a Fallas de Fuentes Externas

**User Story:** Como operador del sistema, quiero que el motor continúe operando cuando las APIs externas fallan, para que los usuarios siempre tengan datos disponibles aunque sean parcialmente desactualizados.

#### Acceptance Criteria

1. IF la NASA FIRMS API retorna un error HTTP (4xx o 5xx), timeout (> 6 segundos) o datos corruptos (respuesta con cuerpo vacío, contenido no-CSV, o menos de 2 filas parseables tras el header), THEN el Pipeline_de_Ingesta SHALL registrar un warning en CloudWatch indicando el tipo de falla y mantener los datos previos válidos en DynamoDB sin vaciar la tabla, y SHALL registrar `source: 'FALLBACK_CACHE'` en el ítem de metadata de ingesta.
2. IF la NASA FIRMS API falla 3 veces consecutivas (dentro de 3 ciclos de ingesta sucesivos de 15 minutos), THEN el sistema SHALL activar una alarma en CloudWatch y enviar notificación SNS a los operadores en un plazo máximo de 60 segundos tras la tercera falla.
3. IF la API meteorológica (SMN/OpenMeteo) no responde en un plazo de 6 segundos o retorna valores fuera de rango (temperatura fuera de [-20, 50] °C, humedad fuera de [0, 100] %, o velocidad de viento negativa), THEN el Motor_de_Riesgo SHALL usar la última lectura válida almacenada, marcar `weatherStale: true` en el registro de riesgo de la provincia afectada, y reducir el Score_de_Confianza en 10 puntos (sin bajar del mínimo de 50).
4. IF DynamoDB experimenta throttling, THEN el SDK de AWS SHALL aplicar retry con backoff exponencial automático hasta un máximo de 3 reintentos (con base de 100ms) antes de reportar error.
5. IF un error persiste tras los 3 reintentos de DynamoDB, THEN el sistema SHALL activar una alarma en CloudWatch y enviar notificación SNS a los operadores en un plazo máximo de 60 segundos tras el último reintento fallido.
6. IF los datos de hotspots almacenados en DynamoDB superan 48 horas de antigüedad (TTL expirado) sin una ingesta exitosa posterior, THEN el Motor_de_Riesgo SHALL reducir el Score_de_Confianza en 20 puntos adicionales para las provincias afectadas y registrar un warning `staleHotspots: true` en CloudWatch.

---

### Requirement 3: Cálculo del Índice de Riesgo de Incendio

**User Story:** Como analista de riesgo, quiero que el sistema calcule un índice compuesto de riesgo de incendio por provincia usando 8 factores ponderados, para que las decisiones de alerta se basen en información integrada y confiable.

#### Acceptance Criteria

1. WHEN el EventBridge_Scheduler dispara el cálculo programado cada 30 minutos, THEN el Motor_de_Riesgo SHALL leer los hotspots activos de las últimas 24 horas desde DynamoDB y consultar la API meteorológica para cada provincia con actividad.
2. THE Motor_de_Riesgo SHALL calcular el riskScore integrando 8 factores ponderados: temperatura (±20 pts), humedad relativa (±30 pts), viento (+20 pts), precipitación (-30 pts), hotspots activos (+25 pts), historial (+10 pts), alerta crítica (+15 pts) y factores regionales (+5 pts), partiendo de un baseline de 25 puntos.
3. THE Motor_de_Riesgo SHALL clampear el riskScore resultante al rango [0, 100] mediante la fórmula: min(100, max(0, round(score))).
4. THE Motor_de_Riesgo SHALL asignar el Nivel_de_Peligro según los siguientes umbrales: score < 20 = 'Bajo', 20 ≤ score < 40 = 'Medio', 40 ≤ score < 60 = 'Alto', 60 ≤ score < 80 = 'Muy Alto', score ≥ 80 = 'Extremo'.
5. WHEN la precipitación en las últimas 24 horas supera 10mm, THEN el Motor_de_Riesgo SHALL reducir el score en al menos 30 puntos desde el baseline, actuando como supresor significativo.
6. WHEN existen hotspots activos recientes (recentHotspotsCount > 0), THEN el Motor_de_Riesgo SHALL sumar puntos adicionales calculados como min(25, recentHotspotsCount × 8).
7. WHEN la región es 'Centro' y la humedad relativa es menor al 20%, THEN el Motor_de_Riesgo SHALL sumar 5 puntos adicionales por factor regional.
8. WHEN la región es 'Patagonia' y el viento supera 25 km/h, THEN el Motor_de_Riesgo SHALL sumar 5 puntos adicionales por factor regional.
9. WHEN el cálculo de riesgo completa para una provincia, THEN el Motor_de_Riesgo SHALL persistir el resultado en DynamoDB con PK=`RISK#CURRENT`, SK=`PROVINCE#{nombre}` sobrescribiendo el valor anterior.

---

### Requirement 4: Cálculo del Fire Weather Index (FWI)

**User Story:** Como analista de riesgo, quiero un índice meteorológico simplificado de peligro de incendio, para evaluar rápidamente las condiciones climáticas favorables a la propagación del fuego.

#### Acceptance Criteria

1. THE Motor_de_Riesgo SHALL calcular el FWI como combinación lineal: (temperatura_°C × 1.0) + ((100 - humedad_%) × 0.5) + (viento_km/h × 0.4), clampeado a [0, 100] mediante min(100, max(0, round(rawFWI))).
2. WHEN la temperatura aumenta manteniendo los demás factores constantes, THEN el FWI SHALL aumentar monotónicamente.
3. WHEN la humedad relativa aumenta manteniendo los demás factores constantes, THEN el FWI SHALL disminuir monotónicamente.
4. WHEN la velocidad del viento aumenta manteniendo los demás factores constantes, THEN el FWI SHALL aumentar monotónicamente.
5. THE Motor_de_Riesgo SHALL aceptar inputs meteorológicos en los siguientes rangos: temperatura ∈ [-20, 50] °C, humedad relativa ∈ [0, 100] %, velocidad del viento ≥ 0 km/h.

---

### Requirement 5: Cálculo del Score de Confianza

**User Story:** Como usuario del sistema, quiero conocer la confiabilidad del cálculo de riesgo presentado, para tomar decisiones informadas sobre la calidad de la información.

#### Acceptance Criteria

1. THE Motor_de_Riesgo SHALL calcular el Score_de_Confianza partiendo de 95 y reduciendo por desviaciones extremas respecto al clima normal de la provincia.
2. WHEN la desviación absoluta de temperatura respecto al promedio histórico (climateNormal.avgTemp) supera 15°C, THEN el Motor_de_Riesgo SHALL reducir el Score_de_Confianza en 5 puntos.
3. WHEN la desviación absoluta de viento respecto al promedio histórico (climateNormal.avgWind) supera 25 km/h, THEN el Motor_de_Riesgo SHALL reducir el Score_de_Confianza en 5 puntos.
4. WHEN la desviación absoluta de humedad respecto al promedio histórico (climateNormal.avgHumidity) supera 40 puntos porcentuales, THEN el Motor_de_Riesgo SHALL reducir el Score_de_Confianza en 5 puntos.
5. WHEN no existen hotspots recientes (recentHotspotsCount = 0) que validen la zona, THEN el Motor_de_Riesgo SHALL reducir el Score_de_Confianza en 3 puntos.
6. THE Motor_de_Riesgo SHALL clampear el Score_de_Confianza al rango [50, 100] mediante la fórmula: min(100, max(50, confidence)).

---

### Requirement 6: Capa de Consulta API

**User Story:** Como desarrollador frontend, quiero endpoints REST que sirvan datos pre-calculados de riesgo con baja latencia, para renderizar el mapa de riesgo y las alertas en la interfaz de usuario.

#### Acceptance Criteria

1. THE API_de_Consulta SHALL exponer los siguientes endpoints: GET /risk/provinces, GET /risk/zones, GET /hotspots, GET /alerts, POST /subscriptions, GET /health.
2. WHEN se recibe un request en cualquier endpoint, THE API_de_Consulta SHALL validar la presencia de una API key válida en el header `x-api-key` antes de procesar la solicitud.
3. IF un request no incluye el header `x-api-key` o la key proporcionada no coincide con una key activa registrada en el sistema, THEN la API_de_Consulta SHALL retornar código HTTP 403 Forbidden con un cuerpo JSON que contenga un campo `error` indicando autenticación fallida, sin revelar si la key existe o es inválida.
4. WHEN se consulta GET /risk/provinces, THEN la API_de_Consulta SHALL retornar un array JSON de las 24 provincias (23 provincias + CABA), cada elemento conteniendo: provinceName (string), riskScore (entero 0-100), activeHotspotsCount (entero ≥ 0), riskLevel (uno de 'Bajo', 'Medio', 'Alto', 'Muy Alto', 'Extremo'), trend (uno de 'up', 'down', 'stable'), lastUpdated (timestamp ISO 8601), confidenceScore (entero 50-100), con tiempo de respuesta no mayor a 500ms en percentil 95.
5. WHEN se consulta GET /risk/zones, THEN la API_de_Consulta SHALL retornar un array JSON con las celdas de grilla activas (máximo 3500 celdas), cada elemento conteniendo: id (string), bounds (par de coordenadas [[lat,lng],[lat,lng]]), fwi (entero 0-100), riskLevel (uno de 'Bajo', 'Medio', 'Alto', 'Muy Alto', 'Extremo'), hotspotsInCell (entero ≥ 0), con tiempo de respuesta no mayor a 800ms en percentil 95.
6. THE API_de_Consulta SHALL aplicar caché de API Gateway con TTL de 120 segundos para los endpoints /risk/provinces y /risk/zones, y TTL de 60 segundos para /hotspots y /alerts.
7. IF un cliente excede el rate limit configurado (50 req/s sustained, 100 req/s burst), THEN la API_de_Consulta SHALL retornar HTTP 429 Too Many Requests con header `Retry-After` indicando el número de segundos que el cliente debe esperar antes de reintentar.
8. IF ocurre un error interno al procesar cualquier request válido, THEN la API_de_Consulta SHALL retornar HTTP 500 con un cuerpo JSON conteniendo un campo `error` con un mensaje descriptivo del tipo de falla, sin exponer detalles internos de implementación, y SHALL registrar el error completo en el sistema de logs.
9. WHEN se consulta GET /hotspots, THEN la API_de_Consulta SHALL retornar un array JSON de hotspots activos (últimas 48 horas), cada elemento conteniendo: lat (número), lng (número), brightness (número), confidence (número 0-100), satellite ('VIIRS' o 'MODIS'), province (string), date (timestamp ISO 8601), windSpeed (número en km/h), fwi (entero 0-100), dangerLevel (uno de 'Bajo', 'Medio', 'Alto', 'Muy Alto', 'Extremo'), area (número en hectáreas ≥ 1), con tiempo de respuesta no mayor a 800ms en percentil 95.

---

### Requirement 7: Deduplicación de Hotspots

**User Story:** Como analista de riesgo, quiero que el sistema elimine detecciones duplicadas del mismo foco ígneo, para que los conteos de hotspots reflejen focos reales y no repeticiones satelitales.

#### Acceptance Criteria

1. THE Deduplicador SHALL considerar duplicados dos hotspots cuando la distancia euclidiana entre sus coordenadas es ≤ 0.015 grados Y la diferencia temporal es ≤ 30 minutos Y provienen del mismo satélite.
2. WHEN se detecta un par de duplicados, THEN el Deduplicador SHALL retener la detección con mayor valor de confianza; en caso de empate de confianza, la de mayor brillo; en caso de empate en ambos, la detección que fue procesada primero.
3. THE Deduplicador SHALL garantizar que el resultado contiene un número de elementos igual o menor al input original.
4. THE Deduplicador SHALL garantizar que no existan dos elementos en el resultado que cumplan simultáneamente las tres condiciones de duplicación (distancia ≤ 0.015°, tiempo ≤ 30 min, mismo satélite).
5. IF el input es una lista vacía, THEN el Deduplicador SHALL retornar una lista vacía sin error.
6. IF un hotspot tiene un timestamp no parseable o inválido, THEN el Deduplicador SHALL excluir dicho hotspot del resultado y contabilizarlo como descartado en el campo duplicatesRemoved del resultado de ingesta.

---

### Requirement 8: Geocodificación Provincial

**User Story:** Como operador del sistema, quiero que cada detección satelital sea asignada a la provincia argentina correspondiente, para agregar los datos de riesgo a nivel provincial.

#### Acceptance Criteria

1. THE Geocodificador_Provincial SHALL determinar la provincia usando el algoritmo ray-casting sobre los polígonos del GeoJSON de las 23 provincias y CABA.
2. WHEN las mismas coordenadas se consultan múltiples veces, THEN el Geocodificador_Provincial SHALL retornar siempre el mismo resultado (determinismo).
3. WHEN un punto geográfico dentro del bounding box de Argentina no cae dentro de ningún polígono provincial, THEN el Geocodificador_Provincial SHALL retornar 'Fuera de Argentina'.
4. THE Geocodificador_Provincial SHALL aceptar coordenadas dentro del bounding box de Argentina: latitud ∈ [-56.0, -21.8], longitud ∈ [-73.6, -53.5].
5. IF se reciben coordenadas fuera del bounding box de Argentina (latitud fuera de [-56.0, -21.8] o longitud fuera de [-73.6, -53.5]), THEN el Geocodificador_Provincial SHALL retornar 'Fuera de Argentina' sin ejecutar el algoritmo ray-casting.
6. IF el archivo GeoJSON de provincias no está disponible o es inválido al momento de inicialización, THEN el Geocodificador_Provincial SHALL registrar un error crítico en CloudWatch y la Lambda SHALL fallar con un código de error descriptivo sin procesar ningún punto.

---

### Requirement 9: Persistencia en DynamoDB (Single Table Design)

**User Story:** Como arquitecto del sistema, quiero un modelo de datos eficiente en DynamoDB con Single Table Design, para soportar todos los patrones de acceso con mínimo costo y latencia.

#### Acceptance Criteria

1. THE Single_Table_Design SHALL modelar 6 entidades en una sola tabla: Hotspot, RiskScore (Provincial), RiskZone (Grilla), Alerta, Suscripción y Metadata de Ingesta.
2. THE Single_Table_Design SHALL utilizar dos índices secundarios globales: GSI1 con partition key `GSI1PK`, sort key `GSI1SK` y proyección ALL, y GSI2 con partition key `GSI2PK`, sort key `GSI2SK` y proyección KEYS_ONLY, para soportar consultas por fecha, severidad, nivel de riesgo y provincia.
3. WHEN se persiste un hotspot, THEN la tabla SHALL almacenarlo con PK=`HOTSPOT#{provincia}`, SK=`TS#{fecha}#{id}`, GSI1PK=`DATE#{yyyy-mm-dd}`, GSI1SK=`PROV#{provincia}` y TTL igual al timestamp actual más 172800 segundos (48 horas).
4. WHEN se persiste un risk score provincial, THEN la tabla SHALL almacenarlo con PK=`RISK#CURRENT`, SK=`PROVINCE#{nombre}`, GSI1PK=`RISKLEVEL#{dangerLevel}` y GSI1SK=`SCORE#{paddedScore}`, sin TTL (sobrescrito en cada ciclo de cálculo).
5. WHEN se persiste una alerta, THEN la tabla SHALL almacenarla con PK=`ALERT#{provincia}`, SK=`TS#{fecha}#{alertId}`, GSI1PK=`SEVERITY#{level}`, GSI1SK=`TS#{fecha}` y TTL igual al timestamp actual más 604800 segundos (7 días).
6. THE Single_Table_Design SHALL soportar los 9 patrones de acceso: (1) hotspots por provincia con PK=`HOTSPOT#{prov}` y SK begins_with `TS#{today}`, (2) hotspots del día con GSI1PK=`DATE#{today}`, (3) risk score por provincia con GetItem PK=`RISK#CURRENT` SK=`PROVINCE#{prov}`, (4) provincias por nivel de riesgo con GSI1PK=`RISKLEVEL#{level}`, (5) alertas por provincia con PK=`ALERT#{prov}`, (6) alertas por severidad con GSI1PK=`SEVERITY#{level}`, (7) suscripciones por provincia con GSI1PK=`PROVINCE#{prov}`, (8) historial de ingestas con PK=`META#INGESTION` y SK begins_with `RUN#`, (9) zonas por provincia con GSI1PK=`PROVINCE#{prov}`.
7. THE Single_Table_Design SHALL validar antes de persistir que riskScore ∈ [0, 100], confidenceScore ∈ [50, 100], TTL es un timestamp Unix futuro respecto al momento de escritura, provincia es una de las 23 provincias argentinas más CABA (24 valores válidos), latitud ∈ [-56.0, -21.8] y longitud ∈ [-73.6, -53.5].
8. IF una validación de datos falla antes de persistir un item, THEN THE Single_Table_Design SHALL rechazar la escritura del item inválido sin afectar los demás items del batch y registrar el error con el campo y valor que falló la validación.
9. WHEN se ejecuta una operación BatchWriteItem y al menos un item del batch falla por capacidad insuficiente (UnprocessedItems), THEN THE Single_Table_Design SHALL reintentar los items no procesados con backoff exponencial hasta un máximo de 3 reintentos antes de registrar la falla.

---

### Requirement 10: Sistema de Notificaciones

**User Story:** Como ciudadano suscrito, quiero recibir alertas por email cuando se genera una alerta crítica en mi provincia, para tomar medidas preventivas a tiempo.

#### Acceptance Criteria

1. WHEN el Motor_de_Riesgo genera una alerta con severidad igual o superior a 'Alto', THEN el sistema SHALL publicar un evento en el SNS Topic de alertas críticas dentro de los 30 segundos posteriores a la generación de la alerta.
2. WHEN el Despachador_de_Notificaciones recibe un evento SNS de alerta, THEN SHALL consultar las suscripciones verificadas (verified=true) en DynamoDB filtrando por provincia coincidente y severidad de la alerta mayor o igual a la severidad mínima configurada por el suscriptor.
3. WHEN un suscriptor cumple los criterios de filtro (provincia coincide Y severidad de la alerta ≥ severidad mínima configurada), THEN el Despachador_de_Notificaciones SHALL enviar un email vía SES conteniendo: título de la alerta, provincia afectada, nivel de severidad, descripción y timestamp de generación.
4. IF el envío de email vía SES falla después de 3 reintentos con backoff exponencial (intervalos de 1s, 2s, 4s), THEN el Despachador_de_Notificaciones SHALL registrar el fallo en CloudWatch con el email destino, el motivo del error y el identificador de la alerta, y SHALL marcar la entrega como 'failed' sin bloquear el despacho al resto de suscriptores.
5. WHEN un usuario crea una suscripción via POST /subscriptions, THEN el sistema SHALL almacenarla con estado 'pending_verification' y enviar un email de verificación; IF el suscriptor no verifica el email dentro de las 72 horas posteriores, THEN el sistema SHALL eliminar la suscripción pendiente.
6. THE Despachador_de_Notificaciones SHALL registrar cada intento de entrega de notificación en CloudWatch incluyendo: subscriptionId, alertId, provincia, canal (email), resultado (success/failed) y timestamp de envío.

---

### Requirement 11: Seguridad y Permisos

**User Story:** Como arquitecto de seguridad, quiero que cada componente tenga exclusivamente los permisos mínimos necesarios para su función, para reducir la superficie de ataque del sistema.

#### Acceptance Criteria

1. THE Lambda de ingesta SHALL tener permisos únicamente para: BatchWriteItem y PutItem en la tabla DynamoDB del sistema, PutObject en el bucket S3 de datos raw, y escritura de logs en CloudWatch, restringidos a los ARN específicos de cada recurso.
2. THE Lambda de consulta SHALL tener permisos únicamente para: Query y GetItem en la tabla DynamoDB del sistema (solo lectura) y escritura de logs en CloudWatch, restringidos a los ARN específicos de cada recurso.
3. THE Lambda de cálculo SHALL tener permisos únicamente para: Query, PutItem y BatchWriteItem en la tabla DynamoDB del sistema, Publish en el topic SNS de alertas críticas, y escritura de logs en CloudWatch, restringidos a los ARN específicos de cada recurso.
4. THE Lambda de notificaciones SHALL tener permisos únicamente para: Query en la tabla DynamoDB del sistema (solo lectura de suscripciones), SendEmail en SES, y escritura de logs en CloudWatch, restringidos a los ARN específicos de cada recurso.
5. THE API_de_Consulta SHALL restringir CORS exclusivamente al dominio del frontend en producción (prohibido wildcard `*`).
6. THE sistema SHALL prohibir el logging de API keys, emails de suscriptores, coordenadas de suscriptores y cualquier dato personal identificable en CloudWatch, aplicando enmascaramiento antes de emitir cualquier entrada de log que contenga campos sensibles.
7. THE CloudWatch SHALL retener logs durante 7 días para minimizar costos y exposición de datos operativos.
8. IF una Lambda intenta invocar una acción IAM no incluida en su lista de permisos definida, THEN el sistema SHALL denegar la operación y registrar el intento denegado en CloudWatch sin exponer datos sensibles en el mensaje de error.

---

### Requirement 12: Estimación de Área de Fuego

**User Story:** Como analista de riesgo, quiero estimar el área afectada por cada foco ígneo, para comunicar la magnitud del evento a los usuarios y autoridades.

#### Acceptance Criteria

1. THE Motor_de_Riesgo SHALL calcular el área estimada en hectáreas usando la fórmula: max(1, round((brightness - 300) × 2.2 + windSpeed × 1.8 + fwi × 0.8)).
2. THE Motor_de_Riesgo SHALL garantizar que el área estimada es siempre ≥ 1 hectárea para cualquier combinación válida de inputs.
3. WHEN el brillo (brightness) es ≤ 300K, THEN la contribución térmica al cálculo de área SHALL ser 0 (usando max(0, brightness - 300)).
4. WHEN aumenta el brillo, la velocidad del viento o el FWI manteniendo los demás constantes, THEN el área estimada SHALL aumentar monotónicamente.
5. THE Motor_de_Riesgo SHALL aceptar inputs de estimación de área en los siguientes rangos: brightness > 0 (en Kelvin, típicamente 300-500K para VIIRS), windSpeed ≥ 0 (km/h), fwi ∈ [0, 100].

---

### Requirement 13: Rendimiento y Escalabilidad

**User Story:** Como operador del sistema, quiero que la arquitectura soporte la carga nacional (24 provincias, ~3.500 zonas) con latencia baja y costo mínimo, para ofrecer un servicio confiable y económico.

#### Acceptance Criteria

1. THE Lambda de ingesta SHALL ejecutarse con 256 MB de memoria y timeout de 30 segundos.
2. THE Lambda de consulta SHALL ejecutarse con 128 MB de memoria y timeout de 10 segundos.
3. THE Lambda de cálculo SHALL ejecutarse con 256 MB de memoria y timeout de 30 segundos.
4. THE DynamoDB SHALL operar en modo On-Demand para absorber picos de carga sin sobreaprovisionamiento.
5. WHEN CloudFront recibe un request de API, THEN SHALL cachear la respuesta según los TTL configurados: 120s para /risk/provinces y /risk/zones, 60s para /hotspots y /alerts.
6. THE EventBridge_Scheduler SHALL ejecutar la ingesta cada 15 minutos y el cálculo de riesgo cada 30 minutos.
7. THE API_de_Consulta SHALL responder a requests GET /risk/provinces en menos de 500ms en percentil 95 y GET /risk/zones en menos de 800ms en percentil 95.
