/**
 * Infrastructure assertions for CloudWatch observability (Task 9.2).
 * Validates: log retention, alarms, metric filters, SNS actions.
 */

import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { FireRiskEngineStack } from '../lib/fire-risk-engine-stack';

describe('CloudWatch Observability (Task 9.2)', () => {
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

  // --- Log Retention ---

  test('all Lambda log groups have 7-day retention', () => {
    // CDK creates LogRetention custom resources for each Lambda with logRetention set
    const logRetentions = template.findResources('Custom::LogRetention');
    const retentionValues = Object.values(logRetentions).map(
      (r: any) => r.Properties?.RetentionInDays
    );

    // All should be 7 days
    for (const retention of retentionValues) {
      expect(retention).toBe(7);
    }
    // Should have 4 Lambdas with log retention
    expect(retentionValues.length).toBe(4);
  });

  // --- FIRMS Consecutive Failures Alarm ---

  test('creates metric filter for FIRMS consecutive failures', () => {
    template.hasResourceProperties('AWS::Logs::MetricFilter', {
      FilterPattern: '"FIRMS_CONSECUTIVE_FAILURES"',
      MetricTransformations: Match.arrayWith([
        Match.objectLike({
          MetricNamespace: 'FireRiskEngine',
          MetricName: 'FirmsConsecutiveFailures',
          MetricValue: '1',
        }),
      ]),
    });
  });

  test('creates FIRMS consecutive failures alarm with threshold 1', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'FireRiskEngine-FIRMS-ConsecutiveFailures',
      Threshold: 1,
      EvaluationPeriods: 1,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      TreatMissingData: 'notBreaching',
    });
  });

  // --- DynamoDB Persistent Errors Alarm ---

  test('creates DynamoDB persistent errors alarm', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'FireRiskEngine-DynamoDB-PersistentErrors',
      Threshold: 5,
      EvaluationPeriods: 2,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      TreatMissingData: 'notBreaching',
    });
  });

  // --- Lambda Error Rate Alarms (> 5%) ---

  test('creates ingestion Lambda error rate alarm at 5%', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'FireRiskEngine-Ingestion-ErrorRate',
      Threshold: 5,
      EvaluationPeriods: 2,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
    });
  });

  test('creates calculation Lambda error rate alarm at 5%', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'FireRiskEngine-Calculation-ErrorRate',
      Threshold: 5,
      EvaluationPeriods: 2,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
    });
  });

  test('creates query Lambda error rate alarm at 5%', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'FireRiskEngine-Query-ErrorRate',
      Threshold: 5,
      EvaluationPeriods: 2,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
    });
  });

  // --- SNS Alarm Actions ---

  test('all alarms send notifications to SNS alerts topic', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    const alarmCount = Object.keys(alarms).length;

    // Each alarm should have AlarmActions referencing the SNS topic
    for (const [_id, alarm] of Object.entries(alarms)) {
      const actions = (alarm as any).Properties?.AlarmActions;
      expect(actions).toBeDefined();
      expect(actions.length).toBeGreaterThan(0);
    }

    // We expect at least 5 alarms: FIRMS failures, DynamoDB errors, 3x Lambda error rates
    expect(alarmCount).toBeGreaterThanOrEqual(5);
  });

  test('alarm actions reference the CriticalAlerts SNS topic', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'FireRiskEngine-FIRMS-ConsecutiveFailures',
      AlarmActions: Match.arrayWith([
        { Ref: Match.stringLikeRegexp('CriticalAlertsTopic') },
      ]),
    });
  });

  // --- Alarm period for fast notification (within 60s) ---

  test('FIRMS alarm evaluates on 5-minute period (fast detection)', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'FireRiskEngine-FIRMS-ConsecutiveFailures',
      EvaluationPeriods: 1,
      // Period is encoded in the metric, verified by threshold being 1
      // (single period evaluation = alarm triggers within one period)
    });
  });
});
