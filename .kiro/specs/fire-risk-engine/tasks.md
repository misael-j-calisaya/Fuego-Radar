# Implementation Plan: Fire Risk Engine

## Overview

Migrate the existing local/mock-based fire risk engine into a production-ready serverless AWS architecture. The implementation converts the current Express backend services into AWS Lambda handlers with DynamoDB persistence (Single Table Design), S3 raw storage, API Gateway with throttling and API key auth, EventBridge schedulers, and SNS/SES notifications. All core algorithms (FWI calculation, risk evaluation, deduplication, geocoding) are preserved and hardened with validation, error handling, and property-based tests using fast-check.

## Tasks

- [ ] 1. Set up AWS infrastructure foundations and shared types
  - [x] 1.1 Create the serverless project structure with SAM/CDK template and shared TypeScript interfaces
    - Create `infrastructure/` directory with SAM template or CDK stack defining: DynamoDB table (Single Table Design with GSI1, GSI2), S3 bucket for raw CSVs, EventBridge rules, SNS topic, and IAM roles
    - Create `backend/src/shared/types.ts` with all shared interfaces: `DynamoDBKeyDesign`, `HotspotItem`, `RiskScoreItem`, `RiskZoneItem`, `AlertItem`, `SubscriptionItem`, `IngestionMetaItem`, `DangerLevel`, `RiskInput`, `RiskOutput`, `WeatherData`, `IngestionResult`
    - Create `backend/src/shared/constants.ts` with bounding box, TTL values, province list (24 values), and validation ranges
    - _Requirements: 9.1, 9.2, 11.1, 11.2, 11.3, 11.4, 13.1, 13.2, 13.3, 13.4_

  - [x] 1.2 Implement DynamoDB data access layer with Single Table Design and validation
    - Create `backend/src/data/dynamoClient.ts` with DynamoDB Document Client setup, retry configuration (3 retries, 100ms base backoff), and table name from environment variable
    - Create `backend/src/data/validators.ts` implementing validation rules: riskScore ∈ [0,100], confidenceScore ∈ [50,100], TTL is future timestamp, province is one of 24 valid values, lat ∈ [-56.0, -21.8], lng ∈ [-73.6, -53.5]
    - Create `backend/src/data/repository.ts` with methods: `putHotspots(items)`, `putRiskScore(item)`, `putAlert(item)`, `queryHotspotsByProvince(province, date)`, `getAllRiskScores()`, `queryAlertsByProvince(province)`, `getSubscriptionsByProvince(province)`, `putIngestionMeta(item)`, handling BatchWriteItem with UnprocessedItems retry
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 2.4, 2.5_

  - [x] 1.3 Write unit tests for DynamoDB validators
    - Test all validation rules with valid and invalid inputs
    - Test edge cases: exactly at boundary values, province name matching
    - _Requirements: 9.7, 9.8_

