import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const extensionPath = resolve('..', 'extension');
const popupPageErrors = [];

const tableOne = `<table><thead><tr><th>Course Code</th><th>Course Title</th><th>Course Type</th><th>Course Structure</th><th>Credits</th><th>Slot</th><th>Faculty</th><th>Venue</th><th>Available Seats</th><th>Total Seats</th><th>Status</th><th>Class Number</th></tr></thead><tbody><tr><td>CSE1001</td><td>Example &amp; Computing</td><td>Theory</td><td>3-0-0</td><td>4</td><td>A11+A12</td><td><span>Faculty A</span></td><td>AB01-101</td><td>0</td><td>60</td><td>Full</td><td>1001</td></tr><tr><td>CSE1001</td><td>Example &amp; Computing</td><td>Theory</td><td>3-0-0</td><td>4</td><td>B11</td><td>Faculty B</td><td>AB02-101</td><td></td><td>60</td><td>Unavailable</td><td>1002</td></tr></tbody></table>`;
const tableTwo = `<table><thead><tr><th>Sub Code</th><th>Course Name</th><th>Course Type</th><th>Course Structure</th><th>Credits</th><th>Slot</th><th>Faculty Name</th><th>Venue</th><th>Available Seats</th><th>Total Seats</th><th>Status</th><th>Class Number</th></tr></thead><tbody><tr><td>CSE1001</td><td>Example &amp; Computing</td><td>Theory</td><td>3-0-0</td><td>4</td><td>A11+A12</td><td>Faculty A</td><td>AB01-101</td><td>5</td><td>60</td><td>Open</td><td>1001</td></tr><tr><td>CSE1001</td><td>Example &amp; Computing</td><td>Theory</td><td>3-0-0</td><td>4</td><td>C11</td><td>Faculty C</td><td>AB02-201</td><td>3</td><td>60</td><td>Open</td><td>1003</td></tr><tr><td>MAT1001</td><td>Second &amp; Example</td><td>Theory</td><td>3-0-0</td><td>3</td><td>D11</td><td>Faculty D</td><td>AB01-202</td><td>9</td><td>60</td><td>Open</td><td>2001</td></tr></tbody></table>`;

function chromeExecutable() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  if (process.platform === 'win32') {
    const installedChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    if (existsSync(installedChrome)) return installedChrome;
  }
  throw new Error('Set CHROME_BIN to an installed Chrome executable to run this real-browser suite.');
}

function launchChrome(profile) {
  return puppeteer.launch({
    browser: 'chrome',
    executablePath: chromeExecutable(),
    userDataDir: profile,
    headless: true,
    pipe: true,
    enableExtensions: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--use-gl=swiftshader'],
    defaultViewport: { width: 1280, height: 900 },
    timeout: 15000,
  });
}

async function serveSyntheticVtopPages(page) {
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.hostname === 'vtop.vitbhopal.ac.in' && url.pathname === '/phase19/page1') {
      request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Synthetic registration page one</title><div id="mount"></div>' });
    } else if (url.hostname === 'vtop.vitbhopal.ac.in' && url.pathname === '/phase19/page2') {
      request.respond({ status: 200, contentType: 'text/html', body: `<!doctype html><title>Synthetic registration page two</title>${tableTwo}` });
    } else if (request.isNavigationRequest()) {
      request.respond({ status: 404, body: 'Not found in synthetic fixture server.' });
    } else {
      request.continue();
    }
  });
}

async function openPopup(browser, extension, tab) {
  const existing = (await browser.targets()).find(target => target.type() === 'page' && target.url() === `chrome-extension://${extension.id}/popup.html`);
  if (existing) await existing.asPage().then(page => page.close());
  await extension.triggerAction(tab);
  const popupTarget = await browser.waitForTarget(
    target => target.type() === 'page' && target.url() === `chrome-extension://${extension.id}/popup.html`,
    { timeout: 10000 },
  );
  const popup = await popupTarget.asPage();
  popup.on('pageerror', error => popupPageErrors.push(error.message));
  return popup;
}

async function importCurrentPage(browser, extension, tab, expectedAlert) {
  const popup = await openPopup(browser, extension, tab);
  await popup.waitForSelector('#btn-import');
  await popup.waitForFunction(() => document.querySelector('#vtop-status-badge')?.textContent === 'Table Found');
  await popup.click('#btn-import');
  await popup.waitForFunction(text => document.querySelector('#alert-text')?.textContent.includes(text), {}, expectedAlert);
  return popup;
}

function readStoredSession(popup) {
  return popup.evaluate(() => new Promise(resolveGet => {
    chrome.storage.local.get(['ffcs_bulk_session'], result => resolveGet(result.ffcs_bulk_session));
  }));
}

