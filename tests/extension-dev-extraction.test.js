const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { JSDOM } = require('../frontend/node_modules/jsdom');
const test = require('node:test');

const contentScript = readFileSync(join(__dirname, '..', 'extension-dev', 'content.js'), 'utf8');

function runPage(html, url) {
  const dom = new JSDOM(html, { url });
  let listener;
  const context = {
    document: dom.window.document,
    window: {
      location: dom.window.location,
      FFCSCore: { sanitizeVtopUrl: () => null },
    },
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } },
    setTimeout() {},
  };
  runInNewContext(contentScript, context);
  return {
    dom,
    send(action) {
      let response;
      listener({ action }, {}, value => { response = value; });
      return response;
    },
  };
}

const splitTableHtml = `<!doctype html><html><head><title>Course Registration</title></head><body>
  <h2>Course Details</h2>
  <table id="course-details"><thead><tr>
    <th>Course Code</th><th>Course Title</th><th>L</th><th>T</th><th>P</th><th>J</th><th>C</th>
    <th>Pre-Requisite</th><th>Co-Requisite</th><th>Anti-Requisite</th>
  </tr></thead><tbody><tr>
    <td>MCA1002</td><td>Problem Solving and Data Structures</td><td>3</td><td>0</td><td>2</td><td>0</td><td>4</td>
    <td>-</td><td></td><td>-</td>
  </tr></tbody></table>
  <h2>Available Offerings</h2>
  <table id="offerings"><thead><tr>
    <th>Course Type</th><th>Slot</th><th>Venue</th><th>Faculty</th>
    <th>Slot Status (i.e. with Registered Course)</th><th>Total Seats</th><th>Alloted Seats</th><th>Available Seats</th>
  </tr></thead><tbody>
    <tr><td>TH</td><td>A11+A12+A13</td><td>AB1-204</td><td>Faculty One</td><td>Available</td><td>60</td><td>60</td><td>0</td></tr>
    <tr><td>TH</td><td>B11+B12+B13</td><td></td><td>Faculty Two</td><td>Available</td><td></td><td></td><td></td></tr>
  </tbody></table>
</body></html>`;

test('split course details and offering tables associate multiple offers without treating status as class status', () => {
  const page = runPage(splitTableHtml, 'https://dev.vitbhopal.ac.in/Winter%20Semester%202026-27_ALL_open_registration/checkRegistration');
  const status = page.send('CHECK_PAGE_STATUS');
  const result = page.send('EXTRACT_PAGE_DATA');
  assert.equal(status.isVtop, true);
  assert.equal(status.hasRegistrationTable, true);
  assert.equal(result.success, true);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(Array.from(result.rows, row => row.courseCode), ['MCA1002', 'MCA1002']);
  assert.deepEqual(Array.from(result.rows, row => row.courseName), ['Problem Solving and Data Structures', 'Problem Solving and Data Structures']);
  assert.equal(result.rows[0].rawSlot, 'A11+A12+A13');
  assert.equal(result.rows[0].availableSeats, '0');
  assert.equal(result.rows[1].availableSeats, null);
  assert.equal(result.rows[1].totalSeats, null);
  assert.equal(result.rows[0].facultyName, 'Faculty One');
  assert.equal(result.rows[1].venue, null);
  assert.equal(result.rows[0].classStatus, null);
  assert.equal(result.rows[0].credits, 4);
  assert.match(result.rows[0].courseStructure, /3-0-2-0/);
  assert.equal(result.sanitizedUrl, null, 'dev origin remains outside the strict VTOP provenance sanitizer');
  page.dom.window.close();
});

test('course-less offerings are rejected when multiple course records make association ambiguous', () => {
  const html = splitTableHtml.replace(
    '<tr><td>MCA1002</td><td>Problem Solving and Data Structures</td><td>3</td><td>0</td><td>2</td><td>0</td><td>4</td>',
    '<tr><td>MCA1002</td><td>Problem Solving and Data Structures</td><td>3</td><td>0</td><td>2</td><td>0</td><td>4</td>',
  ).replace(
    '</tbody></table>\n  <h2>Available Offerings</h2>',
    '<tr><td>MCA1003</td><td>Data Structures Lab</td><td>0</td><td>0</td><td>4</td><td>0</td><td>2</td><td>-</td><td>-</td><td>-</td></tr></tbody></table>\n  <h2>Available Offerings</h2>',
  );
  const page = runPage(html, 'https://dev.vitbhopal.ac.in/registration');
  const result = page.send('EXTRACT_PAGE_DATA');
  assert.equal(result.success, false);
  assert.equal(result.domMetrics.rowsRejected, 2);
  assert.equal(result.domMetrics.rejectionReasons['Offering cannot be associated unambiguously with a course'], 2);
  page.dom.window.close();
});

test('existing VTOP and Vercel hosts remain recognized and unsupported host is not authorized', () => {
  for (const host of ['vtop.vitbhopal.ac.in', 'ffcs-demo.vercel.app', 'dev.vitbhopal.ac.in']) {
    const page = runPage('<!doctype html><table><tr><th>Course Code</th><th>Course Title</th><th>Course Type</th><th>Slot</th><th>Faculty</th><th>Venue</th><th>Available Seats</th></tr><tr><td>CSE1001</td><td>Test</td><td>Theory</td><td>A11</td><td>Faculty A</td><td>AB1-101</td><td>2</td></tr></table>', `https://${host}/registration`);
    assert.equal(page.send('CHECK_PAGE_STATUS').isVtop, true);
    const extracted = page.send('EXTRACT_PAGE_DATA');
    assert.equal(extracted.success, true);
    assert.equal(extracted.rows[0].courseCode, 'CSE1001');
    assert.equal(extracted.rows[0].availableSeats, '2');
    page.dom.window.close();
  }
  const unsupported = runPage('<!doctype html><p>Not a registration table</p>', 'https://example.org/');
  assert.equal(unsupported.send('CHECK_PAGE_STATUS').isVtop, false);
  assert.equal(unsupported.send('CHECK_PAGE_STATUS').hasRegistrationTable, false);
  unsupported.dom.window.close();
});
