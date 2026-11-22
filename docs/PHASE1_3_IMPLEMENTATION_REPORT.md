# FFCS OS Phase 1.3 Implementation Report

**Status: PARTIALLY COMPLETE.** Student-selected offering validation is implemented in the existing optimizer API and covered by unit and Node-to-Python integration tests. Frontend implementation and real Chrome lifecycle verification remain blocked by missing frontend source and browser tooling.

## A. Repository inspection

- Read `docs/PHASE1_2_REMEDIATION_REPORT.md` and rechecked its main claims against the checkout.
- No `AGENTS.md` file was found in the repository tree.
- Neither the workspace root nor `ffcs-os-package` contains a `.git` directory. `git status` cannot run here, so there are no local branches or prior commits available for source recovery or a clean-tree comparison. Existing files were left in place.
- `frontend/` contains only `index.html`, `favicon.svg`, `robots.txt`, and built JS/CSS in `assets/`. It has no React/Vite/TypeScript source, package/build configuration, or frontend source map. The API bundle has a map, but it is not frontend source and was not used to reconstruct UI.
- The editable architecture is the extension in `extension/`, Python parser and optimizer in `backend/`, and the Node API entrypoint only as a generated bundle in `api-server/dist/`. The API `/optimize` route already forwards the preferences object to the Python CLI, so no route was needed.
- Inspected the frontend tree, extension popup and extraction core, API integration test, parser, optimizer, models, test suites, and Phase 1.2 report.

## B. Implementation

- Added `PreferencesInput.selectedOfferings`, a map of course code to exact offering ID.
- Parsing preserves an imported `offeringId`; if absent, it generates the extension-compatible canonical composite identity from normalized course code, component type, sorted atomic slots, faculty, and venue.
- The optimizer requires one selection for every requested subject when the map is supplied. It rejects unknown courses, missing selections, stale IDs, duplicate/ambiguous IDs, and selected offerings that fail slot, faculty, or mode-specific seat eligibility.
- Valid selections are constrained to the exact chosen offering and run through the existing full cross-course CP-SAT slot-clash validation. Planning continues to retain zero and unknown seats; live registration requires known positive seats.
- Results include `selectionValid`, `selectionErrors`, and `selectionConflicts`. Selected course results preserve offering ID, component type, atomic slots, and seat state.
- Documented the request contract in `docs/api.md` and added unit plus API integration coverage.
- No frontend assets, generated API bundle, or extension runtime behavior were changed. No files were deleted.

## C. Faculty selection

Offering identity is the exact imported ID or the extension's canonical composite identity. Selection by faculty name alone is not accepted. If the student changes a selected offering, sending the updated complete map to `/optimize` recalculates the whole schedule.

Example conflict response fields:

```json
{
  "selectionValid": false,
  "selectionErrors": [],
  "selectionConflicts": [
    {
      "courseCodes": ["CSE1001", "MAT1001"],
      "offeringIds": ["chosen-cse", "chosen-mat"],
      "slots": ["A11"],
      "reason": "SLOT_CLASH"
    }
  ]
}
```

On a conflict, no timetable is returned. A client must retain its prior valid selection itself; persistent selection state and confirmation UX are frontend responsibilities and are not implemented in this checkout. No new route was added. The existing timetable save endpoint is outside this selection validation path, so the absent UI must not treat an arbitrary save request as proof of a validated selection.

The current optimizer validates verified slots, cross-course clashes, and seat eligibility by mode. The available data/model does not establish theory-lab linking rules or hard credit constraints, and walking is not a hard validation constraint here. Those requirements remain unverified rather than being claimed as implemented.

## D. Frontend

- Teacher-rating control removal: **blocked**. The only frontend implementation is compiled JS/CSS; those assets were left untouched under the source-recovery restriction.
- Course-first and slot-first views, manual faculty selection UI, clash presentation, and previous-valid-selection preservation: **blocked**.
- The optimizer remains rating-neutral: ratings are not optimizer inputs, selected-course rating values remain null, and the regression suite checks distinct faculty choices receive equal scores.
- Legacy rating fields, rating lookup data, API documentation examples, and historical material remain in the repository. The active optimizer ignores legacy preference fields. They were not removed because the UI source and API source/schema are unavailable and the lookup endpoint/data may be compatibility surfaces.
- The official 42-slot mapping is retained and extension tests cover its confirmed-slot validation; a frontend view of all 42 positions could not be implemented.

## E. Extension

- The existing popup uses `chrome.storage.local`; extension tests exercise collection serialization/restoration, multi-page accumulation, repeated imports, deduplication, possible-match retention, and export data.
- A real Chrome/Chromium executable and Playwright/Puppeteer package were not available in the environment. The extension suite is a Node test of the extension core and serialized session state, **not** a real popup close/reopen or browser-restart test.
- Multi-page and export behavior passed in the automated core tests. Real browser persistence, popup lifecycle, and browser restart remain unverified. Synthetic DOM extraction fixtures do not prove live VTOP compatibility; no real VTOP DOM samples were available.

## F. Test evidence

Environment: Windows PowerShell, Node.js test runner, Python with pytest, Pydantic, and OR-Tools available.

| Suite | Exact command | Result |
|---|---|---|
| Backend parser/data/optimizer | `python -m pytest backend/tests -q` | 32 passed, 0 failed, 0 skipped (final rerun: `32 passed in 0.97s`) |
| Extension and synthetic DOM extraction | `node --test tests/extension.test.js tests/content-extraction.test.js` | 31 passed, 0 failed, 0 skipped (`ℹ tests 31`, `ℹ pass 31`) |
| Node API → Python integration | `node --test tests/api.integration.test.js` | 1 passed, 0 failed, 0 skipped (`ℹ tests 1`, `ℹ pass 1`) |

The integration test imports wrapped JSON through `/parse`, checks parser-generated IDs, requests optimizer alternatives, submits conflicting selected offerings and observes the exact course/slot conflict, then submits a non-conflicting selection and verifies the selected offering ID is returned. Ratings are null in the normal API result.

## G. End-to-end verification

Automated flow: wrapped extension-shaped JSON → `POST /parse` → parser-generated stable IDs and normalized subjects → ordinary `/optimize` alternatives → `/optimize` with a complete `selectedOfferings` map. A colliding selection returned `selectionValid: false`, `reason: SLOT_CLASH`, both course codes, and `A11`; changing to a non-conflicting offering returned `selectionValid: true` and that exact offering ID in the timetable. The test runs the actual Node API bundle and Python CLI subprocess.

## H. Remaining blockers

- Provide the original editable frontend source tree (React/Vite source, components, styles, package manifest and lockfile/build config), or a recoverable Git checkout containing it. Without it, teacher-rating UI removal and the student selection/exploration workflows cannot be implemented safely.
- Provide a Chrome/Chromium environment with extension loading and browser automation, or run the manual lifecycle scenarios from the Phase 1.2 report. Browser restart persistence has not been verified.
- Provide representative sanitized VTOP page captures or access to supported real VTOP pages to validate extraction variations beyond synthetic DOM fixtures.
- Define/import theory-lab links and credit rules if these are required as hard constraints for selection validation.
- UI-side preservation of the prior valid selection and guarding save/export on validation status remain blocked with the frontend source.

## I. Next milestone

Restore the editable frontend source and browser automation environment. Then connect the existing `selectedOfferings` request contract to the course/offering UI, preserve a prior valid selection when a new map conflicts, gate save/export on a successful complete validation, remove rating controls, and verify popup persistence in a real browser.