- [ ] 2. Implement core risk calculation algorithms
  - [x] 2.1 Refactor and harden the FWI calculation function
    - Extract `calculateFWI` from `riskEngine.ts` into `backend/src/services/fwiCalculator.ts`
    - Add input validation: temperature ∈ [-20, 50], humidity ∈ [0, 100], windSpeed ≥ 0
    - Ensure clamping to [0, 100] via `min(100, max(0, round(rawFWI)))`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 2.2 Write property test for FWI boundedness
    - **Property 12: Acotamiento del FWI**
    - For any valid meteorological input, calculateFWI produces result in [0, 100]
    - **Validates: Requirement 4.1**

  - [x] 2.3 Write property test for FWI monotonicity
    - **Property 3: Monotonía del FWI**
    - If temperature increases (others constant), FWI increases or stays equal; if humidity increases, FWI decreases or stays equal; if wind increases, FWI increases or stays equal
    - **Validates: Requirements 4.2, 4.3, 4.4**

  - [x] 2.4 Refactor and harden the fire risk evaluation function
    - Extract `evaluateFireRisk` into `backend/src/services/riskEvaluator.ts`
    - Implement all 8 weighted factors with exact point values from design
    - Add clamping: `min(100, max(0, round(score)))`
    - Implement `getDangerLevel` with exact thresholds: <20 Bajo, 20-39 Medio, 40-59 Alto, 60-79 Muy Alto, ≥80 Extremo
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 2.5 Write property test for riskScore boundedness
    - **Property 1: Acotamiento del riskScore**
    - For any valid RiskInput, evaluateFireRisk returns riskScore in [0, 100]
    - **Validates: Requirement 3.3**

  - [x] 2.6 Write property test for danger level consistency
    - **Property 2: Consistencia nivel-score**
    - For any result, riskLevel corresponds exactly to getDangerLevel(riskScore)
    - **Validates: Requirement 3.4**

  - [x] 2.7 Write property test for rain suppression
    - **Property 4: Supresión por lluvia**
    - For any RiskInput with rain24h > 10mm, riskScore is at least 30 points less than same input with rain24h = 0
    - **Validates: Requirement 3.5**

  - [x] 2.8 Write property test for hotspot contribution
    - **Property 13: Contribución de hotspots activos**
    - For any RiskInput with recentHotspotsCount > 0, riskScore is at least min(25, count×8) points higher than with count = 0
    - **Validates: Requirement 3.6**

  - [x] 2.9 Implement confidence score calculation
    - Create `calculateConfidence` function in `backend/src/services/riskEvaluator.ts`
    - Start at 95, reduce 5 points for each extreme deviation (temp >15°, wind >25 km/h, humidity >40%), reduce 3 if no recent hotspots
    - Clamp to [50, 100]
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 2.10 Write property test for confidence score bounds
    - **Property 6: Cota mínima del Score de Confianza**
    - For any valid RiskInput, calculateConfidence returns value ≥ 50 and ≤ 100
    - **Validates: Requirement 5.6**

  - [x] 2.11 Implement fire area estimation function
    - Create `estimateFireArea` in `backend/src/services/areaEstimator.ts`
    - Formula: `max(1, round((brightness - 300) × 2.2 + windSpeed × 1.8 + fwi × 0.8))`
    - Ensure minimum 1 hectare for any valid inputs
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [x] 2.12 Write property test for area estimation bounds and monotonicity
    - **Property 9: Cota mínima del área estimada y monotonía**
    - For any valid inputs, result ≥ 1 hectare and monotonically increasing in each parameter
    - **Validates: Requirements 12.2, 12.4**

- [ ] 3. Checkpoint - Core algorithms verified
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement ingestion pipeline
  - [x] 4.1 Implement FIRMS API client with timeout and fallback
    - Create `backend/src/services/firmsApiClient.ts` with HTTP fetch to NASA FIRMS API
    - Use AbortController with 6-second timeout
    - Accept bbox parameter for Argentina: `-73.6,-56.0,-53.5,-21.8`
    - Handle error responses (4xx, 5xx), timeouts, and corrupt data (empty body, non-CSV)
    - On failure: log warning, return fallback indicator for pipeline to maintain existing data
    - _Requirements: 1.1, 2.1_

  - [x] 4.2 Implement CSV normalization with confidence conversion
    - Create `backend/src/services/csvNormalizer.ts`
    - Parse CSV extracting: latitude, longitude, bright_ti4, acq_date, acq_time, satellite, confidence
    - Convert textual confidence: high=95, nominal=70, low=30; numeric values pass through
    - Produce normalized objects with ISO dates and numeric confidence [0-100]
    - _Requirements: 1.3, 1.4_

  - [x] 4.3 Write property test for normalization field preservation
    - **Property 10: Normalización preserva campos requeridos**
    - For any valid FIRMS CSV row, normalization produces object with all required fields
    - **Validates: Requirement 1.3**

  - [x] 4.4 Harden geocoding with bounding box pre-check and error handling
    - Refactor `backend/src/services/firmsIngestion.ts` `assignProvince` method
    - Add bounding box pre-check: if lat outside [-56.0, -21.8] or lng outside [-73.6, -53.5], return 'Fuera de Argentina' without ray-casting
    - Handle missing/invalid GeoJSON: log critical error, throw with descriptive code
    - Ensure determinism: same coordinates always return same result
    - _Requirements: 1.5, 1.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 4.5 Write property test for geocoding determinism
    - **Property 7: Determinismo de geocodificación**
    - For any coordinates within Argentina bbox, assignProvince invoked multiple times returns same result
    - **Validates: Requirement 8.2**

  - [x] 4.6 Harden deduplication algorithm with invalid timestamp handling
    - Refactor `detectDuplicates` in `backend/src/services/deduplicator.ts`
    - Add handling for unparseable timestamps: exclude hotspot, count as discarded
    - Maintain duplicate criteria: distance ≤ 0.015°, time ≤ 30 min, same satellite
    - Retain highest confidence, then highest brightness, then first processed
    - Handle empty input returning empty array
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 1.7_

  - [x] 4.7 Write property test for deduplication invariants
    - **Property 5: Invariante de no-duplicados en resultado**
    - For any two hotspots in result, at least one condition fails: dist > 0.015° OR timeDiff > 30min OR different satellite
    - **Validates: Requirement 7.4**

  - [x] 4.8 Write property test for deduplication conservation
    - **Property 8: Conservación en deduplicación**
    - For any hotspot list, detectDuplicates result size ≤ input size
    - **Validates: Requirement 7.3**

  - [x] 4.9 Implement the full ingestion Lambda handler
    - Create `backend/src/lambdas/firmsIngestion.handler.ts`
    - Orchestrate: EventBridge trigger → fetch FIRMS → save raw to S3 → normalize → geocode → deduplicate → persist to DynamoDB with TTL 48h → write ingestion metadata
    - Handle empty response (CSV with only header): log INFO, maintain existing data, record `source: 'EMPTY_RESPONSE'`
    - On API failure: record `source: 'FALLBACK_CACHE'`, maintain existing data
    - Track consecutive failures for CloudWatch alarm (3 consecutive → SNS notification within 60s)
    - _Requirements: 1.1, 1.2, 1.8, 1.9, 2.1, 2.2_

