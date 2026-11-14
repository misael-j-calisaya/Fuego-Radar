import { SSMClient, PutParameterCommand } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({ region: 'us-east-1' });

async function createParam() {
  const parameterName = "/fuegoradar/firms-map-key";
  console.log(`Creating SSM Parameter "${parameterName}"...`);
  try {
    await ssm.send(new PutParameterCommand({
      Name: parameterName,
      Value: "MOCK_KEY_PLACEHOLDER",
      Type: "String",
      Overwrite: true,
      Description: "Secure NASA FIRMS MAP KEY for Alerta Fuego Argentina"
    }));
    console.log("Parameter created successfully!");
  } catch (err) {
    console.error("Error creating parameter:", err);
  }
}

createParam();
