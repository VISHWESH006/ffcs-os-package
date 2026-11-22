import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const api = join(root, 'api-server', 'dist', 'index.mjs');

async function freePort() {
  const server = createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}

test('API requires identity, scopes user data by verified UID, and deletes only that account data', async t => {
  const temp = mkdtempSync(join(tmpdir(), 'ffcs-auth-ownership-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const storePath = join(temp, 'store.json');
  const seed = {
    preferences: { maxGap: 99 },
    userPreferences: { alice: { maxGap: 1 }, bob: { maxGap: 3 } },
    timetables: [
      { id: 1, ownerUid: 'alice', name: 'Alice schedule', score: { overall: 80 }, courses: [], grid: [], savedAt: '2026-01-01T00:00:00.000Z' },
      { id: 2, ownerUid: 'bob', name: 'Bob schedule', score: { overall: 90 }, courses: [], grid: [], savedAt: '2026-01-02T00:00:00.000Z' },
      { id: 3, name: 'Legacy unowned schedule', score: { overall: 100 }, courses: [], grid: [], savedAt: '2025-01-01T00:00:00.000Z' },
    ],
    history: [
      { id: 1, ownerUid: 'alice', subjects: [{ courseCode: 'ALICE' }], preferences: {}, resultCount: 1, durationMs: 10, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 2, ownerUid: 'bob', subjects: [{ courseCode: 'BOB' }], preferences: {}, resultCount: 1, durationMs: 20, createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 3, subjects: [{ courseCode: 'LEGACY' }], preferences: {}, resultCount: 1, durationMs: 30, createdAt: '2025-01-01T00:00:00.000Z' },
    ],
    nextTimetableId: 4,
    nextHistoryId: 4,
  };
  writeFileSync(storePath, JSON.stringify(seed), 'utf8');
  const port = await freePort();
  const child = spawn(process.execPath, [api], {
    cwd: join(root, 'api-server'),
    env: { ...process.env, PORT: String(port), WORKSPACE_ROOT: root, NODE_ENV: 'test', FFCS_TEST_AUTH: '1', FFCS_STORE_PATH: storePath, FFCS_TEST_AUTH_DEFAULT_UID: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', part => logs += part.toString());
  child.stderr.on('data', part => logs += part.toString());
  const base = `http://127.0.0.1:${port}/api`;
  const auth = uid => ({ authorization: `Bearer test:${uid}` });
  try {
    let ready = false;
    for (let retry = 0; retry < 50; retry++) {
      if (child.exitCode !== null) break;
      try { if ((await fetch(`${base}/healthz`)).ok) { ready = true; break; } } catch { /* wait for startup */ }
      await new Promise(done => setTimeout(done, 100));
    }
    assert.ok(ready, `API did not start: ${logs}`);
    assert.equal((await fetch(`${base}/healthz`)).status, 200, 'health endpoint stays public');
    assert.equal((await fetch(`${base}/timetables`)).status, 401);
    assert.equal((await fetch(`${base}/parse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(`${base}/timetables`, { headers: auth('invalid:invalid') })).status, 401);
    assert.equal((await fetch(`${base}/timetables`, { headers: auth('expired:expired') })).status, 401);

    const aliceList = await (await fetch(`${base}/timetables`, { headers: auth('alice') })).json();
    assert.deepEqual(aliceList.map(item => item.name), ['Alice schedule']);
    assert.equal((await fetch(`${base}/timetables/2`, { headers: auth('alice') })).status, 404);
    assert.equal((await fetch(`${base}/timetables/2`, { method: 'DELETE', headers: auth('alice') })).status, 404);
    assert.deepEqual(await (await fetch(`${base}/history`, { headers: auth('alice') })).json().then(items => items.map(item => item.id)), [1]);
    assert.equal((await (await fetch(`${base}/preferences`, { headers: auth('alice') })).json()).maxGap, 1);
    const aliceStats = await (await fetch(`${base}/stats`, { headers: auth('alice') })).json();
    assert.equal(aliceStats.savedTimetables, 1);
    assert.equal(aliceStats.totalOptimizations, 1);

    const bobList = await (await fetch(`${base}/timetables`, { headers: auth('bob') })).json();
    assert.deepEqual(bobList.map(item => item.name), ['Bob schedule']);
    assert.equal((await (await fetch(`${base}/preferences`, { headers: auth('bob') })).json()).maxGap, 3);

    assert.equal((await fetch(`${base}/account`, { method: 'DELETE', headers: auth('alice') })).status, 204);
    assert.equal((await fetch(`${base}/timetables`, { headers: auth('alice') })).status, 401, 'deleted Firebase identities cannot keep using the API');
    const bobAfterDeletion = await (await fetch(`${base}/timetables`, { headers: auth('bob') })).json();
    assert.deepEqual(bobAfterDeletion.map(item => item.name), ['Bob schedule']);
    const stored = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.equal(stored.timetables.some(item => item.ownerUid === 'alice'), false);
    assert.equal(stored.userPreferences.alice, undefined);
    assert.equal(stored.timetables.some(item => item.name === 'Legacy unowned schedule'), true, 'legacy records are retained without being exposed');
  } finally {
    child.kill();
    if (child.exitCode === null) await new Promise(done => child.once('exit', done));
  }
});
