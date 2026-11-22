# FFCS OS backend

The Node.js API and Python optimizer are deployed together. Node owns HTTP routing and safe subprocess execution; the Python CLI modules under `backend/cli/` run the parser, optimizer, and reference data commands. Optimizer inputs, outputs, constraints, and scoring remain unchanged by deployment setup.

`backend/main.py` is a separate legacy FastAPI entrypoint and is not used by the combined Docker service. The production image installs the Python dependencies required by the current CLI (`backend/requirements.txt`); running that legacy entrypoint requires its own dependency setup.

## Render Docker deployment

The repository root contains the Dockerfile and `render.yaml`. Create a Render Blueprint from the repository, or create a Docker Web Service with:

- **Dockerfile:** `./Dockerfile`
- **Docker context:** repository root
- **Health check path:** `/api/healthz`
- **Runtime environment:** Render supplies `PORT`; the image defaults to `10000` for local Docker.
- **`PYTHON_BIN`:** `/opt/venv/bin/python`
- **`WORKSPACE_ROOT`:** `/app`
- **`FFCS_STORE_PATH`:** `/var/data/ffcs_store.json`
- **`CORS_ORIGINS`:** comma-separated exact frontend origins, such as `https://planner.example.vercel.app`

The image installs Node 20, Python 3.11 from Debian Bookworm, the locked API npm dependencies, and Python requirements from `backend/requirements.txt`. The current Docker CLI is not available in this checkout environment, so the image has not been built locally. Validate the first Render build and confirm its Python wheels install before switching production traffic.

### Persistence

The API stores saved timetables/preferences in one local JSON file. Render container files are not durable across instance replacement unless a persistent disk is attached. The blueprint does not provision a disk or paid plan. If persistence across deploys is required, attach a disk mounted at `/var/data` in Render; otherwise expect the local store to reset when the instance is replaced.

### Local API checks

From repository root:

```sh
python -m pip install -r backend/requirements.txt
cd api-server
npm ci
npm run build
```

Start the built API with `PORT=8080`, `PYTHON_BIN=python` (Windows) or `python3` (macOS/Linux), and `WORKSPACE_ROOT` set to the repository root. Then check `GET http://localhost:8080/api/healthz` and exercise `/api/parse` and `/api/optimize`.

## Data files

The Docker context intentionally retains `backend/data/slots.csv`, `buildings.csv`, and `faculty_ratings.csv`. The optimizer CLI loads them from the Python package at runtime.
