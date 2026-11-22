import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(resolve(fileURLToPath(new URL('../extension/content.js', import.meta.url))), 'utf8');

function runExtraction(headers, bodyRows) {
  const makeRow = cells => {
    cells = cells ?? [];
    return ({
    textContent: cells.join(' '),
    querySelectorAll(selector) {
      const items = cells.map(textContent => ({ textContent }));
      return selector === 'td' ? items : items;
    },
  });
  };
  const allRows = [makeRow(headers), ...bodyRows.map(makeRow)];
  const table = { textContent: allRows.map(r => r.textContent).join(' '), querySelectorAll: () => allRows };
  let listener;
  const context = {
    document: { title: 'VTOP', body: { textContent: '' }, querySelector: () => null,
      querySelectorAll: () => [table] },
    window: { location: { href: 'https://vtop.vitbhopal.ac.in/vtop/register', hostname: 'vtop.vitbhopal.ac.in' },
      FFCSCore: { sanitizeVtopUrl: () => 'https://vtop.vitbhopal.ac.in/vtop/register' } },
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } },
    setTimeout() {},
  };
  vm.runInNewContext(source, context);
  let result;
  listener({ action: 'EXTRACT_PAGE_DATA' }, {}, value => { result = value; });
  return result;
}

test('DOM row counts, incomplete reasons, course structure, and rejection reasons are traceable', () => {
  const headers = ['Course Code', 'Course Title', 'Course Type', 'Course Structure', 'Credits', 'Slot', 'Faculty', 'Venue', 'Available Seats', 'Total Seats', 'Status', 'Class Number'];
  const valid = ['CSE1001', 'Example', '', 'L-T-P-J-C', '4', 'A11', 'Faculty A', 'AB01-101', '0', '60', 'Full', '1001'];
  const result = runExtraction(headers, [valid, valid, ['', 'Invalid', '', '', '', 'A11', 'Faculty B', 'AB01-102', '1', '60', 'Open', '1002'], null]);
  assert.equal(result.success, true);
  assert.equal(result.rows[0].courseStructure, 'L-T-P-J-C');
  assert.equal(result.rows[0].componentType, null);
  assert.deepEqual({
    domRowsDetected: result.domMetrics.domRowsDetected,
    rowsScanned: result.domMetrics.rowsScanned,
    rowsAccepted: result.domMetrics.rowsAccepted,
    rowsRejected: result.domMetrics.rowsRejected,
    rowsSkipped: result.domMetrics.rowsSkipped,
    duplicateRows: result.domMetrics.duplicateRows,
    incompleteRows: result.domMetrics.incompleteRows,
  }, { domRowsDetected: 4, rowsScanned: 4, rowsAccepted: 2, rowsRejected: 2, rowsSkipped: 1, duplicateRows: 1, incompleteRows: 2 });
  assert.equal(result.domMetrics.rejectionReasons['Missing course code'], 1);
  assert.equal(result.domMetrics.rejectionReasons['Empty row'], 1);
  assert.equal(result.domMetrics.incompleteReasons['Missing component identification'], 2);
});

test('table discovery uses the supported header aliases, not literal course code text', () => {
  for (const codeHeader of ['Sub Code', ' COURSE_CODE ']) {
    const result = runExtraction(
      [codeHeader, 'Course Name', 'Slots', 'Faculty Name'],
      [['CSE1001', 'Special Topics', 'A11', 'Faculty A']],
    );
    assert.equal(result.success, true, `${codeHeader} should be discoverable`);
    assert.equal(result.rows[0].courseCode, 'CSE1001');
    assert.equal(result.rows[0].rawSlot, 'A11');
  }
});

test('content script rechecks live DOM when an asynchronously rendered table is requested', () => {
  const makeRow = cells => ({
    textContent: cells.join(' '),
    querySelectorAll: () => cells.map(textContent => ({ textContent })),
  });
  const makeTable = (code, title, slot) => {
    const rows = [
      makeRow(['course_code', 'Course Title', 'Course Type', 'Slot', 'Faculty', 'Venue', 'Available Seats']),
      makeRow([code, title, 'Theory', slot, 'Faculty A', 'AB01-101', '0']),
    ];
    return { get textContent() { return rows.map(row => row.textContent).join(' '); }, querySelectorAll: () => rows };
  };
  let tables = [];
  const timers = [];
  let listener;
  vm.runInNewContext(source, {
    document: { title: 'VTOP', body: { textContent: '' }, querySelector: () => null, querySelectorAll: selector => selector === 'table' ? tables : [] },
    window: { location: { href: 'https://vtop.vitbhopal.ac.in/vtop/register', hostname: 'vtop.vitbhopal.ac.in' }, FFCSCore: { sanitizeVtopUrl: url => url } },
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } },
    setTimeout(fn, delay) { timers.push({ fn, delay }); },
  });

  let status;
  listener({ action: 'CHECK_PAGE_STATUS' }, {}, value => { status = value; });
  assert.equal(status.hasRegistrationTable, false);
  tables = [makeTable('CSE9001', 'Loaded later', 'A11')];
  listener({ action: 'CHECK_PAGE_STATUS' }, {}, value => { status = value; });
  assert.equal(status.hasRegistrationTable, true);
  let result;
  listener({ action: 'EXTRACT_PAGE_DATA' }, {}, value => { result = value; });
  assert.equal(result.rows[0].courseCode, 'CSE9001');
  tables = [makeTable('MAT9002', 'Replaced view', 'B11')];
  listener({ action: 'EXTRACT_PAGE_DATA' }, {}, value => { result = value; });
  assert.equal(result.rows[0].courseCode, 'MAT9002');
  assert.equal(timers.length, 1, 'content script schedules only its existing single banner timer');
});
