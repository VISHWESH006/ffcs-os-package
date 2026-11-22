import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { selectPythonExecutable } from '../api-server/src/lib/python-executable.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const api = join(root, 'api-server', 'dist', 'index.mjs');
const fixture = join(root, 'tests', 'fixtures', 'ffcs_vtop_import_20261114183827.json');

async function freePort() {
  const server = createServer();
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

test('the supplied schema 1.5.0 export parses through the API with the platform default Python command', async () => {
  const port = await freePort();
  const temp = mkdtempSync(join(tmpdir(), 'ffcs-api-python-default-'));
  const { PYTHON_BIN: _inheritedPythonBin, ...inheritedEnv } = process.env;
  const selectedPython = selectPythonExecutable(
    process.platform,
    undefined,
    join(root, '.pythonlibs', 'bin', 'python3'),
    existsSync(join(root, '.pythonlibs', 'bin', 'python3')),
  );
  const env = {
    ...inheritedEnv,
    PORT: String(port),
    WORKSPACE_ROOT: root,
    FFCS_STORE_PATH: join(temp, 'store.json'),
    NODE_ENV: 'test',
    FFCS_TEST_AUTH: '1',
    FFCS_TEST_AUTH_DEFAULT_UID: 'python-default-test-user',
  };
  assert.equal(env.PYTHON_BIN, undefined, 'regression test must exercise default executable selection');

  const child = spawn(process.execPath, [api], {
    cwd: join(root, 'api-server'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', chunk => logs += chunk.toString());
  child.stderr.on('data', chunk => logs += chunk.toString());
  const base = `http://127.0.0.1:${port}/api`;

  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(`${base}/healthz`);
        if (response.ok) { ready = true; break; }
      } catch { /* API is still starting */ }
      await new Promise(resolveWait => setTimeout(resolveWait, 100));
    }
    assert.ok(ready, `API did not start using ${selectedPython}: ${logs}`);

    const rawData = readFileSync(fixture, 'utf8');
    const response = await fetch(`${base}/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test:python-default-test-user' },
      body: JSON.stringify({ rawData }),
    });
    const result = await response.json();
    assert.equal(response.status, 200, `selected Python command: ${selectedPython}; API logs: ${logs}; response: ${JSON.stringify(result)}`);
    assert.equal(result.schemaVersion, '1.5.0');
    assert.equal(result.subjects.length, 5);
    assert.equal(result.totalParsed, 11);
    assert.equal(result.invalidRecords, 0);
    assert.deepEqual(result.errors, []);
    assert.equal(result.subjects.reduce((count, subject) => count + subject.options.length, 0), 11);
    assert.equal(result.subjects.flatMap(subject => subject.options).filter(option => option.rawSlot === 'Register').length, 5);
    assert.ok(result.warnings.some(warning => warning.includes('not optimizer compatible')));
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await once(child, 'exit');
    }
    rmSync(temp, { recursive: true, force: true });
  }
});
