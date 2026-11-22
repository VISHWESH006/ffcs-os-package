"""Pydantic models for FFCS OS API."""
from __future__ import annotations
from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field


# ─── Faculty & Subject ────────────────────────────────────────────────────────

class FacultyOption(BaseModel):
    facultyName: Optional[str] = None
    slotName: Optional[str] = None
    slot: str = ""                             # Normalized scheduling slot, e.g. "A11+A14"
    rawSlot: Optional[str] = None              # Original raw slot text from source
    slots: List[str] = Field(default_factory=list) # Atomic verified or raw tokens
    slotVerificationStatus: str = "MISSING_OR_INVALID"
    venue: Optional[str] = None
    building: Optional[str] = None
    room: Optional[str] = None
    seatsAvailable: Optional[int] = None
    availableSeats: Optional[int] = None
    totalSeats: Optional[int] = None
    seatState: str = "UNKNOWN"
    classStatus: Optional[str] = None
    courseType: Optional[str] = None
    componentType: Optional[str] = None        # Theory / Lab / Embedded Lab / UNKNOWN
    offeringId: Optional[str] = None
    sourceOfferingId: Optional[str] = None
    scopedSourceId: Optional[str] = None
    missingFields: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    raw: dict = Field(default_factory=dict)


class Subject(BaseModel):
    courseCode: str
    courseName: str
    category: Optional[str] = None
    credits: int
    courseType: Optional[str] = None   # Theory / Lab / Theory+Lab
    options: List[FacultyOption]
    courseStructure: Optional[str] = None
    source: dict = Field(default_factory=dict)


# ─── Parse ────────────────────────────────────────────────────────────────────

class ParseInput(BaseModel):
    rawData: str = Field(..., description="JSON string copied from browser extension")


class ParseResult(BaseModel):
    schemaVersion: Optional[str] = "1.5.0"
    subjects: List[Subject]
    errors: List[str]
    warnings: List[str]
    rejectedRecords: List[dict] = []
    possibleMatches: List[dict] = []
    totalParsed: int = 0
    invalidRecords: int = 0
    validIncompleteRecords: int = 0
    optimizerCompatibleRecords: int = 0
    extractionMetadata: dict = Field(default_factory=dict)


# ─── Preferences ──────────────────────────────────────────────────────────────

class PreferencesInput(BaseModel):
    mode: Literal["PLANNING", "LIVE_REGISTRATION"] = "LIVE_REGISTRATION"
    timePreference: Literal["morning", "evening", "balanced"] = "balanced"
    maxGap: Optional[int] = Field(default=2, ge=0)
    maxClassesPerDay: Optional[int] = 6
    # Course code -> stable offeringId from the extension export.
    selectedOfferings: Optional[Dict[str, str]] = None

    preferredFreeDay: Optional[str] = None
    avoidEarlyMorning: Optional[bool] = False
    walkingPriority: Optional[bool] = True
    dayScholar: Optional[bool] = False

    # Soft preference: favor schedules with 13:15 free, especially after 11:40 classes.
    mandatoryLunch: Optional[bool] = False
    # Legacy request field retained for older clients; lunch is now always soft.
    allowLunchFallback: Optional[bool] = False

    # ── Backward-compat fields (ignored by optimizer per Phase 1.2 remediation) ─
    teacherWeight: Optional[int] = None
    difficultyPreference: Optional[str] = None
    attendancePreference: Optional[str] = None
    teacherPriority: Optional[bool] = None
    prioritizeDifficulty: Optional[bool] = None
    prioritizeAttendance: Optional[bool] = None
    avoidSaturday: Optional[bool] = None


class Preferences(PreferencesInput):
    id: int = 1


# ─── Timetable ────────────────────────────────────────────────────────────────

class TimetableScore(BaseModel):
    overall: float
    teacherScore: float          # 0-100; -1 means no faculty data available
    gapScore: float              # 0-100
    travelScore: Optional[float] # 0-100; None when there are no verified transitions
    travelKnownTransitions: int = 0
    travelUnknownTransitions: int = 0
    lunchScore: float            # 0-100
    morningScore: float          # 0-100
    difficultyScore: float       # 0-100 (how well difficulty matches preference)
    attendanceScore: float       # 0-100 (how well leniency matches preference)
    preferenceMatch: float       # 0-100 (free day + early-morning + walking)
    conflictCount: int
    teacherDataAvailable: bool   # False when ALL faculty are unknown


