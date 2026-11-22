/**
 * Comprehensive Automated Test Suite for FFCS OS Bulk Import Engine (v1.5.0)
 * Uses Node.js native test runner (node --test) and assert/strict.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import FFCSCore from '../extension/extractor-core.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('Manifest V3 extension paths exist and content injection is scoped to the permitted VTOP host', () => {
  const manifest = JSON.parse(readFileSync(resolve(projectRoot, 'extension/manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.host_permissions.includes('https://vtop.vitbhopal.ac.in/*'));
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://vtop.vitbhopal.ac.in/*']);
  for (const file of [...manifest.content_scripts[0].js, manifest.action.default_popup, ...Object.values(manifest.icons)]) {
    assert.equal(existsSync(resolve(projectRoot, 'extension', file)), true, `missing manifest file: ${file}`);
  }
});

describe('1. Slot Evaluation & Three-State Validation', () => {
  test('Confirmed 42 Theory Slots: single and combined', () => {
    const r1 = FFCSCore.evaluateSlotTokens('A11');
    assert.equal(r1.status, 'CONFIRMED_THEORY');
    assert.deepEqual(r1.slots, ['A11']);
    assert.equal(r1.rawSlot, 'A11');

    const r2 = FFCSCore.evaluateSlotTokens('A11+A12+A13');
    assert.equal(r2.status, 'CONFIRMED_THEORY');
    assert.deepEqual(r2.slots, ['A11', 'A12', 'A13']);
    assert.equal(r2.rawSlot, 'A11+A12+A13');

    // All 42 individual slots must evaluate to CONFIRMED_THEORY
    for (const slot of FFCSCore.CONFIRMED_THEORY_SLOTS) {
      const res = FFCSCore.evaluateSlotTokens(slot);
      assert.equal(res.status, 'CONFIRMED_THEORY', `Slot ${slot} failed theory confirmation`);
      assert.deepEqual(res.slots, [slot]);
    }
  });

  test('Unverified and Lab Slots: preserved raw, excluded from confirmed', () => {
    const rLab = FFCSCore.evaluateSlotTokens('L1+L2');
    assert.equal(rLab.status, 'CONTAINS_UNVERIFIED');
    assert.deepEqual(rLab.slots, ['L1', 'L2']);
    assert.equal(rLab.rawSlot, 'L1+L2');

    const rMixed = FFCSCore.evaluateSlotTokens('A11+L1');
    assert.equal(rMixed.status, 'CONTAINS_UNVERIFIED');
    assert.deepEqual(rMixed.slots, ['A11', 'L1']);
  });

  test('Missing, Placeholder, and Malformed Slots', () => {
    // Null, empty, blank
    assert.equal(FFCSCore.evaluateSlotTokens(null).status, 'MISSING_OR_INVALID');
    assert.equal(FFCSCore.evaluateSlotTokens('').status, 'MISSING_OR_INVALID');
    assert.equal(FFCSCore.evaluateSlotTokens('   ').status, 'MISSING_OR_INVALID');

    // Placeholders
    assert.equal(FFCSCore.evaluateSlotTokens('N/A').status, 'MISSING_OR_INVALID');
    assert.equal(FFCSCore.evaluateSlotTokens('-').status, 'MISSING_OR_INVALID');
    assert.equal(FFCSCore.evaluateSlotTokens('TBA').status, 'MISSING_OR_INVALID');
    assert.equal(FFCSCore.evaluateSlotTokens('NIL').status, 'MISSING_OR_INVALID');

    // Malformed tokens (punctuation, strange characters)
    assert.equal(FFCSCore.evaluateSlotTokens('???').status, 'MISSING_OR_INVALID');
    assert.equal(FFCSCore.evaluateSlotTokens('A11+@bad!').status, 'MISSING_OR_INVALID');
    assert.equal(FFCSCore.evaluateSlotTokens('+++').status, 'MISSING_OR_INVALID');
  });

  test('Vacuous check prevention on empty token array', () => {
    // Ensure that empty arrays never pass .every() check
    const r = FFCSCore.evaluateSlotTokens('  + /  ');
    assert.equal(r.status, 'MISSING_OR_INVALID');
    assert.deepEqual(r.slots, []);
  });

  test('Duplicate slot tokens are deduplicated while rawSlot is preserved', () => {
    const r = FFCSCore.evaluateSlotTokens('A11+A11+A12');
    assert.equal(r.rawSlot, 'A11+A11+A12');
    assert.deepEqual(r.slots, ['A11', 'A12']);
    assert.equal(r.status, 'CONFIRMED_THEORY');
  });
});

describe('2. Venue & Building Parsing', () => {
  test('Confirmed building with room', () => {
    const v1 = FFCSCore.parseVenue('AB01-204');
    assert.equal(v1.venue, 'AB01-204');
    assert.equal(v1.building, 'AB01');
    assert.equal(v1.room, '204');

    const v2 = FFCSCore.parseVenue('LC-002');
    assert.equal(v2.venue, 'LC-002');
    assert.equal(v2.building, 'LC');
    assert.equal(v2.room, '002');

    const v3 = FFCSCore.parseVenue('AR 301');
    assert.equal(v3.venue, 'AR 301');
    assert.equal(v3.building, 'AR');
    assert.equal(v3.room, '301');
  });

  test('Confirmed building without room (Rule E)', () => {
    const v = FFCSCore.parseVenue('AB01');
    assert.equal(v.venue, 'AB01');
    assert.equal(v.building, 'AB01');
    assert.equal(v.room, null);

    const vLC = FFCSCore.parseVenue('LC');
    assert.equal(vLC.venue, 'LC');
    assert.equal(vLC.building, 'LC');
    assert.equal(vLC.room, null);
  });

  test('Explicit CR venue', () => {
    const v = FFCSCore.parseVenue('CR');
    assert.equal(v.venue, 'CR');
    assert.equal(v.building, null);
    assert.equal(v.room, null);
  });

  test('Missing venue never defaults to CR', () => {
    const vNull = FFCSCore.parseVenue(null);
    assert.equal(vNull.venue, null);
    assert.equal(vNull.building, null);
    assert.equal(vNull.room, null);

    const vEmpty = FFCSCore.parseVenue('   ');
    assert.equal(vEmpty.venue, null);
    assert.equal(vEmpty.building, null);
    assert.equal(vEmpty.room, null);

    const vDash = FFCSCore.parseVenue('-');
    assert.equal(vDash.venue, null);
    assert.equal(vDash.building, null);
  });

  test('Unrecognized venue preserves raw text with null building/room', () => {
    const v = FFCSCore.parseVenue('AUDITORIUM-MAIN');
    assert.equal(v.venue, 'AUDITORIUM-MAIN');
    assert.equal(v.building, null);
    assert.equal(v.room, null);
  });
});

describe('3. Seat Counts & Status Preservation', () => {
  test('Actual zero seats preserved as 0', () => {
    const s = FFCSCore.parseSeats('0', '60');
    assert.strictEqual(s.availableSeats, 0);
    assert.strictEqual(s.totalSeats, 60);

    const sNum = FFCSCore.parseSeats(0, 60);
    assert.strictEqual(sNum.availableSeats, 0);
  });

  test('Missing seats parsed as null', () => {
    assert.strictEqual(FFCSCore.parseSeats(null, null).availableSeats, null);
    assert.strictEqual(FFCSCore.parseSeats('', '').availableSeats, null);
    assert.strictEqual(FFCSCore.parseSeats('N/A', '-').availableSeats, null);
    assert.strictEqual(FFCSCore.parseSeats('abc', 'def').availableSeats, null);
  });

  test('Class status parsed or null', () => {
    assert.equal(FFCSCore.parseClassStatus('Open'), 'Open');
    assert.equal(FFCSCore.parseClassStatus('Full'), 'Full');
    assert.equal(FFCSCore.parseClassStatus(''), null);
    assert.equal(FFCSCore.parseClassStatus('-'), null);
    assert.equal(FFCSCore.parseClassStatus(null), null);
  });
});

describe('4. URL Sanitization & Security', () => {
  test('Valid VTOP URL with Java EE jsessionid and sensitive query params', () => {
    const raw = 'https://vtop.vitbhopal.ac.in/vtop/academics/common/StudentCourseRegistration;jsessionid=ABCD1234EF56/subpage?_csrf=secretToken123&session_id=999#step2';
    const sanitized = FFCSCore.sanitizeVtopUrl(raw);
    assert.equal(sanitized, 'https://vtop.vitbhopal.ac.in/vtop/academics/common/StudentCourseRegistration/subpage');
  });

  test('Rejects non-VTOP origins', () => {
    assert.equal(FFCSCore.sanitizeVtopUrl('https://vtop.vit.ac.in/vtop/'), null);
    assert.equal(FFCSCore.sanitizeVtopUrl('https://evil-site.com/vtop'), null);
    assert.equal(FFCSCore.sanitizeVtopUrl('http://vtop.vitbhopal.ac.in/vtop'), null); // Must be https
  });

  test('Handles unparseable URLs', () => {
    assert.equal(FFCSCore.sanitizeVtopUrl('not-a-url'), null);
    assert.equal(FFCSCore.sanitizeVtopUrl(null), null);
  });
});

describe('5. Identity & Collision Tests', () => {
  test('Null faculty vs literal "__NULL__" produce distinct composite IDs', () => {
    const idNull = FFCSCore.generateCompositeOfferingId('CSE2001', 'Theory', ['A11'], null, 'AB01-204');
    const idLiteral = FFCSCore.generateCompositeOfferingId('CSE2001', 'Theory', ['A11'], '__NULL__', 'AB01-204');

    assert.notEqual(idNull, idLiteral);
    const parsedNull = JSON.parse(idNull);
    const parsedLiteral = JSON.parse(idLiteral);

    assert.strictEqual(parsedNull[3], null);
    assert.strictEqual(parsedLiteral[3], '__NULL__');
  });

  test('Scoped Source ID: colons do not cause collisions', () => {
    const id1 = FFCSCore.getScopedSourceId('CSE', 'TH', 'SEC:01');
    const id2 = FFCSCore.getScopedSourceId('CSE', 'TH:SEC', '01');

    assert.notEqual(id1, id2);
    assert.deepEqual(JSON.parse(id1), ['CSE', 'TH', 'SEC:01']);
    assert.deepEqual(JSON.parse(id2), ['CSE', 'TH:SEC', '01']);
  });

  test('Preserves faculty titles during identity generation', () => {
    const idDr = FFCSCore.generateCompositeOfferingId('CSE2001', 'Theory', ['A11'], 'Dr. Anil Sharma', 'AB01-204');
    const idPlain = FFCSCore.generateCompositeOfferingId('CSE2001', 'Theory', ['A11'], 'Anil Sharma', 'AB01-204');

    // Title difference must produce distinct offering IDs!
    assert.notEqual(idDr, idPlain);
  });

  test('Conservative whitespace and case normalization', () => {
    const id1 = FFCSCore.generateCompositeOfferingId('cse2001', 'theory', ['a11'], '  Dr.  Anil   Sharma  ', 'ab01-204');
    const id2 = FFCSCore.generateCompositeOfferingId('CSE2001', 'THEORY', ['A11'], 'Dr. Anil Sharma', 'AB01-204');

    assert.equal(id1, id2);
  });
});

describe('6. Deduplication & Scoped Source ID Precedence (Rule A & D)', () => {
  test('Rule A1: Matching scopedSourceId updates mutable fields', () => {
    const existing = [{
      offeringId: 'id1',
      sourceOfferingId: 'CL01',
      scopedSourceId: FFCSCore.getScopedSourceId('CSE2001', 'Theory', 'CL01'),
      courseCode: 'CSE2001',
      componentType: 'Theory',
      slots: ['A11'],
      facultyName: 'Dr. Sharma',
      venue: 'AB01-204',
      availableSeats: 5,
      totalSeats: 60,
      classStatus: 'Open',
      missingFields: []
    }];

    const incoming = {
      offeringId: 'id1',
      sourceOfferingId: 'CL01',
      scopedSourceId: FFCSCore.getScopedSourceId('CSE2001', 'Theory', 'CL01'),
      courseCode: 'CSE2001',
      componentType: 'Theory',
      slots: ['A11'],
      facultyName: 'Dr. Sharma',
      venue: 'AB01-204',
      availableSeats: 0, // Updated seats
      totalSeats: 60,
      classStatus: 'Full', // Updated status
      missingFields: []
    };

    const res = FFCSCore.deduplicateOffering(existing, incoming);
    assert.equal(res.action, 'UPDATED');
    assert.strictEqual(existing[0].availableSeats, 0);
    assert.equal(existing[0].classStatus, 'Full');
  });

  test('Rule A2: Differing scopedSourceIds are preserved as distinct (no composite fallback)', () => {
    // Both records have the exact same slots, faculty, and venue, BUT different native source IDs
    const existing = [{
      offeringId: FFCSCore.generateCompositeOfferingId('CSE2001', 'Theory', ['A11'], 'Dr. Sharma', 'AB01-204'),
      sourceOfferingId: 'CL01',
      scopedSourceId: FFCSCore.getScopedSourceId('CSE2001', 'Theory', 'CL01'),
      courseCode: 'CSE2001',
      componentType: 'Theory',
      slots: ['A11'],
      facultyName: 'Dr. Sharma',
      venue: 'AB01-204',
      availableSeats: 10,
      totalSeats: 60,
      classStatus: 'Open',
      missingFields: []
    }];

    const incoming = {
      offeringId: FFCSCore.generateCompositeOfferingId('CSE2001', 'Theory', ['A11'], 'Dr. Sharma', 'AB01-204'),
      sourceOfferingId: 'CL02', // Different source ID!
      scopedSourceId: FFCSCore.getScopedSourceId('CSE2001', 'Theory', 'CL02'),
      courseCode: 'CSE2001',
      componentType: 'Theory',
      slots: ['A11'],
      facultyName: 'Dr. Sharma',
      venue: 'AB01-204',
      availableSeats: 15,
      totalSeats: 60,
      classStatus: 'Open',
      missingFields: []
    };

    const res = FFCSCore.deduplicateOffering(existing, incoming);
    // MUST NOT MERGE!
    assert.equal(res.action, 'ADDED');
  });

  test('Composite Match: exact match updates seats without source ID', () => {
    const compId = FFCSCore.generateCompositeOfferingId('CSE2001', 'Theory', ['A11'], 'Dr. Sharma', 'AB01-204');
    const existing = [{
      offeringId: compId,
      sourceOfferingId: null,
      scopedSourceId: null,
      courseCode: 'CSE2001',
      componentType: 'Theory',
      slots: ['A11'],
      facultyName: 'Dr. Sharma',
      venue: 'AB01-204',
      availableSeats: 20,
      totalSeats: 60,
      classStatus: 'Open',
      missingFields: []
    }];

    const incoming = {
      offeringId: compId,
      sourceOfferingId: null,
      scopedSourceId: null,
      courseCode: 'CSE2001',
      componentType: 'Theory',
      slots: ['A11'],
      facultyName: 'Dr. Sharma',
      venue: 'AB01-204',
      availableSeats: 18,
      totalSeats: 60,
      classStatus: 'Open',
      missingFields: []
    };

    const res = FFCSCore.deduplicateOffering(existing, incoming);
    assert.equal(res.action, 'UPDATED');
    assert.strictEqual(existing[0].availableSeats, 18);
  });

  test('Divergent offering on same slot is preserved as distinct (No silent merge)', () => {
    const idNullFaculty = FFCSCore.generateCompositeOfferingId('CSE2001', 'Theory', ['A11'], null, 'AB01-204');
    const idNamedFaculty = FFCSCore.generateCompositeOfferingId('CSE2001', 'Theory', ['A11'], 'Dr. Sharma', 'AB01-204');

    const existing = [{
      offeringId: idNullFaculty,
      sourceOfferingId: null,
      scopedSourceId: null,
      courseCode: 'CSE2001',
      componentType: 'Theory',
      slots: ['A11'],
      facultyName: null,
      venue: 'AB01-204',
      availableSeats: 20,
      totalSeats: 60,
      classStatus: 'Open',
      missingFields: ['facultyName']
    }];

    const incoming = {
      offeringId: idNamedFaculty,
      sourceOfferingId: null,
      scopedSourceId: null,
      courseCode: 'CSE2001',
      componentType: 'Theory',
      slots: ['A11'],
      facultyName: 'Dr. Sharma',
      venue: 'AB01-204',
      availableSeats: 20,
      totalSeats: 60,
      classStatus: 'Open',
      missingFields: []
    };

    const res = FFCSCore.deduplicateOffering(existing, incoming);
    // MUST NOT SILENTLY MERGE!
    assert.equal(res.action, 'DIVERGENT_ADDED');
    assert.ok(res.possibleMatch);
  });
});

describe('7. Course Metadata Enrichment & Conflict Handling', () => {
  test('Enriches null metadata with incoming non-null and records history', () => {
    const course = {
      courseCode: 'CSE2001',
      courseName: null,
      credits: null,
      courseStructure: null,
      categories: ['Program Core'],
      enrichmentHistory: [],
      conflicts: []
    };

    FFCSCore.applyCourseMetadataUpdate(
      course,
      { courseName: 'Data Structures', credits: 4, courseStructure: 'Embedded', category: 'Program Elective' },
      1,
      'https://vtop.vitbhopal.ac.in/vtop/page1'
    );

    assert.equal(course.courseName, 'Data Structures');
    assert.equal(course.credits, 4);
    assert.equal(course.courseStructure, 'Embedded');
    assert.deepEqual(course.categories, ['Program Core', 'Program Elective']);
    assert.equal(course.enrichmentHistory.length, 3);
    assert.equal(course.conflicts.length, 0);
  });

  test('Preserves primary metadata on conflict and records conflict entry', () => {
    const course = {
      courseCode: 'CSE2001',
      courseName: 'Data Structures',
      credits: 4,
      courseStructure: 'Embedded',
      categories: ['Program Core'],
      enrichmentHistory: [],
      conflicts: []
    };

    FFCSCore.applyCourseMetadataUpdate(
      course,
      { courseName: 'Algorithms & Data Structures', credits: 3, courseStructure: 'Theory Only' },
      2,
      'https://vtop.vitbhopal.ac.in/vtop/page2'
    );

    // Primary values MUST NOT be overwritten!
    assert.equal(course.courseName, 'Data Structures');
    assert.equal(course.credits, 4);
    assert.equal(course.courseStructure, 'Embedded');

    // Conflicts recorded
    assert.equal(course.conflicts.length, 3);
    assert.equal(course.conflicts[0].field, 'courseName');
    assert.equal(course.conflicts[0].primaryValue, 'Data Structures');
    assert.equal(course.conflicts[0].conflictingValue, 'Algorithms & Data Structures');
  });
});

describe('8. Multi-Page Accumulation & Storage Serialization', () => {
  test('Full multi-page workflow with accurate metrics and JSON-serializable state', () => {
    const session = FFCSCore.createNewSession();

    // Page 1: 2 courses
    const page1Meta = {
      rawUrl: 'https://vtop.vitbhopal.ac.in/vtop/page1?_csrf=xyz',
      sanitizedUrl: 'https://vtop.vitbhopal.ac.in/vtop/page1',
      pageTitle: 'Registration - Core',
      detectedCategory: 'Program Core'
    };

    const page1Rows = [
      {
        courseCode: 'CSE2001',
        courseName: 'DSA',
        credits: 4,
        componentType: 'Theory',
        rawSlot: 'A11+A12+A13',
        facultyName: 'Dr. Sharma',
        venue: 'AB01-204',
        availableSeats: '20',
        totalSeats: '60',
        classStatus: 'Open'
      },
      {
        courseCode: 'MAT2001',
        courseName: 'Math',
        credits: 3,
        componentType: 'Theory',
        rawSlot: 'B11+B12+B13',
        facultyName: 'Prof. Rao',
        venue: 'AB02-101',
        availableSeats: '0',
        totalSeats: '60',
        classStatus: 'Full'
      }
    ];

    const res1 = FFCSCore.mergePageImport(session, page1Meta, page1Rows);
    assert.equal(res1.attemptRecord.metrics.offeringsAdded, 2);
    assert.equal(Object.keys(session.courses).length, 2);

    // Page 2: Same course CSE2001 with Lab component, and a second offering
    const page2Meta = {
      rawUrl: 'https://vtop.vitbhopal.ac.in/vtop/page2',
      sanitizedUrl: 'https://vtop.vitbhopal.ac.in/vtop/page2',
      pageTitle: 'Registration - Lab',
      detectedCategory: 'Program Core'
    };

    const page2Rows = [
      {
        courseCode: 'CSE2001',
        courseName: 'DSA',
        credits: 4,
        componentType: 'Lab',
        rawSlot: 'L1+L2',
        facultyName: 'Prof. Patel',
        venue: 'LC-102',
        availableSeats: '15',
        totalSeats: '30',
        classStatus: 'Open'
      }
    ];

    const res2 = FFCSCore.mergePageImport(session, page2Meta, page2Rows);
    assert.equal(res2.attemptRecord.metrics.offeringsAdded, 1);
    assert.equal(Object.keys(session.courses).length, 2); // Still 2 courses
    assert.equal(session.courses['CSE2001'].options.length, 2); // Theory + Lab offerings!

    // Page 3: Re-import Page 1 with seat updates
    const page3Rows = [
      {
        courseCode: 'CSE2001',
        courseName: 'DSA',
        credits: 4,
        componentType: 'Theory',
        rawSlot: 'A11+A12+A13',
        facultyName: 'Dr. Sharma',
        venue: 'AB01-204',
        availableSeats: '12', // 20 -> 12
        totalSeats: '60',
        classStatus: 'Open'
      }
    ];

    const res3 = FFCSCore.mergePageImport(session, page1Meta, page3Rows);
    assert.equal(res3.attemptRecord.metrics.offeringsUpdated, 1);
    assert.equal(res3.attemptRecord.metrics.offeringsAdded, 0);
    assert.equal(session.courses['CSE2001'].options[0].availableSeats, 12);

    // Build final export payload
    const exportJson = FFCSCore.buildExportPayload(session, '1.1.0');

    assert.equal(exportJson.schemaVersion, '1.5.0');
    assert.equal(exportJson.importSession.totalImportAttempts, 3);
    assert.equal(exportJson.importSession.totalCourses, 2);
    assert.equal(exportJson.importSession.totalOfferings, 3);
    assert.equal(exportJson.courses.length, 2); // Serialized as array

    // Test JSON serialization round-trip (Chrome storage persistence)
    const serialized = JSON.stringify(session);
    const restored = JSON.parse(serialized);
    assert.equal(Object.keys(restored.courses).length, 2);
    assert.equal(restored.pageHistory.length, 3);
  });

  test('Possible matches persist through session restore and appear in export', () => {
    const session = FFCSCore.createNewSession();
    const meta = { rawUrl: 'https://vtop.vitbhopal.ac.in/vtop/register', pageTitle: 'Registration' };
    const base = { courseCode: 'CSE9001', componentType: 'Theory', rawSlot: 'A11', venue: 'AB01-101', availableSeats: '0', totalSeats: '60' };
    FFCSCore.mergePageImport(session, meta, [{ ...base, facultyName: 'Faculty A' }]);
    const second = FFCSCore.mergePageImport(session, meta, [{ ...base, facultyName: 'Faculty B' }]);
    assert.equal(second.possibleMatches.length, 1);
    assert.equal(session.possibleMatches.length, 1);
    const restored = JSON.parse(JSON.stringify(session));
    assert.equal(restored.possibleMatches[0].incomingOffering.facultyName, 'Faculty B');
    const payload = FFCSCore.buildExportPayload(restored, '1.5.0');
    assert.equal(payload.possibleMatches.length, 1);
    assert.equal(payload.extractionReport.possibleMatches.length, 1);
    assert.equal(payload.courses[0].options.length, 2);
  });

  test('Missing fields are recalculated on updates and zero seats remain present', () => {
    const session = FFCSCore.createNewSession();
    const meta = { rawUrl: 'https://vtop.vitbhopal.ac.in/vtop/register' };
    FFCSCore.mergePageImport(session, meta, [{ courseCode: 'CSE9002', sourceOfferingId: '9002', componentType: 'Theory', rawSlot: 'A11', facultyName: '', venue: '', availableSeats: '', totalSeats: '' }]);
    const before = session.courses.CSE9002.options[0];
    assert.ok(before.missingFields.includes('facultyName'));
    FFCSCore.mergePageImport(session, meta, [{ courseCode: 'CSE9002', sourceOfferingId: '9002', componentType: 'Theory', rawSlot: 'A11', facultyName: 'Faculty A', venue: 'AB01-101', availableSeats: '0', totalSeats: '60' }]);
    const after = session.courses.CSE9002.options[0];
    assert.equal(after.availableSeats, 0);
    assert.ok(!after.missingFields.includes('facultyName'));
    assert.ok(!after.missingFields.includes('availableSeats'));
  });

  test('Missing component type remains unknown and duplicate slots carry a warning', () => {
    const session = FFCSCore.createNewSession();
    FFCSCore.mergePageImport(session, { rawUrl: 'https://vtop.vitbhopal.ac.in/vtop/register' }, [
      { courseCode: 'CSE9003', rawSlot: 'A11+A11+A12', facultyName: 'Faculty A', venue: 'AB01-101' }
    ]);
    const option = session.courses.CSE9003.options[0];
    assert.equal(option.componentType, 'UNKNOWN');
    assert.deepEqual(option.slots, ['A11', 'A12']);
    assert.ok(option.warnings.some(w => w.includes('DUPLICATE_SLOT_TOKEN')));
    assert.ok(option.missingFields.includes('componentType'));
  });
});

