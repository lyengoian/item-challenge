import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';

/**
 * Configuring settings that would differ between envs
 *
 * Check with: cdk synth --context env=dev/prod
 * Defaults to "dev" so plain `cdk synth` still works
 *
 * A potential difference is that prod would be where we keep 
 * more exam data and enough logs to debug issues after the fact.
 */
interface EnvConfig {
  tableName: string;
  removalPolicy: cdk.RemovalPolicy;
  logRetention: logs.RetentionDays;
  stageName: string;
  lambdaMemoryMb: number;
}

/**
 * NodejsFunction's entry file lives in the repo-root src/, outside infrastructure/. 
 * By default CDK treats infrastructure/ as the project root and 
 * rejects that path, so we point projectRoot at the real repo root.
 */
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const LAMBDA_ADAPTER_ENTRY = path.join(PROJECT_ROOT, 'src', 'handlers', 'lambda-adapter.ts');

const ENV_CONFIGS: Record<string, EnvConfig> = {
  dev: {
    tableName: 'ExamItems-dev',
    // Fine to tear down while iterating
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    // Keep logs short in dev
    logRetention: logs.RetentionDays.ONE_WEEK,
    stageName: 'dev',
    lambdaMemoryMb: 128,
  },
  prod: {
    tableName: 'ExamItems-prod',
    // Don't let a stack teardown wipe real exam data
    removalPolicy: cdk.RemovalPolicy.RETAIN,
    // Keep a month of logs so older incidents are still retrievable
    logRetention: logs.RetentionDays.ONE_MONTH,
    stageName: 'prod',
    lambdaMemoryMb: 256,
  },
};

