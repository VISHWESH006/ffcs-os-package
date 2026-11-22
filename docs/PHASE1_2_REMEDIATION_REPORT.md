# FFCS OS Phase 1.2 Remediation Report

**Status: PARTIALLY COMPLETE.** The extension data path, parser, data loader, optimizer, Node subprocess path, and Windows launcher are implemented and verified. The bundled frontend still contains teacher rating controls because the repository contains only compiled frontend assets and no frontend source; the request explicitly prohibits reconstructing source from compiled assets. Chrome popup close/reopen behavior was not exercised in a live browser.

## A. Implementation summary

- The package `extension/` is canonical: its README identifies it as the primary unpacked extension and `tests/extension.test.js` imports its core. The top-level `browser-extension/` was an older duplicate. Its core, content script, popup, HTML, and manifest were synchronized to the canonical package copy so both documented load locations use the same code.
- The extension already persisted `possibleMatches` in `chrome.storage.local` and exported them. Regression coverage now checks deduplication across repeated imports, JSON restoration, and export inclusion. Missing offering fields are recomputed on merge; course-level `missingFields` now covers title, credits, and course structure.
- DOM extraction records detected, scanned, accepted, rejected, skipped, duplicate, and incomplete rows. Rejections and incomplete data have separate reason maps. `courseStructure` is read using recognized headers and kept as source text. Missing component type remains unknown, and duplicate slots retain raw text while exposing deduplicated atomic slots and warnings.
- The parser accepts supported extension schema versions and legacy arrays, keeps incomplete offerings visible, normalizes known type aliases, preserves raw offering data and extraction metadata, and distinguishes `AVAILABLE`, `FULL`, and `UNKNOWN` seats. Malformed and unverified slots cannot be mistaken for verified slots. Duplicate course rows merge offerings by source identity or scheduling attributes without dropping different faculty, venues, or slots.
- DataStore loading uses the repository CSVs. Walking edges are limited to confirmed physical buildings, CR has no edges, unknown distances remain `None`, and the optimizer gives unknown distances a neutral score.
- The optimizer filters offerings with invalid/unverified slots or missing faculty with explicit reasons. Planning retains zero and unknown seats; live registration excludes both. Required courses with no eligible offering return an infeasibility explanation. Teacher ratings no longer affect optimization or returned course scores; tied faculty offerings are surfaced as separate timetable alternatives.
- The available Node API source is absent, but `api-server/dist/index.mjs.map` includes route source text. The actual bundled API was repaired: its default workspace root now resolves to the package root, subprocess errors include module/exit details, and the store defaults to the platform temp directory. The API integration test leaves `WORKSPACE_ROOT` unset to verify the real fallback.
- `start.bat` selects a real interpreter through PowerShell, excludes WindowsApps aliases, runs a version check, and passes `PYTHON_BIN`, `WORKSPACE_ROOT`, and `PORT` to Node. A small Node built-in static server replaces the launcher’s undeclared global `serve` dependency.

## B. Files changed

