import { LambdaClient, GetFunctionConfigurationCommand } from "@aws-sdk/client-lambda";

const lambda = new LambdaClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

async function run() {
  const functionName = "FireRiskEngine-Ingestion";
  console.log(`[Lambda] Fetching configuration for "${functionName}"...`);
  try {
    const response = await lambda.send(new GetFunctionConfigurationCommand({
      FunctionName: functionName
    }));
    console.log("[Lambda] Environment Variables:");
    console.log(JSON.stringify(response.Environment?.Variables, null, 2));
  } catch (err) {
    console.error("[Lambda] Error:", err);
  }
}

run();
