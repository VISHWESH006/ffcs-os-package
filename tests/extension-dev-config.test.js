const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const development = join(__dirname, '..', 'extension-dev');

test('development extension explicitly allows VTOP, demo, and dev.vitbhopal.ac.in', () => {
  const devManifest = JSON.parse(readFileSync(join(development, 'manifest.json'), 'utf8'));
  const hosts = [
    'https://vtop.vitbhopal.ac.in/*',
    'https://ffcs-demo.vercel.app/*',
    'https://dev.vitbhopal.ac.in/*',
  ];
  assert.deepEqual(devManifest.host_permissions, hosts);
  assert.deepEqual(devManifest.content_scripts[0].matches, hosts);
  assert.equal(devManifest.name, 'FFCS OS — Development Test Copy');
  assert.equal(devManifest.host_permissions.some(host => host.includes('*://') || host === '<all_urls>'), false);
});

test('development source sanitizer retains the strict VTOP provenance boundary', () => {
  const coreSource = readFileSync(join(development, 'extractor-core.js'), 'utf8');
  const vm = require('node:vm');
  const context = { URL };
  vm.runInNewContext(coreSource, context);
  const sanitize = context.FFCSCore.sanitizeVtopUrl;
  assert.equal(sanitize('https://vtop.vitbhopal.ac.in/vtop/register'), 'https://vtop.vitbhopal.ac.in/vtop/register');
  assert.equal(sanitize('https://dev.vitbhopal.ac.in/registration'), null);
  assert.equal(sanitize('https://evil.example/'), null);
});

test('only development content and popup authorize the Vercel and dev hosts', () => {
  const devContent = readFileSync(join(development, 'content.js'), 'utf8');
  const devPopup = readFileSync(join(development, 'popup.js'), 'utf8');
  assert.match(devContent, /window\.location\.hostname === 'dev\.vitbhopal\.ac\.in'/);
  assert.match(devContent, /window\.location\.hostname === 'ffcs-demo\.vercel\.app'/);
  assert.match(devPopup, /activeUrl\.hostname === 'dev\.vitbhopal\.ac\.in'/);
  assert.match(devPopup, /activeUrl\.hostname === 'ffcs-demo\.vercel\.app'/);
});

test('development extension UI identifies itself as a test copy', () => {
  const popupHtml = readFileSync(join(development, 'popup.html'), 'utf8');
  assert.match(popupHtml, /FFCS OS Development Test Copy/);
});