| Relative path | Change |
|---|---|
| `extension/extractor-core.js` | Course/offering missing-field recalculation, persisted conflict/export coverage support, and course structure missing-field tracking. |
| `extension/content.js` | DOM row metrics, rejection/incomplete reasons, and course structure extraction. |
| `extension/popup.js` | Display unknown component type without implying Theory. |
| `browser-extension/extractor-core.js` | Synchronized with canonical extension core. |
| `browser-extension/content.js` | Synchronized with canonical content extraction. |
| `browser-extension/popup.js` | Synchronized with canonical popup. |
| `browser-extension/popup.html`, `browser-extension/manifest.json` | Synchronized with canonical extension package. |
| `backend/parser.py` | Versioned, loss-aware parsing, slot and seat validation, aliases, partial-import reporting, source preservation, and offering deduplication. |
| `backend/models.py` | Correct unknown defaults, optional incomplete fields, extraction metadata, course structure, and validation counters. |
| `backend/data_loader.py` | Reject unconfirmed building edges and invalid negative distances. |
| `backend/optimizer.py` | Remove rating-based selection, keep unknown travel neutral, explain excluded options, and enumerate tied faculty alternatives. |
| `backend/tests/test_parser.py` | Tests for v1.5.0 multi-offering imports, zero/unknown seats, duplicate slots, matches, and incomplete records. |
| `backend/tests/test_data_loader.py` | Tests for missing headers, optional walking data, CR and unknown distances. |
| `backend/tests/test_scoring.py` | Replaced obsolete teacher-ranking tests with scheduling, seat, clash, and rating-neutrality tests. |
| `tests/extension.test.js` | Added possible-match persistence/export, missing-field update, zero-seat, unknown component, duplicate warning, and repeated-import checks. |
| `tests/content-extraction.test.js` | Added DOM extraction metrics, course structure, and rejection/incomplete reason coverage. |
| `tests/api.integration.test.js` | Added real Node API → Python CLI → DataStore → parser → optimizer test. |
| `api-server/dist/index.mjs` | Fixed project root, subprocess errors, and Windows-compatible store path. |
| `start.bat` | Verified interpreter selection, environment propagation, actionable dependency errors, and starts API plus frontend. |
| `scripts/serve-frontend.mjs` | Added a built-in static server for the existing compiled frontend. |
| `README.md` | Replaced obsolete teacher-scoring claims and updated test commands. |
| `docs/PROJECT.md`, `docs/api.md` | Updated optimizer/faculty descriptions for the rating-neutral contract. |
| `docs/PHASE1_2_REMEDIATION_REPORT.md` | This report. |

No files were deleted. Frontend source was unavailable, so the compiled frontend bundle was not rewritten.

## C. Data-flow verification

The verified request path is the existing `POST /api/parse` route. It sends `rawData` to `python -m backend.cli.parse_cli`, which loads `DataStore`, calls `parse_vtop_data`, and returns normalized subjects. The existing `POST /api/optimize` route sends those subjects to `python -m backend.cli.optimize_cli`, which loads the same references and calls the optimizer. The API writes optimization history to its platform-temp JSON store and returns timetable alternatives.

`tests/api.integration.test.js` starts the actual bundled API, leaves workspace-root detection at its default, submits a v1.5.0 wrapper, then submits the parsed subjects to `/optimize`. The Windows launcher was also started and both HTTP services responded.

## D. Data integrity behavior

- **Seats:** Positive count → `AVAILABLE`; zero → `FULL`; missing/null/invalid → `UNKNOWN`. Planning preserves all three; live registration accepts only confirmed positive counts.
- **Missing fields:** Offering and course fields are recalculated after merges. Zero is not missing. Incomplete records remain visible and carry warnings/missing-field metadata.
- **Duplicates and conflicts:** Matching source IDs update the corresponding offering. If IDs conflict, records stay distinct. Without matching IDs, component, atomic slots, faculty, and venue define the composite identity. Different faculty, venues, and slot combinations remain options.
- **Possible matches:** Collection-level records retain each side’s identifiers, faculty, venue, reason, and import attempt; repeated conflicts are deduplicated and the records are exported.
- **Slots:** Original slot text is retained; valid tokens are expanded and deduplicated. Malformed, missing, unrecognized, or unverified codes cannot enter optimization. Duplicate tokens produce `DUPLICATE_SLOT_TOKEN` warnings.
- **Buildings/distances:** Building derivation is limited to AB01, AB02, LC, and AR. CR is nonphysical and has no walking edges. Unknown distance data has no optimizer advantage.

## E. Test evidence

All commands below ran on Windows with Node.js v24.13.0 and Python 3.12.10; Pydantic 2.14.3, OR-Tools 9.15.6755, and pytest 9.2.0 were available.

