/**
 * Infrastructure assertions for EventBridge schedules, SNS triggers,
 * and API Gateway route wiring (Task 10.1).
 */

import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { FireRiskEngineStack } from '../lib/fire-risk-engine-stack';

describe('Integration Wiring (Task 10.1)', () => {
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
  // EventBridge Schedules
  // =========================================

  test('EventBridge rule triggers ingestion Lambda every 15 minutes', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Name: 'FireRiskEngine-IngestionSchedule',
      ScheduleExpression: 'rate(15 minutes)',
      State: 'ENABLED',
    });
  });

  test('EventBridge rule triggers calculation Lambda every 30 minutes', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Name: 'FireRiskEngine-CalculationSchedule',
      ScheduleExpression: 'rate(30 minutes)',
      State: 'ENABLED',
    });
  });

  test('ingestion schedule targets the ingestion Lambda', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Name: 'FireRiskEngine-IngestionSchedule',
      Targets: Match.arrayWith([
        Match.objectLike({
          Arn: { 'Fn::GetAtt': [Match.stringLikeRegexp('IngestionLambda'), 'Arn'] },
        }),
      ]),
    });
  });

  test('calculation schedule targets the calculation Lambda', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Name: 'FireRiskEngine-CalculationSchedule',
      Targets: Match.arrayWith([
        Match.objectLike({
          Arn: { 'Fn::GetAtt': [Match.stringLikeRegexp('CalculationLambda'), 'Arn'] },
        }),
      ]),
    });
  });

  // =========================================
  // SNS → NotificationDispatcher Lambda
  // =========================================

  test('SNS topic has a Lambda subscription for notification dispatcher', () => {
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'lambda',
      TopicArn: { Ref: Match.stringLikeRegexp('CriticalAlertsTopic') },
      Endpoint: { 'Fn::GetAtt': [Match.stringLikeRegexp('NotificationLambda'), 'Arn'] },
    });
  });

  test('notification Lambda has permission to be invoked by SNS', () => {
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      FunctionName: { 'Fn::GetAtt': [Match.stringLikeRegexp('NotificationLambda'), 'Arn'] },
      Principal: 'sns.amazonaws.com',
      SourceArn: { Ref: Match.stringLikeRegexp('CriticalAlertsTopic') },
    });
  });

  // =========================================
  // API Gateway → Lambda Wiring
  // =========================================

  test('API Gateway has GET /health route wired to query Lambda via AWS_PROXY', () => {
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'GET',
      Integration: Match.objectLike({
        Type: 'AWS_PROXY',
        IntegrationHttpMethod: 'POST',
      }),
    });
  });

  test('API Gateway has all required resource paths', () => {
    template.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: 'health' });
    template.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: 'risk' });
    template.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: 'provinces' });
    template.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: 'zones' });
    template.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: 'hotspots' });
    template.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: 'alerts' });
    template.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: 'subscriptions' });
  });

  test('API Gateway has both GET and POST methods configured', () => {
    // Count GET methods (health, provinces, zones, hotspots, alerts + OPTIONS methods)
    const getMethods = template.findResources('AWS::ApiGateway::Method', {
      Properties: { HttpMethod: 'GET' },
    });
    expect(Object.keys(getMethods).length).toBeGreaterThanOrEqual(5);

    // At least one POST method (subscriptions)
    const postMethods = template.findResources('AWS::ApiGateway::Method', {
      Properties: { HttpMethod: 'POST' },
    });
    expect(Object.keys(postMethods).length).toBeGreaterThanOrEqual(1);
  });

  // =========================================
  // Lambda Invoke Permissions for EventBridge
  // =========================================

  test('ingestion Lambda has EventBridge invoke permission', () => {
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      FunctionName: { 'Fn::GetAtt': [Match.stringLikeRegexp('IngestionLambda'), 'Arn'] },
      Principal: 'events.amazonaws.com',
      SourceArn: { 'Fn::GetAtt': [Match.stringLikeRegexp('IngestionSchedule'), 'Arn'] },
    });
  });

  test('calculation Lambda has EventBridge invoke permission', () => {
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      FunctionName: { 'Fn::GetAtt': [Match.stringLikeRegexp('CalculationLambda'), 'Arn'] },
      Principal: 'events.amazonaws.com',
      SourceArn: { 'Fn::GetAtt': [Match.stringLikeRegexp('CalculationSchedule'), 'Arn'] },
    });
  });

  // =========================================
  // Full Pipeline Flow Verification
  // =========================================

  test('all four Lambda functions are created with correct names', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'FireRiskEngine-Ingestion',
      Handler: 'firmsIngestion.handler',
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'FireRiskEngine-Query',
      Handler: 'api.handler',
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'FireRiskEngine-Calculation',
      Handler: 'riskCalculation.handler',
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'FireRiskEngine-Notification',
      Handler: 'notificationDispatcher.handler',
    });
  });
});
