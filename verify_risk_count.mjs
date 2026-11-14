async function run() {
  const url = "https://d2xtb0pdutpecz.cloudfront.net/risk/provinces";
  try {
    const res = await fetch(url, {
      headers: { "x-api-key": "FireRiskEngineApiKey2026" }
    });
    const data = await res.json();
    console.log(`HTTP Status: ${res.status}`);
    console.log(`Provinces returned: ${data.length}`);
    console.log("Province Names list:", data.map(p => p.provinceName));
  } catch (err) {
    console.error("Error verifying risk count:", err);
  }
}
run();
