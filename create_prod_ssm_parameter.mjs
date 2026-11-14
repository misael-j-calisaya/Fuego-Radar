import { SSMClient, PutParameterCommand, GetParameterCommand } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({ region: 'us-east-1' });

async function run() {
  const parameterName = "/fuegoradar/prod/FIRMS_MAP_KEY";
  const parameterValue = "ad093105767ed6b4ac0fbd8df849b5db";
  
  console.log(`[SSM] Creating/Updating SecureString Parameter "${parameterName}"...`);
  try {
    await ssm.send(new PutParameterCommand({
      Name: parameterName,
      Value: parameterValue,
      Type: "SecureString",
      Overwrite: true,
      Description: "Secure production NASA FIRMS MAP KEY for Alerta Fuego Argentina"
    }));
    console.log("[SSM] Parameter created successfully!");

    console.log(`[SSM] Verifying parameter retrieval (with decryption)...`);
    const response = await ssm.send(new GetParameterCommand({
      Name: parameterName,
      WithDecryption: true
    }));
    console.log(`[SSM] Retrieved Parameter Name: ${response.Parameter.Name}`);
    console.log(`[SSM] Retrieved Parameter Type: ${response.Parameter.Type}`);
    console.log(`[SSM] Retrieved Parameter Value: ${response.Parameter.Value}`);
  } catch (err) {
    console.error("[SSM] Error:", err);
  }
}

run();