- [ ] 5. Checkpoint - Ingestion pipeline complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement risk calculation Lambda
  - [x] 6.1 Implement weather client with validation and stale fallback
    - Create `backend/src/services/weatherApiClient.ts`
    - Fetch weather data with 6-second timeout for each province
    - Validate ranges: temperature ∈ [-20, 50], humidity ∈ [0, 100], windSpeed ≥ 0
    - On failure or out-of-range: use last valid reading, set `weatherStale: true`, reduce confidence by 10 (min 50)
    - _Requirements: 2.3, 3.1_

  - [x] 6.2 Implement risk calculation Lambda handler
    - Create `backend/src/lambdas/riskCalculation.handler.ts`
    - EventBridge trigger every 30 minutes
    - Read active hotspots (last 24h) from DynamoDB
    - For each province with activity: fetch weather → calculate FWI → evaluate risk → calculate confidence → persist with PK=`RISK#CURRENT`, SK=`PROVINCE#{name}`
    - Handle stale hotspots (>48h): reduce confidence by 20, log warning
    - Generate alerts for provinces with severity ≥ 'Alto' → publish to SNS topic
    - _Requirements: 3.1, 3.2, 3.9, 2.3, 2.6, 10.1_

  - [x] 6.3 Write unit tests for risk calculation Lambda
    - Test with mock weather data and hotspot data
    - Test stale weather fallback scenario
    - Test alert generation threshold
    - _Requirements: 3.1, 3.2, 3.9, 2.3_

- [ ] 7. Implement API query layer
  - [x] 7.1 Implement API Gateway Lambda handlers with auth and error handling
    - Create `backend/src/lambdas/api/riskProvinces.handler.ts` for GET /risk/provinces
    - Create `backend/src/lambdas/api/riskZones.handler.ts` for GET /risk/zones
    - Create `backend/src/lambdas/api/hotspots.handler.ts` for GET /hotspots
    - Create `backend/src/lambdas/api/alerts.handler.ts` for GET /alerts
    - Create `backend/src/lambdas/api/subscriptions.handler.ts` for POST /subscriptions
    - Create `backend/src/lambdas/api/health.handler.ts` for GET /health
    - Each handler: validate `x-api-key` header → return 403 if invalid (without revealing if key exists) → query DynamoDB → return formatted JSON
    - Return 500 with generic error message on internal errors (log full error separately)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.8, 6.9_

  - [x] 7.2 Configure API Gateway throttling, caching, and CORS
    - Define usage plan: 50 req/s sustained, 100 req/s burst
    - Configure cache TTLs: 120s for /risk/provinces and /risk/zones, 60s for /hotspots and /alerts
    - Set CORS to frontend production domain only (no wildcard)
    - Configure 429 response with `Retry-After` header
    - _Requirements: 6.6, 6.7, 11.5, 13.5, 13.7_

  - [x] 7.3 Write unit tests for API handlers
    - Test successful queries return correct format
    - Test 403 for missing/invalid API key
    - Test 500 error handling (no internal details exposed)
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.8_

