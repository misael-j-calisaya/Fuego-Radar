import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const lambda = new LambdaClient({ region: 'us-east-1' });

async function run() {
  try {
    console.log("Triggering FireRiskEngine-Ingestion Lambda...");
    const ingestRes = await lambda.send(new InvokeCommand({
      FunctionName: 'FireRiskEngine-Ingestion',
      Payload: JSON.stringify({ source: 'manual', 'detail-type': 'Scheduled Event', detail: { forceRefresh: true } })
    }));
    const ingestPayload = new TextDecoder().decode(ingestRes.Payload);
    console.log("Ingestion response:", ingestPayload);

    console.log("Triggering FireRiskEngine-Calculation Lambda...");
    const calcRes = await lambda.send(new InvokeCommand({
      FunctionName: 'FireRiskEngine-Calculation'
    }));
    const calcPayload = new TextDecoder().decode(calcRes.Payload);
    console.log("Calculation response:", calcPayload);

    console.log("Trigger complete!");
  } catch (err) {
    console.error("Error triggering lambdas:", err);
  }
}

run();
