# FFCS OS — Intelligent Timetable Optimizer

An AI-powered, constraint-programming timetable optimizer for VIT Bhopal's
Fully Flexible Credit System (FFCS). Uses Google OR-Tools CP-SAT solver to
return the top-20 ranked schedules across millions of possible combinations.

## Architecture

```
monorepo/
├── artifacts/
│   ├── ffcs-os/          React + Vite frontend (7 pages)
│   └── api-server/       Node.js Express API (14 endpoints)
├── backend/              Python optimizer (OR-Tools CP-SAT)
│   ├── cli/              subprocess entry-points (parse, optimize, reference)
│   ├── data/             faculty_ratings.csv, buildings.csv, slots.csv
│   ├── models.py         Pydantic schemas
│   ├── parser.py         VTOP JSON validator
│   ├── optimizer.py      CP-SAT solver (hard + soft constraints)
│   ├── data_loader.py    in-memory CSV store
│   └── database.py       SQLite helpers (optional Python path)
├── browser-extension/    Chrome/Firefox Plasmo extension
├── lib/
│   ├── api-spec/         OpenAPI 3.1 spec
│   ├── api-client-react/ React Query hooks (auto-generated)
│   ├── api-zod/          Zod schemas (auto-generated)
│   └── db/               Drizzle ORM (schema stubs)
└── docs/                 Architecture + API docs
```

## Running locally

```bash
pnpm install           # install all deps
# Start frontend (http://localhost:PORT)
pnpm --filter @workspace/ffcs-os run dev
# Start API server (http://localhost:8080)
pnpm --filter @workspace/api-server run dev
```

Python deps installed globally (no venv):
```
fastapi uvicorn ortools pydantic openpyxl fpdf2 aiosqlite aiofiles
```

## Data flow

1. User pastes VTOP JSON from browser extension → `POST /api/parse`
2. Set preferences → `PUT /api/preferences`
3. Run optimizer → `POST /api/optimize` → spawns `python -m backend.cli.optimize_cli`
4. Browse top-20 timetables on Results page
5. Save favourites → `POST /api/timetables`

## Faculty selection

Faculty names remain visible. Students choose faculty from returned timetable alternatives; faculty ratings do not affect timetable feasibility, scoring, or ranking. Faculty reference data remains available through the faculty lookup endpoint.

## Key design decisions

- All data stays local (no cloud, no VTOP credentials stored)
- CP-SAT model: one integer variable per subject (index into faculty options)
- Scheduling preferences rank distinct timetable alternatives; faculty ratings do not affect scores or ranking
- Node.js API server persists preferences/timetables/history to the platform temporary directory

## User preferences

- Never scrape faculty ratings from the internet — always use `backend/data/faculty_ratings.csv`
- Never store VTOP credentials anywhere
- All computation stays local until the user explicitly exports/shares
