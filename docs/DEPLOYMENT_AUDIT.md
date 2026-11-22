# FFCS OS deployment audit (before deployment edits)

Audit date: 2026-11-22. Repository root: `ffcs-os-package/`; the parent directory also contains `ffcs-os-package.zip` and is not the Git root. The repository has a `.git` directory. Git status was read with an explicit safe-directory override because this workspace checkout is owned by a different Windows SID; no Git configuration was changed.

## Existing component boundaries

- **Frontend:** `frontend/`, React 18 + TypeScript + Vite 5. Entry is `frontend/src/main.tsx` loaded by `frontend/index.html`. Build is `npm run build` (`tsc -b && vite build`), output `frontend/dist/`. Frontend runtime dependencies are React, React DOM and Lucide; the remainder of `frontend/package.json` is build/test tooling. Lockfile: `frontend/package-lock.json`.
- **Frontend API connection:** `frontend/src/api/client.ts` uses `VITE_API_BASE_URL`; its current fallback is `http://localhost:8080/api`. This is the only production code URL that needs environment-based configuration. No backend credential is included in frontend source.
- **Node API:** `api-server/src/index.ts` is the server entry; `api-server/src/app.ts` mounts Express routes under `/api`; `api-server/src/routes/health.ts` exposes `GET /api/healthz`; `api-server/src/routes/ffcs.ts` has the other HTTP endpoints. `npm run build` runs `api-server/build.mjs` and bundles to `api-server/dist/index.mjs`. Runtime dependencies are cors, express, pino and pino-http; build dependency is esbuild. Lockfile: `api-server/package-lock.json`.
- **Python optimizer:** package `backend/`, invoked by the Node route using safe `spawn(PYTHON_BIN, ["-m", module])`, stdin JSON, and modules `backend.cli.parse_cli`, `backend.cli.optimize_cli`, and `backend.cli.reference_cli`. `WORKSPACE_ROOT` is the subprocess cwd/PYTHONPATH. Runtime data is read from `backend/data/{slots.csv,buildings.csv,faculty_ratings.csv}`. Runtime Python dependencies used by these paths are OR-Tools and Pydantic. There is no `requirements.txt`, pyproject, Dockerfile, or Docker ignore file. Current verification environment has Python 3.12.10, OR-Tools 9.15.6755, Pydantic 2.14.3 and Node 24.13.0. The API bundle targets Node 20.
- **Extension:** `extension-dev/` is the only extension directory in the checkout. Its MV3 manifest has VTOP plus explicit demo/dev hosts. The requested production `extension/` directory and production manifest/source are absent. Existing production extension tests refer to that missing directory. The development README itself records the missing production source. The extension exports JSON; its inspected scripts do not call the FFCS API.
- **Tests:** Python tests are in `backend/tests/`; API and dev-extension tests are under `tests/`; frontend Vitest and Playwright tests are under `frontend/`.

## Workflow and deployment-relevant findings

1. Frontend `parseImport` / `optimize` POST JSON to the configured `${API_BASE}/parse` and `/optimize` endpoints.
2. Node validates requests and spawns the Python CLI with `PYTHON_BIN` precedence. `selectPythonExecutable` chooses `python` on Windows, `.pythonlibs/bin/python3` when present on POSIX, otherwise `python3`.
3. The Python CLI loads `DataStore`, which resolves the CSVs relative to the backend package, runs parser/optimizer, and returns JSON to Node.
4. API requires Render's `PORT` and already has a `/api/healthz` endpoint. Saved user state is a local JSON file by default, configurable with `FFCS_STORE_PATH`; Render's local filesystem is ephemeral unless a persistent disk is mounted.
5. `api-server/src/app.ts` currently calls unrestricted `cors()`; production frontend-origin allowlisting is needed. No authentication/credentialed CORS is currently used.
6. Vercel can build from `frontend/` independently; set `VITE_API_BASE_URL` to the deployed Render API URL ending in `/api`. Vite's current dev server has no `/api` proxy.
7. `start.bat` and `start.sh` are local multi-process launchers, not deployment entrypoints. `PORT` is required by the API. The Render container should start the Node API and keep the Python package/data in the same image.
8. `frontend/assets/` and `api-server/dist/` contain generated/older build artifacts. The active Vite build writes `frontend/dist/`; the local launcher serves that directory. No asset deletion is justified by the current runtime references, so these artifacts are retained.

