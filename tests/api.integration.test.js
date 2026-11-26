import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// This checkout carries the unpacked test copy; its extraction core is
// intentionally byte-identical to the packaged production core.
import FFCSCore from '../extension-dev/extractor-core.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const api = join(root, 'api-server', 'dist', 'index.mjs');

async function freePort() {
  const server = createServer();
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

async function waitForApiHealth(child, url, getLogs, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) break;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(750) });
      if (response.ok) return true;
      lastError = `health returned HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  assert.fail(`API did not become healthy (${lastError}): ${getLogs()}`);
}

test('actual Node API → Python CLI → DataStore → parser and optimizer', async t => {
  let python;
  try {
    python = execFileSync('python', ['-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' }).trim();
  } catch {
    t.skip('Python interpreter is unavailable');
    return;
  }
  const port = await freePort();
  const temp = mkdtempSync(join(tmpdir(), 'ffcs-api-test-'));
  const apiEnv = { ...process.env, PORT: String(port), PYTHON_BIN: python,
    TEMP: temp, TMP: temp, FFCS_STORE_PATH: join(temp, 'store.json'), NODE_ENV: 'test',
    FFCS_TEST_AUTH: '1', FFCS_TEST_AUTH_DEFAULT_UID: 'integration-test-user' };
  let logs = '';
  const startApi = () => {
    const apiChild = spawn(process.execPath, [api], { cwd: join(root, 'api-server'), env: apiEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    apiChild.stdout.on('data', chunk => logs += chunk.toString());
    apiChild.stderr.on('data', chunk => logs += chunk.toString());
    apiChild.on('error', error => logs += `API process spawn error: ${error.stack ?? error.message}\n`);
    return apiChild;
  };
  let child = startApi();
  const base = `http://127.0.0.1:${port}/api`;
  try {
    await waitForApiHealth(child, `${base}/healthz`, () => logs);
    try {
      execFileSync(python, ['-c', 'import pydantic, ortools'], { stdio: 'ignore' });
    } catch {
      t.skip('Node API health passed; Python Pydantic and OR-Tools dependencies are unavailable for subprocess completion');
      return;
    }
    const extensionSession = FFCSCore.createNewSession();
    FFCSCore.mergePageImport(extensionSession, {
      rawUrl: 'https://vtop.vitbhopal.ac.in/vtop/register;jsessionid=fixture-secret?token=not-retained',
      sanitizedUrl: 'https://vtop.vitbhopal.ac.in/vtop/register', pageTitle: 'Registration fixture',
      detectedCategory: 'Program Core', domMetrics: { rowsScanned: 6 },
    }, [
      { courseCode: 'CSE1001', courseName: 'Example & Computing', credits: 4, courseStructure: 'L-T-P', componentType: 'Theory', rawSlot: 'A11+A12', facultyName: 'Faculty A', venue: 'AB01-101', availableSeats: '0', totalSeats: '60', classStatus: 'Full', sourceOfferingId: 'CSE-NATIVE-1' },
      { courseCode: 'CSE1001', courseName: 'Example & Computing', credits: 4, courseStructure: 'L-T-P', componentType: 'Theory', rawSlot: 'B11', facultyName: 'Faculty B', venue: 'AB02-101', availableSeats: '', totalSeats: '60', classStatus: 'Unavailable', sourceOfferingId: 'CSE-NATIVE-2' },
      { courseCode: 'CSE1001', courseName: 'Example & Computing', credits: 4, courseStructure: 'L-T-P', componentType: 'Theory', rawSlot: 'A11+A12', facultyName: 'Faculty Other', venue: 'AB02-111', availableSeats: '5', totalSeats: '60', classStatus: 'Open' },
      { courseCode: 'CSE1001', courseName: 'Example & Computing', credits: 4, courseStructure: 'L-T-P', componentType: null, rawSlot: 'L1', facultyName: '', venue: '', availableSeats: 'unknown', totalSeats: 'bad', classStatus: null },
      { courseCode: 'MAT1001', courseName: 'Second example', credits: 3, courseStructure: 'L-T-P', componentType: 'Theory', rawSlot: 'A11', facultyName: 'Faculty C', venue: 'AB01-102', availableSeats: '10', totalSeats: '60', classStatus: 'Open', sourceOfferingId: 'MAT-NATIVE-1' },
      { courseCode: 'MAT1001', courseName: 'Second example', credits: 3, courseStructure: 'L-T-P', componentType: 'Theory', rawSlot: 'A12', facultyName: 'Faculty D', venue: 'AB01-103', availableSeats: '10', totalSeats: '60', classStatus: 'Open', sourceOfferingId: 'MAT-NATIVE-2' },
    ]);
    const rawData = JSON.stringify(FFCSCore.buildExportPayload(extensionSession, '1.1.0'));
    const parsedResponse = await fetch(`${base}/parse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rawData }) });
    assert.equal(parsedResponse.status, 200, logs);
    const parsed = await parsedResponse.json();
    assert.equal(parsed.subjects[0].options.length, 4);
    assert.equal(parsed.subjects[0].options[0].seatState, 'FULL');
    assert.equal(parsed.subjects[0].options[1].seatState, 'UNKNOWN');
    assert.equal(parsed.subjects[0].options[1].classStatus, 'Unavailable');
    assert.equal(parsed.subjects[0].courseName, 'Example & Computing');
    assert.equal(parsed.subjects[0].courseStructure, 'L-T-P');
    assert.equal(parsed.subjects[0].category, 'Program Core');
    assert.deepEqual(parsed.subjects[0].source.categories, ['Program Core']);
    assert.equal(parsed.subjects[0].options[0].rawSlot, 'A11+A12');
    assert.deepEqual(parsed.subjects[0].options[0].slots, ['A11', 'A12']);
    assert.equal(parsed.subjects[0].options[0].slotVerificationStatus, 'CONFIRMED_THEORY');
    assert.equal(parsed.subjects[0].options[0].sourceOfferingId, 'CSE-NATIVE-1');
    assert.equal(parsed.subjects[0].options[0].venue, 'AB01-101');
    assert.equal(parsed.subjects[0].options[0].building, 'AB01');
    assert.equal(parsed.subjects[0].options[0].room, '101');
    assert.equal(parsed.subjects[0].options[0].totalSeats, 60);
    assert.equal(parsed.subjects[0].options[3].componentType, 'UNKNOWN');
    assert.equal(parsed.subjects[0].options[3].slotVerificationStatus, 'CONTAINS_UNVERIFIED');
    assert.ok(parsed.subjects[0].options[3].missingFields.includes('componentType'));
    assert.equal(parsed.possibleMatches.length, 1);
    assert.ok(parsed.subjects[0].options[0].offeringId, 'parser assigns stable IDs when source IDs are absent');

    const largeRawData = JSON.stringify({ schemaVersion: '1.5.0', courses: Array.from({ length: 500 }, (_, i) => ({
      courseCode: `CSE${String(i).padStart(4, '0')}`, options: [
        { offeringId: `${i}-a`, facultyName: 'Faculty A', slot: 'A11', componentType: 'Theory', venue: 'AB01-101', availableSeats: 10, totalSeats: 60 },
        { offeringId: `${i}-b`, facultyName: 'Faculty B', slot: 'B11', componentType: 'Theory', venue: 'AB02-101', availableSeats: 10, totalSeats: 60 },
      ],
    })) });
    assert.ok(Buffer.byteLength(largeRawData) > 100_000, 'large fixture exceeds the default Express JSON limit');
    const largeImportResponse = await fetch(`${base}/parse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rawData: largeRawData }) });
    assert.equal(largeImportResponse.status, 200, logs);
    const largeImport = await largeImportResponse.json();
    assert.equal(largeImport.subjects.length, 500);
    assert.equal(largeImport.totalParsed, 1000);

    const requestLimit = 10 * 1024 * 1024;
    const emptyWrapper = JSON.stringify({ schemaVersion: '1.5.0', courses: [] });
    const baseBodyBytes = Buffer.byteLength(JSON.stringify({ rawData: emptyWrapper }));
    const belowLimitRaw = emptyWrapper + ' '.repeat(requestLimit - baseBodyBytes - 1);
    const belowLimitBody = JSON.stringify({ rawData: belowLimitRaw });
    assert.equal(Buffer.byteLength(belowLimitBody), requestLimit - 1);
    const belowLimitResponse = await fetch(`${base}/parse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: belowLimitBody });
    assert.equal(belowLimitResponse.status, 200, logs);
    const aboveLimitRaw = emptyWrapper + ' '.repeat(requestLimit - baseBodyBytes + 1);
    const aboveLimitBody = JSON.stringify({ rawData: aboveLimitRaw });
    assert.equal(Buffer.byteLength(aboveLimitBody), requestLimit + 1);
    const aboveLimitResponse = await fetch(`${base}/parse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: aboveLimitBody });
    assert.equal(aboveLimitResponse.status, 413);

    const tooManyCourses = JSON.stringify({ schemaVersion: '1.5.0', courses: Array.from({ length: 1001 }, (_, i) => ({ courseCode: `CSE${i}` })) });
    const courseLimitResponse = await fetch(`${base}/parse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rawData: tooManyCourses }) });
    assert.equal(courseLimitResponse.status, 413);
    const tooManyOfferings = JSON.stringify({ schemaVersion: '1.5.0', courses: [{ courseCode: 'CSE1001', options: Array.from({ length: 5001 }, () => ({})) }] });
    const offeringLimitResponse = await fetch(`${base}/parse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rawData: tooManyOfferings }) });
    assert.equal(offeringLimitResponse.status, 413);
    const malformedParse = await fetch(`${base}/parse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rawData: '{malformed' }) });
    assert.equal(malformedParse.status, 200);
    assert.match((await malformedParse.json()).errors[0], /Invalid JSON/);

    const optimizedResponse = await fetch(`${base}/optimize`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjects: parsed.subjects, preferences: { mode: 'PLANNING' }, topN: 3 }) });
    assert.equal(optimizedResponse.status, 200, logs);
    const optimized = await optimizedResponse.json();
    assert.ok(optimized.feasibleCount > 0);
    assert.equal(optimized.mode, 'PLANNING');
    assert.equal(optimized.timetables[0].courses[0].overallRating, null);

    const invalidPreference = await fetch(`${base}/optimize`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjects: parsed.subjects, preferences: { mode: 'PLANNING', timePreference: 'night' }, topN: 1 }) });
    assert.equal(invalidPreference.status, 400);
    assert.match((await invalidPreference.json()).error, /timePreference/);

    const independentDayScholarLunchResponse = await fetch(`${base}/optimize`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjects: parsed.subjects, preferences: { mode: 'PLANNING', dayScholar: true, mandatoryLunch: true }, topN: 2 }) });
    assert.equal(independentDayScholarLunchResponse.status, 200, logs);
    const independentDayScholarLunch = await independentDayScholarLunchResponse.json();
    assert.ok(independentDayScholarLunch.timetables.length > 0);

    const dayScholarApiResponse = await fetch(`${base}/optimize`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjects: [{ courseCode: 'CSE9001', courseName: 'Day Scholar regression', credits: 3, options: [
        { offeringId: 'before-six', facultyName: 'Faculty Early', slot: 'B21', slots: ['B21'], slotVerificationStatus: 'CONFIRMED_THEORY', seatState: 'OPEN', seatsAvailable: 5, componentType: 'Theory' },
        { offeringId: 'after-six', facultyName: 'Faculty Late', slot: 'C21', slots: ['C21'], slotVerificationStatus: 'CONFIRMED_THEORY', seatState: 'OPEN', seatsAvailable: 5, componentType: 'Theory' },
      ] }], preferences: { mode: 'PLANNING', dayScholar: true }, topN: 5 }) });
    assert.equal(dayScholarApiResponse.status, 200, logs);
    const dayScholarApiResult = await dayScholarApiResponse.json();
    assert.deepEqual(dayScholarApiResult.timetables.map(tt => tt.courses[0].offeringId), ['before-six', 'after-six']);
    assert.equal(dayScholarApiResult.timetables[1].courses[0].slot, 'C21', 'after-6 PM schedules remain feasible and returnable');

    const selectedIds = {
      CSE1001: parsed.subjects[0].options[0].offeringId,
      MAT1001: parsed.subjects[1].options[0].offeringId,
    };
    const selectionResponse = await fetch(`${base}/optimize`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjects: parsed.subjects, preferences: { mode: 'PLANNING', selectedOfferings: selectedIds }, topN: 3 }) });
    assert.equal(selectionResponse.status, 200, logs);
    const selectionResult = await selectionResponse.json();
    assert.equal(selectionResult.selectionValid, false);
    assert.equal(selectionResult.selectionConflicts[0].reason, 'SLOT_CLASH');
    assert.deepEqual(selectionResult.selectionConflicts[0].courseCodes, ['CSE1001', 'MAT1001']);
    assert.ok(selectionResult.selectionConflicts[0].slots.includes('A11'));

    const atomicSelection = { CSE1001: selectedIds.CSE1001, MAT1001: parsed.subjects[1].options[1].offeringId };
    const atomicResponse = await fetch(`${base}/optimize`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjects: parsed.subjects, preferences: { mode: 'PLANNING', selectedOfferings: atomicSelection } }) });
    assert.equal(atomicResponse.status, 200);
    const atomicResult = await atomicResponse.json();
    assert.equal(atomicResult.selectionValid, false);
    assert.ok(atomicResult.selectionConflicts[0].slots.includes('A12'));

    const validIds = { ...selectedIds, CSE1001: parsed.subjects[0].options[1].offeringId };
    const validSelectionResponse = await fetch(`${base}/optimize`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjects: parsed.subjects, preferences: { mode: 'PLANNING', selectedOfferings: validIds }, topN: 3 }) });
    assert.equal(validSelectionResponse.status, 200, logs);
    const validSelection = await validSelectionResponse.json();
    assert.equal(validSelection.selectionValid, true);
    assert.equal(validSelection.timetables[0].courses.find(course => course.courseCode === 'CSE1001').offeringId, validIds.CSE1001);

    const partialLockResponse = await fetch(`${base}/optimize`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjects: parsed.subjects, preferences: { mode: 'PLANNING', selectedOfferings: { CSE1001: validIds.CSE1001 } }, topN: 20 }) });
    assert.equal(partialLockResponse.status, 200, logs);
    const partialLockResult = await partialLockResponse.json();
    assert.equal(partialLockResult.selectionValid, true);
    assert.ok(partialLockResult.timetables.length > 0);
    assert.ok(partialLockResult.timetables.every(tt => tt.courses.find(course => course.courseCode === 'CSE1001')?.offeringId === validIds.CSE1001),
      'every returned alternative must retain the explicitly locked CSE1001 offering');

    const chosenTimetable = validSelection.timetables[0];
    const saveRequest = (overrides = {}) => fetch(`${base}/timetables`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Validated integration schedule', rawData, preferences: { mode: 'PLANNING' }, courseCodes: ['CSE1001', 'MAT1001'], selectedOfferings: validIds,
        selectionValid: true, validatedAt: 'forged', score: { overall: 100 }, courses: [{ courseCode: 'CSE1001', facultyName: 'Forged Faculty', venue: 'CR-999' }], grid: [], ...overrides }) });
    const invalidSaves = [
      { label: 'forged valid flag with a clash', body: { selectedOfferings: selectedIds } },
      { label: 'unknown offering', body: { selectedOfferings: { ...validIds, CSE1001: 'missing-id' } } },
      { label: 'offering belongs to another course', body: { selectedOfferings: { CSE1001: validIds.MAT1001, MAT1001: validIds.CSE1001 } } },
      { label: 'missing required course', body: { selectedOfferings: { CSE1001: validIds.CSE1001 } } },
      { label: 'extra offering selection', body: { selectedOfferings: { ...validIds, CSE9999: 'unexpected' } } },
      { label: 'unknown requested course', body: { courseCodes: ['CSE1001', 'UNKNOWN'], selectedOfferings: { CSE1001: validIds.CSE1001, UNKNOWN: 'missing' } } },
      { label: 'duplicate offering id', body: { selectedOfferings: { CSE1001: validIds.CSE1001, MAT1001: validIds.CSE1001 } } },
      { label: 'stale selection', body: { selectedOfferings: { ...validIds, CSE1001: 'stale-id' } } },
      { label: 'zero seats in live registration', body: { preferences: { mode: 'LIVE_REGISTRATION' }, selectedOfferings: { ...validIds, CSE1001: selectedIds.CSE1001 } } },
      { label: 'unknown seats in live registration', body: { preferences: { mode: 'LIVE_REGISTRATION' } } },
    ];
    for (const attempt of invalidSaves) {
      const response = await saveRequest(attempt.body);
      assert.equal(response.status, 422, `${attempt.label}: ${await response.text()}`);
      const list = await (await fetch(`${base}/timetables`)).json();
      assert.equal(list.length, 0, `${attempt.label} must not persist`);
    }
    const emptySave = await saveRequest({ rawData: '' });
    assert.equal(emptySave.status, 400);
    const malformedSave = await saveRequest({ rawData: '{malformed' });
    assert.equal(malformedSave.status, 422);
    assert.equal((await (await fetch(`${base}/timetables`)).json()).length, 0);
    const invalidSlotRaw = JSON.stringify({ schemaVersion: '1.5.0', courses: [
      { courseCode: 'CSE1001', options: [{ offeringId: 'bad-slot', facultyName: 'Faculty A', slot: 'ZZ99', componentType: 'Theory', venue: 'AB01-101', availableSeats: 10 }] },
      { courseCode: 'MAT1001', options: [{ offeringId: 'mat-good', facultyName: 'Faculty C', slot: 'A11', componentType: 'Theory', venue: 'AB01-102', availableSeats: 10 }] },
    ] });
    const invalidSlotSave = await saveRequest({ rawData: invalidSlotRaw, selectedOfferings: { CSE1001: 'bad-slot', MAT1001: 'mat-good' } });
    assert.equal(invalidSlotSave.status, 422, 'invalid slot code must not save');
    assert.equal((await (await fetch(`${base}/timetables`)).json()).length, 0);
    const duplicateIdRaw = JSON.stringify({ schemaVersion: '1.5.0', courses: [
      { courseCode: 'CSE1001', options: [
        { offeringId: 'duplicate-id', facultyName: 'Faculty A', slot: 'B11', componentType: 'Theory', venue: 'AB01-101', availableSeats: 10 },
        { offeringId: 'duplicate-id', facultyName: 'Faculty B', slot: 'C11', componentType: 'Theory', venue: 'AB01-102', availableSeats: 10 },
      ] },
      { courseCode: 'MAT1001', options: [{ offeringId: 'mat-good', facultyName: 'Faculty C', slot: 'A11', componentType: 'Theory', venue: 'AB01-102', availableSeats: 10 }] },
    ] });
    const duplicateIdSave = await saveRequest({ rawData: duplicateIdRaw, selectedOfferings: { CSE1001: 'duplicate-id', MAT1001: 'mat-good' } });
    assert.equal(duplicateIdSave.status, 422, 'ambiguous duplicate IDs in imported offerings must not save');
    assert.equal((await (await fetch(`${base}/timetables`)).json()).length, 0);

    const repeatedCourseRaw = JSON.stringify({ schemaVersion: '1.5.0', courses: [
      { courseCode: 'CSE1001', options: [{ offeringId: 'repeat-valid', facultyName: 'Faculty B', slot: 'B11', componentType: 'Theory', venue: 'AB02-101', availableSeats: 10 }] },
      { courseCode: 'CSE1001', options: [
        { offeringId: 'repeat-valid', facultyName: 'Faculty B', slot: 'B11', componentType: 'Theory', venue: 'AB02-101', availableSeats: 8 },
        { offeringId: 'second-valid', facultyName: 'Faculty C', slot: 'C11', componentType: 'Theory', venue: 'AB01-102', availableSeats: 10 },
      ] },
      { courseCode: 'MAT1001', options: [{ offeringId: 'mat-valid', facultyName: 'Faculty D', slot: 'A11', componentType: 'Theory', venue: 'AB01-201', availableSeats: 10 }] },
    ] });
    const repeatedCourseSave = await saveRequest({ name: 'Merged duplicate course', rawData: repeatedCourseRaw,
      selectedOfferings: { CSE1001: 'repeat-valid', MAT1001: 'mat-valid' } });
    assert.equal(repeatedCourseSave.status, 201);
    const repeatedSaved = await repeatedCourseSave.json();
    assert.equal(repeatedSaved.courses.length, 2, 'duplicate source course rows merge to one requested course');
    assert.equal(repeatedSaved.courses.find(course => course.courseCode === 'CSE1001').offeringId, 'repeat-valid');
    assert.equal((await fetch(`${base}/timetables/${repeatedSaved.id}`)).status, 200);
    assert.equal((await fetch(`${base}/timetables/${repeatedSaved.id}`, { method: 'DELETE' })).status, 204);

    // Concurrent saves with different and identical names, plus interleaved
    // list/delete/preferences/optimization-history writes, must not lose records.
    const parallelNames = ['Parallel Alpha', 'Parallel Beta', 'Shared Name', 'Shared Name'];
    const parallelResponses = await Promise.all(parallelNames.map(name => saveRequest({ name })));
    assert.ok(parallelResponses.every(response => response.status === 201), logs);
    const parallelSaved = await Promise.all(parallelResponses.map(response => response.json()));
    assert.equal(new Set(parallelSaved.map(record => record.id)).size, parallelSaved.length);
    assert.deepEqual(parallelSaved.map(record => record.name).sort(), parallelNames.slice().sort());
    const saved = parallelSaved[0];
    assert.equal(saved.courses.find(course => course.courseCode === 'CSE1001').offeringId, validIds.CSE1001);
    assert.notEqual(saved.courses.find(course => course.courseCode === 'CSE1001').facultyName, 'Forged Faculty');
    assert.notEqual(saved.courses.find(course => course.courseCode === 'CSE1001').venue, 'CR-999');
    assert.notEqual(saved.score.overall, 100);

    const [deleteResponse, overlappingSave, listResponse, preferenceResponse, historyResponse] = await Promise.all([
      fetch(`${base}/timetables/${parallelSaved[1].id}`, { method: 'DELETE' }),
      saveRequest({ name: 'Saved during concurrent delete' }),
      fetch(`${base}/timetables`),
      fetch(`${base}/preferences`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ maxGap: 8 }) }),
      fetch(`${base}/optimize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subjects: parsed.subjects, preferences: { mode: 'PLANNING', selectedOfferings: validIds }, topN: 1 }) }),
    ]);
    assert.equal(deleteResponse.status, 204);
    assert.equal(overlappingSave.status, 201, logs);
    assert.equal(listResponse.status, 200);
    assert.equal(preferenceResponse.status, 200);
    assert.equal(historyResponse.status, 200, logs);
    const finalListResponse = await fetch(`${base}/timetables`);
    assert.equal(finalListResponse.status, 200);
    const finalList = await finalListResponse.json();
    assert.equal(finalList.length, 4);
    assert.ok(!finalList.some(record => record.id === parallelSaved[1].id));
    assert.ok(finalList.some(record => record.name === 'Saved during concurrent delete'));
    assert.ok(parallelSaved.filter(record => record.id !== parallelSaved[1].id).every(record => finalList.some(item => item.id === record.id)));

    const previousProcess = child;
    const processExit = new Promise(resolveClose => previousProcess.once('exit', resolveClose));
    previousProcess.kill();
    await processExit;
    child = startApi();
    await waitForApiHealth(child, `${base}/healthz`, () => logs);
    const afterRestart = await fetch(`${base}/timetables`);
    assert.equal(afterRestart.status, 200);
    const restartedRecords = await afterRestart.json();
    assert.deepEqual(restartedRecords.map(record => record.id).sort((a, b) => a - b), finalList.map(record => record.id).sort((a, b) => a - b));
    assert.equal(restartedRecords.find(record => record.id === saved.id).courses.find(course => course.courseCode === 'CSE1001').offeringId, validIds.CSE1001);

    await Promise.all(finalList.map(record => fetch(`${base}/timetables/${record.id}`, { method: 'DELETE' })));
    assert.equal((await (await fetch(`${base}/timetables`)).json()).length, 0);

    // Simulate filesystem failure after schedule validation. Atomic replace must leave no record.
    rmSync(join(temp, 'store.json'), { force: true });
    mkdirSync(join(temp, 'store.json'));
    const failedPersistence = await saveRequest();
    assert.equal(failedPersistence.status, 503);
    assert.equal((await fetch(`${base}/timetables`)).status, 503);
  } finally {
    child.kill();
    await new Promise(resolveClose => child.once('exit', resolveClose));
    rmSync(temp, { recursive: true, force: true });
  }
});
