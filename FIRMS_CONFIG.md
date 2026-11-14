# NASA FIRMS Production Configuration Guide

This document explains how the NASA FIRMS Active Fire Ingestion pipeline is configured for production, where the API key must be set, and how to toggle between the mock telemetry fallback and the live NASA API feed.

---

## 1. Where to Configure `FIRMS_MAP_KEY`

In production, the ingestion pipeline retrieves the NASA FIRMS MAP API key securely from **AWS Systems Manager (SSM) Parameter Store**. 

- **SSM Parameter Name**: `/fuegoradar/prod/FIRMS_MAP_KEY`
- **SSM Parameter Type**: `SecureString`
- **Encryption**: Default SSM KMS Key (`alias/aws/ssm`) or custom KMS key.

### AWS CLI Command to Create or Update the Key
Run the following command in your terminal (with appropriate AWS credentials configured) to write your real API key to the SSM Parameter Store:

```bash
aws ssm put-parameter --name "/fuegoradar/prod/FIRMS_MAP_KEY" --type "SecureString" --value "<YOUR_FIRMS_KEY>" --overwrite
```

*Replace `<YOUR_FIRMS_KEY>` with your actual NASA FIRMS MAP API key.*

---

## 2. Ingestion Lambda Environment & Permissions

The AWS CDK stack is configured in [fire-risk-engine-stack.ts](file:///d:/APPS/FuegoRadar/infrastructure/lib/fire-risk-engine-stack.ts) to:
1. Inject the SSM Parameter path name (`/fuegoradar/prod/FIRMS_MAP_KEY`) into the Ingestion Lambda's environment variables as `FIRMS_MAP_KEY_SSM_NAME`.
2. Grant the Ingestion Lambda's execution IAM role `ssm:GetParameter` permission strictly for that parameter ARN, ensuring zero-trust least-privilege security.
3. Automatically decrypt the `SecureString` at runtime using the default SSM service KMS key.

---

## 3. Mock Fallback Behavior (`FIRMS_MOCK_FALLBACK`)

To facilitate local testing and prevent pipeline failures during setup, the codebase includes a simulated CSV telemetry cache fallback.

### Environmental Rules:
- **Local Development**: If `FIRMS_MOCK_FALLBACK=true` (or if no API key is configured), the pipeline automatically falls back to simulated data.
- **Production (AWS)**: The CDK stack defaults the environment variable `NODE_ENV` to `'production'` for all Lambda functions.
- **Safety Restriction**: The mock fallback is strictly disabled in production when `NODE_ENV === 'production'` **unless** the API key itself is missing. If the API key is present in SSM Parameter Store, the pipeline will **always** call the live NASA FIRMS API.

---

## 4. How to Switch from Mock Fallback to Live FIRMS API

Once you have verified that your real key is stored in SSM Parameter Store, follow these steps to switch to the live API feed:

### Step 1: Write the Key to SSM
Run the `aws ssm put-parameter` command shown above to store your key.

### Step 2: Ensure Mock Fallback is Disabled in Deployment
By default, the CDK stack configures `FIRMS_MOCK_FALLBACK` to `'false'`. If you previously overrode it to `'true'` in your deployment shell environment, ensure it is cleared:

#### On Windows (PowerShell):
```powershell
Remove-Item Env:\FIRMS_MOCK_FALLBACK
```

#### On Linux/macOS:
```bash
unset FIRMS_MOCK_FALLBACK
```

### Step 3: Deploy the Infrastructure Changes
Navigate to the `infrastructure/` directory and run:

```bash
npx cdk deploy --require-approval never
```

The Lambda function will now dynamically resolve `/fuegoradar/prod/FIRMS_MAP_KEY` at runtime and query the live NASA FIRMS active fire endpoints for Argentina.

---

## 5. Troubleshooting Ingestion

To inspect whether the pipeline is running in mock fallback or live mode, query the CloudWatch Logs for the `FireRiskEngine-Ingestion` Lambda:

- **Mock Fallback Active**: You will see the warning:
  `[FIRMS API] Ingestion running in dev mock fallback mode. Loading mock raw CSV telemetry cache.`
- **Live Ingestion Active**: You will see the info log:
  `[FIRMS API] Retrieving API key from SSM Parameter Store: /fuegoradar/prod/FIRMS_MAP_KEY` followed by standard request logs.
