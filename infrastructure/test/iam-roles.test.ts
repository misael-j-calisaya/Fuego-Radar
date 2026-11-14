/**
 * Infrastructure assertions for IAM roles with least privilege.
 * Task 9.1: Validates each Lambda role has minimal required permissions.
 */

import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { FireRiskEngineStack } from '../lib/fire-risk-engine-stack';

describe('IAM Roles - Least Privilege (Task 9.1)', () => {
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

  // --- Ingestion Lambda Role ---

  test('ingestion role allows only BatchWriteItem and PutItem on DDB table', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'DynamoDBWriteTable',
            Effect: 'Allow',
            Action: ['dynamodb:BatchWriteItem', 'dynamodb:PutItem'],
          }),
        ]),
      },
      Roles: Match.arrayWith([{ Ref: Match.stringLikeRegexp('IngestionLambdaRole') }]),
    });
  });

  test('ingestion role allows only PutObject on S3 firms-raw/ prefix', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'S3PutRawCsv',
            Effect: 'Allow',
            Action: 's3:PutObject',
          }),
        ]),
      },
      Roles: Match.arrayWith([{ Ref: Match.stringLikeRegexp('IngestionLambdaRole') }]),
    });
  });

  // --- Query Lambda Role ---

  test('query role allows only Query and GetItem (read-only) on DDB', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'DynamoDBReadOnly',
            Effect: 'Allow',
            Action: ['dynamodb:Query', 'dynamodb:GetItem'],
          }),
        ]),
      },
      Roles: Match.arrayWith([{ Ref: Match.stringLikeRegexp('QueryLambdaRole') }]),
    });
  });

  test('query role restricts DDB access to specific table and GSI ARNs', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'DynamoDBReadOnly',
            Resource: Match.arrayWith([
              { 'Fn::GetAtt': [Match.stringLikeRegexp('FireRiskEngineTable'), 'Arn'] },
            ]),
          }),
        ]),
      },
      Roles: Match.arrayWith([{ Ref: Match.stringLikeRegexp('QueryLambdaRole') }]),
    });
  });

  // --- Calculation Lambda Role ---

  test('calculation role has separate read and write DDB policies', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'DynamoDBRead',
            Effect: 'Allow',
            Action: ['dynamodb:Query', 'dynamodb:GetItem'],
          }),
          Match.objectLike({
            Sid: 'DynamoDBWrite',
            Effect: 'Allow',
            Action: ['dynamodb:PutItem', 'dynamodb:BatchWriteItem'],
          }),
        ]),
      },
      Roles: Match.arrayWith([{ Ref: Match.stringLikeRegexp('CalculationLambdaRole') }]),
    });
  });

  test('calculation role allows SNS Publish only on alerts topic ARN', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'SNSPublishAlerts',
            Effect: 'Allow',
            Action: 'sns:Publish',
            Resource: { Ref: Match.stringLikeRegexp('CriticalAlertsTopic') },
          }),
        ]),
      },
      Roles: Match.arrayWith([{ Ref: Match.stringLikeRegexp('CalculationLambdaRole') }]),
    });
  });

  // --- Notification Lambda Role ---

  test('notification role allows only Query on DDB (subscriptions read-only)', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'DynamoDBQuerySubscriptions',
            Effect: 'Allow',
            Action: 'dynamodb:Query',
          }),
        ]),
      },
      Roles: Match.arrayWith([{ Ref: Match.stringLikeRegexp('NotificationLambdaRole') }]),
    });
  });

  test('notification role restricts SES to account identity ARNs (no wildcard resource)', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'SESSendEmail',
            Effect: 'Allow',
            Action: ['ses:SendEmail', 'ses:SendRawEmail'],
            Resource: Match.arrayWith([
              Match.stringLikeRegexp('arn:aws:ses:.*:.*:identity/\\*'),
            ]),
          }),
        ]),
      },
      Roles: Match.arrayWith([{ Ref: Match.stringLikeRegexp('NotificationLambdaRole') }]),
    });
  });

  // --- Cross-role isolation ---

  test('no role uses wildcard (*) for DDB resource', () => {
    const policies = template.findResources('AWS::IAM::Policy', {
      Properties: {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.anyValue(),
              Resource: '*',
            }),
          ]),
        },
      },
    });
    // Should find zero policies with Resource: '*' for DDB actions
    for (const [_id, policy] of Object.entries(policies)) {
      const statements = (policy as any).Properties?.PolicyDocument?.Statement || [];
      for (const stmt of statements) {
        if (stmt.Resource === '*') {
          const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
          const hasDdbAction = actions.some((a: string) => a.startsWith('dynamodb:'));
          expect(hasDdbAction).toBe(false);
        }
      }
    }
  });

  test('all four Lambda roles are created', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'FireRiskEngine-IngestionLambdaRole',
    });
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'FireRiskEngine-QueryLambdaRole',
    });
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'FireRiskEngine-CalculationLambdaRole',
    });
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'FireRiskEngine-NotificationLambdaRole',
    });
  });
});
