# FFCS OS Phase 1.7 Implementation Report

**Status: IMPLEMENTED AND VERIFIED WITH EXPLICIT LIMITATIONS.** The API’s maintainable TypeScript source and repeatable build were recovered from its existing source map. The real student-facing frontend flow passed in installed Chrome against the built frontend and live local API. Academic constraints and import authenticity that the repository cannot establish are documented below.

## 1. API source and reproducible build

- Restored the API’s first-party TypeScript source under `api-server/src/` using `sourcesContent` in the checked-in `api-server/dist/index.mjs.map`. Recovered app setup, route registration, health, FFCS routes, logging, and entry point; the previous bundle patch is now represented in maintained source.
- Added `api-server/build.mjs`, a pinned, self-contained `api-server/package.json` and lockfile, and ignored `node_modules/`. `npm ci` followed by `npm run build` creates the Node ESM bundle and source map with source content.
- The Windows and shell launchers build the API before startup and check that its dependencies are installed. The README documents setup and build commands.
- The save route validates imports and selected IDs on the server, reruns parse and optimize, and persists only the canonical result. Client-supplied timetable rows, score, grid, timestamps, and validation flags are ignored. Store writes use a same-directory temporary file followed by rename; failed writes clean up the temporary file.
- The Python subprocess has a 30-second default timeout (configurable through `FFCS_PYTHON_TIMEOUT_MS`), bounded stdout/stderr, and explicit errors for spawn failure, nonzero exit, timeout, oversized output, and malformed JSON. Request and import sizes are bounded.

## 2. Browser verification

Playwright uses the installed Chrome channel. The test builds the production frontend with an isolated API base URL, starts the built Node API and a static frontend server, and exercises the UI against both services.

The main browser scenario imported a two-course fixture, inspected all 42 official slots, chose exact offerings, confirmed a valid combination, attempted a conflicting choice and observed that the previous valid choice remained, generated alternatives, saved a server-validated schedule, reloaded and found the saved record, exported the selected IDs and canonical courses, then deleted the record. A second scenario covered an empty import and a simulated API error. The mobile viewport checked all 42 slots and document width; desktop and mobile screenshots were captured.

- Desktop: [phase1_7-desktop.png](screenshots/phase1_7-desktop.png)
- Mobile: [phase1_7-mobile.png](screenshots/phase1_7-mobile.png)
- Automation: `frontend/e2e/student-workflow.spec.ts`, `frontend/playwright.config.ts`

The mobile scenario tests the responsive web app in Chrome. It does **not** load the Chrome extension, test popup close/reopen or browser restart persistence, or verify live VTOP pages.

## 3. API and persistence edge coverage

The Node integration tests exercise the built API and actual Python parser/optimizer. Added or extended cases cover:

- request body just below and above the 10 MiB Express limit;
- imports over 1,000 courses or 5,000 offerings;
- malformed raw JSON and combined atomic-slot clashes;
- unknown, stale, duplicate, missing, extra, and wrong-course offering IDs;
- live-registration saves with full or unknown seats, invalid slots, ambiguous duplicate IDs, and forged client timetable data;
- duplicate source course rows with matching offering identity;
- parallel same-name saves, list/get/delete, and simulated filesystem persistence failure;
- Python executable spawn failure and a forced subprocess timeout, including empty-store assertions.

## 4. Academic rules and data authenticity

### Established in this checkout

- The optimizer selects one offering for each requested course and enforces clashes between selected, verified theory slots. Combined slots are expanded into atomic positions for collision checks.
- Seat availability differs by mode: planning may retain full/unknown seats; live registration requires a known positive count.
- Credits and course structure are represented in parsed course metadata. Their presence does not mean the optimizer enforces a credit minimum/maximum or a theory/lab pairing rule.

### Not established by repository evidence

- No authoritative academic policy or source data in this checkout defines required theory/lab pairing, credit-load bounds, optional components, or treatment of repeated weekly sessions. These remain unresolved requirements; no scheduling rule was inferred or added.
- `rawData` is submitted by the browser and is the import trust boundary. The server reparses it and validates derived selections against it, but there is no authenticated VTOP session, server-held catalog, signature, or provenance proof. The API therefore cannot attest that an import is genuine VTOP data. It prevents a caller from independently forging derived timetable rows, scores, grids, or validation flags apart from the submitted import.
- Extension tests use synthetic DOM fixtures. No sanitized live VTOP page captures were available for compatibility testing.

## 5. Regression results

| Area | Command | Result |
|---|---|---|
| Frontend types | `cd frontend && npm run typecheck` | Passed |
| Frontend unit suite | `cd frontend && npm test -- --reporter=dot` | 7 passed |
| Frontend production build | `cd frontend && npm run build` (also run by E2E command) | Passed |
| Browser E2E | `cd frontend && npm run test:e2e` | 2 passed in installed Chrome |
| Backend | `python -m pytest backend/tests -q` | 37 passed |
| Extension and synthetic extraction | `node --test tests/extension.test.js tests/content-extraction.test.js` | 31 passed |
| API integration and subprocess failures | `node --test tests/api.integration.test.js tests/api.subprocess.test.js` | 3 passed, 0 skipped |
| API production build | `cd api-server && npm run build` | Passed; emits `dist/index.mjs` and `.map` |

## 6. Remaining verification limits

- Browser evidence covers the web app and local API, not extension popup lifecycle or browser restart persistence.
- Import authenticity requires a trusted source beyond a client-provided JSON payload. No VTOP server integration or authenticated capture mechanism exists here.
- Theory/lab links, credit rules, and repeated-session semantics need authoritative policy/data before they can be implemented as correctness constraints.
- A real VTOP DOM sample is still needed to establish extraction compatibility beyond synthetic fixtures.