class TimetableCell(BaseModel):
    day: str
    timeSlot: str
    slotCode: str
    courseCode: str
    courseName: str
    facultyName: Optional[str] = None
    venue: Optional[str] = None
    building: Optional[str] = None


class SelectedCourse(BaseModel):
    courseCode: str
    courseName: str
    facultyName: Optional[str] = None
    slot: str
    venue: Optional[str] = None
    building: Optional[str] = None
    credits: int
    offeringId: Optional[str] = None
    componentType: Optional[str] = None
    slots: List[str] = Field(default_factory=list)
    seatState: str = "UNKNOWN"
    # Faculty rating fields — None means "No ratings available"
    overallRating: Optional[float] = None
    reviewCount: Optional[int] = None
    difficulty: Optional[float] = None
    attendanceLeniency: Optional[float] = None
    internalMarks: Optional[float] = None
    wouldTakeAgain: Optional[bool] = None
    recommendedPercentage: Optional[float] = None
    lastUpdated: Optional[str] = None
    confidenceScore: Optional[float] = None  # min(reviewCount/50, 1.0)


class RankedTimetable(BaseModel):
    rank: int
    score: TimetableScore
    grid: List[TimetableCell]
    courses: List[SelectedCourse]


# ─── Optimize ─────────────────────────────────────────────────────────────────

class OptimizeInput(BaseModel):
    subjects: List[Subject]
    preferences: PreferencesInput
    topN: int = 20


class OptimizeResult(BaseModel):
    timetables: List[RankedTimetable]
    durationMs: int
    feasibleCount: int
    mode: str = "PLANNING"
    infeasibleExplanation: Optional[str] = None
    infeasibleCourses: List[str] = []
    excludedOfferings: List[dict] = []
    selectionValid: Optional[bool] = None
    selectionErrors: List[dict] = []
    selectionConflicts: List[dict] = []
    lunchPreferenceNote: Optional[str] = None
    policyFallbackNote: Optional[str] = None
    optimizationOptimal: bool = False
    # Deprecated compatibility fields; the optimizer no longer has fallback passes.
    lunchFallbackUsed: bool = False
    lunchFallbackExplanation: Optional[str] = None


# ─── Saved Timetable ──────────────────────────────────────────────────────────

class SaveTimetableInput(BaseModel):
    title: str
    timetable: RankedTimetable


class SavedTimetable(BaseModel):
    id: int
    title: str
    overallScore: float
    courseCount: int
    createdAt: str
    timetable: RankedTimetable


# ─── History ──────────────────────────────────────────────────────────────────

class HistoryEntry(BaseModel):
    id: int
    subjectCount: int
    resultCount: int
    durationMs: int
    topScore: float
    createdAt: str


# ─── Faculty ──────────────────────────────────────────────────────────────────

class FacultyRating(BaseModel):
    facultyName: str
    department: str
    overallRating: float                       # 1-5 scale
    reviewCount: int = 0
    difficulty: Optional[float] = None         # 1-5 (5 = very hard)
    attendanceLeniency: Optional[float] = None # 1-5 (5 = very lenient)
    internalMarks: Optional[float] = None      # 0-100 (typical internal marks given)
    wouldTakeAgain: Optional[bool] = None
    recommendedPercentage: Optional[float] = None  # 0-100
    academicBlock: Optional[str] = None
    floor: Optional[int] = None
    lastUpdated: Optional[str] = None


# ─── Reference ────────────────────────────────────────────────────────────────

class SlotDefinition(BaseModel):
    slotCode: str
    day: str
    timeStart: str
    timeEnd: str
    slotType: str


class Building(BaseModel):
    name: str
    floor: Optional[int] = None
    walkingPenalty: float = 0.0
    walkingTime: float = 0.0


class BuildingMetadata(BaseModel):
    code: str
    name: str
    isPhysical: bool = True
    description: Optional[str] = None


class WalkingDistance(BaseModel):
    fromBuilding: str
    toBuilding: str
    walkingMinutes: float


# ─── Stats ────────────────────────────────────────────────────────────────────

class DashboardStats(BaseModel):
    savedCount: int
    historyCount: int
    totalOptimizations: int
    avgTopScore: float
