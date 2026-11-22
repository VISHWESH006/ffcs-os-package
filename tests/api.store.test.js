import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const api = join(root, 'api-server', 'dist', 'index.mjs');
const failureHook = join(root, 'tests', 'fixtures', 'store-failure-hook.mjs');

async function freePort() {
  const server = createServer();
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

async function startApi(storePath, { defaultPath = false, extraEnv = {}, nodeArgs = [] } = {}) {
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), WORKSPACE_ROOT: root, NODE_ENV: 'test', FFCS_TEST_AUTH: '1', FFCS_TEST_AUTH_DEFAULT_UID: 'store-test-user', ...extraEnv };
  if (defaultPath) delete env.FFCS_STORE_PATH;
  else env.FFCS_STORE_PATH = storePath;
  const child = spawn(process.execPath, [...nodeArgs, api], {
    cwd: join(root, 'api-server'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', chunk => logs += chunk.toString());
  child.stderr.on('data', chunk => logs += chunk.toString());
  const base = `http://127.0.0.1:${port}/api`;
  let ready = false;
  for (let i = 0; i < 40; i++) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(`${base}/healthz`)).ok) { ready = true; break; }
    } catch { /* wait for startup */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  assert.ok(ready, `API did not start: ${logs}`);
  return { child, base };
}

async function stopApi(child) {
  child.kill();
  if (child.exitCode === null) await new Promise(resolveExit => child.once('exit', resolveExit));
}

test('preference data survives an API process restart', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'ffcs-store-restart-'));
  const storePath = join(temp, 'store.json');
  let running;
  try {
    running = await startApi(storePath);
    const updated = await fetch(`${running.base}/preferences`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ maxGap: 9 }),
    });
    assert.equal(updated.status, 200);
    await stopApi(running.child);
    running = await startApi(storePath);
    const restored = await fetch(`${running.base}/preferences`);
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).maxGap, 9);
  } finally {
    if (running) await stopApi(running.child);
    rmSync(temp, { recursive: true, force: true });
  }
});

test('default-path migration copies a valid legacy store and leaves the original file intact', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'ffcs-store-migration-'));
  const dataHome = join(temp, 'data');
  const legacyPath = join(temp, 'legacy-store.json');
  const legacyContents = JSON.stringify({
    preferences: { maxGap: 7 }, timetables: [], history: [], nextTimetableId: 1, nextHistoryId: 1,
  });
  writeFileSync(legacyPath, legacyContents, 'utf8');
  const storePath = join(dataHome, 'FFCS OS', 'ffcs_store.json');
  let running;
  try {
    running = await startApi(undefined, {
      defaultPath: true,
      extraEnv: { FFCS_LEGACY_STORE_PATH: legacyPath, LOCALAPPDATA: dataHome, XDG_DATA_HOME: dataHome },
    });
    const response = await fetch(`${running.base}/preferences`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).maxGap, 4, 'unowned legacy preferences are not assigned to the authenticated test user');
    assert.equal(readFileSync(storePath, 'utf8'), legacyContents);
    assert.equal(readFileSync(legacyPath, 'utf8'), legacyContents, 'migration must copy, not delete, the source file');
  } finally {
    if (running) await stopApi(running.child);
    rmSync(temp, { recursive: true, force: true });
  }
});

test('unreadable, corrupt, or structurally invalid stores fail closed without replacing the file', async () => {
  const invalidStores = [
    ['empty', ''],
    ['malformed', '{broken'],
    ['truncated', '{"preferences":{"maxGap":2},"timetables":['],
    ['invalid structure', JSON.stringify({ preferences: [], timetables: [], history: [], nextTimetableId: 1, nextHistoryId: 1 })],
  ];
  for (const [label, initialContents] of invalidStores) {
    const temp = mkdtempSync(join(tmpdir(), 'ffcs-store-corrupt-'));
    const storePath = join(temp, 'store.json');
    writeFileSync(storePath, initialContents, 'utf8');
    let running;
    try {
      running = await startApi(storePath);
      const list = await fetch(`${running.base}/timetables`);
      assert.equal(list.status, 503, `${label} store must not appear empty`);
      const update = await fetch(`${running.base}/preferences`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ maxGap: 99 }),
      });
      assert.equal(update.status, 503, `${label} store must block writes`);
      assert.equal(readFileSync(storePath, 'utf8'), initialContents, `${label} source file must remain available`);
    } finally {
      if (running) await stopApi(running.child);
      rmSync(temp, { recursive: true, force: true });
    }
  }
});

test('a store path that is a directory reports a write failure without claiming success', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'ffcs-store-write-fail-'));
  const storePath = join(temp, 'store.json');
  mkdirSync(storePath);
  let running;
  try {
    running = await startApi(storePath);
    const list = await fetch(`${running.base}/timetables`);
    assert.equal(list.status, 503, 'an existing path that cannot be read as a file must not look like a missing store');
    const update = await fetch(`${running.base}/preferences`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ maxGap: 3 }),
    });
    assert.equal(update.status, 503);
    assert.equal((await update.json()).error.includes('store'), true);
    await stopApi(running.child);
    running = await startApi(storePath);
    assert.equal((await fetch(`${running.base}/timetables`)).status, 503, 'restart must keep rejecting the failed store path');
  } finally {
    if (running) await stopApi(running.child);
    rmSync(temp, { recursive: true, force: true });
  }
});

test('temporary-file and rename failures preserve saved preferences and recover after restart', async () => {
  const failures = ['temp-write', 'rename'];
  const originalContents = JSON.stringify({
    preferences: { maxGap: 6 }, userPreferences: { 'store-test-user': { maxGap: 6 } },
    timetables: [], history: [], nextTimetableId: 1, nextHistoryId: 1,
  });
  for (const failure of failures) {
    const temp = mkdtempSync(join(tmpdir(), 'ffcs-store-failure-'));
    const storePath = join(temp, 'store.json');
    writeFileSync(storePath, originalContents, 'utf8');
    let running;
    try {
      running = await startApi(storePath, {
        extraEnv: { FFCS_TEST_STORE_FAILURE: failure },
        nodeArgs: ['--import', pathToFileURL(failureHook).href],
      });
      const read = await fetch(`${running.base}/preferences`);
      assert.equal(read.status, 200);
      assert.equal((await read.json()).maxGap, 6);
      const update = await fetch(`${running.base}/preferences`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ maxGap: 99 }),
      });
      assert.equal(update.status, 503, `${failure} failure must not claim preference persistence`);
      assert.equal(readFileSync(storePath, 'utf8'), originalContents, `${failure} failure must preserve the previous store bytes`);
      assert.deepEqual(readdirSync(temp).sort(), ['store.json'], `${failure} failure must not leave a temporary file`);
      await stopApi(running.child);
      running = await startApi(storePath);
      const recovered = await fetch(`${running.base}/preferences`);
      assert.equal(recovered.status, 200);
      assert.equal((await recovered.json()).maxGap, 6, `${failure} failure must preserve the authenticated user's saved preferences`);
    } finally {
      if (running) await stopApi(running.child);
      rmSync(temp, { recursive: true, force: true });
    }
  }
});
