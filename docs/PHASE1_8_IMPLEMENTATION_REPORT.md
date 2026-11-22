# FFCS OS Phase 1.8 Implementation Report

**Status: REPOSITORY FIXES IMPLEMENTED; NOT READY FOR A STUDENT PILOT.** Automated backend, extension-core, frontend, and real-browser web workflow checks pass. Live VTOP compatibility and the Chrome extension's real popup/browser-restart lifecycle remain unverified.

## Scope and baseline

- The active implementation is `ffcs-os-package/`; the adjacent `ffcs-os-package.zip` was compared by relative paths. The active tree has 12,842 files and the ZIP has 12,837; after stripping the package prefix, differences were limited to generated `.pytest_cache` entries. The package code was taken from the active checkout.
- The repository has no `.git` directory, so prior commits and a clean-tree comparison were unavailable. Existing application sources were inspected before changes.
- The supported extension target in `extension/manifest.json` is `https://vtop.vitbhopal.ac.in/*`. No live VTOP page, account, credentials, or session was used. Extraction fixtures are synthetic and do not prove compatibility with the current production VTOP DOM.
- The existing Chrome installation was available, but launching it with the unpacked extension did not register the extension in the test profile. Therefore no claim is made that Chrome popup persistence, popup close/reopen, or browser restart works end to end.

## Traced data flow

1. `extension/content.js` discovers registration tables and passes rows to `extension/extractor-core.js` for normalized fields, stable offering identity, duplicate handling, and session accumulation.
2. The popup serializes the session in `chrome.storage.local` and produces the wrapped export JSON. Import and collection operations are performed by the popup UI.
3. The frontend imports the wrapped JSON through `/api/parse`. The Python parser retains imported identity and source metadata, seat states, raw slots, unknown/incomplete records, and warnings. The optimizer validates exact offering IDs and confirmed slot clashes.
4. Save requests are reparsed and revalidated by the API before canonical results are persisted. The frontend reloads saved records through the API; validated export uses the currently selected offering map.

The Phase 1.7 real-browser tests exercise the student web application against the local Node API and Python subprocess. They do not load the Chrome extension. Phase 1.8 adds a Node/JSDOM test of the actual popup HTML/JavaScript and extension core with mocked Chrome APIs; it verifies UI error handling but not Chrome's implementation of extension storage.

## Confirmed defects and changes

Ranked by data-loss risk, correctness risk, and direct user impact:

1. **Critical data-loss risk:** `readStore()` could treat a damaged store as empty, allowing a later write to destroy recoverable records. Fixed with fail-closed validation and preservation (`api-server/src/routes/ffcs.ts:97-118`).
2. **High data-loss risk:** extension storage failures could appear as an empty session or successful change. Fixed with blocked actions, visible errors, retry, and export recovery (`extension/popup.js:86-164`, `extension/popup.js:455-479`).
3. **High persistence risk:** the default store used a temporary path. Fixed with platform application-data paths and copy migration (`api-server/src/routes/ffcs.ts:17-29`, `api-server/src/routes/ffcs.ts:97-105`).
4. **High import correctness risk:** frontend localStorage failures were swallowed, allowing fallback state to replace corrupt data. Fixed by preserving invalid data and pausing automatic writes (`frontend/src/utils/storage.ts:23-46`, `frontend/src/App.tsx:26-40`).
5. **Medium extraction risk:** registration table discovery used a literal header phrase and missed aliases accepted by its own parser. Fixed with shared header detection (`extension/content.js:81-93`).
6. **Medium timing/user impact:** a popup opened before async content rendered had no recheck action. Added a fresh status/extraction request (`extension/popup.html:175`, `extension/popup.js`, content message handler). Tests demonstrate the request behavior on synthetic DOM only, not real VTOP timing.

### Extension extraction and popup storage

- Table discovery required the literal phrase “course code” even though the header parser accepted aliases. Tables using `Sub Code` and `COURSE_CODE` could be missed. Discovery now uses the same normalized header detection and requires a course-code column plus slot or faculty column.
- A popup opened before a registration table finished rendering could retain its initial status. The popup now has **Check page again**, which requests a fresh status and extraction from the current DOM. The content script already reads the live DOM on request; no VTOP-specific timing assumption was introduced.
- Popup read failures previously looked like an empty collection and could be followed by an overwrite. Failed reads now block session-changing actions, show the error, and provide a retry action.
- Popup write/remove failures could be mistaken for successful collection changes. The popup now checks `runtime.lastError`, retains the in-memory collection for export after write failure, disables unsafe actions until recovery, and offers retry. A failed removal no longer reports “Collection cleared.”
- Manifest paths and declared host scope now have a regression test that checks the referenced popup, scripts, and icons exist.

### Backend persistence

