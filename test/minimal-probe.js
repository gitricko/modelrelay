import { runServer } from '../lib/server.js';
import { loadConfig } from '../lib/config.js';

const config = loadConfig();
const server = await runServer(config, 7777);
const port = server.address().port;
console.log('Server listening on', port);

// Wait for health checks
await new Promise(r => setTimeout(r, 3000));

// Fetch Anthropic /v1/models
try {
  const res = await fetch(`http://localhost:${port}/v1/models`, {
    headers: { 'anthropic-version': '2023-06-01' },
  });
  console.log('Status:', res.status);
  console.log('Content-Type:', res.headers.get('content-type'));
  const body = await res.json();
  console.log('Body:', JSON.stringify(body).slice(0, 200));
} catch (e) {
  console.error('Fetch error:', e);
}
server.close();
