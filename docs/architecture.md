# FFCS OS — System Architecture

## Overview

FFCS OS is a local-first timetable optimizer for VIT Bhopal's Fully Flexible
Credit System. Everything runs in the browser or on localhost — no data leaves
your machine.

```
┌──────────────────────────────────────────────────┐
│                  User's Browser                  │
│                                                  │
│  ┌────────────────┐   ┌──────────────────────┐  │
│  │  FFCS OS Web   │   │  Browser Extension   │  │
│  │  (React/Vite)  │◄──│  (Plasmo / Chrome)   │  │
│  └───────┬────────┘   └──────────────────────┘  │
│          │ HTTP                                  │
└──────────┼───────────────────────────────────────┘
           │
           ▼ localhost:8080
┌──────────────────────┐
│  Node.js API Server  │  (Express, port 8080)
│  (artifacts/api-     │
│   server)            │
│                      │
│  CRUD routes ──►  platform application-data/FFCS OS/ffcs_store.json (JSON)
│                      │
│  Parse/Optimize ──►  spawn Python subprocess
└──────────┬───────────┘
           │ stdin/stdout JSON
           ▼
┌──────────────────────┐
│  Python Backend      │  (Google OR-Tools CP-SAT)
│  (backend/)          │
│                      │
│  parser.py       CSV Data:
│  optimizer.py ──► faculty_ratings.csv
│  data_loader.py     buildings.csv
│                      slots.csv
└──────────────────────┘
```

## Components

### 1. Web Frontend (`artifacts/ffcs-os/`)

React 18 + Vite, Tailwind CSS v4, shadcn/ui, Wouter routing, TanStack Query.

**Pages:**
| Route | Purpose |
|-------|---------|
| `/` | Landing — project overview and feature list |
| `/import` | Paste VTOP JSON, parse, quick-optimize |
| `/preferences` | Configure all soft-constraint weights |
| `/results` | Browse top-20 ranked timetables |
| `/compare` | Side-by-side comparison of 2 saved timetables |
| `/saved` | Manage saved favourites |
| `/settings` | Theme and app settings |
| `/about` | Documentation and architecture |

**State management:** TanStack Query for server state; `AppContext` (React context + `localStorage`) for session state (parsed subjects, latest optimize result).

### 2. API Server (`artifacts/api-server/`)

Node.js 22 + Express 5. Handles all 14 REST endpoints. The compute-heavy
`/parse` and `/optimize` routes spawn Python subprocess via `child_process.spawn`
and exchange JSON over stdin/stdout. CRUD routes read/write
`platform application-data/FFCS OS/ffcs_store.json` (`FFCS_STORE_PATH` overrides this location). On first use, a valid legacy `/tmp/ffcs_store.json` is copied and retained. Corrupt or unreadable stores return an error and are preserved.

### 3. Python Optimizer (`backend/`)

Pure Python, no web framework required for subprocess use.

**Key modules:**
- `data_loader.py` — loads the three CSVs once at startup into singleton `DataStore`
- `parser.py` — validates the JSON array from the extension
- `optimizer.py` — CP-SAT model + scoring
- `cli/` — stdin→stdout wrappers called by Node.js

**CP-SAT Model:**

```
Variables:
  choice[i] ∈ {0 … |options[i]|-1}   one integer per subject

Hard constraints:
  ∀ i1≠i2, j1, j2: if slots(option[i1][j1]) ∩ slots(option[i2][j2]) ≠ ∅
      → NOT (choice[i1]=j1 ∧ choice[i2]=j2)
  if preferred_free_day set:
      ∀ i: choice[i] ≠ j  for all j that have class on that day

Objective (maximise, scaled ×1000):
  Σᵢ score(choice[i])

  score(option) = teacher_rating
               + seat_bonus
               − saturday_penalty
               − early_morning_penalty
               ± time_preference_bonus
               − walking_penalty
```

The solver runs with `enumerate_all_solutions=True` + 8s time limit, collecting up to 60 feasible solutions via callback. After solving, solutions are re-ranked by a detailed multi-factor score and the top-N returned.

### 4. Browser Extension (`browser-extension/`)

Plasmo framework (Chrome MV3 / Firefox MV2).

- **popup.tsx** — UI: scrape button, subject list, copy JSON
- **contents/vtop-detector.ts** — content script that detects the course registration table and shows a banner
- Scraping happens via `chrome.scripting.executeScript` (injected function)
- No VTOP credentials are ever accessed or stored

## Data Flow

```
VTOP page
  └─► extension scrapes table → JSON array
        └─► user copies JSON
              └─► Import page: POST /api/parse
                    └─► Python parser validates
                          └─► subjects stored in localStorage
                                └─► Preferences page: configure weights
                                      └─► POST /api/optimize
                                            └─► Python CP-SAT solver
                                                  └─► top-20 results
                                                        └─► Results page
                                                              └─► POST /api/timetables (save)
```

## Privacy

- No data is sent to any server outside localhost
- VTOP credentials are never requested, stored, or transmitted
- Faculty ratings come from the bundled `faculty_ratings.csv`, not scraped live
- All persistence is in `localStorage` (frontend) and `platform application-data/FFCS OS/ffcs_store.json` (backend)

