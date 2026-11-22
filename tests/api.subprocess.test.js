import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const api = join(root, 'api-server', 'dist', 'index.mjs');

async function freePort() {
  const server = createServer();
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

async function withApi(t, extraEnv, callback) {
  const port = await freePort();
  const temp = mkdtempSync(join(tmpdir(), 'ffcs-api-failure-'));
  const child = spawn(process.execPath, [api], {
    cwd: join(root, 'api-server'),
    env: { ...process.env, PORT: String(port), WORKSPACE_ROOT: root, FFCS_STORE_PATH: join(temp, 'store.json'), NODE_ENV: 'test', FFCS_TEST_AUTH: '1', FFCS_TEST_AUTH_DEFAULT_UID: 'subprocess-test-user', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', chunk => logs += chunk.toString());
  child.stderr.on('data', chunk => logs += chunk.toString());
  const base = `http://127.0.0.1:${port}/api`;
  try {
    let ready = false;
    for (let i = 0; i < 40; i++) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(`${base}/healthz`);
        if (response.ok) { ready = true; break; }
      } catch { /* wait for startup */ }
      await new Promise(resolveWait => setTimeout(resolveWait, 100));
    }
    assert.ok(ready, `API did not start: ${logs}`);
    await callback(base);
  } finally {
    child.kill();
    await new Promise(resolveClose => child.once('exit', resolveClose));
    rmSync(temp, { recursive: true, force: true });
  }
}

test('Python spawn failure returns a bounded API error and leaves storage empty', async t => {
  await withApi(t, { PYTHON_BIN: 'ffcs-missing-python-executable', FFCS_PYTHON_TIMEOUT_MS: '1000' }, async base => {
    const response = await fetch(`${base}/parse`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawData: JSON.stringify({ courses: [] }) }),
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, 'Parsing could not be completed');
    assert.deepEqual(await (await fetch(`${base}/timetables`)).json(), []);
  });
});

test('Python CLI timeout returns 504 and leaves storage empty', async t => {
  let python;
  try {
    python = execFileSync('python', ['-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' }).trim();
  } catch {
    t.skip('Python interpreter is unavailable');
    return;
  }
  await withApi(t, { PYTHON_BIN: python, FFCS_PYTHON_TIMEOUT_MS: '10' }, async base => {
    const response = await fetch(`${base}/parse`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawData: JSON.stringify({ courses: [] }) }),
    });
    assert.equal(response.status, 504, await response.text());
    assert.deepEqual(await (await fetch(`${base}/timetables`)).json(), []);
  });
});
