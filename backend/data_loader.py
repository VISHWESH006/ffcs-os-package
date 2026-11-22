"""Load and cache CSV reference data at startup.

All CSVs are read exactly once into memory dicts/lists.
"""
from __future__ import annotations

import csv
import math
import os
from pathlib import Path
from typing import Dict, List, Optional

from .models import FacultyRating, SlotDefinition, Building, BuildingMetadata, WalkingDistance

_DATA_DIR = Path(__file__).parent / "data"


class DataStore:
    """Singleton in-memory store for all CSV-backed reference data."""

    faculty_by_name: Dict[str, FacultyRating] = {}
    faculty_list: List[FacultyRating] = []
    slots: List[SlotDefinition] = []
    # slot_code -> list of (day, time_start, time_end) tuples
    slot_times: Dict[str, List[tuple]] = {}
    buildings: List[Building] = []
    # building_name -> Building
    building_map: Dict[str, Building] = {}

    CONFIRMED_BUILDINGS: Dict[str, BuildingMetadata] = {
        "AB01": BuildingMetadata(code="AB01", name="Academic Block 01", isPhysical=True),
        "AB02": BuildingMetadata(code="AB02", name="Academic Block 02", isPhysical=True),
        "LC": BuildingMetadata(code="LC", name="Lab Complex", isPhysical=True),
        "AR": BuildingMetadata(code="AR", name="Architecture Block", isPhysical=True),
        "CR": BuildingMetadata(code="CR", name="Classroom Placeholder", isPhysical=False, description="Unassigned / dynamic classroom"),
    }
    CONFIRMED_PHYSICAL_CODES = {"AB01", "AB02", "LC", "AR"}
    walking_matrix: Dict[tuple[str, str], float] = {}

    # Computed once at startup — used as the Bayesian prior mean
    global_avg_rating: float = 3.0

    @classmethod
    def load(cls) -> None:
        cls._load_faculty()
        cls._compute_global_stats()   # must follow _load_faculty
        cls._load_slots()
        cls._load_buildings()

    @classmethod
    def _compute_global_stats(cls) -> None:
        """Compute the global average OverallRating across all known faculty.

        Used as the prior mean in the Bayesian adjusted rating:
          AdjustedRating = (rating × n + global_avg × C) / (n + C)

        Computed once at startup; never re-reads the CSV.
        """
        ratings = [fr.overallRating for fr in cls.faculty_list if fr.overallRating]
        cls.global_avg_rating = sum(ratings) / len(ratings) if ratings else 3.0

    @classmethod
    def _load_faculty(cls) -> None:
        """Load faculty_ratings.csv into an O(1) lookup dict.

        CSV schema (v2):
          FacultyName, Department, OverallRating, ReviewCount, Difficulty,
          AttendanceLeniency, InternalMarks, WouldTakeAgain,
          RecommendedPercentage, AcademicBlock, Floor, LastUpdated
        """
        path = _DATA_DIR / "faculty_ratings.csv"
        cls.faculty_list = []
        cls.faculty_by_name = {}
        if not path.exists():
            return
        with open(path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                fr = FacultyRating(
                    facultyName=row["FacultyName"].strip(),
                    department=row["Department"].strip(),
                    overallRating=float(row.get("OverallRating") or 3.0),
                    reviewCount=_opt_int(row.get("ReviewCount")) or 0,
                    difficulty=_opt_float(row.get("Difficulty")),
                    attendanceLeniency=_opt_float(row.get("AttendanceLeniency")),
                    internalMarks=_opt_float(row.get("InternalMarks")),
                    wouldTakeAgain=_opt_bool(row.get("WouldTakeAgain")),
                    recommendedPercentage=_opt_float(row.get("RecommendedPercentage")),
                    academicBlock=row.get("AcademicBlock") or None,
                    floor=_opt_int(row.get("Floor")),
                    lastUpdated=row.get("LastUpdated") or None,
                )
                cls.faculty_list.append(fr)
                name_upper = fr.facultyName.upper()
                cls.faculty_by_name[name_upper] = fr
                import re
                stripped = re.sub(r"^(DR|PROF|MR|MS|MRS)\.?\s+", "", name_upper)
                if stripped and stripped not in cls.faculty_by_name:
                    cls.faculty_by_name[stripped] = fr
                dr_prefixed = f"DR. {stripped}"
                if dr_prefixed not in cls.faculty_by_name:
                    cls.faculty_by_name[dr_prefixed] = fr

    @classmethod
    def _load_slots(cls) -> None:
        path = _DATA_DIR / "slots.csv"
        cls.slots = []
        cls.slot_times = {}
        if not path.exists():
            return
        with open(path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                sd = SlotDefinition(
                    slotCode=row["SlotCode"].strip(),
                    day=row["Day"].strip(),
                    timeStart=row["TimeStart"].strip(),
                    timeEnd=row["TimeEnd"].strip(),
                    slotType=row["SlotType"].strip(),
                )
                cls.slots.append(sd)
                cls.slot_times.setdefault(sd.slotCode, []).append(
                    (sd.day, sd.timeStart, sd.timeEnd)
                )

    @classmethod
    def _load_buildings(cls) -> None:
        path = _DATA_DIR / "buildings.csv"
        cls.buildings = []
        cls.building_map = {}
        cls.walking_matrix = {}

        # Initialize confirmed physical buildings
        for code in cls.CONFIRMED_PHYSICAL_CODES:
            b = Building(name=code, floor=None, walkingPenalty=0.0, walkingTime=0.0)
            cls.buildings.append(b)
            cls.building_map[code] = b
            cls.walking_matrix[(code, code)] = 0.0

        if not path.exists():
            return

        with open(path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            headers = set(reader.fieldnames or [])
            required = {"FromBuilding", "ToBuilding", "WalkingMinutes"}
            if not required.issubset(headers):
                raise ValueError(
                    f"buildings.csv missing required headers. Expected {required}, found {reader.fieldnames}"
                )
            for row in reader:
                from_b = (row.get("FromBuilding") or "").strip().upper()
                to_b = (row.get("ToBuilding") or "").strip().upper()
                if not from_b or not to_b:
                    continue
                # CR is a non-physical placeholder. Exclude CR from walking matrix entirely.
                if from_b == "CR" or to_b == "CR":
                    continue
                if from_b not in cls.CONFIRMED_PHYSICAL_CODES or to_b not in cls.CONFIRMED_PHYSICAL_CODES:
                    continue
                try:
                    mins = float(row.get("WalkingMinutes") or 0)
                except (ValueError, TypeError):
                    continue
                if not math.isfinite(mins) or mins < 0:
                    continue
                cls.walking_matrix[(from_b, to_b)] = mins

    @classmethod
    def get_walking_minutes(cls, from_building: Optional[str], to_building: Optional[str]) -> Optional[float]:
        """Return verified walking minutes between two buildings.
        
        Returns:
            0.0 if same confirmed physical building.
            float minutes if verified in distance matrix.
            None if unknown, missing, unconfirmed, or involves non-physical CR placeholder.
            (Unknown distances remain None and never provide an optimization advantage).
        """
        if not from_building or not to_building:
            return None
        fb = from_building.strip().upper()
        tb = to_building.strip().upper()
        if fb == "CR" or tb == "CR":
            return None
        if fb == tb and fb in cls.CONFIRMED_PHYSICAL_CODES:
            return 0.0
        return cls.walking_matrix.get((fb, tb))

    @classmethod
    def get_building_penalty(cls, venue: str, building: Optional[str]) -> float:
        """Legacy helper: returns 0.0 (no invented penalty)."""
        return 0.0


# ─── helpers ──────────────────────────────────────────────────────────────────

def _opt_float(val: Optional[str]) -> Optional[float]:
    if val is None or val.strip() == "":
        return None
    try:
        return float(val)
    except ValueError:
        return None


def _opt_int(val: Optional[str]) -> Optional[int]:
    if val is None or val.strip() == "":
        return None
    try:
        return int(float(val))
    except ValueError:
        return None


def _opt_bool(val: Optional[str]) -> Optional[bool]:
    if val is None or val.strip() == "":
        return None
    return val.strip().lower() in ("true", "1", "yes")