## Git state before deployment edits

The working tree was already dirty. Existing modified paths were:

`api-server/dist/index.mjs`, `api-server/dist/index.mjs.map`, `api-server/src/routes/ffcs.ts`, `backend/__pycache__/models.cpython-312.pyc`, `backend/__pycache__/optimizer.cpython-312.pyc`, `backend/models.py`, `backend/optimizer.py`, `backend/tests/__pycache__/test_scoring.cpython-312-pytest-9.2.0.pyc`, `backend/tests/test_scoring.py`, `extension-dev/README.md`, `extension-dev/content.js`, `extension-dev/manifest.json`, `extension-dev/popup.html`, `extension-dev/popup.js`, `frontend/src/App.test.tsx`, `frontend/src/App.tsx`, `frontend/src/index.css`, `frontend/src/types.ts`, `frontend/src/utils/storage.ts`, `tests/api.integration.test.js`, `tests/extension-dev-config.test.js`, and `tests/fixtures/ffcs_student_planner_synthetic_v1.5.0.json`.

Already-untracked paths were:

`docs/LUNCH_PREFERENCE.md`, `docs/OPTIMIZATION_FLOW.md`, `frontend/extension-e2e/dev-vtop-live.test.mjs`, and `tests/extension-dev-extraction.test.js`.

No files were moved or deleted for this audit. This report records the pre-deployment baseline; later edits must retain the above work.

## Deployment blockers to handle without guessing

- Production extension source is missing. Do not turn `extension-dev/` into a store package or claim a production ZIP is ready until the production source/manifest is recovered or the owner authorizes that source choice.
- Docker CLI is unavailable in the current environment, so a local image build/container smoke test may not be possible.
- Render's persistent-disk configuration and final Vercel/Render public URLs are owner deployment settings, not present in the repo.

## Implementation status after the baseline audit

- Production browser CORS is now restricted to exact `CORS_ORIGINS`; the API binds to `0.0.0.0`. Vite uses `/api` locally through a dev proxy and the deployed frontend takes its public API origin from `VITE_API_BASE_URL`.
- Added Vercel frontend configuration, a combined Node/Python Docker image, a Render Blueprint, runtime dependency pins, environment examples, local launcher settings, and deployment guides. No backend optimizer or parser business logic was changed for deployment.
- Added production extension packaging validation. It intentionally refuses to package `extension-dev/`; `extension/` has no production manifest/runtime source in this checkout, so there is no production ZIP to build.
- Updated the browser E2E flow to exercise the current UI and real Node API to Python parser/optimizer path. The legacy popup storage test now loads the existing development extension source because the production source is absent.
- No files were moved or deleted. Existing working-tree changes were retained.

Validation after these changes: frontend unit tests (10 passed), frontend browser E2E tests (2 passed), popup storage tests (2 passed), Python backend tests (59 passed), deployment-focused extension tests (10 passed), API/CORS and integration tests passed, and frontend/API builds passed. `npm run test:e2e` completed with all three stages passing. The broad legacy Node suite still has two test modules that import missing `extension/` production files; tests scoped to the available development extension passed. Docker image build, external Render/Vercel deployment, persistent storage, and production extension packaging remain unverified for the blockers above. No lint script is defined in the frontend or API package manifests.

## Production extension source recovery (2026-11-22)

The later controlled audit confirmed `extension-dev/` contains the complete MV3 extraction runtime: `manifest.json`, popup HTML/JS, content script, extraction core, and three referenced icons. It has no background worker, external API client, localhost service dependency, or development-only file dependency. Its popup extracts from the active tab, persists with `chrome.storage.local`, and exports the schema-1.5.0 JSON for the planner to import. The extraction core was copied byte-for-byte.

A separate `extension/` production copy now has VTOP-only host permissions and content matches, and its popup/content host checks also authorize only VTOP. `storage` and `activeTab` remain the required permissions. The production packaging script now successfully builds the eight referenced runtime files into `dist/ffcs-os-extension.zip`, with the manifest at ZIP root. The extension itself does not call the backend; the planner's public backend origin is configured through `VITE_API_BASE_URL`. The actual deployed Render URL is not in the repository and was not invented.

The historical baseline findings above describe the state before this recovery. The production-source blocker is resolved in the current checkout. The Docker build, external deployments, persistent disk, and Chrome Web Store submission remain unverified.
