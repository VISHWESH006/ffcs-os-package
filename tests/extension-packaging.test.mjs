import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packager = join(root, 'scripts', 'package_extension.py');

function createExtension(source, hosts = ['https://vtop.vitbhopal.ac.in/*']) {
  mkdirSync(join(source, 'icons'), { recursive: true });
  writeFileSync(join(source, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    host_permissions: hosts,
    action: { default_popup: 'popup.html', default_icon: { 16: 'icons/16.png' } },
    content_scripts: [{ matches: ['https://vtop.vitbhopal.ac.in/*'], js: ['content.js'] }],
  }));
  writeFileSync(join(source, 'popup.html'), '<script src="popup.js"></script>');
  writeFileSync(join(source, 'popup.js'), 'import "./helper.js";');
  writeFileSync(join(source, 'helper.js'), 'globalThis.ffcs = true;');
  writeFileSync(join(source, 'content.js'), 'globalThis.content = true;');
  writeFileSync(join(source, 'icons', '16.png'), 'icon');
  writeFileSync(join(source, 'unused.png'), 'unused');
  writeFileSync(join(source, 'debug.js.map'), '{}');
}

test('production package has manifest at ZIP root and only referenced runtime assets', t => {
  const temp = mkdtempSync(join(tmpdir(), 'ffcs-ext-package-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const source = join(temp, 'extension');
  const output = join(temp, 'dist', 'ffcs-os-extension.zip');
  mkdirSync(source);
  createExtension(source);
  execFileSync('python', [packager, '--source', source, '--output', output]);
  const list = execFileSync('python', ['-c', 'import sys,zipfile; print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', output], { encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.ok(list.includes('manifest.json'));
  assert.ok(list.includes('helper.js'));
  assert.ok(list.includes('icons/16.png'));
  assert.ok(!list.includes('unused.png'));
  assert.ok(!list.includes('debug.js.map'));
});

test('checked-in production source uses only VTOP and packages all runtime files', t => {
  const temp = mkdtempSync(join(tmpdir(), 'ffcs-ext-production-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const source = join(root, 'extension');
  const output = join(temp, 'ffcs-os-extension.zip');
  const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage', 'activeTab']);
  assert.deepEqual(manifest.host_permissions, ['https://vtop.vitbhopal.ac.in/*']);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://vtop.vitbhopal.ac.in/*']);
  assert.equal(readFileSync(join(source, 'extractor-core.js'), 'utf8'), readFileSync(join(root, 'extension-dev', 'extractor-core.js'), 'utf8'));
  const runtimeText = ['popup.html', 'popup.js', 'content.js', 'extractor-core.js']
    .map(name => readFileSync(join(source, name), 'utf8')).join('\n');
  assert.doesNotMatch(runtimeText, /localhost|127\.0\.0\.1|ffcs-demo\.vercel\.app|dev\.vitbhopal\.ac\.in/i);
  assert.doesNotMatch(runtimeText, /fetch\s*\(|XMLHttpRequest|axios\./i, 'extension stays on its JSON export workflow and does not call an API directly');
  assert.match(readFileSync(join(source, 'popup.js'), 'utf8'), /if \(!isVtopHost\)/);
  assert.match(readFileSync(join(source, 'content.js'), 'utf8'), /isVtop:\s*window\.location\.hostname === 'vtop\.vitbhopal\.ac\.in'/);
  execFileSync('python', [packager, '--source', source, '--output', output]);
  const list = execFileSync('python', ['-c', 'import sys,zipfile; print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', output], { encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.ok(list.includes('manifest.json'));
  assert.ok(list.includes('popup.html'));
  assert.ok(list.includes('popup.js'));
  assert.ok(list.includes('content.js'));
  assert.ok(list.includes('extractor-core.js'));
  assert.ok(list.includes('icons/icon16.png'));
  assert.ok(list.includes('icons/icon48.png'));
  assert.ok(list.includes('icons/icon128.png'));
  assert.equal(list.length, 8);
  assert.equal(list.some(name => /README|test|\.map$/i.test(name)), false);
});

test('packager refuses development hosts instead of shipping them', t => {
  const temp = mkdtempSync(join(tmpdir(), 'ffcs-ext-host-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const source = join(temp, 'extension');
  mkdirSync(source);
  createExtension(source, ['https://vtop.vitbhopal.ac.in/*', 'https://dev.vitbhopal.ac.in/*']);
  const result = spawnSync('python', [packager, '--source', source, '--output', join(temp, 'out.zip')], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unreviewed production host|Development or broad host/);
});

test('default production package uses extension/ and succeeds without a development fallback', t => {
  const temp = mkdtempSync(join(tmpdir(), 'ffcs-ext-default-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const output = join(temp, 'ffcs-os-extension.zip');
  const result = spawnSync('python', [packager, '--output', output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const list = execFileSync('python', ['-c', 'import sys,zipfile; print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', output], { encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.equal(list[0], 'content.js');
  assert.ok(list.includes('manifest.json'));
  assert.equal(list.some(name => name.includes('extension-dev')), false);
});
