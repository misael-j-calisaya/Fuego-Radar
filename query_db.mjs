import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });
const ddbDoc = DynamoDBDocumentClient.from(client);

async function scanTable() {
  const tableName = "FireRiskEngine";
  console.log(`Scanning DynamoDB table "${tableName}"...`);
  try {
    const res = await ddbDoc.send(new ScanCommand({
      TableName: tableName
    }));

    const items = res.Items || [];
    console.log(`Total items found: ${items.length}`);
    console.log("--------------------------------------------------");

    const counts = {
      hotspots: 0,
      currentRisk: 0,
      riskZones: 0,
      alerts: 0,
      ingestMeta: 0,
      subscriptions: 0,
      verificationTokens: 0,
      others: 0
    };

    const provincesWithHotspots = new Set();
    const alertTitles = [];

    for (const item of items) {
      const pk = item.PK || "";
      if (pk.startsWith("HOTSPOT#")) {
        counts.hotspots++;
        provincesWithHotspots.add(item.province);
      } else if (pk === "RISK#CURRENT") {
        counts.currentRisk++;
      } else if (pk === "RISK#ZONES") {
        counts.riskZones++;
      } else if (pk.startsWith("ALERT#")) {
        counts.alerts++;
        alertTitles.push(`${item.province}: ${item.title} (${item.severity})`);
      } else if (pk === "META#INGESTION") {
        counts.ingestMeta++;
      } else if (pk.startsWith("SUB#")) {
        counts.subscriptions++;
      } else if (pk.startsWith("VERIFY#")) {
        counts.verificationTokens++;
      } else {
        counts.others++;
      }
    }

    console.log("Record type counts:");
    console.log(` - Hotspots (HOTSPOT#*):        ${counts.hotspots}`);
    console.log(` - Current Risk (RISK#CURRENT): ${counts.currentRisk}`);
    console.log(` - Risk Zones (RISK#ZONES):     ${counts.riskZones}`);
    console.log(` - Alerts (ALERT#*):            ${counts.alerts}`);
    console.log(` - Ingestion Meta (META#*):     ${counts.ingestMeta}`);
    console.log(` - Subscriptions (SUB#*):       ${counts.subscriptions}`);
    console.log(` - Verification (VERIFY#*):     ${counts.verificationTokens}`);
    console.log(` - Others:                      ${counts.others}`);
    console.log("--------------------------------------------------");
    console.log(`Provinces with hotspots: ${Array.from(provincesWithHotspots).join(", ")}`);
    console.log(`Alerts generated:`);
    alertTitles.forEach(t => console.log(` * ${t}`));
    console.log("--------------------------------------------------");
  } catch (err) {
    console.error("Error scanning table:", err);
  }
}

scanTable();