- [ ] 8. Implement notification system
  - [x] 8.1 Implement notification dispatcher Lambda
    - Create `backend/src/lambdas/notificationDispatcher.handler.ts`
    - Receive SNS event with alert data
    - Query verified subscriptions from DynamoDB filtering by province and minSeverity
    - Send emails via SES with alert title, province, severity, description, timestamp
    - Retry failed SES sends with exponential backoff (1s, 2s, 4s) up to 3 retries
    - On persistent failure: log to CloudWatch (subscriptionId, alertId, province, result), mark as 'failed', continue with other subscribers
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6_

  - [x] 8.2 Implement subscription creation with verification flow
    - In POST /subscriptions handler: validate email and provinces, store with `status: 'pending_verification'`
    - Send verification email
    - Implement TTL or scheduled cleanup for unverified subscriptions after 72 hours
    - _Requirements: 10.5_

  - [x] 8.3 Write property test for notification filtering
    - **Property 11: Filtrado de notificaciones por criterio**
    - For any alert and subscription list, notifications are sent only when province matches AND alert severity ≥ subscriber's minSeverity
    - **Validates: Requirements 10.2, 10.3**

- [ ] 9. Implement security and observability
  - [x] 9.1 Configure IAM roles with least privilege per Lambda
    - Define ingestion Lambda role: BatchWriteItem/PutItem on DDB table, PutObject on S3 raw bucket, CloudWatch logs
    - Define query Lambda role: Query/GetItem on DDB table and indices (read-only), CloudWatch logs
    - Define calculation Lambda role: Query/PutItem/BatchWriteItem on DDB, Publish on SNS topic, CloudWatch logs
    - Define notification Lambda role: Query on DDB (subscriptions only), SendEmail on SES, CloudWatch logs
    - All restricted to specific resource ARNs
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.8_

  - [x] 9.2 Implement log sanitization and CloudWatch configuration
    - Create `backend/src/shared/logger.ts` with PII masking (API keys, emails, coordinates of subscribers)
    - Configure CloudWatch log retention to 7 days
    - Set up CloudWatch alarms: FIRMS consecutive failures (3x), DynamoDB persistent errors, Lambda error rate > 5%
    - Configure SNS notifications for alarms (within 60s)
    - _Requirements: 11.6, 11.7, 2.2, 2.5_

  - [x] 9.3 Write unit tests for log sanitization
    - Test that API keys, emails, and PII are masked in log output
    - Test alarm metric publishing
    - _Requirements: 11.6_

- [ ] 10. Integration wiring and final configuration
  - [x] 10.1 Wire EventBridge schedules and Lambda triggers
    - Configure EventBridge rule: ingestion every 15 minutes targeting FirmsIngestion Lambda
    - Configure EventBridge rule: risk calculation every 30 minutes targeting RiskCalculation Lambda
    - Configure SNS topic subscription triggering NotificationDispatcher Lambda
    - Wire API Gateway routes to respective query Lambdas
    - _Requirements: 1.1, 3.1, 13.6_

  - [x] 10.2 Configure DynamoDB table with GSIs and CloudFront distribution
    - Create DynamoDB table in On-Demand mode with PK/SK, GSI1 (ALL projection), GSI2 (KEYS_ONLY projection)
    - Configure TTL attribute
    - Set up CloudFront distribution with API Gateway origin and caching rules (120s for /risk, 60s for /hotspots and /alerts)
    - _Requirements: 9.1, 9.2, 13.4, 13.5_

  - [x] 10.3 Write integration tests for end-to-end flows
    - Test ingestion pipeline: trigger → fetch → normalize → persist → verify DynamoDB items
    - Test risk calculation: trigger → read hotspots → calculate → persist → verify alert generation
    - Test API query: request with valid key → verify response format and data consistency
    - _Requirements: 1.1, 3.1, 6.4, 6.5_

- [ ] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using fast-check
- Unit tests validate specific examples and edge cases
- The existing backend services in `backend/src/services/` contain working algorithm implementations that should be refactored into the new Lambda-based structure
- All TypeScript code targets ES2022 with NodeNext module resolution as per the existing tsconfig

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "2.1", "2.4", "2.9", "2.11"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.5", "2.6", "2.7", "2.8", "2.10", "2.12"] },
    { "id": 4, "tasks": ["4.1", "4.2", "4.4", "4.6"] },
    { "id": 5, "tasks": ["4.3", "4.5", "4.7", "4.8", "4.9"] },
    { "id": 6, "tasks": ["6.1"] },
    { "id": 7, "tasks": ["6.2"] },
    { "id": 8, "tasks": ["6.3", "7.1"] },
    { "id": 9, "tasks": ["7.2", "7.3", "8.1", "8.2"] },
    { "id": 10, "tasks": ["8.3", "9.1", "9.2"] },
    { "id": 11, "tasks": ["9.3", "10.1", "10.2"] },
    { "id": 12, "tasks": ["10.3"] }
  ]
}
```
