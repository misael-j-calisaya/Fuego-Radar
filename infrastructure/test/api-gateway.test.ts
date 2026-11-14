/**
 * Infrastructure assertions for API Gateway configuration.
 * Task 7.2: Validates throttling, caching, CORS, and 429 response.
 */

import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { FireRiskEngineStack } from '../lib/fire-risk-engine-stack';

describe('API Gateway Configuration (Task 7.2)', () => {
  let template: Template;

  beforeAll(() => {
    // Set FRONTEND_ORIGIN for test
    process.env.FRONTEND_ORIGIN = 'https://app.fuegoradar.ar';

    const app = new cdk.App();
    const stack = new FireRiskEngineStack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });
    template = Template.fromStack(stack);
  });

  afterAll(() => {
    delete process.env.FRONTEND_ORIGIN;
  });

  test('creates REST API resource', () => {
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      Name: 'FireRiskEngine-API',
    });
  });

  test('configures stage with caching enabled and 0.5 GB cluster', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      StageName: 'prod',
      CacheClusterEnabled: true,
      CacheClusterSize: '0.5',
    });
  });

  test('configures stage-level throttling at 50 req/s sustained and 100 burst', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          HttpMethod: '*',
          ResourcePath: '/*',
          ThrottlingRateLimit: 50,
          ThrottlingBurstLimit: 100,
        }),
      ]),
    });
  });

  test('configures usage plan with 50 req/s and 100 burst', () => {
    template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
      UsagePlanName: 'FireRiskEngine-StandardPlan',
      Throttle: {
        RateLimit: 50,
        BurstLimit: 100,
      },
    });
  });

  test('creates API key linked to usage plan', () => {
    template.hasResourceProperties('AWS::ApiGateway::ApiKey', {
      Name: 'FireRiskEngine-DefaultKey',
    });

    template.resourceCountIs('AWS::ApiGateway::UsagePlanKey', 1);
  });

  test('configures 429 gateway response with Retry-After header', () => {
    template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
      ResponseType: 'THROTTLED',
      StatusCode: '429',
      ResponseParameters: Match.objectLike({
        'gatewayresponse.header.Retry-After': "'60'",
      }),
    });
  });

  test('configures CORS for specific frontend origin (no wildcard)', () => {
    // Verify CORS preflight OPTIONS method exists with correct origin
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'OPTIONS',
      Integration: Match.objectLike({
        IntegrationResponses: Match.arrayWith([
          Match.objectLike({
            ResponseParameters: Match.objectLike({
              'method.response.header.Access-Control-Allow-Origin': "'https://app.fuegoradar.ar'",
            }),
          }),
        ]),
      }),
    });
  });

  test('does NOT use wildcard CORS origin', () => {
    const resources = template.findResources('AWS::ApiGateway::Method', {
      Properties: {
        HttpMethod: 'OPTIONS',
        Integration: {
          IntegrationResponses: Match.arrayWith([
            Match.objectLike({
              ResponseParameters: Match.objectLike({
                'method.response.header.Access-Control-Allow-Origin': "'*'",
              }),
            }),
          ]),
        },
      },
    });
    expect(Object.keys(resources)).toHaveLength(0);
  });

  test('defines all required API routes', () => {
    // Verify resource paths exist
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      PathPart: 'health',
    });
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      PathPart: 'risk',
    });
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      PathPart: 'provinces',
    });
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      PathPart: 'zones',
    });
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      PathPart: 'hotspots',
    });
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      PathPart: 'alerts',
    });
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      PathPart: 'subscriptions',
    });
  });

  test('configures cache TTL 120s for /risk/provinces', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          ResourcePath: '/risk/provinces/GET',
          CachingEnabled: true,
          CacheTtlInSeconds: 120,
        }),
      ]),
    });
  });

  test('configures cache TTL 120s for /risk/zones', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          ResourcePath: '/risk/zones/GET',
          CachingEnabled: true,
          CacheTtlInSeconds: 120,
        }),
      ]),
    });
  });

  test('configures cache TTL 60s for /hotspots', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          ResourcePath: '/hotspots/GET',
          CachingEnabled: true,
          CacheTtlInSeconds: 60,
        }),
      ]),
    });
  });

  test('configures cache TTL 60s for /alerts', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          ResourcePath: '/alerts/GET',
          CachingEnabled: true,
          CacheTtlInSeconds: 60,
        }),
      ]),
    });
  });

  test('disables cache for /health', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          ResourcePath: '/health/GET',
          CachingEnabled: false,
        }),
      ]),
    });
  });

  test('disables cache for POST /subscriptions', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          ResourcePath: '/subscriptions/POST',
          CachingEnabled: false,
        }),
      ]),
    });
  });

  test('sets CORS_ORIGIN environment variable on query Lambda', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'FireRiskEngine-Query',
      Environment: {
        Variables: Match.objectLike({
          CORS_ORIGIN: 'https://app.fuegoradar.ar',
        }),
      },
    });
  });
});