| Command | Result |
|---|---|
| `node --test tests/extension.test.js tests/content-extraction.test.js` | 31 passed, 0 failed, 0 skipped. |
| `python -m pytest backend/tests/test_parser.py -q` | 10 passed, 0 failed. |
| `python -m pytest backend/tests/test_data_loader.py -q` | 10 passed, 0 failed. |
| `python -m pytest backend/tests/test_scoring.py -q` | 6 passed, 0 failed. |
| `python -m pytest backend/tests -q` | 26 passed, 0 failed. |
| `node --test tests/api.integration.test.js` | 1 passed, 0 failed, 0 skipped. |
| `node --check tests/api.integration.test.js` plus checks of canonical and duplicate extension scripts and `api-server/dist/index.mjs` | All syntax checks passed. |
| `python -m py_compile backend/parser.py backend/models.py backend/data_loader.py backend/optimizer.py backend/cli/parse_cli.py backend/cli/optimize_cli.py` | Passed. |
| `cmd /c start.bat` | Launcher selected Python 3.12.10 and started API and frontend. HTTP health/static checks succeeded. |

## F. End-to-end evidence

Sanitized request shape submitted to the actual running API:

```json
{
  "rawData": "{\"schemaVersion\":\"1.5.0\",\"source\":\"FFCS_OS_VTOP_EXTENSION\",\"courses\":[{\"courseCode\":\"CSE1001\",\"courseTitle\":\"Example Course\",\"courseStructure\":\"L-T-P\",\"options\":[{\"facultyName\":\"Faculty A\",\"slots\":[\"A11\",\"A12\"],\"rawSlot\":\"A11+A12\",\"componentType\":\"Theory\",\"venue\":\"AB01-101\",\"availableSeats\":0,\"totalSeats\":60},{\"facultyName\":\"Faculty B\",\"slots\":[\"B11\"],\"rawSlot\":\"B11\",\"componentType\":\"Theory\",\"venue\":\"AB02-101\",\"availableSeats\":null,\"totalSeats\":null}]}]}"
}
```

`POST /api/parse` returned HTTP 200 with one course and two offerings (`FULL` and `UNKNOWN`); `POST /api/optimize` returned HTTP 200, `mode: PLANNING`, two feasible alternatives, and both faculty names. Rating fields were null. The integration test additionally verifies the default temp store is created on Windows.

## G. Remaining limitations

- The repository has no editable frontend source; only `frontend/assets/index-BiIN_y8_.js` and its CSS are present. The compiled UI still contains teacher-weight/difficulty/attendance controls and teacher-quality comparison labels. Backend optimization ignores these values and emits no ratings, but removing the visible controls safely requires the frontend source or an approved source-level frontend workflow. This definition-of-done item remains incomplete.
- Chrome itself was not driven in this environment. `chrome.storage.local` is the existing persistence mechanism and core persistence/export is tested through serialized session restoration, but popup close/reopen and browser restart were not manually verified.
- Actual VTOP pages were not available. DOM extraction was tested against a representative fake DOM; live VTOP header variations remain unverified.
- The Node API TypeScript source is absent. The bundled `dist/index.mjs` was changed directly and the existing route was exercised end-to-end; a source rebuild is not possible from this checkout.

## H. Manual Windows verification

1. Install Python 3.10+ and ensure `python` resolves to the intended interpreter in PowerShell.
2. Install backend requirements with that interpreter: `python -m pip install pytest pydantic ortools`.
3. Ensure Node.js is on `PATH`.
4. From `ffcs-os-package`, run `start.bat`. Confirm it prints the selected Python executable and starts both services.
5. Open `http://localhost:3000` and check `http://localhost:8080/api/healthz`.
6. Submit the downloaded extension JSON as `{ "rawData": "<JSON text>" }` to `POST http://localhost:8080/api/parse`.
7. Submit the returned `subjects` and `{ "mode": "PLANNING" }` to `POST http://localhost:8080/api/optimize`. Confirm zero and unknown seat options are retained in planning mode and inspect `excludedOfferings` for any rejected slot/faculty values.
8. Stop the API and frontend windows when finished.

## I. Next milestone recommendation

Restore or provide the frontend source, then remove teacher-rating controls and comparison UI, add explicit student faculty selection with full timetable revalidation, and run a browser-level popup persistence test against Chrome storage. The current milestone should remain marked **PARTIALLY COMPLETE** until those product and browser verification items are closed.
