import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const api = join(root, 'api-server', 'dist', 'index.mjs');
const requireApi = createRequire(join(root, 'api-server', 'package.json'));
const pino = requireApi('pino');

async function freePort() {
  const server = createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}

test('Pino serializes Firebase error name, message, code, and stack through err', () => {
  const error = Object.assign(new Error('Firebase diagnostic detail'), {
    name: 'FirebaseError',
    code: 'auth/internal-error',
  });
  const serialized = pino.stdSerializers.err(error);
  assert.equal(serialized.name, 'FirebaseError');
  assert.equal(serialized.message, 'Firebase diagnostic detail');
  assert.equal(serialized.code, 'auth/internal-error');
  assert.match(serialized.stack, /FirebaseError: Firebase diagnostic detail/);
});

test('Firebase middleware sends caught exceptions through Pino err serializer', () => {
  const source = readFileSync(join(root, 'api-server', 'src', 'lib', 'firebase-auth.ts'), 'utf8');
  assert.match(source, /logger\.error\(\s*\{\s*err:\s*error\s*\}\s*,\s*"Firebase token verification is unavailable"\s*\)/);
});

test('authentication service failure logs diagnostics but keeps tokens and credentials private and returns generic 503', async t => {
  const port = await freePort();
  const token = 'ID_TOKEN_SENTINEL_MUST_NOT_BE_LOGGED';
  const credentialMarker = 'PRIVATE_KEY_SENTINEL_MUST_NOT_BE_LOGGED';
  const child = spawn(process.execPath, [api], {
    cwd: join(root, 'api-server'),
    env: {
      ...process.env,
      PORT: String(port),
      WORKSPACE_ROOT: root,
      NODE_ENV: 'production',
      LOG_LEVEL: 'error',
      FIREBASE_PROJECT_ID: 'ffcs-os',
      // Deliberately truncated test input forces an initialization error; this is not a real key.
      FIREBASE_SERVICE_ACCOUNT_JSON: `{"private_key":"${credentialMarker}"`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });

  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.stderr.on('data', chunk => { logs += chunk.toString(); });
  const base = `http://127.0.0.1:${port}/api`;
  let ready = false;
  for (let retry = 0; retry < 60; retry++) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; }
    } catch { /* wait for startup */ }
    await new Promise(done => setTimeout(done, 100));
  }
  assert.ok(ready, `API did not start: ${logs}`);

  const response = await fetch(`${base}/parse`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Authentication service is not configured or unavailable' });

  for (let retry = 0; retry < 30 && !logs.includes('Firebase token verification is unavailable'); retry++) {
    await new Promise(done => setTimeout(done, 25));
  }
  const log = logs.split(/\r?\n/).filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).find(entry => entry?.msg === 'Firebase token verification is unavailable');
  assert.ok(log, `Firebase diagnostic log not found: ${logs}`);
  assert.equal(log.err.type, 'SyntaxError');
  assert.match(log.err.message, /JSON|property|position|end/i);
  assert.match(log.err.stack, /JSON\.parse/);
  assert.ok(!logs.includes(token), 'bearer token must not appear in logs');
  assert.ok(!logs.includes(credentialMarker), 'credential contents must not appear in logs');
});