- The default API store was a temporary `/tmp/ffcs_store.json` path, which is unstable across platforms and restarts. The default now uses platform application-data locations: `%LOCALAPPDATA%\\FFCS OS\\ffcs_store.json` on Windows, `~/Library/Application Support/FFCS OS/ffcs_store.json` on macOS, and `${XDG_DATA_HOME:-~/.local/share}/FFCS OS/ffcs_store.json` on Linux. `FFCS_STORE_PATH` overrides the location.
- On first use, when the new path is absent, a valid legacy `/tmp/ffcs_store.json` is copied to the new path and the old file is retained. `FFCS_LEGACY_STORE_PATH` provides a test/migration override.
- Missing stores still initialize as empty. Unreadable, malformed, truncated, structurally invalid, or unwritable stores now fail closed with a typed HTTP 503 response rather than silently returning an empty store or claiming a save succeeded. Failed reads/writes preserve the source file; temporary write files are cleaned up where possible.
- The frontend previously swallowed localStorage read/write errors. It now reports these failures. Malformed existing state is preserved and automatic writes pause, preventing fallback state from overwriting corrupt data. Write failures are visible and advise exporting current in-tab changes before refresh.

### API end-to-end preservation fixture

The Node API integration fixture is now generated through the extension's `createNewSession`, `mergePageImport`, and `buildExportPayload` functions. It follows the actual wrapper into `/api/parse` and checks exact/native identities, metadata, raw and atomic slots, seat states including zero and unknown, possible matches, unknown component data, and missing-field reporting. This validates the repository serialization boundary using synthetic records; it is not a live-page extraction test.

No changes were made to teacher ratings, theory/lab pairing, credit requirements, or other unverified academic policy.

## Files changed

- `extension/content.js`, `extension/popup.html`, `extension/popup.js`
- `tests/content-extraction.test.js`, `tests/extension.test.js`, `tests/api.integration.test.js`, new `tests/api.store.test.js`
- `api-server/src/routes/ffcs.ts`, `api-server/src/routes/index.ts`; regenerated `api-server/dist/index.mjs` and source map
- `frontend/src/utils/storage.ts`, `frontend/src/App.tsx`, `frontend/src/App.test.tsx`
- New `frontend/extension-e2e/popup-storage.test.mjs`; `frontend/scripts/test-e2e.mjs` now runs it with the existing browser suite
- `docs/architecture.md` and this report

## Verification evidence

Commands were run from `ffcs-os-package/` unless noted. API and frontend build/test tooling needed to run outside the filesystem sandbox because esbuild was denied parent-directory traversal inside it.

| Command | Result |
|---|---|
| `cd api-server; npm ci; npm run build` | Install succeeded; API bundle and source map built. |
| `python -m pytest backend/tests -q` | 37 passed. |
| `node --test tests/extension.test.js tests/content-extraction.test.js` | 34 passed. |
| `node --test tests/api.integration.test.js tests/api.subprocess.test.js tests/api.store.test.js` | 7 passed, 0 failed, 0 skipped. Includes actual Node API → Python CLI integration and store restart/corruption/write failure cases. |
| `cd frontend; npm run typecheck` | Passed. |
| `cd frontend; npm test -- --reporter=dot` | 9 passed. |
| `cd frontend; npm run test:e2e` | Production build passed; 2 Playwright web workflow tests passed in installed Chrome; 2 popup JSDOM tests passed. |

The Chrome browser suite verifies the web planner's import, exact selection, clash handling with prior valid selection retention, optimization, save/reload/export/delete, and API error behavior. It is not an extension lifecycle test.

## Limitations and manual verification

The following still require an environment or evidence unavailable here:

- Load `extension/` as an unpacked extension in Chrome on a sanitized representative VTOP registration page. Confirm the content script runs only on the declared host and inspect extraction for each supported page layout.
- Open the extension popup before and after the registration table renders. Use **Check page again** and confirm rows and page counts update.
- Import multiple pages; close/reopen the popup and restart Chrome; confirm the accumulated collection survives and duplicate rows update without losing distinct offerings.
- Simulate extension storage quota/read/remove errors if the browser offers a safe test profile or mock; verify retry and export recovery.
- Export the collection, import it through the planner, select offerings, validate, save, reload, and export again. Compare course codes, offering IDs, slots, seats, and source metadata.
- Validate extraction against sanitized DOM captures from actual supported VTOP pages, preserving table headers and structural variation while removing names, IDs, session tokens, and private registration data. Include asynchronous rendering and pagination examples.

No live VTOP compatibility, no real Chrome extension storage lifecycle, and no browser restart persistence is claimed. The Node popup test uses the real popup UI code with mocked Chrome APIs; synthetic DOM tests cover the parser's supported aliases and data handling only.

Store verification covered process restart, copy migration, missing/corrupt/invalid files, and an unwritable directory path. It did not simulate OS read denial, temp-file creation failure, rename failure, or process termination mid-write. Existing integration coverage includes parallel same-name saves; multi-process API coordination is not implemented or claimed. The launchers start a local API process for the app; multiple independent API processes writing the same JSON store remain unsupported/unverified. Linux/macOS path behavior was reviewed from platform path logic, not executed there. Frontend localStorage read failure and write failure are unit-tested; real browser quota exhaustion and OS permission failure were not induced.

## Pilot readiness

**Not ready for a controlled student pilot yet.** The repository-driven defects above are fixed and the local web/API workflow is covered. Before a student pilot, first complete the manual Chrome popup/restart scenarios and validate the extractor against sanitized representative VTOP pages. Those checks establish whether the installed extension can persist collection state in Chrome and whether its current selectors match the real registration screens.
