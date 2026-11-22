import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import FFCSCore from '../../extension-dev/extractor-core.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const popupHtml = await readFile(path.resolve(here, '../../extension-dev/popup.html'), 'utf8');
const popupScript = await readFile(path.resolve(here, '../../extension-dev/popup.js'), 'utf8');

function createPopup({ failRead = false, failWrite = false, failRemove = false } = {}) {
  const dom = new JSDOM(popupHtml, { url: 'chrome-extension://test/popup.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const window = dom.window;
  const state = { failRead, failWrite, failRemove, stored: null };
  const runtime = { lastError: null };
  const callback = (error, fn) => {
    runtime.lastError = error ? { message: error } : null;
    fn();
    runtime.lastError = null;
  };
  window.chrome = {
    runtime,
    storage: { local: {
      get(_keys, done) { callback(state.failRead ? 'simulated read failure' : null, () => done(state.stored ? { ffcs_bulk_session: structuredClone(state.stored) } : {})); },
      set(items, done) {
        if (!state.failWrite) state.stored = structuredClone(items.ffcs_bulk_session);
        callback(state.failWrite ? 'simulated quota failure' : null, done);
      },
      remove(_keys, done) {
        if (!state.failRemove) state.stored = null;
        callback(state.failRemove ? 'simulated remove failure' : null, done);
      },
    } },
    tabs: {
      query(_query, done) { done([{ id: 9, url: 'https://vtop.vitbhopal.ac.in/vtop/register' }]); },
      sendMessage(_tabId, message, done) {
        done(message.action === 'CHECK_PAGE_STATUS'
          ? { hasRegistrationTable: true, tableCount: 1, detectedCategory: 'Program Core' }
          : { success: true, rawUrl: 'https://vtop.vitbhopal.ac.in/vtop/register;jsessionid=secret', sanitizedUrl: 'https://vtop.vitbhopal.ac.in/vtop/register', pageTitle: 'Registration', detectedCategory: 'Program Core', rows: [{ courseCode: 'CSE9001', courseName: 'Compilers', credits: 4, courseStructure: '3-0-0', componentType: 'Theory', rawSlot: 'A11', facultyName: 'Faculty A', venue: 'AB01-101', availableSeats: '0', totalSeats: '60', classStatus: 'Full', sourceOfferingId: '1001' }], domMetrics: {} });
      },
    },
  };
  window.FFCSCore = FFCSCore;
  window.eval(popupScript);
  return { dom, window, state };
}

async function until(predicate, message) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`${message}. Current alert: ${predicate.lastValue ?? ''}`);
}

test('popup read failure blocks imports until storage can be read', async () => {
  const { dom, window, state } = createPopup({ failRead: true });
  try {
    await until(() => window.document.querySelector('#vtop-status-badge').textContent === 'Storage Error', 'popup did not expose a storage read error');
    assert.match(window.document.querySelector('#alert-text').textContent, /No empty session was created/);
    assert.equal(window.document.querySelector('#btn-import').disabled, true);
    assert.equal(state.stored, null);

    state.failRead = false;
    window.document.querySelector('#btn-retry-storage').click();
    await until(() => window.document.querySelector('#vtop-status-badge').textContent === 'Table Found', 'retry did not restore page checks');
    assert.equal(window.document.querySelector('#btn-import').disabled, false);
  } finally { dom.window.close(); }
});

test('popup write and remove failures never report success and offer a retry path', async () => {
  const { dom, window, state } = createPopup({ failWrite: true });
  try {
    await until(() => window.document.querySelector('#vtop-status-badge').textContent === 'Table Found', 'popup did not check the active VTOP tab');
    window.document.querySelector('#btn-import').click();
    await until(() => window.document.querySelector('#alert-text').textContent.includes('simulated quota failure'), 'popup did not show its storage write error');
    assert.match(window.document.querySelector('#alert-text').textContent, /Keep this popup open/);
    assert.doesNotMatch(window.document.querySelector('#alert-text').textContent, /Successfully imported/);
    assert.equal(window.document.querySelector('#stat-courses').textContent, '1');
    assert.equal(window.document.querySelector('#btn-export').disabled, false);
    assert.equal(state.stored, null);

    state.failWrite = false;
    window.document.querySelector('#btn-retry-storage').click();
    await until(() => window.document.querySelector('#alert-text').textContent === 'Collection saved to browser storage.', 'retry did not save the pending collection');
    assert.equal(state.stored.courses.CSE9001.options[0].availableSeats, 0);

    state.failRemove = true;
    window.document.querySelector('#btn-clear-session').click();
    window.document.querySelector('#modal-confirm').click();
    await until(() => {
      const text = window.document.querySelector('#alert-text').textContent;
      if (text.includes('simulated remove failure')) return true;
      return false;
    }, `popup did not show its clear error (last: ${window.document.querySelector('#alert-text').textContent})`);
    assert.doesNotMatch(window.document.querySelector('#alert-text').textContent, /Collection cleared/);
    assert.equal(state.stored.courses.CSE9001.options.length, 1);

    state.failRemove = false;
    window.document.querySelector('#btn-retry-storage').click();
    await until(() => window.document.querySelector('#stat-courses').textContent === '1', 'retry did not restore the previously saved data');
    assert.equal(state.stored.courses.CSE9001.options.length, 1);
  } finally { dom.window.close(); }
});
