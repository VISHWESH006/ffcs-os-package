# FFCS OS Phase 1.9 Implementation Report

## Final decision

**B. NOT READY FOR A STUDENT PILOT.** The actual MV3 extension now installs and operates in the installed Chrome build, and its `chrome.storage.local` data survived a Chrome process restart in the test profile. The browser tests used synthetic HTML served at the extension's permitted hostname. There is no sanitized real VTOP capture, so production extraction compatibility is still unverified. Chrome's runtime test installer also had to reinstall the extension with the same ID after restart; persistence of a user-installed extension registration across restart was not established by this automation.

## 1. Repository baseline

- Read `docs/PHASE1_8_IMPLEMENTATION_REPORT.md`, `docs/architecture.md`, and `README.md`, then inspected the current extension manifest/content/popup/core, API routes, persistence tests, Python parser/optimizer/models/data loader, frontend app/client/types/storage/validated-export, launcher scripts, package scripts, and generated API/frontend artifacts.
- No `.git` directory exists at the workspace or package root. There is no Git status or historical diff available.
- Phase 1.8 fixes are present in the active checkout: content table discovery uses header detection, popup storage failures are visible and recoverable, corrupt API stores fail closed, the API store has a platform data path, and frontend localStorage failures are visible.
- The extension is Manifest V3 and declares only `storage`, `activeTab`, and the VIT Bhopal VTOP host scope `https://vtop.vitbhopal.ac.in/*`. The manifest test verifies every referenced popup/script/icon exists. Chrome accepted the extension manifest during installation.
- The app launcher starts one local API process and one static frontend process. The JSON store performs synchronous reads/writes in that process; no multi-process coordination is claimed.
- No real VTOP capture, credentials, cookies, session identifiers, or private student data were available or used.

## 2. Phase 1.8 verification and environment

Environment: Windows 11, Node.js v24.13.0, npm 11.6.2, Python 3.12.10, Google Chrome 157.0.8103.51. The active Windows `LOCALAPPDATA` is `C:\Users\HPVICTUS\AppData\Local`.

The Phase 1.8 regression suites were rerun below; all passed. Added coverage in this phase raises the API suite to eight tests and adds a separate real-Chrome extension lifecycle command.