export class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Env we're targetting (defaults to dev)
    const envName = (this.node.tryGetContext('env') as string) || 'dev';
    const envConfig = ENV_CONFIGS[envName];
    if (!envConfig) {
      throw new Error(`Unknown env "${envName}". Expected one of: ${Object.keys(ENV_CONFIGS).join(', ')}`);
    }

    /**
     * DynamoDB table (single-table design)
     * --------------------------------------------------------------
     * Every record for one exam item shares PK = ITEM#<id>,
     * and the sort key says which record it is:
     *  SK = METADATA -> current state of the item
     *  SK = VERSION#n -> a frozen snapshot of that version
     *
     * So getting the current item is one GetItem, and getting the whole
     * history is one Query for everything starting with VERSION#.
     */
    const table = new dynamodb.Table(this, 'ExamItemsTable', {
      tableName: envConfig.tableName,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      // Decision here explained in ARCHITECTURE.md. 
      // The idea is that on-demand fits exam-season traffic without capacity guessing
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // DESTROY in dev, RETAIN in prod
      removalPolicy: envConfig.removalPolicy,
    });

    /**
     * Lets us filter by subject + status without scanning the whole table.
     * Makes sense we'd need this since our main key is built around "one item," 
     * not "all items with this subject."
     */
    table.addGlobalSecondaryIndex({
      indexName: 'SubjectStatusIndex',
      partitionKey: { name: 'subject', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'status', type: dynamodb.AttributeType.STRING },
    });

    /**
     * Lambda functions (one per endpoint)
     * --------------------------------------------------------------
     * Giving each endpoint its own Lambda instead of sharing one, so each
     * one only gets the IAM permissions it actually needs, and a traffic
     * spike on one route doesn't eat into the others' cold starts.
     *
     * Using NodejsFunction instead of a plain lambda.Function, since it
     * bundles with esbuild at synth time and pulls in dependencies like
     * @aws-sdk and zod. Code.fromAsset('../dist') alone would only ship
     * what tsc compiles, and would 500 on real AWS when importing node_modules
     */
    const commonEnv = {
      DYNAMODB_TABLE_NAME: table.tableName,
      USE_DYNAMODB: 'true',
    };

    const createItemFn = new NodejsFunction(this, 'CreateItemFunction', {
      functionName: `exam-items-create-${envName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: LAMBDA_ADAPTER_ENTRY,
      handler: 'createItemLambdaHandler',
      projectRoot: PROJECT_ROOT,
      environment: commonEnv,
      timeout: cdk.Duration.seconds(10),
      memorySize: envConfig.lambdaMemoryMb,
    });

    const getItemFn = new NodejsFunction(this, 'GetItemFunction', {
      functionName: `exam-items-get-${envName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: LAMBDA_ADAPTER_ENTRY,
      handler: 'getItemLambdaHandler',
      projectRoot: PROJECT_ROOT,
      environment: commonEnv,
      timeout: cdk.Duration.seconds(10),
      memorySize: envConfig.lambdaMemoryMb,
    });

    const updateItemFn = new NodejsFunction(this, 'UpdateItemFunction', {
      functionName: `exam-items-update-${envName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      /**
       * Hits the adapter, which unpacks the API Gateway event and calls
       * updateItemHandler (same logic the unit tests cover).
       */
      entry: LAMBDA_ADAPTER_ENTRY,
      handler: 'updateItemLambdaHandler',
      projectRoot: PROJECT_ROOT,
      environment: commonEnv,
      timeout: cdk.Duration.seconds(10),
      // Prod gets more memory (and CPU). Dev is kept lean.
      memorySize: envConfig.lambdaMemoryMb,
    });

    const listItemsFn = new NodejsFunction(this, 'ListItemsFunction', {
      functionName: `exam-items-list-${envName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: LAMBDA_ADAPTER_ENTRY,
      handler: 'listItemsLambdaHandler',
      projectRoot: PROJECT_ROOT,
      environment: commonEnv,
      timeout: cdk.Duration.seconds(10),
      memorySize: envConfig.lambdaMemoryMb,
    });

    /**
     * IAM roles and policies (least privilege per Lambda)
     * --------------------------------------------------------------
     * Create/update need read+write; get/list only need read.
     * The different "grant" helpers attach the role policies CDK creates for each function
     */
    table.grantReadWriteData(createItemFn);
    table.grantReadData(getItemFn);
    table.grantReadWriteData(updateItemFn);
    table.grantReadData(listItemsFn);

    /**
     * CloudWatch log groups
     * --------------------------------------------------------------
     * Declaring log groups explicitly so retention is a real choice, not
     * whatever Lambda defaults to (which is to just keep everything forever)
     */
    new logs.LogGroup(this, 'CreateItemLogGroup', {
      logGroupName: `/aws/lambda/${createItemFn.functionName}`,
      retention: envConfig.logRetention,
      removalPolicy: envConfig.removalPolicy,
    });

    new logs.LogGroup(this, 'GetItemLogGroup', {
      logGroupName: `/aws/lambda/${getItemFn.functionName}`,
      retention: envConfig.logRetention,
      removalPolicy: envConfig.removalPolicy,
    });

    new logs.LogGroup(this, 'UpdateItemLogGroup', {
      logGroupName: `/aws/lambda/${updateItemFn.functionName}`,
      retention: envConfig.logRetention,
      removalPolicy: envConfig.removalPolicy,
    });

    new logs.LogGroup(this, 'ListItemsLogGroup', {
      logGroupName: `/aws/lambda/${listItemsFn.functionName}`,
      retention: envConfig.logRetention,
      removalPolicy: envConfig.removalPolicy,
    });

    /**
     * API Gateway REST API
     * ------------------------------------------------------------------
     * Wires the four implemented endpoints to their Lambdas
     */
    const api = new apigateway.RestApi(this, 'ItemApi', {
      restApiName: `Exam Item Management API (${envName})`,
      description: 'API for managing versioned exam items',
      deployOptions: {
        stageName: envConfig.stageName,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
      },
    });

    // /api/items
    const api_ = api.root.addResource('api');
    const items = api_.addResource('items');
    items.addMethod('GET', new apigateway.LambdaIntegration(listItemsFn));
    items.addMethod('POST', new apigateway.LambdaIntegration(createItemFn));

    // /api/items/{id}
    const item = items.addResource('{id}');
    item.addMethod('GET', new apigateway.LambdaIntegration(getItemFn));
    item.addMethod('PUT', new apigateway.LambdaIntegration(updateItemFn));

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Base URL for the Exam Item Management API',
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
      description: 'DynamoDB table name for exam items',
    });
  }
}