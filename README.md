# FFCS OS

VIT Bhopal timetable planner with three deployment boundaries: a Vite frontend, one Node.js API + Python OR-Tools backend, and a Chrome extension package. The source lives in this repository under `frontend/`, `api-server/`, and `backend/`; no source relocation is required for separate deployment.

## Repository layout

```text
ffcs-os-package/
├── frontend/              React + TypeScript + Vite app; Vercel root
├── api-server/             Express API source, lockfile and build output
├── backend/                Python parser/optimizer, CLI modules, CSV data and pytest suite
├── extension-dev/          Unpacked test extension (development origins)
├── extension/              Production-only Manifest V3 source and packaging boundary
├── scripts/                Local frontend server and production extension packager
├── tests/                  API, parser/optimizer integration and extension tests
├── docs/                   Architecture, behavior and deployment reports
├── Dockerfile              Combined Render API + Python optimizer image
├── render.yaml             Render Blueprint for the API
└── frontend/vercel.json    Vercel build/output settings
```

Deployment audit and careful cleanup decisions are in [docs/DEPLOYMENT_AUDIT.md](docs/DEPLOYMENT_AUDIT.md) and [docs/CLEANUP_REPORT.md](docs/CLEANUP_REPORT.md). The optimizer behavior diagram is [docs/OPTIMIZATION_FLOW.md](docs/OPTIMIZATION_FLOW.md).

## Local development

Prerequisites: Node.js 20 or newer, Python 3.11 or newer, and npm. Runtime Python packages are in `backend/requirements.txt`.

Install dependencies once:

```powershell
python -m pip install -r backend/requirements.txt
cd api-server
npm ci
cd ../frontend
npm ci
cd ..
```

Windows quick start (builds the API and frontend and starts both local services):

```powershell
.\start.bat
```

Open `http://localhost:3000`. To develop the frontend with Vite, start the API first (the launcher starts a built static frontend), then run from `frontend/`:

```powershell
npm run dev
```

The Vite development server proxies `/api` to `http://127.0.0.1:8080`. The local API requires `PORT`; `start.bat` sets it to `8080` and selects Python. For manual API startup, build first with `npm run build` in `api-server`, set `PORT=8080`, `PYTHON_BIN` to the local interpreter, and `WORKSPACE_ROOT` to this repository root, then run `npm start` from `api-server`.

Local checks:

```powershell
python -m pytest backend/tests -q
node --test tests/api.integration.test.js
node --test tests/extension-dev-config.test.js tests/extension-dev-extraction.test.js
cd frontend
npm run typecheck
npm test
npm run build
```

## Vercel frontend deployment

Create a Vercel project for this repository and set its **Root Directory** to `frontend`. Use the Vite preset, Install Command `npm ci`, Build Command `npm run build`, and Output Directory `dist`. Set the public build-time variable `VITE_API_BASE_URL` to the Render API origin ending in `/api`, for example `https://<service>.onrender.com/api`. Set it for Production, Preview, and Development as needed, then redeploy. Never place backend secrets in a `VITE_*` variable.

Exact settings are recorded in [frontend/README.md](frontend/README.md) and `frontend/vercel.json`.

## Google sign-in, account data and analytics

Application routes and API features require a Google sign-in. Configure Firebase web and Admin credentials and the optional page-view-only GA4 measurement ID using the steps in [docs/AUTH_AND_PRIVACY.md](docs/AUTH_AND_PRIVACY.md). The API verifies Firebase ID tokens and scopes saved data to the verified UID. The JSON file store supports the current single API process; use a transactional shared database before running multiple API instances.

## Render backend deployment

The API and optimizer are one Docker web service; do not split them. The repository-root Dockerfile builds the Node API and installs the Python runtime and OR-Tools in the same image. Create a Render Blueprint from `render.yaml`, or create a Docker Web Service with the repo root as Docker context and `./Dockerfile` as Dockerfile. Set the exact Vercel production and preview origins in `CORS_ORIGINS` (comma-separated; no wildcard). Health check: `/api/healthz`.

Render supplies `PORT`; the container listens on `0.0.0.0`. `PYTHON_BIN=/opt/venv/bin/python` and `WORKSPACE_ROOT=/app` are set in the image/Blueprint. The API writes its JSON store to `/var/data/ffcs_store.json`. Render's service filesystem is ephemeral unless a persistent disk is attached, so saved planner data will not survive instance replacement without one. No disk or paid plan is provisioned in this repository.

See [backend/README.md](backend/README.md) for the deployment and persistence details. A Docker CLI was unavailable during this preparation, so local image build and container API smoke tests remain unverified.

## Chrome extension

`extension-dev/` remains the development copy for explicitly allowlisted testing hosts. Load it from `chrome://extensions` → **Developer mode** → **Load unpacked** for testing. Do not upload it to the Chrome Web Store.

`extension/` is a separate production build sourced from the complete development runtime. It keeps the extraction core unchanged and restricts both manifest access and popup activation to VTOP. Build the ZIP from the repo root:

```powershell
python scripts/package_extension.py
```

It validates Manifest V3, only the VTOP production host, referenced local assets, and writes `dist/ffcs-os-extension.zip` with `manifest.json` at ZIP root. The extension exports JSON and does not call the backend directly; the web planner uses `VITE_API_BASE_URL` after import. Instructions are in [extension/README.md](extension/README.md).

## Environment variables

See [.env.example](.env.example) for safe placeholders.

| Variable | Component | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | Frontend build | Public Render API URL ending in `/api` |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` | Frontend build | Public Firebase web-app configuration; not an Admin credential |
| `VITE_GA_MEASUREMENT_ID` | Frontend build | Optional GA4 measurement ID; analytics is disabled when empty |
| `PORT` | API | Render-assigned listen port; local default is `8080`, container default is `10000` |
| `CORS_ORIGINS` | API | Exact comma-separated browser frontend origins |
| `PYTHON_BIN` | API | Python executable override; highest priority |
| `WORKSPACE_ROOT` | API | Root used for Python module path and subprocess cwd |
| `FFCS_STORE_PATH` | API | Local JSON state file path; mount durable storage at its parent if needed |
| `FFCS_LEGACY_STORE_PATH` | API | Optional legacy JSON state file to migrate from on startup |
| `FFCS_PYTHON_TIMEOUT_MS` | API | Optional optimizer subprocess timeout |
| `FIREBASE_PROJECT_ID` | API | Firebase project used by Firebase Admin |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | API secret | Service account JSON; configure only in backend runtime, never commit or expose to Vite |
| `NODE_ENV`, `LOG_LEVEL` | API | Runtime mode and log verbosity |

No secrets are required by the current application. Vercel's frontend environment contains only the public API origin.

## Deployment blockers

- Build and run the Docker image in Docker or Render; Docker was unavailable locally.
- Choose a Render persistence plan/disk if saved data must survive instance replacement.
- Set actual Vercel/Render URLs in project settings and exact origins in `CORS_ORIGINS`.
