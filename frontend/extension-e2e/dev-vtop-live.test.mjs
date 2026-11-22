import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const extensionPath = resolve('..', 'extension-dev');
const registrationUrl = 'https://dev.vitbhopal.ac.in/Winter%20Semester%202026-27_ALL_open_registration/checkRegistration';

function chromeExecutable() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  if (process.platform === 'win32') {
    const installedChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    if (existsSync(installedChrome)) return installedChrome;
  }
  throw new Error('Set CHROME_BIN to an installed Chrome executable to run this live-site suite.');
}

test('development extension recognizes and imports the live VIT Bhopal registration page', async t => {
  const profile = mkdtempSync(join(tmpdir(), 'ffcs-dev-vtop-chrome-'));
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
      defaultViewport: { width: 1440, height: 1000 },
      timeout: 20000,
    });
    const extensionId = await browser.installExtension(extensionPath);
    const extension = (await browser.extensions()).get(extensionId);
    assert.equal(extension?.name, 'FFCS OS — Development Test Copy');

    const tab = await browser.newPage();
    tab.setDefaultNavigationTimeout(30000);
    await tab.goto(registrationUrl, { waitUntil: 'domcontentloaded' });
    await tab.waitForFunction(() => document.querySelectorAll('table').length > 0, { timeout: 30000 });
    const rendered = await tab.evaluate(() => ({
      title: document.title,
      url: location.href,
      tables: [...document.querySelectorAll('table')].map(table => ({
        rowCount: table.rows.length,
        headers: [...table.querySelectorAll('tr')].slice(0, 4).map(row => [...row.querySelectorAll('th,td')].map(cell => cell.textContent.trim())),
      })),
    }));
    t.diagnostic(`Rendered URL: ${rendered.url}; title: ${rendered.title}; tables: ${JSON.stringify(rendered.tables)}`);

    await extension.triggerAction(tab);
    const popupTarget = await browser.waitForTarget(
      target => target.type() === 'page' && target.url() === `chrome-extension://${extensionId}/popup.html`,
      { timeout: 15000 },
    );
    const popup = await popupTarget.asPage();
    await popup.waitForFunction(() => document.querySelector('#vtop-status-badge')?.textContent === 'Table Found', { timeout: 15000 });
    assert.equal(await popup.$eval('#btn-import', button => button.disabled), false);
    await popup.click('#btn-import');
    await popup.waitForFunction(() => document.querySelector('#alert-text')?.textContent.includes('Successfully imported'), { timeout: 15000 });
    const courseCount = await popup.$eval('#stat-courses', el => Number(el.textContent));
    const offeringCount = await popup.$eval('#stat-offerings', el => Number(el.textContent));
    assert.ok(courseCount > 0);
    assert.ok(offeringCount > 0);
    t.diagnostic(`Imported courses: ${courseCount}; offerings: ${offeringCount}`);
  } finally {
    if (browser) await browser.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
