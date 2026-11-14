import { CloudWatchLogsClient, DescribeLogStreamsCommand, GetLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";

const client = new CloudWatchLogsClient({ region: "us-east-1" });

async function getLogs() {
  const logGroupName = "/aws/lambda/FireRiskEngine-Ingestion";
  console.log(`Fetching latest logs for group: ${logGroupName}...`);
  try {
    const streamsRes = await client.send(new DescribeLogStreamsCommand({
      logGroupName,
      orderBy: "LastEventTime",
      descending: true,
      limit: 1
    }));

    if (!streamsRes.logStreams || streamsRes.logStreams.length === 0) {
      console.log("No log streams found.");
      return;
    }

    const streamName = streamsRes.logStreams[0].logStreamName;
    console.log(`Latest Stream: ${streamName}`);
    console.log("--------------------------------------------------------------------------------");

    const eventsRes = await client.send(new GetLogEventsCommand({
      logGroupName,
      logStreamName: streamName,
      limit: 100,
      startFromHead: false
    }));

    for (const event of eventsRes.events || []) {
      const date = new Date(event.timestamp).toISOString();
      console.log(`[${date}] ${event.message.trim()}`);
    }
    console.log("--------------------------------------------------------------------------------");
  } catch (err) {
    console.error("Error fetching logs:", err);
  }
}

getLogs();
