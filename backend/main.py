"""FastAPI standalone server for FFCS OS (optional — used for direct Python deployment).

For the Replit demo, the Node.js API server spawns Python CLIs as subprocesses.
This file lets you run the full Python backend directly with:
  uvicorn backend.main:app --reload --port 8001
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .data_loader import DataStore
from .database import get_preferences, init_db, save_preferences as _save_preferences
from .models import (
    OptimizeInput,
    OptimizeResult,
    ParseInput,
    ParseResult,
    PreferencesInput,
    Preferences,
)
from .optimizer import optimize
from .parser import parse_vtop_data


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    DataStore.load()
    await init_db()
    yield
    # Shutdown — nothing needed


app = FastAPI(
    title="FFCS OS API",
    version="1.0.0",
    description="Intelligent timetable optimizer for VIT Bhopal FFCS",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/healthz")
async def healthz():
    return {"status": "ok", "service": "ffcs-os-python"}


@app.post("/api/parse", response_model=ParseResult)
async def parse(body: ParseInput) -> ParseResult:
    return parse_vtop_data(body.rawData)


@app.post("/api/optimize", response_model=OptimizeResult)
async def optimize_route(body: OptimizeInput) -> OptimizeResult:
    return optimize(body)


@app.get("/api/preferences", response_model=Preferences)
async def get_prefs() -> Preferences:
    return await get_preferences()


@app.put("/api/preferences", response_model=Preferences)
async def save_prefs(body: PreferencesInput) -> Preferences:
    return await _save_preferences(body)


@app.get("/api/faculty/search")
async def faculty_search(q: Optional[str] = Query(None)):
    query = (q or "").lower()
    results = [
        f for f in DataStore.faculty_list
        if not query or query in f.name.lower()
    ]
    return {"faculty": [r.model_dump() for r in results]}


@app.get("/api/slots")
async def slots():
    return {"slots": [s.model_dump() for s in DataStore.slots]}


@app.get("/api/buildings")
async def buildings():
    return {"buildings": [b.model_dump() for b in DataStore.buildings]}
