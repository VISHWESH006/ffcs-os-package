/**
 * FFCS OS — Bulk Import Extractor Core Engine (v1.5.0)
 * Pure, dependency-free business logic for VTOP Bhopal course extraction,
 * slot validation, offering deduplication, and export generation.
 * Compatible with Node.js test environments and Chrome MV3 runtime.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FFCSCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ─── 1. Official Reference Data ──────────────────────────────────────────

  // Exactly 42 confirmed theory slots from official VIT Bhopal timetable mapping
  const CONFIRMED_THEORY_SLOTS = new Set([
    // Monday (7)
    'A11', 'B11', 'C11', 'A21', 'A14', 'B21', 'C21',
    // Tuesday (7)
    'D11', 'E11', 'F11', 'D21', 'E14', 'E21', 'F21',
    // Wednesday (7)
    'A12', 'B12', 'C12', 'A22', 'B14', 'B22', 'A24',
    // Thursday (7)
    'D12', 'E12', 'F12', 'D22', 'F14', 'E22', 'F22',
    // Friday (7)
    'A13', 'B13', 'C13', 'A23', 'C14', 'B23', 'B24',
    // Saturday (7)
    'D13', 'E13', 'F13', 'D23', 'D14', 'D24', 'E23'
  ]);

  // Confirmed physical buildings at VIT Bhopal
  const CONFIRMED_BUILDINGS = new Set(['AB01', 'AB02', 'LC', 'AR']);

  // Placeholder strings indicating empty or unassigned slots
  const PLACEHOLDER_SLOT_STRINGS = new Set([
    '', '-', '–', '—', 'N/A', 'NA', 'NIL', 'NULL', 'NONE', 'TBD', 'TBA', 'EMPTY'
  ]);

  // ─── 2. Slot Parsing & Validation ────────────────────────────────────────

  /**
   * Evaluates slot tokens with three-state verification.
   * Preserves verbatim original text in rawSlot.
   * Handles duplicate slot tokens and malformed strings.
   *
   * @param {string|null|undefined} rawSlotString
   * @returns {{ rawSlot: string|null, slots: string[], status: 'CONFIRMED_THEORY'|'CONTAINS_UNVERIFIED'|'MISSING_OR_INVALID' }}
   */
  function evaluateSlotTokens(rawSlotString) {
    if (rawSlotString === null || rawSlotString === undefined || typeof rawSlotString !== 'string') {
      return {
        rawSlot: null,
        slots: [],
        status: 'MISSING_OR_INVALID'
      };
    }

    // Preserve exact original source text separately
    const rawSlot = rawSlotString;
    const trimmed = rawSlotString.trim();

    if (PLACEHOLDER_SLOT_STRINGS.has(trimmed.toUpperCase())) {
      return {
        rawSlot,
        slots: [],
        status: 'MISSING_OR_INVALID'
      };
    }

    // Split tokens by +, /, or whitespace
    const rawTokens = trimmed
      .split(/[+,\/\s]+/)
      .map(t => t.trim())
      .filter(t => t.length > 0);

    // Vacuous array check: empty tokens means missing or invalid
    if (rawTokens.length === 0) {
      return {
        rawSlot,
        slots: [],
        status: 'MISSING_OR_INVALID'
      };
    }

    // Check for malformed tokens: valid slot tokens are alphanumeric (e.g., A11, L1, L12)
    // Characters like ?, !, @ or purely symbol tokens denote malformed inputs
    const validTokenRegex = /^[A-Za-z0-9]+$/;
    for (const t of rawTokens) {
      if (!validTokenRegex.test(t)) {
        return {
          rawSlot,
          slots: [],
          status: 'MISSING_OR_INVALID'
        };
      }
    }

    // Deduplicate tokens preserving order, normalized to uppercase
    const upperTokens = rawTokens.map(t => t.toUpperCase());
    const uniqueTokens = Array.from(new Set(upperTokens));
    const duplicateWarnings = [];
    if (upperTokens.length !== uniqueTokens.length) {
      const counts = {};
      for (const t of upperTokens) {
        counts[t] = (counts[t] || 0) + 1;
      }
      for (const [t, count] of Object.entries(counts)) {
        if (count > 1) {
          duplicateWarnings.push(`DUPLICATE_SLOT_TOKEN: ${t} occurs more than once.`);
        }
      }
    }

    if (uniqueTokens.length === 0) {
      return {
        rawSlot,
        slots: [],
        status: 'MISSING_OR_INVALID',
        warnings: duplicateWarnings
      };
    }

    // Verify against 42 confirmed theory slots
    const allTheory = uniqueTokens.every(t => CONFIRMED_THEORY_SLOTS.has(t));
    if (allTheory) {
      return {
        rawSlot,
        slots: uniqueTokens,
        status: 'CONFIRMED_THEORY',
        warnings: duplicateWarnings
      };
    }

    return {
      rawSlot,
      slots: uniqueTokens,
      status: 'CONTAINS_UNVERIFIED',
      warnings: duplicateWarnings
    };
  }

  // ─── 3. Venue & Building Parsing ─────────────────────────────────────────

  /**
   * Parses venue string against confirmed VIT Bhopal buildings.
   * Recognizes AB01, AB02, LC, and AR even without a room number.
   * Recognizes explicit CR as unassigned physical location.
   * Never defaults empty/missing venue to CR.
   *
   * @param {string|null|undefined} venueString
   * @returns {{ venue: string|null, building: string|null, room: string|null }}
   */
  function parseVenue(venueString) {
    if (venueString === null || venueString === undefined || typeof venueString !== 'string') {
      return { venue: null, building: null, room: null };
    }

    const trimmed = venueString.trim();
    if (trimmed === '' || trimmed === '-' || trimmed.toUpperCase() === 'N/A' || trimmed.toUpperCase() === 'NULL') {
      return { venue: null, building: null, room: null };
    }

    // Explicit "CR" denotes Classroom assigned later; physical location unknown
    if (trimmed.toUpperCase() === 'CR') {
      return { venue: 'CR', building: null, room: null };
    }

    // Match confirmed buildings: AB01, AB02, LC, AR with optional room separator
    const match = trimmed.match(/^(AB01|AB02|LC|AR)(?:[-–\s]+(.+))?$/i);
    if (match) {
      const building = match[1].toUpperCase();
      const rawRoom = match[2] ? match[2].trim() : null;
      const room = (rawRoom && rawRoom.length > 0) ? rawRoom : null;
      return { venue: trimmed, building, room };
    }

    // Unrecognized venue string (e.g. AUDITORIUM)
    return { venue: trimmed, building: null, room: null };
  }

  // ─── 4. Seat Counts & Status ─────────────────────────────────────────────

  /**
   * Parses available and total seat strings.
   * Preserves 0 as integer 0. Sets null for missing/unparseable values.
   *
   * @param {string|number|null|undefined} availStr
   * @param {string|number|null|undefined} totalStr
   * @returns {{ availableSeats: number|null, totalSeats: number|null }}
   */
  function parseSeats(availStr, totalStr) {
    let availableSeats = null;
    let totalSeats = null;

    if (availStr !== null && availStr !== undefined) {
      if (typeof availStr === 'number' && !isNaN(availStr)) {
        availableSeats = Math.floor(availStr);
      } else if (typeof availStr === 'string') {
        const t = availStr.trim();
        if (t === '0') {
          availableSeats = 0;
        } else if (/^-?\d+$/.test(t)) {
          availableSeats = parseInt(t, 10);
        }
      }
    }

    if (totalStr !== null && totalStr !== undefined) {
      if (typeof totalStr === 'number' && !isNaN(totalStr)) {
        totalSeats = Math.floor(totalStr);
      } else if (typeof totalStr === 'string') {
        const t = totalStr.trim();
        if (/^-?\d+$/.test(t)) {
          totalSeats = parseInt(t, 10);
        }
      }
    }

    return { availableSeats, totalSeats };
  }

  /**
   * Parses classStatus string. Returns trimmed string or null if empty/missing.
   *
   * @param {string|null|undefined} statusStr
   * @returns {string|null}
   */
  function parseClassStatus(statusStr) {
    if (statusStr === null || statusStr === undefined || typeof statusStr !== 'string') {
      return null;
    }
    const t = statusStr.trim();
    if (t === '' || t === '-' || t.toUpperCase() === 'N/A' || t.toUpperCase() === 'NULL') {
      return null;
    }
    return t;
  }

  // ─── 5. Strict URL Sanitization ──────────────────────────────────────────

  /**
   * Strictly sanitizes VTOP Bhopal URLs.
   * Verifies origin is https://vtop.vitbhopal.ac.in.
   * Strips path-based session identifiers (;jsessionid=...) without breaking subsequent paths.
   * Drops all query parameters and fragments.
   * Returns null for invalid or external URLs.
   *
   * @param {string|null|undefined} rawUrl
   * @returns {string|null}
   */
  function sanitizeVtopUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
      return null;
    }

    try {
      const urlObj = new URL(rawUrl);

      // Strict origin verification
      if (urlObj.origin !== 'https://vtop.vitbhopal.ac.in') {
        return null;
      }

      // Remove path-based Java EE session identifier (;jsessionid=...)
      // Preserves preceding and subsequent path segments
      urlObj.pathname = urlObj.pathname.replace(/;jsessionid=[^/?#;]+/gi, '');

      // Drop all query parameters
      urlObj.search = '';

      // Drop all fragments
      urlObj.hash = '';

      return urlObj.toString();
    } catch {
      return null;
    }
  }

  // ─── 6. Collision-Proof Identity Generation ──────────────────────────────

  /**
   * Generates a collision-proof composite offering identity using JSON array serialization.
   * Uses native JSON null for missing faculty and venue (never sentinel strings).
   * Preserves faculty titles while normalizing case and collapsing internal whitespace.
   *
   * @param {string} courseCode
   * @param {string} componentType
   * @param {string[]} slots
   * @param {string|null} facultyName
   * @param {string|null} venue
   * @returns {string} JSON-stringified composite key
   */
  function generateCompositeOfferingId(courseCode, componentType, slots, facultyName, venue) {
    const normCourse = (courseCode || '').trim().toUpperCase();
    const normComponent = (componentType || '').trim().toUpperCase();
    const sortedSlots = [...(slots || [])].map(s => s.trim().toUpperCase()).sort();

    const normFaculty = (typeof facultyName === 'string' && facultyName.trim().length > 0)
      ? facultyName.trim().replace(/\s+/g, ' ').toUpperCase()
      : null;

    const normVenue = (typeof venue === 'string' && venue.trim().length > 0)
      ? venue.trim().replace(/\s+/g, ' ').toUpperCase()
      : null;

    return JSON.stringify([normCourse, normComponent, sortedSlots, normFaculty, normVenue]);
  }

  /**
   * Generates a collision-proof scoped native source ID using JSON array serialization.
   *
   * @param {string} courseCode
   * @param {string} componentType
   * @param {string|null|undefined} sourceOfferingId
   * @returns {string|null}
   */
  function getScopedSourceId(courseCode, componentType, sourceOfferingId) {
    if (!sourceOfferingId || typeof sourceOfferingId !== 'string' || sourceOfferingId.trim().length === 0) {
      return null;
    }
    return JSON.stringify([
      (courseCode || '').trim().toUpperCase(),
      (componentType || '').trim().toUpperCase(),
      sourceOfferingId.trim()
    ]);
  }

  // ─── 7. Course Metadata Conflict & Enrichment ─────────────────────────────

  /**
   * Applies deterministic course-level metadata updates:
   * - Existing null + incoming non-null -> enrich primary record & record in enrichmentHistory.
   * - Existing non-null + incoming differing non-null -> preserve primary value & record in conflicts.
   * - Both null or identical -> no-op.
   * - categories: set union of all non-empty strings.
   *
   * @param {object} course Stored course record
   * @param {object} incoming Incoming metadata { courseName, credits, courseStructure, category }
   * @param {number} attemptIndex
   * @param {string|null} sourceUrl
   */
  function applyCourseMetadataUpdate(course, incoming, attemptIndex, sourceUrl) {
    if (!course.enrichmentHistory) course.enrichmentHistory = [];
    if (!course.conflicts) course.conflicts = [];
    if (!course.categories) course.categories = [];

    // 1. Category set union
    if (incoming.category && typeof incoming.category === 'string') {
      const catTrimmed = incoming.category.trim();
      if (catTrimmed.length > 0 && !course.categories.includes(catTrimmed)) {
        course.categories.push(catTrimmed);
      }
    }

    // 2. Metadata fields check: courseName, credits, courseStructure
    const fields = ['courseName', 'credits', 'courseStructure'];
    for (const field of fields) {
      const existingVal = course[field];
      const incomingVal = incoming[field] !== undefined ? incoming[field] : null;

      if (incomingVal === null || incomingVal === undefined) {
        continue; // Incoming has no data; no enrichment or conflict
      }

      if (existingVal === null || existingVal === undefined) {
        // Safe enrichment
        course[field] = incomingVal;
        course.enrichmentHistory.push({
          field,
          previousValue: null,
          enrichedValue: incomingVal,
          attemptIndex,
          sourceUrl
        });
      } else {
        // Check for difference
        const isDifferent = (typeof existingVal === 'string' && typeof incomingVal === 'string')
          ? existingVal.trim().toUpperCase() !== incomingVal.trim().toUpperCase()
          : existingVal !== incomingVal;

        if (isDifferent) {
          course.conflicts.push({
            field,
            primaryValue: existingVal,
            conflictingValue: incomingVal,
            attemptIndex,
            sourceUrl
          });
        }
      }
    }
  }

  function recalculateCourseMissingFields(course) {
    const missing = [];
    if (!course.courseName || !String(course.courseName).trim()) missing.push('courseName');
    if (course.credits === null || course.credits === undefined) missing.push('credits');
    if (!course.courseStructure || !String(course.courseStructure).trim()) missing.push('courseStructure');
    course.missingFields = missing;
    return missing;
  }

  // ─── 8. Deduplication Engine & Field Integrity ──────────────────────────

  /**
   * Recalculates missingFields for an offering dynamically based on current values.
   * Legitimate 0 seats is NOT considered missing.
   *
   * @param {object} offering
   * @returns {string[]} array of missing field names
   */
  function recalculateMissingFields(offering) {
    const missing = [];
    if (!offering.facultyName || !String(offering.facultyName).trim()) {
      missing.push('facultyName');
    }
    if (!offering.venue || !String(offering.venue).trim()) {
      missing.push('venue');
    }
    if (offering.availableSeats === null || offering.availableSeats === undefined) {
      missing.push('availableSeats');
    }
    if (offering.totalSeats === null || offering.totalSeats === undefined) {
      missing.push('totalSeats');
    }
    if (!offering.classStatus || !String(offering.classStatus).trim()) {
      missing.push('classStatus');
    }
    if (!offering.slots || offering.slots.length === 0 || offering.slotVerificationStatus === 'MISSING_OR_INVALID') {
      missing.push('slots');
    }
    if (!offering.componentType || offering.componentType === 'UNKNOWN') {
      missing.push('componentType');
    }
    return missing;
  }

  /**
   * Evaluates an incoming offering against existing offerings for the course.
   *
   * Rules:
   * A. Source ID Precedence:
   *    - If both have non-null scopedSourceIds and match: update mutable fields.
   *    - If both have non-null scopedSourceIds and differ: distinct offerings (do NOT fall back to composite).
   * B. Composite Identity Matching:
   *    - Used only when source ID is unavailable on at least one record.
   *    - If offeringId matches: update mutable fields.
   *    - If courseCode, componentType, and slots match, but faculty or venue differ: DO NOT MERGE.
   *      Preserve incoming as distinct offering and record possible match for student reconciliation.
   *
   * @param {object[]} existingOptions Array of StoredOffering
   * @param {object} incoming StoredOffering
   * @returns {{ action: 'UPDATED'|'UNCHANGED'|'ADDED'|'DIVERGENT_ADDED', matchedOffering?: object, possibleMatch?: object }}
   */
  function deduplicateOffering(existingOptions, incoming) {
    let sourceIdMismatchFound = false;

    // Pass 1: Check Scoped Source ID
    if (incoming.scopedSourceId) {
      for (const existing of existingOptions) {
        if (existing.scopedSourceId) {
          if (existing.scopedSourceId === incoming.scopedSourceId) {
            // Source ID Match: update mutable fields
            const changed = existing.availableSeats !== incoming.availableSeats ||
                            existing.totalSeats !== incoming.totalSeats ||
                            existing.classStatus !== incoming.classStatus ||
                            (!existing.facultyName && incoming.facultyName) ||
                            (!existing.venue && incoming.venue);

            existing.availableSeats = incoming.availableSeats;
            existing.totalSeats = incoming.totalSeats;
            existing.classStatus = incoming.classStatus;

            // If existing was missing faculty or venue and incoming provides it, safely enrich
            if (!existing.facultyName && incoming.facultyName) {
              existing.facultyName = incoming.facultyName;
            }
            if (!existing.venue && incoming.venue) {
              existing.venue = incoming.venue;
              existing.building = incoming.building;
              existing.room = incoming.room;
            }

            // Recalculate missingFields dynamically after every merge/update
            existing.missingFields = recalculateMissingFields(existing);

            // Recompute offeringId in case fields enriched
            existing.offeringId = generateCompositeOfferingId(
              existing.courseCode,
              existing.componentType,
              existing.slots,
              existing.facultyName,
              existing.venue
            );

            return { action: changed ? 'UPDATED' : 'UNCHANGED', matchedOffering: existing };
          } else {
            // Both have source IDs and differ -> distinct!
            sourceIdMismatchFound = true;
          }
        }
      }
    }

    // Pass 2: Composite Identity Matching
    // Only compare against existing offerings that do NOT have a conflicting source ID
    for (const existing of existingOptions) {
      // If both had source IDs and differed, Rule A forbids composite fallback against this record
      if (incoming.scopedSourceId && existing.scopedSourceId && incoming.scopedSourceId !== existing.scopedSourceId) {
        continue;
      }

      // Exact Composite Match
      if (existing.offeringId === incoming.offeringId) {
        const changed = existing.availableSeats !== incoming.availableSeats ||
                        existing.totalSeats !== incoming.totalSeats ||
                        existing.classStatus !== incoming.classStatus ||
                        (!existing.facultyName && incoming.facultyName) ||
                        (!existing.venue && incoming.venue);

        existing.availableSeats = incoming.availableSeats;
        existing.totalSeats = incoming.totalSeats;
        existing.classStatus = incoming.classStatus;

        if (!existing.facultyName && incoming.facultyName) {
          existing.facultyName = incoming.facultyName;
        }
        if (!existing.venue && incoming.venue) {
          existing.venue = incoming.venue;
          existing.building = incoming.building;
          existing.room = incoming.room;
        }

        existing.missingFields = recalculateMissingFields(existing);

        return { action: changed ? 'UPDATED' : 'UNCHANGED', matchedOffering: existing };
      }

      // Check for Potential Divergent Match (same courseCode, componentType, and identical slots, but divergent faculty/venue)
      const existingCourse = (existing.courseCode || '').trim().toUpperCase();
      const incomingCourse = (incoming.courseCode || '').trim().toUpperCase();
      const sameCourse = !existingCourse || !incomingCourse || existingCourse === incomingCourse;
      const sameComponent = (existing.componentType || '').trim().toUpperCase() === (incoming.componentType || '').trim().toUpperCase();
      const sameSlots = JSON.stringify([...(existing.slots || [])].sort()) === JSON.stringify([...(incoming.slots || [])].sort());

      if (sameCourse && sameComponent && sameSlots) {
        // DO NOT MERGE! Preserve as distinct offering and report divergence
        return {
          action: 'DIVERGENT_ADDED',
          matchedOffering: existing,
          possibleMatch: {
            existingOfferingId: existing.offeringId,
            existingFaculty: existing.facultyName,
            existingVenue: existing.venue,
            incomingOfferingId: incoming.offeringId,
            incomingFaculty: incoming.facultyName,
            incomingVenue: incoming.venue,
            reason: 'Identical slots and componentType but divergent faculty or venue; preserved as distinct records.'
          }
        };
      }
    }

    // No match found -> new distinct offering
    return { action: 'ADDED' };
  }

  // ─── 9. Page Import & Session Accumulation ───────────────────────────────

  /**
   * Initializes a fresh session state.
   */
  function createNewSession() {
    return {
      sessionId: 'ses_' + Math.random().toString(36).substring(2, 12),
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      status: 'collecting',
      pageHistory: [],
      courses: {}, // Plain object keyed by courseCode
      possibleMatches: [] // Persisted collection-level divergent offerings
    };
  }

  /**
   * Merges an extracted page's rows into the ongoing session.
   *
   * @param {object} session Plain object session state
   * @param {object} pageMetadata { rawUrl, sanitizedUrl, pageTitle, detectedCategory, domMetrics }
   * @param {object[]} extractedRows Array of extracted offering rows
   * @returns {{ attemptRecord: object, possibleMatches: object[], warnings: string[] }}
   */
  function mergePageImport(session, pageMetadata, extractedRows) {
    const attemptIndex = session.pageHistory.length + 1;
    const sanitizedUrl = pageMetadata.sanitizedUrl || sanitizeVtopUrl(pageMetadata.rawUrl);
    session.possibleMatches = session.possibleMatches || [];

    let rowsScanned = 0;
    let rowsRejected = 0;
    let offeringsExtracted = 0;
    let offeringsAdded = 0;
    let offeringsUpdated = 0;
    let offeringsUnchanged = 0;

    const possibleMatches = [];
    const warnings = [];

    for (const rawRow of (extractedRows || [])) {
      rowsScanned++;

      const courseCode = (rawRow.courseCode || '').trim().toUpperCase();
      if (!courseCode) {
        rowsRejected++;
        continue;
      }

      offeringsExtracted++;

      // 1. Get or create Course Record
      if (!session.courses[courseCode]) {
        session.courses[courseCode] = {
          courseCode,
          courseName: rawRow.courseName || null,
          credits: rawRow.credits !== undefined ? rawRow.credits : null,
          categories: pageMetadata.detectedCategory ? [pageMetadata.detectedCategory.trim()] : [],
          courseStructure: rawRow.courseStructure || null,
          enrichmentHistory: [],
          conflicts: [],
          options: [],
          missingFields: []
        };
        recalculateCourseMissingFields(session.courses[courseCode]);
      } else {
        // Apply metadata updates/conflicts
        applyCourseMetadataUpdate(
          session.courses[courseCode],
          {
            courseName: rawRow.courseName || null,
            credits: rawRow.credits !== undefined ? rawRow.credits : null,
            courseStructure: rawRow.courseStructure || null,
            category: pageMetadata.detectedCategory || null
          },
          attemptIndex,
          sanitizedUrl
        );
        recalculateCourseMissingFields(session.courses[courseCode]);
      }

      const course = session.courses[courseCode];

      // 2. Construct Offering
      const rawComp = rawRow.componentType;
      const componentType = (rawComp && String(rawComp).trim().length > 0)
        ? String(rawComp).trim()
        : 'UNKNOWN';

      if (componentType === 'UNKNOWN') {
        warnings.push(`Course ${courseCode} offering has missing or unknown component type.`);
      }

      const slotEval = evaluateSlotTokens(rawRow.rawSlot);
      const offeringWarnings = [...(slotEval.warnings || [])];
      if (slotEval.warnings && slotEval.warnings.length > 0) {
        warnings.push(...slotEval.warnings);
      }

      const venueParsed = parseVenue(rawRow.venue);
      const seats = parseSeats(rawRow.availableSeats, rawRow.totalSeats);
      const classStatus = parseClassStatus(rawRow.classStatus);

      const facultyName = (rawRow.facultyName && typeof rawRow.facultyName === 'string' && rawRow.facultyName.trim().length > 0)
        ? rawRow.facultyName.trim()
        : null;

      const sourceOfferingId = (rawRow.sourceOfferingId && String(rawRow.sourceOfferingId).trim().length > 0)
        ? String(rawRow.sourceOfferingId).trim()
        : null;

      const scopedSourceId = getScopedSourceId(courseCode, componentType, sourceOfferingId);

      const incomingOffering = {
        courseCode,
        offeringId: '',
        sourceOfferingId,
        scopedSourceId,
        componentType,
        rawSlot: slotEval.rawSlot,
        slots: slotEval.slots,
        slotVerificationStatus: slotEval.status,
        facultyName,
        venue: venueParsed.venue,
        building: venueParsed.building,
        room: venueParsed.room,
        availableSeats: seats.availableSeats,
        totalSeats: seats.totalSeats,
        classStatus,
        missingFields: [],
        warnings: offeringWarnings
      };

      incomingOffering.missingFields = recalculateMissingFields(incomingOffering);
      incomingOffering.offeringId = generateCompositeOfferingId(
        courseCode,
        componentType,
        slotEval.slots,
        facultyName,
        venueParsed.venue
      );

      // 3. Deduplicate
      const dedupResult = deduplicateOffering(course.options, incomingOffering);

      if (dedupResult.action === 'ADDED' || dedupResult.action === 'DIVERGENT_ADDED') {
        course.options.push(incomingOffering);
        offeringsAdded++;
        if (dedupResult.possibleMatch) {
          const pm = {
            courseCode,
            slots: slotEval.slots,
            componentType,
            existingOffering: {
              offeringId: dedupResult.possibleMatch.existingOfferingId,
              facultyName: dedupResult.possibleMatch.existingFaculty || (dedupResult.matchedOffering ? dedupResult.matchedOffering.facultyName : null),
              venue: dedupResult.possibleMatch.existingVenue || (dedupResult.matchedOffering ? dedupResult.matchedOffering.venue : null),
              sourceOfferingId: dedupResult.matchedOffering ? dedupResult.matchedOffering.sourceOfferingId : null
            },
            incomingOffering: {
              offeringId: incomingOffering.offeringId,
              facultyName: incomingOffering.facultyName,
              venue: incomingOffering.venue,
              sourceOfferingId: incomingOffering.sourceOfferingId
            },
            reason: dedupResult.possibleMatch.reason,
            attemptIndex,
            detectedAt: new Date().toISOString()
          };

          const alreadyLogged = session.possibleMatches.some(
            m => m.courseCode === pm.courseCode &&
                 ((m.existingOffering.offeringId === pm.existingOffering.offeringId && m.incomingOffering.offeringId === pm.incomingOffering.offeringId) ||
                  (m.existingOffering.offeringId === pm.incomingOffering.offeringId && m.incomingOffering.offeringId === pm.existingOffering.offeringId))
          );
          if (!alreadyLogged) {
            session.possibleMatches.push(pm);
          }
          possibleMatches.push(pm);
        }
      } else if (dedupResult.action === 'UPDATED') {
        offeringsUpdated++;
      } else if (dedupResult.action === 'UNCHANGED') {
        offeringsUnchanged++;
      }
    }

    const dm = pageMetadata.domMetrics || {};
    const attemptRecord = {
      attemptIndex,
      pageTitle: pageMetadata.pageTitle || 'Course Registration',
      sanitizedUrl,
      category: pageMetadata.detectedCategory || null,
      importedAt: new Date().toISOString(),
      metrics: {
        domRowsDetected: dm.domRowsDetected !== undefined ? dm.domRowsDetected : rowsScanned,
        rowsScanned: dm.rowsScanned !== undefined ? dm.rowsScanned : rowsScanned,
        rowsAccepted: dm.rowsAccepted !== undefined ? dm.rowsAccepted : (offeringsAdded + offeringsUpdated + offeringsUnchanged),
        rowsRejected: dm.rowsRejected !== undefined ? dm.rowsRejected : rowsRejected,
        rowsSkipped: dm.rowsSkipped !== undefined ? dm.rowsSkipped : 0,
        duplicateRows: dm.duplicateRows !== undefined ? dm.duplicateRows : 0,
        incompleteRows: dm.incompleteRows !== undefined ? dm.incompleteRows : 0,
        rejectionReasons: dm.rejectionReasons || {},
        offeringsExtracted,
        offeringsAdded,
        offeringsUpdated,
        offeringsUnchanged
      }
    };

    session.pageHistory.push(attemptRecord);
    session.lastUpdatedAt = new Date().toISOString();

    return {
      attemptRecord,
      possibleMatches,
      warnings
    };
  }

  // ─── 10. Final Consolidated Export Builder ───────────────────────────────

  /**
   * Builds the versioned v1.5.0 JSON export payload.
   * Serializes courses as an array. Calculates deterministic metrics.
   *
   * @param {object} session
   * @param {string} extensionVersion
   * @returns {object} JSON-ready object
   */
  function buildExportPayload(session, extensionVersion) {
    const courseList = Object.values(session.courses || {});
    const totalCourses = courseList.length;
    let totalOfferings = 0;

    let missingFaculty = 0;
    let missingVenue = 0;
    let missingAvailableSeats = 0;
    let missingTotalSeats = 0;
    let missingClassStatus = 0;
    let missingCourseStructures = 0;
    let zeroAvailableSeats = 0;

    const unverifiedSlots = [];
    const courseMetadataConflicts = [];
    const warnings = [];

    for (const course of courseList) {
      totalOfferings += course.options.length;
      if (!course.courseStructure) missingCourseStructures++;

      if (course.conflicts && course.conflicts.length > 0) {
        courseMetadataConflicts.push({
          courseCode: course.courseCode,
          conflicts: course.conflicts
        });
      }

      for (const opt of course.options) {
        if (!opt.facultyName) missingFaculty++;
        if (!opt.venue) missingVenue++;
        if (opt.availableSeats === null) missingAvailableSeats++;
        if (opt.availableSeats === 0) zeroAvailableSeats++;
        if (opt.totalSeats === null) missingTotalSeats++;
        if (!opt.classStatus) missingClassStatus++;

        if (opt.slotVerificationStatus === 'CONTAINS_UNVERIFIED') {
          for (const s of opt.slots) {
            if (!CONFIRMED_THEORY_SLOTS.has(s)) {
              unverifiedSlots.push({
                slotCode: s,
                rawSlot: opt.rawSlot,
                offeringId: opt.offeringId,
                reason: 'Not in confirmed 42 theory slots; excluded from automated timetable clash validation'
              });
            }
          }
        }
      }
    }

    let totalRowsScanned = 0;
    let totalRowsRejected = 0;
    let totalOfferingsExtracted = 0;

    for (const attempt of (session.pageHistory || [])) {
      if (attempt.metrics) {
        totalRowsScanned += attempt.metrics.rowsScanned || 0;
        totalRowsRejected += attempt.metrics.rowsRejected || 0;
        totalOfferingsExtracted += attempt.metrics.offeringsExtracted || 0;
      }
    }

    if (missingFaculty > 0) warnings.push(`${missingFaculty} offering(s) contain null facultyName.`);
    if (missingVenue > 0) warnings.push(`${missingVenue} offering(s) contain null venue.`);
    if (zeroAvailableSeats > 0) warnings.push(`${zeroAvailableSeats} offering(s) have actual 0 available seats and were preserved.`);
    if (unverifiedSlots.length > 0) warnings.push(`${unverifiedSlots.length} unverified slot code(s) detected and excluded from automated clash validation.`);
    if (courseMetadataConflicts.length > 0) warnings.push(`${courseMetadataConflicts.length} course(s) have metadata conflicts recorded for student review.`);

    const storedPossibleMatches = session.possibleMatches || [];

    return {
      schemaVersion: '1.5.0',
      source: {
        system: 'VTOP',
        campus: 'VIT Bhopal University',
        verifiedOrigin: 'https://vtop.vitbhopal.ac.in',
        extensionVersion: extensionVersion || '1.1.0',
        exportedAt: new Date().toISOString()
      },
      importSession: {
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        completedAt: new Date().toISOString(),
        totalImportAttempts: session.pageHistory.length,
        totalCourses,
        totalOfferings,
        totalPossibleMatches: storedPossibleMatches.length
      },
      pageHistory: session.pageHistory || [],
      courses: courseList,
      possibleMatches: storedPossibleMatches,
      extractionReport: {
        totalRowsScanned,
        totalRowsRejected,
        totalOfferingsExtracted,
        totalUniqueOfferingsInSession: totalOfferings,
        missingFieldsSummary: {
          missingCourseStructures,
          missingFaculty,
          missingVenue,
          missingAvailableSeats,
          missingTotalSeats,
          missingClassStatus,
          zeroAvailableSeats
        },
        unverifiedSlots,
        possibleMatches: storedPossibleMatches,
        courseMetadataConflicts,
        warnings,
        errors: []
      }
    };
  }

  // ─── Exported Interface ──────────────────────────────────────────────────

  return {
    CONFIRMED_THEORY_SLOTS,
    CONFIRMED_BUILDINGS,
    PLACEHOLDER_SLOT_STRINGS,
    evaluateSlotTokens,
    parseVenue,
    parseSeats,
    parseClassStatus,
    sanitizeVtopUrl,
    generateCompositeOfferingId,
    getScopedSourceId,
    applyCourseMetadataUpdate,
    recalculateMissingFields,
    deduplicateOffering,
    createNewSession,
    mergePageImport,
    buildExportPayload
  };
});
