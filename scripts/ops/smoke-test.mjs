// Smoke test against a deployed stack.
// Usage: API_BASE_URL=https://dxxxx.cloudfront.net API_KEY=... node scripts/ops/smoke-test.mjs
const base = process.env.API_BASE_URL;
const apiKey = process.env.API_KEY;

if (!base || !apiKey) {
  console.error('API_BASE_URL and API_KEY environment variables are required.');
  process.exit(1);
}

const endpoints = ['/health', '/risk/provinces', '/risk/zones', '/hotspots', '/alerts'];
let failed = false;

for (const path of endpoints) {
  try {
    const res = await fetch(`${base}${path}`, { headers: { 'x-api-key': apiKey } });
    const data = await res.json();
    const size = Array.isArray(data) ? `${data.length} items` : Object.keys(data).join(', ');
    console.log(`${res.ok ? 'OK  ' : 'FAIL'} ${res.status} ${path} -> ${size}`);
    if (!res.ok) failed = true;
  } catch (err) {
    console.error(`FAIL ${path}:`, err.message);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
