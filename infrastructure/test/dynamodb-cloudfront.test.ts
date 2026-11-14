/**
 * Infrastructure assertions for DynamoDB table configuration and
 * CloudFront distribution (Task 10.2).
 */

import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { FireRiskEngineStack } from '../lib/fire-risk-engine-stack';

describe('DynamoDB & CloudFront (Task 10.2)', () => {
  let template: Template;

  beforeAll(() => {
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

  // =========================================
  // DynamoDB Table
  // =========================================

  test('DynamoDB table uses On-Demand (PAY_PER_REQUEST) billing', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  test('DynamoDB table has PK (String) and SK (String) keys', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
    });
  });

  test('DynamoDB table has TTL enabled on TTL attribute', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TimeToLiveSpecification: {
        AttributeName: 'TTL',
        Enabled: true,
      },
    });
  });

  test('DynamoDB table has GSI1 with ALL projection', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        }),
      ]),
    });
  });

  test('DynamoDB table has GSI2 with KEYS_ONLY projection', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'GSI2',
          KeySchema: [
            { AttributeName: 'GSI2PK', KeyType: 'HASH' },
            { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'KEYS_ONLY' },
        }),
      ]),
    });
  });

  test('DynamoDB table has RETAIN removal policy', () => {
    const tables = template.findResources('AWS::DynamoDB::Table');
    const tableKeys = Object.keys(tables);
    expect(tableKeys.length).toBe(1);
    const table = tables[tableKeys[0]];
    expect((table as any).DeletionPolicy).toBe('Retain');
  });

  // =========================================
  // CloudFront Distribution
  // =========================================

  test('CloudFront distribution is created', () => {
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });

  test('CloudFront uses HTTPS-only origin protocol', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Origins: Match.arrayWith([
          Match.objectLike({
            CustomOriginConfig: Match.objectLike({
              OriginProtocolPolicy: 'https-only',
            }),
          }),
        ]),
      }),
    });
  });

  test('CloudFront origin points to API Gateway with /prod origin path', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Origins: Match.arrayWith([
          Match.objectLike({
            OriginPath: '/prod',
            DomainName: Match.objectLike({
              'Fn::Join': Match.anyValue(),
            }),
          }),
        ]),
      }),
    });
  });

  test('CloudFront default behavior redirects to HTTPS', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
        }),
      }),
    });
  });

  test('CloudFront has cache behavior for /risk/* path', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: '/risk/*',
            ViewerProtocolPolicy: 'redirect-to-https',
          }),
        ]),
      }),
    });
  });

  test('CloudFront has cache behavior for /hotspots path', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: '/hotspots',
            ViewerProtocolPolicy: 'redirect-to-https',
          }),
        ]),
      }),
    });
  });

  test('CloudFront has cache behavior for /alerts path', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: '/alerts',
            ViewerProtocolPolicy: 'redirect-to-https',
          }),
        ]),
      }),
    });
  });

  test('CloudFront has cache behavior for /health (no cache)', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: '/health',
            ViewerProtocolPolicy: 'redirect-to-https',
          }),
        ]),
      }),
    });
  });

  test('CloudFront has cache behavior for /subscriptions (no cache)', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: '/subscriptions',
            ViewerProtocolPolicy: 'redirect-to-https',
          }),
        ]),
      }),
    });
  });

  // =========================================
  // Cache Policies
  // =========================================

  test('creates risk cache policy with 120s default TTL', () => {
    template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: Match.objectLike({
        Name: 'FireRiskEngine-RiskCache-120s',
        DefaultTTL: 120,
      }),
    });
  });

  test('creates hotspots cache policy with 60s default TTL', () => {
    template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: Match.objectLike({
        Name: 'FireRiskEngine-HotspotsCache-60s',
        DefaultTTL: 60,
      }),
    });
  });

  test('creates alerts cache policy with 60s default TTL', () => {
    template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: Match.objectLike({
        Name: 'FireRiskEngine-AlertsCache-60s',
        DefaultTTL: 60,
      }),
    });
  });

  // =========================================
  // Stack Outputs
  // =========================================

  test('outputs CloudFront domain name', () => {
    template.hasOutput('CloudFrontDomainName', {});
  });

  test('outputs CloudFront distribution ID', () => {
    template.hasOutput('CloudFrontDistributionId', {});
  });
});