test('real Chrome installs the extension and preserves collection state across popup and browser lifecycles', async t => {
  const profile = mkdtempSync(join(tmpdir(), 'ffcs-phase19-chrome-'));
  let browser;
  try {
    browser = await launchChrome(profile);
    const extensionId = await browser.installExtension(extensionPath);
    let extension = (await browser.extensions()).get(extensionId);
    assert.equal(extension?.name, 'FFCS OS Bulk Import');

    const tab = await browser.newPage();
    const pageErrors = [];
    tab.on('pageerror', error => pageErrors.push(error.message));
    await serveSyntheticVtopPages(tab);
    await tab.goto('https://vtop.vitbhopal.ac.in/phase19/page1');
    assert.equal(await tab.title(), 'Synthetic registration page one');

    // Open before the table exists, then exercise the popup's live-page recheck.
    let popup = await openPopup(browser, extension, tab);
    await popup.waitForFunction(() => document.querySelector('#vtop-status-badge')?.textContent === 'No Tables');
    await tab.evaluate(html => { document.querySelector('#mount').innerHTML = html; }, tableOne);
    await popup.click('#btn-check-page');
    await popup.waitForFunction(() => document.querySelector('#vtop-status-badge')?.textContent === 'Table Found');
    await popup.click('#btn-import');
    await popup.waitForFunction(() => document.querySelector('#alert-text')?.textContent.includes('2 offerings'));

    let stored = await readStoredSession(popup);
    assert.equal(Object.keys(stored.courses).length, 1);
    assert.equal(stored.courses.CSE1001.options.length, 2);
    assert.equal(stored.courses.CSE1001.options.some(option => Number(option.availableSeats) === 0), true, 'zero seats are present in Chrome storage');
    const combined = stored.courses.CSE1001.options.find(option => option.sourceOfferingId === '1001');
    assert.equal(combined.rawSlot, 'A11+A12');
    assert.deepEqual(combined.slots, ['A11', 'A12']);
    await popup.close();

    // Closing and reopening the actual extension popup restores the first page.
    popup = await openPopup(browser, extension, tab);
    await popup.waitForFunction(() => document.querySelector('#stat-courses')?.textContent === '1' && document.querySelector('#stat-offerings')?.textContent === '2');
    await popup.close();

    // Merge a second synthetic registration view: one native offering updates,
    // two distinct offerings are added, and prior offers remain present.
    await tab.goto('https://vtop.vitbhopal.ac.in/phase19/page2');
    assert.equal(await tab.title(), 'Synthetic registration page two');
    popup = await importCurrentPage(browser, extension, tab, '3 offerings');
    stored = await readStoredSession(popup);
    assert.equal(Object.keys(stored.courses).length, 2);
    assert.equal(stored.pageHistory.length, 2);
    assert.equal(stored.pageHistory[1].metrics.offeringsAdded, 2);
    assert.equal(stored.pageHistory[1].metrics.offeringsUpdated, 1);
    assert.equal(stored.courses.CSE1001.options.length, 3);
    assert.equal(stored.courses.CSE1001.options.find(option => option.sourceOfferingId === '1001').availableSeats, 5);
    assert.equal(stored.courses.CSE1001.options.some(option => option.sourceOfferingId === '1002'), true);
    assert.equal(stored.courses.CSE1001.options.some(option => option.sourceOfferingId === '1003'), true);
    assert.equal(stored.courses.MAT1001.options.length, 1);
    const exportPayload = await popup.evaluate(session => window.FFCSCore.buildExportPayload(session, '1.1.0'), stored);
    assert.equal(exportPayload.courses.length, 2);
    assert.equal(exportPayload.courses.find(course => course.courseCode === 'CSE1001').options.length, 3);
    await popup.close();
    await browser.close();
    browser = null;

    // Puppeteer's runtime installation is session-scoped, so reinstall the same
    // unpacked source into the same Chrome profile after process restart. Chrome's
    // storage remains bound to the same extension ID and must retain its data.
    browser = await launchChrome(profile);
    extension = (await browser.extensions()).get(extensionId);
    if (!extension) {
      assert.equal(await browser.installExtension(extensionPath), extensionId);
      extension = (await browser.extensions()).get(extensionId);
    }
    assert.equal(extension?.name, 'FFCS OS Bulk Import');
    const restoredTab = await browser.newPage();
    await serveSyntheticVtopPages(restoredTab);
    await restoredTab.goto('https://vtop.vitbhopal.ac.in/phase19/page2');
    popup = await openPopup(browser, extension, restoredTab);
    await popup.waitForFunction(() => document.querySelector('#stat-courses')?.textContent === '2' && document.querySelector('#stat-offerings')?.textContent === '4');
    stored = await readStoredSession(popup);
    assert.equal(Object.keys(stored.courses).length, 2);
    assert.equal(stored.pageHistory.length, 2);

    await popup.click('#btn-clear-session');
    await popup.waitForSelector('#confirm-modal:not(.hidden)');
    await popup.click('#modal-confirm');
    await popup.waitForFunction(() => document.querySelector('#stat-courses')?.textContent === '0' && document.querySelector('#stat-offerings')?.textContent === '0');
    assert.equal(await readStoredSession(popup), undefined);
    await popup.close();
    popup = await openPopup(browser, extension, restoredTab);
    await popup.waitForFunction(() => document.querySelector('#stat-courses')?.textContent === '0');
    await popup.click('#btn-new-session');
    await popup.waitForFunction(() => document.querySelector('#alert-text')?.textContent.includes('fresh collection session'));
    await popup.close();
    popup = await openPopup(browser, extension, restoredTab);
    await popup.waitForFunction(() => document.querySelector('#stat-courses')?.textContent === '0');
    assert.deepEqual(pageErrors, [], 'synthetic VTOP tab must have no uncaught JavaScript exceptions');
    assert.deepEqual(popupPageErrors, [], 'extension popup must have no uncaught JavaScript exceptions');
    t.diagnostic('Real Chrome install and popup lifecycle verified using synthetic HTML intercepted at the permitted VTOP hostname. No live VTOP DOM was used. Chrome process restart required Puppeteer to reinstall the same extension ID; extension storage survived the restart.');
  } finally {
    if (browser) await browser.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
  }
});