The earlier attempt to load the extension with `--load-extension` did not work because Chrome-branded builds removed that command-line switch beginning with Chrome 137. The installed Chrome is v157. I switched to Puppeteer's current extension installation API and added a pinned, test-only `puppeteer-core` dependency plus `npm run test:extension-chrome`. See [Chrome's extension news](https://developer.chrome.com/blog/extension-news-june-2025) and [Puppeteer's Chrome extension guide](https://pptr.dev/guides/chrome-extensions).

## 3. Real Chrome extension results

`npm run test:extension-chrome` ran the actual Chrome 157 executable with an isolated temporary profile. Puppeteer installed the actual `extension/` directory and Chrome loaded its popup and content script.

Verified in actual Chrome:

- Chrome accepted the MV3 manifest; the extension was listed as **FFCS OS — VTOP Bulk Extractor**, version 1.1.0. The static manifest test checks declared permissions/host scope and all referenced files.
- The popup opened without uncaught page errors. The content script ran on the permitted hostname.
- The popup was opened before the table existed, the synthetic DOM table was inserted, **Check page again** discovered it, and import collected it.
- A popup close/reopen restored the first import from real `chrome.storage.local`.
- A second synthetic page updated one matching native offering and added two distinct offerings. After the merge, storage held 2 courses, 4 offerings, and 2 page imports. The zero-seat and combined-slot values, source IDs, distinct offerings, and extension export payload were checked.
- After closing and restarting Chrome with the same temporary profile, Puppeteer reinstalled the same unpacked extension ID because its runtime installation is session-scoped. The stored collection was restored with both courses, all four offerings, and both import records. This verifies Chrome storage durability across browser process restart for that extension ID. It does not verify automatic retention of the extension installation by Chrome's normal Load unpacked UI.
- Clear Session removed the stored collection; popup reopen showed an empty session. New Session saved an empty collection and remained empty after another close/reopen.

The page bodies were synthetic HTML returned by request interception at the permitted VTOP hostname. This tests real Chrome extension injection and storage, but it is **not real VTOP evidence**. The Chrome storage failure paths were tested separately in the popup JSDOM suite with mocked Chrome APIs; actual quota/read/remove failures were not induced in Chrome.

## 4. Real VTOP compatibility evidence

No sanitized VTOP DOM capture was supplied or found in the repository. No live VTOP page was accessed. Existing Node fixtures cover supported header aliases and extraction bookkeeping; the new Chrome test covers asynchronous table insertion, `Sub Code`, nested content, combined slots, zero/blank seats, multiple offerings, duplicate native offering update, and preservation of distinct offerings. Those are synthetic cases only.

Created [VTOP_SANITIZED_FIXTURE_SPEC.md](VTOP_SANITIZED_FIXTURE_SPEC.md) with capture requirements, a suggested fixture layout, and redaction rules. It asks for original table structure and headers to be preserved while removing scripts, student information, credentials, cookies, URL tokens, and unrelated content. Pagination must be described as observed or unknown; it is not assumed.

**Live VTOP extraction compatibility remains unverified.** There is no evidence here about actual production table layouts, current header variations, page count/pagination, or VTOP's live asynchronous behavior.

## 5. Persistence concurrency and recovery

Expanded `tests/api.integration.test.js` to submit four simultaneous timetable saves: two different names and two identical names. Every save returned 201, all IDs were unique, same-name records followed the established behavior of remaining separate, and all canonical records were present. Then list, delete, another save, preference update, and optimizer history write overlapped. The final store contained the expected records and remained valid after restarting the API process; records and selected offering IDs were still readable.

Added `tests/fixtures/store-failure-hook.mjs`, loaded only by an isolated test subprocess when an explicit test environment variable is set. It injects temporary-file write and rename failures. The API returned 503; prior store bytes remained identical; temporary files were removed; after restart without the injected failure, the previous preferences were readable. Existing cases still cover empty/malformed/truncated/invalid stores, a directory at the store path, default-path legacy copy migration, and normal process restart.

Not tested: forced process termination between temp-file write and rename, OS-level read permission denial, actual filesystem rename failure outside injected failure, or multiple independent API processes writing one JSON file. The launchers start one API process. Multi-process access remains unsupported/unverified; no lock/database was added.

## 6. Cross-platform storage and launcher checks

- **Windows runtime:** verified. API tests ran on Windows. A default-path migration test ran with the actual Windows `process.platform` and an isolated `LOCALAPPDATA` test directory, creating `FFCS OS/ffcs_store.json` and retaining the legacy source. The current default resolves to `C:\Users\HPVICTUS\AppData\Local\FFCS OS\ffcs_store.json`. API tests use `FFCS_STORE_PATH` overrides and verify the override path is used.
- **Linux:** not run. The code resolves `${XDG_DATA_HOME:-~/.local/share}/FFCS OS/ffcs_store.json`, but this was reviewed statically. `wsl.exe --list --quiet` returned `Wsl/EnumerateDistros/Service/E_ACCESSDENIED`; no usable Linux runtime/container was available.
- **macOS:** not run. The code resolves `~/Library/Application Support/FFCS OS/ffcs_store.json`, reviewed statically only.
- **Launchers:** `cmd.exe /c start.bat` was executed after confirming ports 3000/8080 were free. Both API and frontend builds completed; `GET http://127.0.0.1:8080/api/healthz` returned 200 and `GET http://127.0.0.1:3000/` returned 200. The two processes started by that launcher were stopped afterward. `start.bat` sets `WORKSPACE_ROOT`, `PORT=8080`, and `NODE_ENV=production`; it inherits the Windows `LOCALAPPDATA` used for store resolution. `start.sh` was reviewed but not executed because WSL enumeration was denied; Bash was also inaccessible in this environment.
- Missing store creates an empty in-memory store; valid existing store, migration, malformed store, and failing writes are covered by automated tests. Legacy migration copies and retains the source file.

## 7. Complete student workflow evidence

No complete workflow using a real VTOP page can be claimed. Automated synthetic workflow coverage is split across these boundaries:

1. The real Chrome test extracts synthetic page rows, accumulates two pages in real Chrome storage, and checks the extension's export payload.
2. The Node API integration test passes extension-core-generated wrapped JSON through the actual API and Python parser/optimizer, checking course metadata, raw/atomic slots, offering IDs, seat states, unknown component/missing fields, and possible matches.
3. Playwright runs the frontend against the actual local API and Python subprocess. It imports synthetic data, selects exact offerings, handles a clash while preserving the prior valid choice, optimizes, validates, saves, reloads, exports, and deletes.

These checks verify the repository transformations and user workflow with synthetic data. They do not show that current VTOP page contents are extracted correctly or that one real VTOP export completes the entire flow without loss.

## 8. Defects reproduced and fixes

- **Extension did not load using the old test flags:** reproduced on Chrome 157; `--load-extension` and `--disable-extensions-except` did not register the extension. This was an automation/browser-version mismatch, not an application defect. Replaced that approach with Puppeteer's supported `browser.installExtension()` API and made the check reproducible as a test script.
- **Concurrent JSON-store updates:** four concurrent saves and overlapping list/save/delete/preferences/optimization-history requests were executed. No same-process lost update or corrupt store was reproduced; every requested record survived and the resulting records remained readable after API restart. No locking change was justified for the launcher's single-process deployment model.
- **Temp-file write and rename failures:** injected both failures into the real API subprocess. Existing store bytes remained unchanged, no temp file remained, the API returned 503, and the old preference value remained readable after restart. These tests found no product-code defect requiring another persistence change.
- **Live VTOP extraction defect:** neither reproduced nor ruled out. There was no sanitized real VTOP capture to test against, so no production compatibility claim is made.

## 9. Changes and tests added

- Added pinned test-only `puppeteer-core@25.17.0` and `npm run test:extension-chrome` for real Chrome extension install/injection/popup/storage testing. No app runtime dependency was added.
- Added `frontend/extension-e2e/real-chrome-lifecycle.test.mjs` using a disposable Chrome profile and synthetic intercepted pages.
- Expanded API integration coverage for simultaneous different-name and same-name saves; overlapping list/save/delete/preferences/history; and saved timetable retrieval after API restart.
- Added injected temp-write/rename failure coverage and a test-only hook, including data preservation and recovery after restart.
- Added [VTOP_SANITIZED_FIXTURE_SPEC.md](VTOP_SANITIZED_FIXTURE_SPEC.md), documented the Chrome test and data path in `README.md`.
- No scheduler logic, academic rules, extension permissions, API contracts, imported schema, or production persistence format were changed in Phase 1.9.

## 10. Exact regression results

Environment: Windows 11, Node.js 24.13.0/npm 11.6.2, Python 3.12.10, Chrome 157.0.8103.51. API/frontend builds ran outside the filesystem sandbox because esbuild parent-directory traversal was denied inside it.

| Exact command | Result |
|---|---|
| `python -m pytest backend/tests -q` | 37 passed, 0 failed. |
| `node --test tests/extension.test.js tests/content-extraction.test.js` | 34 passed, 0 failed, 0 skipped. |
| `node --test tests/api.integration.test.js tests/api.subprocess.test.js tests/api.store.test.js` | 8 passed, 0 failed, 0 skipped. |
| `cd frontend; npm ci` | Completed; 273 packages installed. |
| `cd frontend; npm run typecheck` | Passed. |
| `cd frontend; npm test -- --reporter=dot` | 9 passed, 0 failed. |
| `cd frontend; npm run build` | Passed; Vite built 1,585 modules. |
| `cd frontend; npm run test:e2e` | 2 Playwright web workflow tests passed; 2 popup JSDOM error/storage tests passed. |
| `cd frontend; npm run test:extension-chrome` | 1 real Chrome lifecycle test passed, 0 failed, 0 skipped. |
| `cd api-server; npm ci; npm run build` | Install completed; API bundle and source map built. |
| `cmd.exe /c start.bat` | Exit 0; API health and frontend returned HTTP 200. |

`npm install` reported 7 audit findings in the frontend dependency tree. `npm audit --omit=dev` could not reach the npm registry advisory endpoint, so the finding details and production-only status could not be verified. No audit-driven dependency changes were made.

## 11. Not tested or not verified

- Real VTOP page structure or expected extracted values.
- Automatic Chrome retention of a user-installed unpacked extension across browser restart; the Puppeteer runtime installation was re-applied under the same ID for the restart check.
- Real Chrome storage quota/read/remove failure. JSDOM mocks verify user-facing errors and retry/export recovery only.
- Linux/macOS runtime/path behavior; Linux access was blocked by WSL access denial and macOS was unavailable.
- Process kill during atomic persistence and multi-process store concurrency.
- A single end-to-end flow sourced from actual VTOP data.

## 12. Manual pre-pilot checklist

Do not invite students until each critical check passes:

- [ ] Install the unpacked `extension/` through `chrome://extensions` Developer mode in a clean Chrome profile. Confirm the extension is enabled, popup opens, and permissions are limited to the manifest declarations.
- [ ] On an authorized real VTOP account/page, compare the extension output with visible sanitized rows. Check every supported registration layout and any observed pagination/async rendering. Do not record account/session information.
- [ ] Import multiple real pages; close/reopen the popup and restart Chrome. Confirm session counts, history, duplicate updates, and distinct offerings remain intact.
- [ ] Exercise storage recovery with safe test conditions; confirm failures are visible, retry works, and export remains available for unsaved in-memory state.
- [ ] Export JSON and inspect course code/name, component, raw/atomic slots, offering ID, faculty, venue, seats, class status, and source metadata. Import it into FFCS OS and compare those values after parsing.
- [ ] Select exact offerings manually, validate a valid schedule, deliberately try a clash, and confirm the prior valid selection remains. Generate and compare alternatives.
- [ ] Save the validated timetable, restart the API/app, reload it, and export it. Confirm the exact selected IDs and canonical schedule remain.
- [ ] Review known limits with pilot participants: no established credit constraints or theory/lab pairing rules; no claim of current VTOP support until representative layouts are checked.
- [ ] Prepare support notes with app/Chrome versions and reproduction steps. Share only sanitized errors and fixtures; never request passwords, cookies, session IDs, or private student information.

## 13. Pilot readiness decision

**B. NOT READY FOR A STUDENT PILOT.** Chrome execution and extension storage lifecycle behavior are now covered with real Chrome and synthetic data, and persistence concurrency/failure recovery has stronger regression coverage. The production VTOP extractor has not been compared against any representative real page capture, and Chrome's ordinary user-installed extension registration was not observed surviving restart in this automation path. Complete the manual checks above with sanitized real VTOP evidence before inviting students.
