#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { FireRiskEngineStack } from './fire-risk-engine-stack';

const app = new cdk.App();

new FireRiskEngineStack(app, 'FireRiskEngineStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description: 'Fire Risk Engine - Alerta Fuego Argentina serverless infrastructure',
});
