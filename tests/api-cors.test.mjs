import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const api = join(root, 'api-server', 'dist', 'index.mjs');

async function freePort() {
  const server = createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  await new Promise(done => server.close(done));
  return port;
}

test('production CORS allows configured frontend origins only', async t => {
  const port = await freePort();
  const temp = mkdtempSync(join(tmpdir(), 'ffcs-cors-test-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const allowed = 'https://planner.example.test';
  const child = spawn(process.execPath, [api], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), CORS_ORIGINS: allowed, FFCS_STORE_PATH: join(temp, 'state.json') },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  t.after(() => child.kill());
  const health = `http://127.0.0.1:${port}/api/healthz`;
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      if ((await fetch(health)).ok) { ready = true; break; }
    } catch { /* wait for server startup */ }
    await new Promise(done => setTimeout(done, 100));
  }
  assert.ok(ready, `API did not start: ${stderr}`);
  const allowedResponse = await fetch(health, { headers: { Origin: allowed } });
  assert.equal(allowedResponse.headers.get('access-control-allow-origin'), allowed);
  const blockedResponse = await fetch(health, { headers: { Origin: 'https://other.example.test' } });
  assert.equal(blockedResponse.headers.get('access-control-allow-origin'), null);
});
