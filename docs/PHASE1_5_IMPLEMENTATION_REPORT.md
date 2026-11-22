# FFCS OS Phase 1.5 Implementation Report

**Status: IMPLEMENTED AND VERIFIED.** A new React, TypeScript, Vite, Tailwind, and Lucide frontend now runs from the existing Windows launcher and uses the existing API contracts. No Python optimizer or extension runtime behavior was changed.

## 1. Frontend architecture

- Added a Vite + React 18 + TypeScript app in `frontend/src/`.
- Added Tailwind/PostCSS configuration, Lucide icons, typed API models, a small fetch client, and localStorage-backed planner state. The UI is composed from typed page-level components in `App.tsx` with shared offering, timetable, and empty-state components.
- Vite outputs production files to `frontend/dist/`. The existing static server serves that directory on port 3000.
- The 42-slot UI data is generated from the authoritative `backend/data/slots.csv`; no slot codes or times were invented.
- `frontend/.gitignore` excludes local dependencies and production build output.

## 2. Files created or modified

- Created `frontend/package.json`, `frontend/package-lock.json`, Vite/TypeScript/Tailwind/PostCSS configuration, `.gitignore`, and the Vite `index.html` entrypoint.
- Created `frontend/src/App.tsx`, `App.test.tsx`, `main.tsx`, `index.css`, `types.ts`, `api/client.ts`, `utils/storage.ts`, `utils/validated-export.ts`, test setup, and `data/slots.json`.
- Modified `start.bat` to build the frontend before launching and serve `frontend/dist` at the existing port 3000. API remains at port 8080.
- Updated `README.md` with first-time frontend dependency setup, Vite development instructions, production build command, and frontend checks.
- Modified `tests/api.integration.test.js` to cover saving, listing, and deleting a timetable after exact-offering validation.
- Created this report. No backend runtime modules or extension runtime files changed.

## 3. API contracts used

- `POST /api/parse` with `{ "rawData": "<stringified extension JSON>" }`.
- `POST /api/optimize` with `{ subjects, preferences, topN }`. Manual validation uses `preferences.selectedOfferings` as a complete course-code-to-exact-offering-ID map. Mode and supported scheduling preferences are passed through unchanged.
- `GET /api/healthz` for the live API indicator.
- Existing timetable routes: `GET /api/timetables`, `POST /api/timetables` with `{ name, score, courses, grid }`, and `DELETE /api/timetables/:id`.
- No new API routes were introduced. The frontend source and generated bundle do not contain teacher-rating labels or controls.

## 4. Import and Course Workspace

Students can upload a JSON file or paste extension JSON. The frontend checks JSON syntax, sends it to `/parse`, displays parser errors/warnings and incomplete/invalid record counts, and replaces the current dataset instead of merging import sessions.

The searchable course catalogue filters by course type, selects/deselects required courses, expands every imported offering, and displays course code/title, credits, structure, component type, offering count, faculty, atomic slots, venue/building, seat state/count, missing metadata, and slot verification status. Selecting a course does not select faculty.

## 5. Slot Explorer

- Course-first exploration is available by expanding any course in Course Workspace.
- Slot-first exploration shows all 42 slots sourced from the official CSV, with day filtering and imported offering counts.
- Selecting a position displays every imported option occupying it. Empty positions remain empty.
- Unknown or unverified slot records remain visible in a separate section and are never treated as free.

## 6. Faculty selection and validation

Each offering is chosen by its exact `offeringId`. When all required courses have a choice, the frontend submits the complete `selectedOfferings` map to the existing optimizer. Schedule alternatives can also be generated first; choosing an alternative submits that alternative's exact IDs for full backend validation.

When an offering change conflicts, the frontend retains the previous selected map and validated timetable, shows the conflicting courses and exact slot codes, and does not replace the valid selection. The optimizer remains the validation authority for verified slots and planning/live seat rules. Preference changes and course changes invalidate prior validation. During a save or export check, the frontend submits the current complete map to `/optimize` again and verifies the returned course IDs match before proceeding.

## 7. Timetable generation and results

The builder supports `PLANNING` and `LIVE_REGISTRATION`, time preference, max gap, early-morning avoidance, and lunch preference. These correspond to existing optimizer input fields; no unsupported profile labels were added.

It displays backend alternatives, schedule score, gap/travel scores, faculty and venue details, imported seat-state warnings, and a weekly timetable. A compare control selects two alternatives for side-by-side course/faculty/slot/score inspection. Daily class-slot totals and free positions are derived from the selected timetable and the official 42-slot map.

## 8. Save and export safety

- Export creates a local JSON file containing the current timetable, exact `selectedOfferings`, mode, and validation timestamp.
- Save calls the existing `/api/timetables` route with the timetable returned from a fresh backend validation.
- Both actions require a complete current offering map, `selectionValid === true`, exact course-to-offering ID agreement, and a timetable covering all selected courses. Selection/preference changes clear that validation.
- The existing save route itself accepts a timetable payload and does not independently rerun optimization for arbitrary direct API callers. The UI always revalidates immediately before save/export; direct callers must follow the same validation contract.

## 9. Startup integration

`start.bat` now checks npm and installed frontend dependencies, runs `npm run build`, starts the existing API, and serves `frontend/dist` on port 3000. The Vite build succeeds and the static server returns the production HTML, JS, and CSS.

The final startup check ran `cmd.exe /c start.bat`. It reported “FFCS OS is ready”; frontend HTML, JS, and CSS each returned HTTP 200, and `/api/healthz` returned `ok`. The temporary services were stopped after verification.

## 10. Test evidence

Environment: Windows, Node.js 24.13.0, Python 3.12.10, pytest, Pydantic, and OR-Tools.

| Suite | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` (in `frontend/`) | Passed, no errors |
| Frontend workflow | `npm test -- --reporter=dot` (in `frontend/`) | 6 passed, 0 failed, 0 skipped |
| Production build | `npm run build` (in `frontend/`) | Passed; Vite produced `frontend/dist/` |
| Backend parser/data/optimizer | `python -m pytest backend/tests -q` | 33 passed, 0 failed, 0 skipped |
| Extension and extraction | `node --test tests/extension.test.js tests/content-extraction.test.js` | 31 passed, 0 failed, 0 skipped |
| API integration | `node --test tests/api.integration.test.js` | 1 passed, 0 failed, 0 skipped; covers parse, optimization, selected-offering validation, and timetable save/list/delete |

Frontend tests cover JSON parse failures, course search/filter, course selection, exact offering ID submission, clash rejection with previous choice preservation, all 42 positions and empty slots, save/export gating, exact-ID export data, and fresh validation before save.

## 11. Screenshots and browser verification

No screenshot is attached. Chrome/Chromium and Playwright/Puppeteer were not available in the environment. The UI was verified through component tests and the production HTTP startup smoke test, not a real interactive browser session.

## 12. Remaining limitations

- Real browser visual/responsive inspection and keyboard/screen-reader review remain outstanding.
- The backend save route does not independently validate arbitrary direct API save requests; the application performs a fresh backend optimization validation before calling it.
- Daily workload/free positions use the confirmed 42-position mapping and schedule grid; no cross-building walking-time claims are added by the frontend.
- Slot-extraction compatibility still relies on the existing extension fixtures; no live VTOP page was used in this milestone.
