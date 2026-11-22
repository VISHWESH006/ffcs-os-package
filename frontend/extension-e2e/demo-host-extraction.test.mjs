import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const extensionPath = resolve('..', 'extension-dev');
const demoUrl = 'https://ffcs-demo.vercel.app/';

function chromeExecutable() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  if (process.platform === 'win32') {
    const installedChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    if (existsSync(installedChrome)) return installedChrome;
  }
  throw new Error('Set CHROME_BIN to an installed Chrome executable to run this real-site suite.');
}

test('development extension imports offerings from the deployed demo rendered table', async t => {
  const profile = mkdtempSync(join(tmpdir(), 'ffcs-demo-chrome-'));
  let browser;
  try {
    browser = await puppeteer.launch({
      browser: 'chrome',
      executablePath: chromeExecutable(),
      userDataDir: profile,
      headless: true,
      pipe: true,
      enableExtensions: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--use-gl=swiftshader'],
      defaultViewport: { width: 1280, height: 900 },
      timeout: 20000,
    });
    const extensionId = await browser.installExtension(extensionPath);
    const extension = (await browser.extensions()).get(extensionId);
    assert.equal(extension?.name, 'FFCS OS — VTOP Demo Test Copy');

    const tab = await browser.newPage();
    tab.setDefaultNavigationTimeout(60000);
    await tab.goto(demoUrl, { waitUntil: 'domcontentloaded' });
    await tab.waitForFunction(() => document.querySelectorAll('table').length > 0, { timeout: 30000 });
    const rendered = await tab.evaluate(() => ({
      title: document.title,
      tableCount: document.querySelectorAll('table').length,
      rowCount: [...document.querySelectorAll('table')].reduce((total, table) => total + table.rows.length, 0),
      tableText: [...document.querySelectorAll('table')].map(table => table.innerText).join('\n'),
    }));
    assert.ok(rendered.rowCount > 1, `Expected rendered course rows; saw ${rendered.rowCount} table rows`);

    await extension.triggerAction(tab);
    const popupTarget = await browser.waitForTarget(
      target => target.type() === 'page' && target.url() === `chrome-extension://${extensionId}/popup.html`,
      { timeout: 15000 },
    );
    const popup = await popupTarget.asPage();
    await popup.waitForSelector('#btn-import');
    await popup.waitForFunction(() => document.querySelector('#vtop-status-badge')?.textContent === 'Table Found', { timeout: 15000 });
    assert.equal(await popup.$eval('#btn-import', button => button.disabled), false);
    await popup.click('#btn-import');
    await popup.waitForFunction(() => document.querySelector('#alert-text')?.textContent.includes('Successfully imported'), { timeout: 15000 });

    const session = await popup.evaluate(() => new Promise(resolveGet => {
      chrome.storage.local.get(['ffcs_bulk_session'], result => resolveGet(result.ffcs_bulk_session));
    }));
    const courseCodes = Object.keys(session?.courses || {});
    const offeringCount = courseCodes.reduce((total, code) => total + (session.courses[code].options?.length || 0), 0);
    assert.ok(offeringCount > 0, 'Expected imported offerings from the live rendered table');
    const importedText = JSON.stringify(session.courses);
    const importedCourseCodes = courseCodes.filter(code => rendered.tableText.includes(code));
    assert.ok(importedCourseCodes.length > 0, 'Imported course codes should appear in the actual rendered table');
    assert.match(await popup.$eval('#vtop-status-badge', badge => badge.textContent), /Table Found/);

    t.diagnostic(`Live URL: ${demoUrl}`);
    t.diagnostic(`Rendered title: ${rendered.title}; tables: ${rendered.tableCount}; table rows: ${rendered.rowCount}`);
    t.diagnostic(`Imported courses: ${courseCodes.join(', ')}; offerings: ${offeringCount}`);
    assert.ok(importedText.length > 0);
    await popup.close();
  } finally {
    if (browser) await browser.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
