"""SQLite database setup and helpers using aiosqlite."""
from __future__ import annotations

import json
import os
import aiosqlite
from pathlib import Path
from typing import Any, Dict, List, Optional

DB_PATH = Path(os.environ.get("DB_PATH", "/tmp/ffcs_os.db"))

CREATE_SQL = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS preferences (
    id      INTEGER PRIMARY KEY DEFAULT 1,
    data    TEXT    NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS saved_timetables (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT    NOT NULL,
    overall_score REAL    NOT NULL DEFAULT 0,
    course_count  INTEGER NOT NULL DEFAULT 0,
    timetable     TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS history (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_count  INTEGER NOT NULL DEFAULT 0,
    result_count   INTEGER NOT NULL DEFAULT 0,
    duration_ms    INTEGER NOT NULL DEFAULT 0,
    top_score      REAL    NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO preferences (id, data) VALUES (1, '{}');
"""


async def init_db() -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(CREATE_SQL)
        await db.commit()


async def get_preferences() -> Dict[str, Any]:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT data FROM preferences WHERE id = 1") as cur:
            row = await cur.fetchone()
            return json.loads(row[0]) if row else {}


async def save_preferences(data: Dict[str, Any]) -> Dict[str, Any]:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO preferences (id, data) VALUES (1, ?) "
            "ON CONFLICT(id) DO UPDATE SET data = excluded.data",
            (json.dumps(data),),
        )
        await db.commit()
    return data


async def list_timetables() -> List[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, title, overall_score, course_count, timetable, created_at "
            "FROM saved_timetables ORDER BY created_at DESC"
        ) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]


async def save_timetable(title: str, timetable: Dict[str, Any]) -> Dict[str, Any]:
    overall = timetable.get("score", {}).get("overall", 0)
    courses = timetable.get("courses", [])
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "INSERT INTO saved_timetables (title, overall_score, course_count, timetable) "
            "VALUES (?, ?, ?, ?) RETURNING id, created_at",
            (title, overall, len(courses), json.dumps(timetable)),
        )
        row = await cur.fetchone()
        await db.commit()
        return {
            "id": row[0],
            "title": title,
            "overallScore": overall,
            "courseCount": len(courses),
            "createdAt": row[1],
            "timetable": timetable,
        }


async def get_timetable(id: int) -> Optional[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, title, overall_score, course_count, timetable, created_at "
            "FROM saved_timetables WHERE id = ?", (id,)
        ) as cur:
            row = await cur.fetchone()
            if not row:
                return None
            d = dict(row)
            d["timetable"] = json.loads(d["timetable"])
            return d


async def delete_timetable(id: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("DELETE FROM saved_timetables WHERE id = ?", (id,))
        await db.commit()
        return cur.rowcount > 0


async def list_history() -> List[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, subject_count, result_count, duration_ms, top_score, created_at "
            "FROM history ORDER BY created_at DESC LIMIT 50"
        ) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]


async def add_history(subject_count: int, result_count: int,
                      duration_ms: int, top_score: float) -> Dict[str, Any]:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "INSERT INTO history (subject_count, result_count, duration_ms, top_score) "
            "VALUES (?, ?, ?, ?) RETURNING id, created_at",
            (subject_count, result_count, duration_ms, top_score),
        )
        row = await cur.fetchone()
        await db.commit()
        return {
            "id": row[0],
            "subjectCount": subject_count,
            "resultCount": result_count,
            "durationMs": duration_ms,
            "topScore": top_score,
            "createdAt": row[1],
        }


async def get_stats() -> Dict[str, Any]:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT COUNT(*) FROM saved_timetables") as cur:
            saved_count = (await cur.fetchone())[0]
        async with db.execute("SELECT COUNT(*), AVG(top_score) FROM history") as cur:
            row = await cur.fetchone()
            history_count, avg_score = row[0], row[1] or 0.0
    return {
        "savedCount": saved_count,
        "historyCount": history_count,
        "totalOptimizations": history_count,
        "avgTopScore": round(avg_score, 2),
    }
