import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export class FireRiskEngineStack extends cdk.Stack {
  public readonly table: dynamodb.Table;
  public readonly rawBucket: s3.Bucket;
  public readonly alertsTopic: sns.Topic;
  public readonly api: apigateway.RestApi;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ========================================
    // DynamoDB Table - Single Table Design
    // ========================================
    this.table = new dynamodb.Table(this, 'FireRiskEngineTable', {
      tableName: 'FireRiskEngine',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'TTL',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI1: Temporal/severity queries (ALL projection)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2: Reserved for future access patterns (KEYS_ONLY projection)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    // ========================================
    // S3 Bucket - Raw FIRMS CSV storage
    // ========================================
    this.rawBucket = new s3.Bucket(this, 'FirmsRawBucket', {
      bucketName: cdk.Fn.sub('fuegoradar-firms-raw-${AWS::AccountId}'),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          id: 'ExpireRawCsvAfter90Days',
          expiration: cdk.Duration.days(90),
          prefix: 'firms-raw/',
        },
      ],
    });

    // ========================================
    // S3 Bucket - Frontend Static Hosting
    // ========================================
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: cdk.Fn.sub('fuegoradar-frontend-${AWS::AccountId}'),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // ========================================
    // SNS Topic - Critical fire alerts
    // ========================================
    this.alertsTopic = new sns.Topic(this, 'CriticalAlertsTopic', {
      topicName: 'FireRiskEngine-CriticalAlerts',
      displayName: 'Alerta Fuego Argentina - Alertas Críticas',
    });

    // ========================================
    // IAM Roles - Least privilege per Lambda (Task 9.1)
    // ========================================

    // Ingestion Lambda Role
    // Permissions: DDB write (BatchWriteItem, PutItem) on table only,
    //              S3 PutObject restricted to firms-raw/ prefix,
    //              CloudWatch logs via managed policy
    const ingestionRole = new iam.Role(this, 'IngestionLambdaRole', {
      roleName: 'FireRiskEngine-IngestionLambdaRole',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for FIRMS ingestion Lambda with DDB write, S3 put, and CloudWatch logs',
    });

    ingestionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'DynamoDBWriteTable',
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:BatchWriteItem', 'dynamodb:PutItem'],
      resources: [this.table.tableArn],
    }));

    ingestionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'DynamoDBReadIngestionState',
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem'],
      resources: [this.table.tableArn],
    }));

    ingestionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'S3PutRawCsv',
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject'],
      resources: [this.rawBucket.arnForObjects('firms-raw/*')],
    }));

    ingestionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    );

    // Query Lambda Role
    // Permissions: DDB read-only (Query, GetItem) on table and all GSIs,
    //              CloudWatch logs via managed policy
    // Explicitly NO write access to DDB, NO S3, NO SNS, NO SES
    const queryRole = new iam.Role(this, 'QueryLambdaRole', {
      roleName: 'FireRiskEngine-QueryLambdaRole',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for API query Lambda with DDB read-only and CloudWatch logs',
    });

    queryRole.addToPolicy(new iam.PolicyStatement({
      sid: 'DynamoDBReadOnly',
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:Query', 'dynamodb:GetItem'],
      resources: [
        this.table.tableArn,
        `${this.table.tableArn}/index/GSI1`,
        `${this.table.tableArn}/index/GSI2`,
      ],
    }));

    queryRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    );

    // Calculation Lambda Role
    // Permissions: DDB read+write (Query on table+GSIs, PutItem, BatchWriteItem on table),
    //              SNS Publish restricted to alerts topic ARN,
    //              CloudWatch logs via managed policy
    const calculationRole = new iam.Role(this, 'CalculationLambdaRole', {
      roleName: 'FireRiskEngine-CalculationLambdaRole',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for risk calculation Lambda with DDB read/write, SNS publish, and CloudWatch logs',
    });

    calculationRole.addToPolicy(new iam.PolicyStatement({
      sid: 'DynamoDBRead',
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:Query', 'dynamodb:GetItem'],
      resources: [
        this.table.tableArn,
        `${this.table.tableArn}/index/GSI1`,
        `${this.table.tableArn}/index/GSI2`,
      ],
    }));

    calculationRole.addToPolicy(new iam.PolicyStatement({
      sid: 'DynamoDBWrite',
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:PutItem', 'dynamodb:BatchWriteItem'],
      resources: [this.table.tableArn],
    }));

    calculationRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SNSPublishAlerts',
      effect: iam.Effect.ALLOW,
      actions: ['sns:Publish'],
      resources: [this.alertsTopic.topicArn],
    }));

    calculationRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    );

    // Subscriptions Lambda Role
    // Permissions: DDB item-level read/write for subscriptions + verification tokens,
    //              SES send (verification emails), CloudWatch logs.
    // Kept separate so the query Lambda stays strictly read-only.
    const subscriptionsRole = new iam.Role(this, 'SubscriptionsLambdaRole', {
      roleName: 'FireRiskEngine-SubscriptionsLambdaRole',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for subscriptions Lambda with DDB item read/write, SES send, and CloudWatch logs',
    });

    subscriptionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'DynamoDBSubscriptionsReadWrite',
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
      resources: [this.table.tableArn],
    }));

    subscriptionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SESSendVerificationEmail',
      effect: iam.Effect.ALLOW,
      actions: ['ses:SendEmail'],
      resources: [`arn:aws:ses:${this.region}:${this.account}:identity/*`],
    }));

    subscriptionsRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    );

    // Notification Lambda Role
    // Permissions: DDB Query on table+GSIs (read subscriptions only),
    //              SES SendEmail/SendRawEmail restricted to account identities,
    //              CloudWatch logs via managed policy
    const notificationRole = new iam.Role(this, 'NotificationLambdaRole', {
      roleName: 'FireRiskEngine-NotificationLambdaRole',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for notification dispatcher Lambda with DDB query (subscriptions), SES send, and CloudWatch logs',
    });

    notificationRole.addToPolicy(new iam.PolicyStatement({
      sid: 'DynamoDBQuerySubscriptions',
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:Query'],
      resources: [
        this.table.tableArn,
        `${this.table.tableArn}/index/GSI1`,
        `${this.table.tableArn}/index/GSI2`,
      ],
    }));

    notificationRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SESSendEmail',
      effect: iam.Effect.ALLOW,
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: [
        `arn:aws:ses:${this.region}:${this.account}:identity/*`,
        `arn:aws:ses:${this.region}:${this.account}:configuration-set/*`,
      ],
    }));

    notificationRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    );

    // ========================================
    // Configuration
    // ========================================

    const frontendOrigin = process.env.FRONTEND_ORIGIN ?? 'https://fuegoradar.ar';
    const fromEmail = process.env.FROM_EMAIL ?? 'alertas@fuegoradar.ar';
    const verifyBaseUrl = process.env.VERIFY_BASE_URL ?? `${frontendOrigin}/`;

    // API key value lives in SSM Parameter Store (never hardcoded in source).
    // Create it once with: aws ssm put-parameter --name /fuegoradar/prod/API_KEY --type String --value <key>
    const apiKeyParamName = process.env.API_KEY_SSM_NAME ?? '/fuegoradar/prod/API_KEY';
    const apiKeyValue = ssm.StringParameter.valueForStringParameter(this, apiKeyParamName);

    // ========================================
    // Lambda Functions (placeholder - handlers defined in later tasks)
    // ========================================

    const firmsMapKeyParamName = '/fuegoradar/prod/FIRMS_MAP_KEY';

    // Import the SecureString parameter attributes to grant permissions
    const firmsMapKeyParam = ssm.StringParameter.fromSecureStringParameterAttributes(this, 'FirmsMapKeySecure', {
      parameterName: firmsMapKeyParamName,
      version: 1, // version is required for secure string parameters reference in CDK
    });

    const ingestionLambda = new lambda.Function(this, 'IngestionLambda', {
      functionName: 'FireRiskEngine-Ingestion',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'firmsIngestion.handler',
      code: lambda.Code.fromAsset('../backend/dist/lambdas'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      role: ingestionRole,
      environment: {
        TABLE_NAME: this.table.tableName,
        RAW_BUCKET_NAME: this.rawBucket.bucketName,
        RAW_BUCKET: this.rawBucket.bucketName,
        PROVINCES_GEOJSON_PATH: './data/provinces.json',
        FIRMS_MAP_KEY_SSM_NAME: firmsMapKeyParamName,
        FIRMS_MOCK_FALLBACK: process.env.FIRMS_MOCK_FALLBACK ?? 'false',
        NODE_ENV: process.env.NODE_ENV ?? 'production',
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant the Lambda's execution role permission to read the secure parameter from SSM
    firmsMapKeyParam.grantRead(ingestionLambda);

    const queryLambda = new lambda.Function(this, 'QueryLambda', {
      functionName: 'FireRiskEngine-Query',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'api.handler',
      code: lambda.Code.fromAsset('../backend/dist/lambdas'),
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
      role: queryRole,
      environment: {
        TABLE_NAME: this.table.tableName,
        CORS_ORIGIN: frontendOrigin,
        API_KEYS: apiKeyValue,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    const subscriptionsLambda = new lambda.Function(this, 'SubscriptionsLambda', {
      functionName: 'FireRiskEngine-Subscriptions',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'api.handler',
      code: lambda.Code.fromAsset('../backend/dist/lambdas'),
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
      role: subscriptionsRole,
      environment: {
        TABLE_NAME: this.table.tableName,
        CORS_ORIGIN: frontendOrigin,
        API_KEYS: apiKeyValue,
        FROM_EMAIL: fromEmail,
        VERIFY_BASE_URL: verifyBaseUrl,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    const calculationLambda = new lambda.Function(this, 'CalculationLambda', {
      functionName: 'FireRiskEngine-Calculation',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'riskCalculation.handler',
      code: lambda.Code.fromAsset('../backend/dist/lambdas'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      role: calculationRole,
      environment: {
        TABLE_NAME: this.table.tableName,
        ALERTS_TOPIC_ARN: this.alertsTopic.topicArn,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    const notificationLambda = new lambda.Function(this, 'NotificationLambda', {
      functionName: 'FireRiskEngine-Notification',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'notificationDispatcher.handler',
      code: lambda.Code.fromAsset('../backend/dist/lambdas'),
      memorySize: 128,
      timeout: cdk.Duration.seconds(30),
      role: notificationRole,
      environment: {
        TABLE_NAME: this.table.tableName,
        FROM_EMAIL: fromEmail,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // ========================================
    // API Gateway - REST API with throttling, caching, CORS
    // ========================================

    this.api = new apigateway.RestApi(this, 'FireRiskEngineApi', {
      restApiName: 'FireRiskEngine-API',
      description: 'Fuego Radar - API de Alerta Temprana de Incendios',
      deployOptions: {
        stageName: 'prod',
        cachingEnabled: true,
        cacheClusterEnabled: true,
        cacheClusterSize: '0.5',
        throttlingRateLimit: 50,
        throttlingBurstLimit: 100,
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.ERROR,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: [frontendOrigin],
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: [
          'Content-Type',
          'X-Api-Key',
          'x-api-key',
          'Authorization',
        ],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // --- Gateway Responses (429 with Retry-After) ---
    this.api.addGatewayResponse('ThrottledResponse', {
      type: apigateway.ResponseType.THROTTLED,
      statusCode: '429',
      responseHeaders: {
        'Access-Control-Allow-Origin': `'${frontendOrigin}'`,
        'Retry-After': "'60'",
      },
      templates: {
        'application/json': JSON.stringify({
          error: 'Too many requests',
          retryAfterSeconds: 60,
        }),
      },
    });

    // --- Lambda Integrations ---
    const healthIntegration = new apigateway.LambdaIntegration(queryLambda, {
      proxy: true,
    });
    const riskProvincesIntegration = new apigateway.LambdaIntegration(queryLambda, {
      proxy: true,
    });
    const riskZonesIntegration = new apigateway.LambdaIntegration(queryLambda, {
      proxy: true,
    });
    const hotspotsIntegration = new apigateway.LambdaIntegration(queryLambda, {
      proxy: true,
    });
    const alertsIntegration = new apigateway.LambdaIntegration(queryLambda, {
      proxy: true,
    });
    const subscriptionsIntegration = new apigateway.LambdaIntegration(subscriptionsLambda, {
      proxy: true,
    });

    // --- Routes ---
    // GET /health (no cache - always fresh)
    const healthResource = this.api.root.addResource('health');
    healthResource.addMethod('GET', healthIntegration, {
      methodResponses: [{ statusCode: '200' }],
    });

    // GET /risk/provinces (cache 120s)
    const riskResource = this.api.root.addResource('risk');
    const provincesResource = riskResource.addResource('provinces');
    provincesResource.addMethod('GET', riskProvincesIntegration, {
      methodResponses: [{ statusCode: '200' }],
    });

    // GET /risk/zones (cache 120s)
    const zonesResource = riskResource.addResource('zones');
    zonesResource.addMethod('GET', riskZonesIntegration, {
      methodResponses: [{ statusCode: '200' }],
    });

    // GET /hotspots (cache 60s)
    const hotspotsResource = this.api.root.addResource('hotspots');
    hotspotsResource.addMethod('GET', hotspotsIntegration, {
      methodResponses: [{ statusCode: '200' }],
    });

    // GET /alerts (cache 60s)
    const alertsResource = this.api.root.addResource('alerts');
    alertsResource.addMethod('GET', alertsIntegration, {
      methodResponses: [{ statusCode: '200' }],
    });

    // POST /subscriptions (no cache)
    const subscriptionsResource = this.api.root.addResource('subscriptions');
    subscriptionsResource.addMethod('POST', subscriptionsIntegration, {
      methodResponses: [{ statusCode: '200' }],
    });

    // GET /subscriptions/verify (no cache) — confirms the emailed token
    const verifyResource = subscriptionsResource.addResource('verify');
    verifyResource.addMethod('GET', subscriptionsIntegration, {
      methodResponses: [{ statusCode: '200' }],
    });

    // --- Per-method cache TTL overrides ---
    // /risk/provinces and /risk/zones: 120s cache
    const provincesMethod = provincesResource.node.findChild('GET') as apigateway.Method;
    const cfnProvincesMethod = provincesMethod.node.defaultChild as apigateway.CfnMethod;
    cfnProvincesMethod.addPropertyOverride('Integration.CacheKeyParameters', []);
    cfnProvincesMethod.addPropertyOverride('Integration.CacheNamespace', provincesResource.node.id);

    const zonesMethod = zonesResource.node.findChild('GET') as apigateway.Method;
    const cfnZonesMethod = zonesMethod.node.defaultChild as apigateway.CfnMethod;
    cfnZonesMethod.addPropertyOverride('Integration.CacheKeyParameters', []);
    cfnZonesMethod.addPropertyOverride('Integration.CacheNamespace', zonesResource.node.id);

    // /hotspots and /alerts: 60s cache
    const hotspotsMethod = hotspotsResource.node.findChild('GET') as apigateway.Method;
    const cfnHotspotsMethod = hotspotsMethod.node.defaultChild as apigateway.CfnMethod;
    cfnHotspotsMethod.addPropertyOverride('Integration.CacheKeyParameters', []);
    cfnHotspotsMethod.addPropertyOverride('Integration.CacheNamespace', hotspotsResource.node.id);

    const alertsMethod = alertsResource.node.findChild('GET') as apigateway.Method;
    const cfnAlertsMethod = alertsMethod.node.defaultChild as apigateway.CfnMethod;
    cfnAlertsMethod.addPropertyOverride('Integration.CacheKeyParameters', []);
    cfnAlertsMethod.addPropertyOverride('Integration.CacheNamespace', alertsResource.node.id);

    // /health - disable cache
    const healthMethod = healthResource.node.findChild('GET') as apigateway.Method;
    const cfnHealthMethod = healthMethod.node.defaultChild as apigateway.CfnMethod;
    cfnHealthMethod.addPropertyOverride('Integration.CacheKeyParameters', []);
    cfnHealthMethod.addPropertyOverride('Integration.CacheNamespace', healthResource.node.id);

    // /subscriptions POST - disable cache
    const subscriptionsMethod = subscriptionsResource.node.findChild('POST') as apigateway.Method;
    const cfnSubscriptionsMethod = subscriptionsMethod.node.defaultChild as apigateway.CfnMethod;
    cfnSubscriptionsMethod.addPropertyOverride('Integration.CacheKeyParameters', []);
    cfnSubscriptionsMethod.addPropertyOverride('Integration.CacheNamespace', subscriptionsResource.node.id);

    // --- Usage Plan with API Key ---
    const apiKey = this.api.addApiKey('FireRiskEngineApiKey', {
      apiKeyName: 'FireRiskEngine-DefaultKey',
      description: 'Default API key for Fire Risk Engine',
      value: apiKeyValue,
    });

    const usagePlan = this.api.addUsagePlan('FireRiskEngineUsagePlan', {
      name: 'FireRiskEngine-StandardPlan',
      description: 'Standard usage plan: 50 req/s sustained, 100 req/s burst',
      throttle: {
        rateLimit: 50,
        burstLimit: 100,
      },
      apiStages: [
        {
          api: this.api,
          stage: this.api.deploymentStage,
        },
      ],
    });

    usagePlan.addApiKey(apiKey);

    // --- Stage-level method settings for cache TTL ---
    const stage = this.api.deploymentStage;
    const cfnStage = stage.node.defaultChild as apigateway.CfnStage;

    cfnStage.addPropertyOverride('MethodSettings', [
      {
        ResourcePath: '/*',
        HttpMethod: '*',
        ThrottlingRateLimit: 50,
        ThrottlingBurstLimit: 100,
        MetricsEnabled: true,
        LoggingLevel: 'ERROR',
      },
      {
        ResourcePath: '/health/GET',
        HttpMethod: 'GET',
        CachingEnabled: false,
      },
      {
        ResourcePath: '/risk/provinces/GET',
        HttpMethod: 'GET',
        CachingEnabled: true,
        CacheTtlInSeconds: 120,
      },
      {
        ResourcePath: '/risk/zones/GET',
        HttpMethod: 'GET',
        CachingEnabled: true,
        CacheTtlInSeconds: 120,
      },
      {
        ResourcePath: '/hotspots/GET',
        HttpMethod: 'GET',
        CachingEnabled: true,
        CacheTtlInSeconds: 60,
      },
      {
        ResourcePath: '/alerts/GET',
        HttpMethod: 'GET',
        CachingEnabled: true,
        CacheTtlInSeconds: 60,
      },
      {
        ResourcePath: '/subscriptions/POST',
        HttpMethod: 'POST',
        CachingEnabled: false,
      },
      {
        ResourcePath: '/subscriptions/verify/GET',
        HttpMethod: 'GET',
        CachingEnabled: false,
      },
    ]);

    // ========================================
    // EventBridge Rules - Scheduled triggers
    // ========================================

    // Ingestion schedule: every 15 minutes
    const ingestionSchedule = new events.Rule(this, 'IngestionSchedule', {
      ruleName: 'FireRiskEngine-IngestionSchedule',
      description: 'Triggers FIRMS ingestion Lambda every 15 minutes',
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
    });
    ingestionSchedule.addTarget(new targets.LambdaFunction(ingestionLambda));

    // Risk calculation schedule: every 30 minutes
    const calculationSchedule = new events.Rule(this, 'CalculationSchedule', {
      ruleName: 'FireRiskEngine-CalculationSchedule',
      description: 'Triggers risk calculation Lambda every 30 minutes',
      schedule: events.Schedule.rate(cdk.Duration.minutes(30)),
    });
    calculationSchedule.addTarget(new targets.LambdaFunction(calculationLambda));

    // ========================================
    // SNS → Lambda Subscription (Task 10.1)
    // ========================================

    // When the calculation Lambda publishes an alert to the SNS topic,
    // the notification Lambda is triggered to dispatch emails/Telegram messages.
    this.alertsTopic.addSubscription(
      new sns_subscriptions.LambdaSubscription(notificationLambda)
    );

    // ========================================
    // CloudWatch Alarms - Observability (Task 9.2)
    // ========================================

    // --- FIRMS Consecutive Failures Alarm ---
    // Uses a metric filter on ingestion Lambda logs to detect structured error logs
    // with alarm: 'FIRMS_CONSECUTIVE_FAILURES' pattern
    const firmsFailureMetricFilter = new logs.MetricFilter(this, 'FirmsFailureMetricFilter', {
      logGroup: ingestionLambda.logGroup,
      metricNamespace: 'FireRiskEngine',
      metricName: 'FirmsConsecutiveFailures',
      filterPattern: logs.FilterPattern.literal('"FIRMS_CONSECUTIVE_FAILURES"'),
      metricValue: '1',
    });

    const firmsFailureAlarm = new cloudwatch.Alarm(this, 'FirmsConsecutiveFailuresAlarm', {
      alarmName: 'FireRiskEngine-FIRMS-ConsecutiveFailures',
      alarmDescription: 'FIRMS API has failed 3 or more consecutive times',
      metric: firmsFailureMetricFilter.metric({
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    firmsFailureAlarm.addAlarmAction(new cw_actions.SnsAction(this.alertsTopic));

    // --- DynamoDB Persistent Errors Alarm ---
    // Triggers when DynamoDB system errors exceed threshold
    const dynamoDbErrorAlarm = new cloudwatch.Alarm(this, 'DynamoDBErrorAlarm', {
      alarmName: 'FireRiskEngine-DynamoDB-PersistentErrors',
      alarmDescription: 'DynamoDB system errors exceed threshold indicating persistent issues',
      metric: this.table.metricSystemErrorsForOperations({
        operations: [
          dynamodb.Operation.PUT_ITEM,
          dynamodb.Operation.QUERY,
          dynamodb.Operation.BATCH_WRITE_ITEM,
        ],
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    dynamoDbErrorAlarm.addAlarmAction(new cw_actions.SnsAction(this.alertsTopic));

    // --- Ingestion Lambda Error Rate Alarm (> 5%) ---
    const ingestionErrorRate = new cloudwatch.MathExpression({
      expression: '(errors / invocations) * 100',
      usingMetrics: {
        errors: ingestionLambda.metricErrors({ statistic: 'Sum', period: cdk.Duration.minutes(5) }),
        invocations: ingestionLambda.metricInvocations({ statistic: 'Sum', period: cdk.Duration.minutes(5) }),
      },
      label: 'Ingestion Lambda Error Rate %',
      period: cdk.Duration.minutes(5),
    });

    const ingestionErrorAlarm = new cloudwatch.Alarm(this, 'IngestionLambdaErrorRateAlarm', {
      alarmName: 'FireRiskEngine-Ingestion-ErrorRate',
      alarmDescription: 'Ingestion Lambda error rate exceeds 5%',
      metric: ingestionErrorRate,
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    ingestionErrorAlarm.addAlarmAction(new cw_actions.SnsAction(this.alertsTopic));

    // --- Calculation Lambda Error Rate Alarm (> 5%) ---
    const calculationErrorRate = new cloudwatch.MathExpression({
      expression: '(errors / invocations) * 100',
      usingMetrics: {
        errors: calculationLambda.metricErrors({ statistic: 'Sum', period: cdk.Duration.minutes(5) }),
        invocations: calculationLambda.metricInvocations({ statistic: 'Sum', period: cdk.Duration.minutes(5) }),
      },
      label: 'Calculation Lambda Error Rate %',
      period: cdk.Duration.minutes(5),
    });

    const calculationErrorAlarm = new cloudwatch.Alarm(this, 'CalculationLambdaErrorRateAlarm', {
      alarmName: 'FireRiskEngine-Calculation-ErrorRate',
      alarmDescription: 'Calculation Lambda error rate exceeds 5%',
      metric: calculationErrorRate,
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    calculationErrorAlarm.addAlarmAction(new cw_actions.SnsAction(this.alertsTopic));

    // --- Query Lambda Error Rate Alarm (> 5%) ---
    const queryErrorRate = new cloudwatch.MathExpression({
      expression: '(errors / invocations) * 100',
      usingMetrics: {
        errors: queryLambda.metricErrors({ statistic: 'Sum', period: cdk.Duration.minutes(5) }),
        invocations: queryLambda.metricInvocations({ statistic: 'Sum', period: cdk.Duration.minutes(5) }),
      },
      label: 'Query Lambda Error Rate %',
      period: cdk.Duration.minutes(5),
    });

    const queryErrorAlarm = new cloudwatch.Alarm(this, 'QueryLambdaErrorRateAlarm', {
      alarmName: 'FireRiskEngine-Query-ErrorRate',
      alarmDescription: 'Query Lambda error rate exceeds 5%',
      metric: queryErrorRate,
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    queryErrorAlarm.addAlarmAction(new cw_actions.SnsAction(this.alertsTopic));

    // ========================================
    // CloudFront Distribution (Task 10.2)
    // ========================================

    // Extract API Gateway domain from the REST API
    const apiDomainName = `${this.api.restApiId}.execute-api.${this.region}.amazonaws.com`;

    // API Gateway origin (forwards to /prod/ stage)
    const apiOrigin = new origins.HttpOrigin(apiDomainName, {
      originPath: '/prod',
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    this.distribution = new cloudfront.Distribution(this, 'ApiDistribution', {
      comment: 'FuegoRadar API CDN - caching layer for API Gateway',
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: new origins.S3Origin(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        }
      ],
      additionalBehaviors: {
        // /risk/* — 120 second cache
        '/risk/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: new cloudfront.CachePolicy(this, 'RiskCachePolicy', {
            cachePolicyName: 'FireRiskEngine-RiskCache-120s',
            comment: 'Cache /risk/* endpoints for 120 seconds',
            defaultTtl: cdk.Duration.seconds(120),
            maxTtl: cdk.Duration.seconds(300),
            minTtl: cdk.Duration.seconds(1),
            enableAcceptEncodingGzip: true,
            enableAcceptEncodingBrotli: true,
            headerBehavior: cloudfront.CacheHeaderBehavior.allowList('x-api-key', 'X-Api-Key'),
          }),
        },
        // /hotspots — 60 second cache
        '/hotspots': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: new cloudfront.CachePolicy(this, 'HotspotsCachePolicy', {
            cachePolicyName: 'FireRiskEngine-HotspotsCache-60s',
            comment: 'Cache /hotspots endpoint for 60 seconds',
            defaultTtl: cdk.Duration.seconds(60),
            maxTtl: cdk.Duration.seconds(120),
            minTtl: cdk.Duration.seconds(1),
            enableAcceptEncodingGzip: true,
            enableAcceptEncodingBrotli: true,
            headerBehavior: cloudfront.CacheHeaderBehavior.allowList('x-api-key', 'X-Api-Key'),
          }),
        },
        // /alerts — 60 second cache
        '/alerts': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: new cloudfront.CachePolicy(this, 'AlertsCachePolicy', {
            cachePolicyName: 'FireRiskEngine-AlertsCache-60s',
            comment: 'Cache /alerts endpoint for 60 seconds',
            defaultTtl: cdk.Duration.seconds(60),
            maxTtl: cdk.Duration.seconds(120),
            minTtl: cdk.Duration.seconds(1),
            enableAcceptEncodingGzip: true,
            enableAcceptEncodingBrotli: true,
            headerBehavior: cloudfront.CacheHeaderBehavior.allowList('x-api-key', 'X-Api-Key'),
          }),
        },
        // /health — no cache (pass through)
        '/health': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        // /subscriptions — no cache (POST mutation)
        '/subscriptions': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        // /subscriptions/verify — no cache, forwards token/email query string
        '/subscriptions/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    });

    // 1. Deploy hashed assets with long cache duration (excluding HTML/SEO entrypoints)
    new s3deploy.BucketDeployment(this, 'DeployHashedAssets', {
      sources: [s3deploy.Source.asset('../dist', {
        exclude: ['index.html', 'robots.txt', 'sitemap.xml'],
      })],
      destinationBucket: frontendBucket,
      cacheControl: [
        s3deploy.CacheControl.fromString('public, max-age=31536000, immutable'),
      ],
      prune: false,
    });

    // 2. Deploy entrypoint files with no-cache and trigger invalidation
    new s3deploy.BucketDeployment(this, 'DeployEntrypoints', {
      sources: [s3deploy.Source.asset('../dist', {
        exclude: ['assets/*'],
      })],
      destinationBucket: frontendBucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      cacheControl: [
        s3deploy.CacheControl.fromString('public, max-age=0, must-revalidate'),
      ],
      prune: false,
    });

    // ========================================
    // Stack Outputs
    // ========================================
    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      description: 'DynamoDB table name',
    });

    new cdk.CfnOutput(this, 'RawBucketName', {
      value: this.rawBucket.bucketName,
      description: 'S3 bucket for raw FIRMS CSV files',
    });

    new cdk.CfnOutput(this, 'AlertsTopicArn', {
      value: this.alertsTopic.topicArn,
      description: 'SNS topic ARN for critical fire alerts',
    });

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: this.api.url,
      description: 'API Gateway endpoint URL',
    });

    new cdk.CfnOutput(this, 'ApiKeyId', {
      value: apiKey.keyId,
      description: 'API Key ID for the usage plan',
    });

    new cdk.CfnOutput(this, 'CloudFrontDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain name',
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution ID',
    });
  }
}
