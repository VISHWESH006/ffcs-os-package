# FFCS OS Phase 1.6 Implementation Report

**Status: SERVER AND FRONTEND HARDENING IMPLEMENTED; AUTOMATED REGRESSION PASSED.** Direct API saves now reparse imported source data and run the existing optimizer before persisting. Browser visual and lifecycle verification could not be performed because no Chromium browser or browser automation package is installed in this environment.

## 1. Files changed

- `api-server/dist/index.mjs` — server save validation and 10 MB JSON request limit.
- `backend/parser.py` — retain conflicting duplicate offering IDs separately so optimizer selection reports them as ambiguous; only merge repeated IDs when course component, atomic slots, faculty, and venue agree.
- `backend/tests/test_parser.py` — conflicting and repeated offering identity coverage plus a 300-course/600-offering import case.
- `backend/tests/test_data_loader.py` — verify frontend slot JSON exactly matches all 42 rows in `backend/data/slots.csv`.
- `tests/api.integration.test.js` — API rejection/non-persistence cases, large request import, canonical saved fields, and full save/list/delete verification.
- `frontend/src/App.tsx` — store original import JSON, invalidate stale requests after changes, prevent old responses from committing, and use the hardened save contract.
- `frontend/src/App.test.tsx` — save contract and rapid course-change stale-response regression.
- `frontend/src/api/client.ts` — send raw import, selected course codes, preferences, and exact offering IDs to save.
- `frontend/src/utils/storage.ts` — retain source import data with the planner state.
- `docs/api.md` — document the new save request and server behavior.
- `docs/PHASE1_6_IMPLEMENTATION_REPORT.md` — this report.

The API checkout has no editable `api-server/src` tree or build configuration; the runtime entrypoint is the checked-in bundle. The implemented route is therefore in `api-server/dist/index.mjs`. The source map still contains the previous embedded source and must be regenerated or updated if an API source/build tree is restored.

## 2. Root causes and fixes

### Server save integrity

The previous `POST /api/timetables` handler only checked that `name`, `score`, `courses`, and `grid` were present, then persisted those exact client values. It did not validate offering IDs, clashes, seat state, or course details.

The new request contract is `{ name, notes?, rawData, preferences, courseCodes, selectedOfferings }`. The API reparses `rawData`, ensures requested course codes are a distinct subset of parsed courses, ensures exactly one distinct ID per requested course, and runs the existing Python optimizer in selected-offering mode. Invalid imports or schedules return `422` without writing the store. The server stores the optimizer’s canonical score, course/faculty/slot/venue rows, and grid. Client-supplied schedule fields, validation flags, and timestamps are ignored.

The optimizer remains responsible for the existing authoritative slot verification, atomic slot clash checks, exact course/offering identity checks, and PLANNING/LIVE_REGISTRATION eligibility. No scheduling logic was changed. Repeated IDs with matching offering identity still merge as updates; conflicting identities now remain visible as ambiguous instead of being silently collapsed by the parser.

### Validation freshness

Validation and import callbacks previously had no request ordering guard. A delayed response could update planner state after a newer user action. Planner mutations and navigation now increment a revision; async results commit only if their revision and source-state snapshot still match. Superseded requests cannot replace the current selection or unlock validation-dependent actions. Course/preference changes clear validation immediately, while a failed offering candidate leaves the prior selection intact. Save and export still perform a fresh optimizer validation; save then sends the exact imported source and selection for independent server validation.

### Large request imports

The API used Express’s default JSON body limit. The JSON parser now accepts requests up to 10 MB, which is exercised with a 500-course/1,000-offering request fixture.

## 3. API contract and validation tests

The timetable save request changed from client timetable fields to source import data, requested course codes, preferences, and exact offering IDs. `GET`, `DELETE`, and the returned saved-record shape remain compatible.

The API integration test sends `selectionValid: true`, a forged timestamp, score, faculty, venue, and grid along with its requests. It verifies rejection and an unchanged saved list for:

- Two courses selecting the same atomic slot (`A11`).
- Unknown, stale, wrong-course, missing, and duplicate selected IDs.
- An unknown requested course.
- Conflicting duplicate IDs inside the imported offerings.
- An invalid slot code.
- A zero-seat offering in `LIVE_REGISTRATION`.

Each invalid attempt returns `422`; the saved timetable list remains empty. A valid save with forged client score/course/grid fields succeeds using the canonical optimizer result; assertions confirm the forged faculty, venue, and score did not persist. The test then lists and deletes the saved record and verifies the list is empty again.

## 4. Import and scheduling integrity

Coverage includes the wrapped v1.5.0 extension format, empty data, missing course metadata, multiple faculty options, duplicate offerings, malformed/unknown slots, zero/unknown seat states, possible matches, and large imports. The parser continues to retain rejected and incomplete record explanations. The browser/API integration successfully parses an import above 100 KB.

The regression suite also covers all 42 slot mappings against the backend CSV, combined atomic slot clashes, unverified slots excluded from optimization, PLANNING versus LIVE_REGISTRATION seats, exact selected offering IDs, rating-neutral scoring, and unknown/CR walking data remaining unknown. No extension runtime code changed.

## 5. Frontend freshness and accessibility review

Seven frontend tests pass, including a delayed validation response resolved after a rapid required-course change; the old result does not become the validated timetable. Existing tests continue to cover conflict rejection, preservation of the previous valid selection, clearing validation on preference changes, save/export gating, and exact selected IDs.

The source includes responsive layouts at 1100 px, 760 px, and 390 px breakpoints, horizontal scrolling for the timetable, visible `:focus-visible` styles, labeled form controls, and accessible names for navigation and offering controls. These are source-level checks only. No real desktop/mobile rendering, keyboard session, screen-reader review, contrast measurement, or modal behavior inspection was possible without a browser.

## 6. Browser end-to-end limitation

`Get-Command chrome,msedge,chromium,chromium-browser -ErrorAction SilentlyContinue` returned no browser executable. `npm ls --depth=0 playwright @playwright/test puppeteer` reported an empty dependency tree. Therefore no real-browser workflow or screenshot was produced. The actual running API was exercised by Node integration tests; frontend behavior was tested with Vitest/Testing Library and is not represented as browser verification.

## 7. Verification evidence

Environment: Windows PowerShell, Node.js 24.13.0, Python 3.12.10.

| Command | Result |
|---|---|
| `npm run typecheck` (from `frontend/`) | Passed |
| `npm test -- --reporter=dot` (from `frontend/`) | 7 passed, 0 failed |
| `npm run build` (from `frontend/`) | Passed; Vite production build completed |
| `python -m pytest backend/tests -q` | 37 passed, 0 failed |
| `node --test tests/extension.test.js tests/content-extraction.test.js` | 31 passed, 0 failed |
| `node --test tests/api.integration.test.js` | 1 passed, 0 failed; includes 500-course import and invalid save cases |
| `cmd.exe /c start.bat` | Passed; launcher built frontend and reported ports 3000/8080 |
| PowerShell `Invoke-WebRequest http://127.0.0.1:3000` and `Invoke-RestMethod http://127.0.0.1:8080/api/healthz` | Frontend HTTP 200 with built bundle; API status `ok` |

## 8. Remaining risks and limitations

- The server reparses the client-provided raw import as the source of course/offering details. There is no server-side VTOP catalog or authenticated import session in this repository, so the API cannot prove that the submitted JSON itself is authentic VTOP data. It does prevent clients from forging derived timetable rows, score, grid, or validation state independently of that import.
- The API handler was patched in the checked-in runtime bundle because editable API source and build configuration are absent. A restored source build must port this route and regenerate its source map and bundle; otherwise a later bundle rebuild could overwrite this hardening.
- Browser rendering, full keyboard/screen-reader accessibility, and popup lifecycle scenarios remain unverified because browser tooling is unavailable.
- Theory/lab linking and credit constraints remain outside the existing optimizer’s defined validation model.
