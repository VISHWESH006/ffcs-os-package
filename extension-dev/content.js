/**
 * FFCS OS — development Content Script (v1.5.0)
 * Runs on explicitly allowlisted VTOP and development test hosts.
 * 1. Injects a notification banner when course tables are detected.
 * 2. Scans, extracts, and reports all course registration tables on the page.
 * 3. Responds to message requests from popup.js.
 */
'use strict';

(function () {
  const BANNER_ID = 'ffcs-os-banner';
  const BANNER_DISMISS_MS = 8000;

  // Header keyword variants — ordered most-specific first
  const HEADER_KEYWORDS = {
    courseCode: ['course code', 'sub code', 'course_code'],
    courseTitle: ['course title', 'course name', 'subject title', 'title'],
    courseType: ['course type', 'type'],
    courseStructure: ['course structure', 'structure', 'distribution', 'l-t-p-j-c', 'ltpjc', 'ltpc'],
    credits: ['credit', 'credits'],
    slot: ['slot', 'slots'],
    faculty: ['faculty name', 'faculty', 'teacher'],
    venue: ['venue', 'room no', 'room'],
    available: ['available seats', 'available seat', 'vacant', 'available', 'seats available'],
    totalSeats: ['total seats', 'total seat', 'capacity', 'max seats'],
    classStatus: ['status', 'class status', 'status of class'],
    sourceOfferingId: ['class number', 'class nbr', 'seq no', 'option id', 'section id']
  };

  const REQUIRED_HEADERS = ['courseCode'];

  // ─── Banner ─────────────────────────────────────────────────────────────

  function injectBanner() {
    if (document.getElementById(BANNER_ID)) return;
    if (findAllCourseTables().length === 0) return;

    injectKeyframes();

    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px', 'z-index:2147483647',
      'background:linear-gradient(135deg,#00bfa5,#0070f3)',
      'color:#fff', 'border-radius:12px', 'padding:14px 18px',
      'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
      'font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
      'font-size:14px', 'display:flex', 'align-items:center', 'gap:12px',
      'cursor:default', 'max-width:340px',
      'animation:ffcs-slide-in 0.3s ease'
    ].join(';');

    banner.innerHTML = `
      <span style="font-size:24px;flex-shrink:0">⚡</span>
      <div style="flex:1">
        <div style="font-weight:700;font-size:14px">FFCS OS Detected</div>
        <div style="font-size:11px;opacity:0.9">Course table found — click extension icon to import this page</div>
      </div>
      <button id="ffcs-close-btn" style="
        background:rgba(255,255,255,0.2);border:none;color:#fff;
        cursor:pointer;font-size:16px;padding:2px 8px;border-radius:6px;
        line-height:1;flex-shrink:0
      ">×</button>
    `;

    document.body.appendChild(banner);
    document.getElementById('ffcs-close-btn')?.addEventListener('click', () => banner.remove());
    setTimeout(() => { if (banner.isConnected) banner.remove(); }, BANNER_DISMISS_MS);
  }

  function injectKeyframes() {
    if (document.getElementById('ffcs-kf')) return;
    const style = document.createElement('style');
    style.id = 'ffcs-kf';
    style.textContent = '@keyframes ffcs-slide-in{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}';
    document.head.appendChild(style);
  }

  // ─── Table Discovery & Header Detection ──────────────────────────────────

  function detectHeaders(rows, requiredHeaders = REQUIRED_HEADERS) {
    const maxScan = Math.min(rows.length, 5);

    for (let i = 0; i < maxScan; i++) {
      const cells = rows[i].querySelectorAll('th, td');
      const texts = Array.from(cells, c => (c.textContent || '').trim().toLowerCase());
      const hasRequired = requiredHeaders.every(field =>
        findColumnIndex(texts, HEADER_KEYWORDS[field]) >= 0
      );
      if (!hasRequired) continue;

      const columns = {};
      for (const [field, keywords] of Object.entries(HEADER_KEYWORDS)) {
        const idx = findColumnIndex(texts, keywords);
        if (idx >= 0) columns[field] = idx;
      }
      if (requiredHeaders.length === 0 && !(
        columns.slot !== undefined && (
          columns.courseCode !== undefined || columns.courseType !== undefined ||
          columns.faculty !== undefined || columns.venue !== undefined
        )
      )) continue;
      return { headerIndex: i, columns, texts };
    }
    return null;
  }

  function isRegistrationTable(table) {
    const rows = Array.from(table.querySelectorAll('tr')).slice(0, 5);
    const header = detectHeaders(rows, []);
    return Boolean(header && header.columns.slot !== undefined && (
      header.columns.courseCode !== undefined || header.columns.courseType !== undefined ||
      header.columns.faculty !== undefined || header.columns.venue !== undefined
    ));
  }

  function findAllCourseTables() {
    const results = [];
    for (const table of document.querySelectorAll('table')) {
      if (isRegistrationTable(table)) results.push(table);
    }
    return results;
  }

  function findColumnIndex(texts, keywords) {
    for (const kw of keywords) {
      const idx = texts.findIndex(t => t.includes(kw));
      if (idx >= 0) return idx;
    }
    return -1;
  }

  function cellValue(cells, columns, field) {
    const idx = columns[field];
    if (idx === undefined || idx >= cells.length) return '';
    return (cells[idx].textContent || '').trim();
  }

  function normalizeCourseType(raw) {
    if (!raw || !String(raw).trim()) return null;
    const upper = raw.toUpperCase().trim();
    if (upper === 'ELA' || upper === 'SS' || upper.includes('EMBEDDED LAB')) return 'Embedded Lab';
    if (upper === 'ETH' || upper.includes('EMBEDDED THEORY')) return 'Embedded Theory';
    if (upper === 'TH' || upper === 'THEORY') return 'Theory';
    if (upper === 'LO' || upper === 'LAB' || upper.includes('LAB')) return 'Lab';
    return raw.trim();
  }

  function detectPageCategory() {
    // 1. Look for active tab or category header
    const selectors = [
      '.nav-tabs .active',
      '.page-header',
      '.panel-title',
      'h3', 'h4', 'h5',
      'select[name*="category"] option:checked',
      'select[name*="basket"] option:checked'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const txt = el.textContent.trim();
        if (txt && /core|elective|basket|university|program/i.test(txt)) {
          return txt.replace(/\s+/g, ' ');
        }
      }
    }

    // 2. Scan text for known VIT Bhopal categories
    const bodyText = document.body.textContent || '';
    if (/Program Core/i.test(bodyText)) return 'Program Core';
    if (/Program Elective/i.test(bodyText)) return 'Program Elective';
    if (/University Core/i.test(bodyText)) return 'University Core';
    if (/University Elective|Open Elective/i.test(bodyText)) return 'Open Elective';

    return null;
  }

  // ─── Row Parser ─────────────────────────────────────────────────────────

  function parseRow(row, columns) {
    const cells = row.querySelectorAll('td');
    if (cells.length === 0) {
      return { success: false, reason: 'Empty row' };
    }
    if (cells.length < 3) {
      return { success: false, reason: 'Unsupported table structure (fewer than 3 cells)' };
    }

    const courseCode = cellValue(cells, columns, 'courseCode').toUpperCase().replace(/\s+/g, '');
    if (!courseCode) {
      return { success: false, reason: 'Missing course code' };
    }
    if (courseCode.length < 4) {
      return { success: false, reason: 'Invalid or unrecognized data (course code too short)' };
    }

    const courseName = cellValue(cells, columns, 'courseTitle') || null;
    const rawCourseType = cellValue(cells, columns, 'courseType');
    const componentType = normalizeCourseType(rawCourseType);
    const courseStructure = cellValue(cells, columns, 'courseStructure') || null;
    const creditsStr = cellValue(cells, columns, 'credits');
    const credits = /^\d+$/.test(creditsStr) ? parseInt(creditsStr, 10) : null;

    const slotRaw = cellValue(cells, columns, 'slot') || null;
    const facultyRaw = cellValue(cells, columns, 'faculty') || null;
    const venueRaw = cellValue(cells, columns, 'venue') || null;
    const availRaw = cellValue(cells, columns, 'available');
    const totalRaw = cellValue(cells, columns, 'totalSeats');
    const statusRaw = cellValue(cells, columns, 'classStatus') || null;
    const sourceOfferingId = cellValue(cells, columns, 'sourceOfferingId') || null;

    const incompleteReasons = [];
    if (!componentType) incompleteReasons.push('Missing component identification');
    if (!slotRaw) incompleteReasons.push('Missing slot');
    if (!facultyRaw) incompleteReasons.push('Missing faculty');
    if (!venueRaw) incompleteReasons.push('Missing venue');
    const isIncomplete = incompleteReasons.length > 0;

    return {
      success: true,
      isIncomplete,
      incompleteReasons,
      data: {
        courseCode,
        courseName,
        componentType,
        courseStructure,
        credits,
        rawSlot: slotRaw,
        facultyName: facultyRaw,
        venue: venueRaw,
        availableSeats: availRaw,
        totalSeats: totalRaw,
        classStatus: statusRaw,
        sourceOfferingId
      }
    };
  }

  // ─── Main Extraction Method ──────────────────────────────────────────────

  function extractPageData() {
    const allTables = Array.from(document.querySelectorAll('table'));
    const offeringTables = allTables.filter(isRegistrationTable);
    if (offeringTables.length === 0) {
      return {
        success: false,
        error: 'No supported offering table found. Make sure the course registration offerings are visible.'
      };
    }

    // Some VTOP registration pages render course metadata and offerings in
    // separate tables. Collect only explicit course records; never infer a
    // relationship from row order when more than one course is present.
    const metadataByCode = new Map();
    for (const table of allTables) {
      const tableRows = Array.from(table.querySelectorAll('tr'));
      const header = detectHeaders(tableRows, ['courseCode', 'courseTitle']);
      if (!header || header.columns.slot !== undefined) continue;
      const bodyRows = tableRows.slice(header.headerIndex + 1);
      const texts = header.texts || [];
      const structureIndexes = ['l', 't', 'p', 'j', 'c'].map(label => texts.findIndex(text => text === label));
      for (const row of bodyRows) {
        const cells = row.querySelectorAll('td');
        const courseCode = cellValue(cells, header.columns, 'courseCode').toUpperCase().replace(/\s+/g, '');
        const courseName = cellValue(cells, header.columns, 'courseTitle') || null;
        if (!courseCode || courseCode.length < 4 || !courseName) continue;
        const structureParts = structureIndexes.slice(0, 4).map(index => index < 0 ? '' : (cells[index]?.textContent || '').trim());
        const structure = structureIndexes.some(index => index >= 0)
          ? `L-T-P-J: ${structureParts.join('-')}`
          : null;
        const cIndex = structureIndexes[4];
        const cValue = cIndex < 0 ? '' : (cells[cIndex]?.textContent || '').trim();
        metadataByCode.set(courseCode, {
          courseCode,
          courseName,
          credits: /^\d+$/.test(cValue) ? Number.parseInt(cValue, 10) : null,
          courseStructure: structure
        });
      }
    }

    const rows = [];
    let tablesScanned = 0;
    const detectedCategory = detectPageCategory();

    let domRowsDetected = 0;
    let rowsScanned = 0;
    let rowsAccepted = 0;
    let rowsRejected = 0;
    let rowsSkipped = 0;
    let duplicateRows = 0;
    let incompleteRows = 0;
    const rejectionReasons = {};
    const incompleteReasons = {};
    const seenRowSignatures = new Set();

    for (const table of offeringTables) {
      const tableRows = Array.from(table.querySelectorAll('tr'));
      if (tableRows.length < 2) continue;

      const headerResult = detectHeaders(tableRows, []);
      if (!headerResult) {
        // It was a registration-like table (findAllCourseTables), but its
        // columns could not be interpreted. Count each body row as rejected.
        const candidates = tableRows.slice(1);
        domRowsDetected += candidates.length;
        rowsScanned += candidates.length;
        rowsRejected += candidates.length;
        rejectionReasons['Unsupported table structure'] =
          (rejectionReasons['Unsupported table structure'] || 0) + candidates.length;
        continue;
      }

      tablesScanned++;
      const { headerIndex, columns } = headerResult;

      domRowsDetected += tableRows.length - (headerIndex + 1);
      rowsSkipped += (headerIndex + 1);

      for (let i = headerIndex + 1; i < tableRows.length; i++) {
        rowsScanned++;
        const rowText = (tableRows[i].textContent || '').trim().replace(/\s+/g, ' ');
        if (seenRowSignatures.has(rowText)) {
          duplicateRows++;
        } else {
          seenRowSignatures.add(rowText);
        }

        let parseRes;
        if (columns.courseCode !== undefined) {
          parseRes = parseRow(tableRows[i], columns);
          if (parseRes.success) {
            const metadata = metadataByCode.get(parseRes.data.courseCode);
            if (metadata) {
              parseRes.data.courseName = parseRes.data.courseName || metadata.courseName;
              parseRes.data.credits = parseRes.data.credits ?? metadata.credits;
              parseRes.data.courseStructure = parseRes.data.courseStructure || metadata.courseStructure;
            }
          }
        } else if (metadataByCode.size === 1) {
          const metadata = metadataByCode.values().next().value;
          const parsed = parseOfferingWithoutCourseCode(tableRows[i], columns);
          parseRes = parsed.success
            ? { ...parsed, data: { ...metadata, ...parsed.data } }
            : parsed;
        } else {
          parseRes = { success: false, reason: metadataByCode.size
            ? 'Offering cannot be associated unambiguously with a course'
            : 'Missing course code and course metadata' };
        }
        if (!parseRes.success) {
          rowsRejected++;
          rejectionReasons[parseRes.reason] = (rejectionReasons[parseRes.reason] || 0) + 1;
        } else {
          rowsAccepted++;
          if (parseRes.isIncomplete) {
            incompleteRows++;
            for (const reason of parseRes.incompleteReasons || []) {
              incompleteReasons[reason] = (incompleteReasons[reason] || 0) + 1;
            }
          }
          rows.push(parseRes.data);
        }
      }
    }

    if (rows.length === 0) {
      return {
        success: false,
        error: 'Offering rows were detected, but no rows could be associated with a course safely. Ensure one course is selected or that offering rows include course codes.',
        rows: [],
        tableCount: tablesScanned,
        domMetrics: { domRowsDetected, rowsScanned, rowsAccepted, rowsRejected, rowsSkipped, duplicateRows, incompleteRows, rejectionReasons, incompleteReasons }
      };
    }

    const sanitizedUrl = window.FFCSCore
      ? window.FFCSCore.sanitizeVtopUrl(window.location.href)
      : window.location.href;

    return {
      success: true,
      rawUrl: window.location.href,
      sanitizedUrl,
      pageTitle: document.title || 'Course Registration',
      detectedCategory,
      rows,
      tableCount: tablesScanned,
      domMetrics: {
        domRowsDetected,
        rowsScanned,
        rowsAccepted,
        rowsRejected,
        rowsSkipped,
        duplicateRows,
        incompleteRows,
        rejectionReasons,
        incompleteReasons
      }
    };
  }

  function parseOfferingWithoutCourseCode(row, columns) {
    const cells = row.querySelectorAll('td');
    if (cells.length === 0) return { success: false, reason: 'Empty row' };
    if (cells.length < 3) return { success: false, reason: 'Unsupported table structure (fewer than 3 cells)' };
    const rawSlot = cellValue(cells, columns, 'slot') || null;
    const rawAvailable = cellValue(cells, columns, 'available');
    const rawTotal = cellValue(cells, columns, 'totalSeats');
    return {
      success: true,
      isIncomplete: !cellValue(cells, columns, 'courseType') || !rawSlot,
      incompleteReasons: [
        ...(!cellValue(cells, columns, 'courseType') ? ['Missing component identification'] : []),
        ...(!rawSlot ? ['Missing slot'] : [])
      ],
      data: {
        componentType: normalizeCourseType(cellValue(cells, columns, 'courseType')),
        rawSlot,
        facultyName: cellValue(cells, columns, 'faculty') || null,
        venue: cellValue(cells, columns, 'venue') || null,
        availableSeats: rawAvailable || null,
        totalSeats: rawTotal || null,
        // The page's "Slot Status (with Registered Course)" is not a class status.
        classStatus: null,
        sourceOfferingId: cellValue(cells, columns, 'sourceOfferingId') || null
      }
    };
  }

  // ─── Message Listener ───────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'CHECK_PAGE_STATUS') {
      const tables = findAllCourseTables();
      sendResponse({
        isVtop: window.location.hostname === 'vtop.vitbhopal.ac.in' ||
          window.location.hostname === 'ffcs-demo.vercel.app' ||
          window.location.hostname === 'dev.vitbhopal.ac.in',
        hasRegistrationTable: tables.length > 0,
        tableCount: tables.length,
        detectedCategory: detectPageCategory()
      });
      return false;
    }

    if (msg.action === 'EXTRACT_PAGE_DATA') {
      const result = extractPageData();
      sendResponse(result);
      return false;
    }

    return false;
  });

  // Delay banner slightly to let VTOP ajax render tables
  setTimeout(injectBanner, 2000);
})();

