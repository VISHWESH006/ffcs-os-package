"""OR-Tools CP-SAT timetable optimizer for FFCS OS.

The optimizer enforces verified slot compatibility and seat rules by registration mode, ranks schedules using timetable preferences, and returns distinct faculty alternatives. Faculty ratings do not affect feasibility, scoring, or ranking. Only confirmed distances between confirmed physical buildings are used.
"""
from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional, Tuple

# pyrefly: ignore [missing-import]
from ortools.sat.python import cp_model

from .data_loader import DataStore
from .models import (
    FacultyOption,
    OptimizeInput,
    OptimizeResult,
    PreferencesInput,
    RankedTimetable,
    SelectedCourse,
    Subject,
    TimetableCell,
    TimetableScore,
)

# ─── constants ────────────────────────────────────────────────────────────────

_DAYS_ORDER   = ["MON", "TUE", "WED", "THU", "FRI", "SAT"]
_DISPLAY_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
_DAY_DISPLAY  = dict(zip(_DAYS_ORDER, _DISPLAY_DAYS))

def _official_periods() -> List[Tuple[str, str]]:
    """Return the unique verified (start, end) periods in slots.csv order."""
    by_start: Dict[str, str] = {}
    for slot in DataStore.slots:
        by_start.setdefault(slot.timeStart, slot.timeEnd)
    return sorted(by_start.items(), key=lambda period: period[0])


def _clock_minutes(value: str) -> int:
    hours, minutes = value.split(":", 1)
    return int(hours) * 60 + int(minutes)

# ─── slot utilities ───────────────────────────────────────────────────────────

def expand_slot(slot_str: str) -> List[Tuple[str, str, str, str]]:
    """Expand 'A1+TA1' → list of (day, time_start, time_end, code)."""
    codes = [s.strip() for s in re.split(r"[+,/]", slot_str) if s.strip()]
    result = []
    for code in codes:
        for day, ts, te in DataStore.slot_times.get(code, []):
            result.append((day.upper(), ts, te, code))
    return result


def slots_clash(slot_a: str, slot_b: str) -> bool:
    """True if two slot strings share any (day, time_start) pair."""
    times_a = {(d, ts) for d, ts, _, _ in expand_slot(slot_a)}
    times_b = {(d, ts) for d, ts, _, _ in expand_slot(slot_b)}
    return bool(times_a & times_b)


# ─── timetable quality scoring ────────────────────────────────────────────────

def _score_gaps(options: List[FacultyOption], max_gap: int) -> float:
    """Score gap quality using a quadratic penalty for long idle gaps.

    Continuous classes score highest.
    30-60 min gaps (1 slot) are acceptable.
    2+ hr gaps are penalised quadratically — a 3-hr gap costs 4× a 1-hr gap.
    5-hr gaps cost far more than 5× a 1-hr gap (cubic tail).
    Returns 0-1.
    """
    period_index = {start: index for index, (start, _) in enumerate(_official_periods())}
    day_times: Dict[str, List[str]] = {}
    for opt in options:
        for d, ts, _, _ in expand_slot(opt.slot):
            day_times.setdefault(d, []).append(ts)

    total_penalty = 0.0
    total_classes = 0
    for times in day_times.values():
        sorted_times = sorted({time for time in times if time in period_index}, key=period_index.__getitem__)
        total_classes += len(sorted_times)
        for i in range(len(sorted_times) - 1):
            gap = period_index[sorted_times[i + 1]] - period_index[sorted_times[i]] - 1
            if gap == 0:
                continue
            if gap <= max_gap:
                total_penalty += gap * 0.5
            else:
                excess = gap - max_gap
                total_penalty += excess ** 2 + (max(0, excess - 3) ** 3) * 0.5

    if total_classes == 0:
        return 1.0
    # Scale against the largest possible number of official-period gaps.
    period_count = len(_official_periods())
    max_possible = total_classes * max((period_count - 1) ** 2, 1)
    return max(0.0, 1.0 - total_penalty / max_possible)


def _score_lunch(options: List[FacultyOption]) -> float:
    """Score lunch-break quality.

    Either lunch-adjacent period is a soft cost; occupying both adds a further
    same-day cost. The relationship is symmetric and never affects eligibility.
    """
    days_with_class: Dict[str, bool] = {}
    days_with_before: Dict[str, bool] = {}
    days_with_after: Dict[str, bool] = {}
    for opt in options:
        for d, ts, _, _ in expand_slot(opt.slot):
            days_with_class[d] = True
            if ts == "11:40":
                days_with_before[d] = True
            elif ts == "13:15":
                days_with_after[d] = True

    if not days_with_class:
        return 1.0
    penalty = sum(
        0.5 * bool(days_with_before.get(day))
        + 0.5 * bool(days_with_after.get(day))
        + 0.5 * bool(days_with_before.get(day) and days_with_after.get(day))
        for day in days_with_class
    )
    return max(0.0, 1.0 - penalty / len(days_with_class))


def _walking_metrics(options: List[FacultyOption]) -> Tuple[Optional[float], int, int]:
    """Penalise high walking distances between consecutive classes.

    IMPORTANT: Travel is calculated ONLY from verified walking distances between
    physical buildings (scraped opt.venue / opt.building).
    AcademicBlock and Floor from faculty_ratings.csv are NEVER used.
    Unknown movements and CR placeholder do not gain an optimization advantage.
    Returns 0-1.
    """
    schedule: List[Tuple[str, str, str]] = []
    for opt in options:
        # Only parser/model-confirmed building codes participate. A room label
        # such as AB305 or CR-008 is not sufficient evidence of a mapped route.
        b = opt.building if opt.building in DataStore.CONFIRMED_PHYSICAL_CODES else ""
        for d, ts, _, _ in expand_slot(opt.slot):
            schedule.append((d, ts, b))
    schedule.sort(key=lambda x: (_DAYS_ORDER.index(x[0]) if x[0] in _DAYS_ORDER else 99, x[1]))

    total_walking_minutes = 0.0
    transitions = 0
    unknown_transitions = 0
    for i in range(len(schedule) - 1):
        d1, _, b1 = schedule[i]
        d2, _, b2 = schedule[i + 1]
        if d1 == d2:
            mins = DataStore.get_walking_minutes(b1, b2)
            if mins is not None:
                total_walking_minutes += mins
                transitions += 1
            else:
                unknown_transitions += 1
                continue

    if transitions == 0:
        return None, 0, unknown_transitions
    avg_mins = total_walking_minutes / transitions
    return max(0.0, 1.0 - min(avg_mins / 10.0, 1.0)), transitions, unknown_transitions


def _score_walking(options: List[FacultyOption]) -> Optional[float]:
    return _walking_metrics(options)[0]


def _score_morning(options: List[FacultyOption], time_preference: str) -> float:
    """Score morning/evening balance against user preference. Returns 0-1."""
    morning, afternoon = 0, 0
    for opt in options:
        for _, ts, _, _ in expand_slot(opt.slot):
            if ts < "13:15":
                morning += 1
            else:
                afternoon += 1
    total = morning + afternoon
    if total == 0:
        return 0.5
    ratio = morning / total
    if time_preference == "morning":
        return ratio
    if time_preference == "evening":
        return 1.0 - ratio
    return 1.0 - abs(ratio - 0.5) * 2   # balanced: peak at 0.5


def _score_free_day(options: List[FacultyOption], preferred: Optional[str]) -> float:
    """1.0 if preferred free day has no classes, else 0.0."""
    if not preferred:
        return 1.0
    target = preferred[:3].upper()
    for opt in options:
        for d, _, _, _ in expand_slot(opt.slot):
            if d == target:
                return 0.0
    return 1.0


def _score_day_scholar_meetings(meetings: List[Tuple[str, str, str, str]]) -> float:
    """Softly prefer each teaching day to finish by 18:00, and earlier if possible.

    Finishing by 18:00 scores in the 0.9-1.0 range, with earlier finishes
    slightly preferred. Finishes after 18:00 score below 0.9 and decline
    linearly to zero at the latest official period end. The strong score change
    expresses the preference without turning 18:00 into an eligibility rule.
    """
    if not meetings:
        return 1.0

    periods = _official_periods()
    if not periods:
        return 1.0
    earliest_finish = min(_clock_minutes(end) for _, end in periods)
    latest_finish = max(_clock_minutes(end) for _, end in periods)
    preferred_finish = 18 * 60
    finishes_by_day: Dict[str, int] = {}
    for day, _, end, _ in meetings:
        finish = _clock_minutes(end)
        finishes_by_day[day] = max(finishes_by_day.get(day, 0), finish)

    before_span = max(preferred_finish - earliest_finish, 1)
    after_span = max(latest_finish - preferred_finish, 1)
    daily_scores = []
    for finish in finishes_by_day.values():
        if finish <= preferred_finish:
            score = 0.9 + 0.1 * (preferred_finish - finish) / before_span
        else:
            score = 0.9 * (latest_finish - finish) / after_span
        daily_scores.append(max(0.0, min(score, 1.0)))
    return sum(daily_scores) / len(daily_scores)


def _score_day_scholar(options: List[FacultyOption]) -> float:
    """Score daily finish times for the Day Scholar's soft 18:00 preference."""
    return _score_day_scholar_meetings(
        [meeting for opt in options for meeting in expand_slot(opt.slot)]
    )


# ─── composite timetable score ────────────────────────────────────────────────

def compute_score(
    selected: List[Tuple[Subject, FacultyOption]],
    prefs: PreferencesInput,
) -> TimetableScore:
    """Multi-dimensional TimetableScore for a candidate timetable.

    Teacher ratings are removed from optimization per Phase 1.2 remediation.
    Faculty information remains visible and under manual student control.
    Objective components:
      Gap Quality: 30%
      Preference Match: 25% (configured preferred free day and Day Scholar finish time)
      Travel Efficiency: 20% (verified building walking distances)
      Lunch Quality: 15%
      Morning/Evening Balance: 10%
    """
    options_only = [opt for _, opt in selected]
    mandatory_lunch = prefs.mandatoryLunch or False

    # ── sub-scores ────────────────────────────────────────────────────────────
    gap_score    = _score_gaps(options_only, prefs.maxGap if prefs.maxGap is not None else 2)
    travel_score, travel_known, travel_unknown = _walking_metrics(options_only)
    # Day Scholar and lunch are independent. Lunch is always a soft preference.
    lunch_score  = _score_lunch(options_only) if mandatory_lunch else 1.0
    morning_score= _score_morning(options_only, prefs.timePreference or "balanced")
    free_score   = _score_free_day(options_only, prefs.preferredFreeDay)

    # Only preferences that the user can currently select contribute here.
    # The retired early-class control and unsupported unconditional Saturday
    # penalty do not affect the score.
    pref_parts = []
    if prefs.preferredFreeDay:
        pref_parts.append(free_score)
    if prefs.dayScholar:
        pref_parts.append(_score_day_scholar(options_only))
    preference_match = sum(pref_parts) / len(pref_parts) if pref_parts else 1.0

    # Composite weighted score (0-100)
    available_weights = [(0.30, gap_score), (0.25, preference_match), (0.15, lunch_score), (0.10, morning_score)]
    if prefs.walkingPriority and travel_score is not None:
        available_weights.append((0.20, travel_score))
    weight_total = sum(weight for weight, _ in available_weights)
    overall_01 = sum(weight * score for weight, score in available_weights) / weight_total
    overall = round(min(overall_01, 1.0) * 100, 2)

    return TimetableScore(
        overall=overall,
        teacherScore=-1.0,  # Removed: manual student selection
        gapScore=round(gap_score * 100, 2),
        travelScore=round(travel_score * 100, 2) if travel_score is not None else None,
        travelKnownTransitions=travel_known,
        travelUnknownTransitions=travel_unknown,
        lunchScore=round(lunch_score * 100, 2),
        morningScore=round(morning_score * 100, 2),
        difficultyScore=50.0,
        attendanceScore=50.0,
        preferenceMatch=round(preference_match * 100, 2),
        conflictCount=0,
        teacherDataAvailable=False,
    )


# ─── grid / course builders ──────────────────────────────────────────────────

def build_grid(selected: List[Tuple[Subject, FacultyOption]]) -> List[TimetableCell]:
    cells = []
    for subj, opt in selected:
        for d, ts, te, code in expand_slot(opt.slot):
            cells.append(TimetableCell(
                day=_DAY_DISPLAY.get(d, d),
                timeSlot=ts,
                slotCode=code,
                courseCode=subj.courseCode,
                courseName=subj.courseName,
                facultyName=opt.facultyName,
                venue=opt.venue,
                building=opt.building,
            ))
    return cells


def build_courses(selected: List[Tuple[Subject, FacultyOption]]) -> List[SelectedCourse]:
    """Build course list with full faculty data for display.

    Faculty names stay visible; no rating lookup or faculty score is returned.
    """
    courses = []
    for subj, opt in selected:
        courses.append(SelectedCourse(
            courseCode=subj.courseCode,
            courseName=subj.courseName,
            facultyName=opt.facultyName,
            slot=opt.slot,
            offeringId=opt.offeringId,
            componentType=opt.componentType,
            slots=list(opt.slots),
            seatState=opt.seatState,
            venue=opt.venue,
            building=opt.building,
            credits=subj.credits,
            overallRating=None, reviewCount=None, difficulty=None,
            attendanceLeniency=None, internalMarks=None, wouldTakeAgain=None,
            recommendedPercentage=None, lastUpdated=None, confidenceScore=None,
        ))
    return courses


# ─── CP-SAT solution callback ─────────────────────────────────────────────────

class TimetableSolutionCallback(cp_model.CpSolverSolutionCallback):
    """Collect feasible solutions during enumeration."""

    def __init__(
        self,
        choice_vars: List[Any],
        subjects: List[Subject],
        option_lists: List[List[FacultyOption]],
        prefs: PreferencesInput,
        max_solutions: int = 20,
    ) -> None:
        super().__init__()
        self._choice_vars  = choice_vars
        self._subjects     = subjects
        self._option_lists = option_lists
        self._prefs        = prefs
        self._max_solutions = max_solutions
        self.solutions: List[Tuple[List[Tuple[Subject, FacultyOption]], TimetableScore]] = []
        self.visited = 0

    def _rank_key(self, selected: List[Tuple[Subject, FacultyOption]], score: TimetableScore) -> tuple:
        meetings = [meeting for _, option in selected for meeting in expand_slot(option.slot)]
        if self._prefs.timePreference == "morning":
            # Policy tier first: minimize post-lunch meetings, then sum the
            # verified end time of each teaching day's final class.
            late_count = sum(1 for _, start, _, _ in meetings if start >= "13:15")
            end_by_start = dict(_official_periods())
            daily_finish_minutes = []
            for day in _DAYS_ORDER:
                starts = [start for meeting_day, start, _, _ in meetings if meeting_day == day]
                if starts:
                    end = end_by_start.get(max(starts))
                    if end:
                        daily_finish_minutes.append(_clock_minutes(end))
            return (late_count, sum(daily_finish_minutes), -score.overall)
        if self._prefs.timePreference == "evening":
            fallback_count = sum(1 for _, start, _, _ in meetings if start < "13:15")
            late_fallback_count = sum(1 for _, start, _, _ in meetings if start == "10:05")
            return (fallback_count, late_fallback_count, -score.overall)
        return (-score.overall,)

    def on_solution_callback(self) -> None:
        selected = [
            (self._subjects[i], self._option_lists[i][self.Value(var)])
            for i, var in enumerate(self._choice_vars)
        ]
        score = compute_score(selected, self._prefs)
        self.visited += 1
        self.solutions.append((selected, score))
        self.solutions.sort(key=lambda item: self._rank_key(item[0], item[1]))
        if len(self.solutions) > self._max_solutions:
            self.solutions.pop()


# ─── main optimizer ──────────────────────────────────────────────────────────

def optimize(inp: OptimizeInput) -> OptimizeResult:
    """Run CP-SAT optimizer and return top-N ranked timetables.

    Explicit Modes:
      PLANNING: Preserves zero-seat and unknown-seat offerings for schedule simulation.
      LIVE_REGISTRATION: Only confirmed positive seats are eligible.

    Guarantees:
      - Required courses are never silently dropped; structured infeasibility explanations returned.
      - Unverified/unknown slots never bypass clash detection (excluded with explicit explanation).
      - Teacher scoring removed from CP-SAT objective and ranking; student manually chooses faculty.
    """
    start_ms = int(time.time() * 1000)
    prefs  = inp.preferences
    mode   = (prefs.mode or "LIVE_REGISTRATION").strip().upper()
    top_n  = min(inp.topN, 20)
    mandatory_lunch = prefs.mandatoryLunch or False
    selection_map = prefs.selectedOfferings

    if not inp.subjects:
        return OptimizeResult(
            timetables=[],
            durationMs=0,
            feasibleCount=0,
            mode=mode,
            infeasibleExplanation="No subjects provided for optimization."
        )

    selection_errors: List[Dict[str, Any]] = []
    selected_options: List[Tuple[Subject, FacultyOption]] = []
    if selection_map is not None:
        by_code = {s.courseCode.upper(): s for s in inp.subjects}
        normalized_selection = {str(code).upper(): offering_id for code, offering_id in selection_map.items()}
        for code in selection_map:
            if code.upper() not in by_code:
                selection_errors.append({"courseCode": code, "reason": "UNKNOWN_COURSE"})
        for code, selected_id in normalized_selection.items():
            subj = by_code.get(code)
            if subj is None:
                continue
            matches = [o for o in subj.options if o.offeringId == selected_id]
            if len(matches) != 1:
                selection_errors.append({
                    "courseCode": subj.courseCode,
                    "offeringId": selected_id,
                    "reason": "UNKNOWN_OFFERING" if not matches else "AMBIGUOUS_OFFERING",
                })
            else:
                selected_options.append((subj, matches[0]))
        if selection_errors:
            return OptimizeResult(
                timetables=[], durationMs=int(time.time() * 1000) - start_ms,
                feasibleCount=0, mode=mode, selectionValid=False,
                selectionErrors=selection_errors,
                infeasibleExplanation="One or more locked offerings could not be validated. Refresh the course data and review those selections.",
            )

    # ── Stage 1: Validate slots and filter by mode ────────────────────────────
    filtered_subjects: List[Subject] = []
    excluded_offerings: List[Dict[str, Any]] = []
    infeasible_courses: List[str] = []

    selection_by_code = {s.courseCode.upper(): opt for s, opt in selected_options}
    for s in inp.subjects:
        valid_options: List[FacultyOption] = []
        locked_option = selection_by_code.get(s.courseCode.upper())
        candidate_options = [locked_option] if locked_option is not None else s.options
        for opt in candidate_options:
            if not opt.facultyName or not opt.facultyName.strip():
                excluded_offerings.append({
                    "courseCode": s.courseCode,
                    "facultyName": None,
                    "slot": opt.rawSlot or opt.slot,
                    "reason": "Faculty name is missing; offering cannot be selected by the student."
                })
                continue
            # 1. Slot safety: unverified or malformed slots cannot bypass clash detection
            atomic_slots = opt.slots if opt.slots else [x.strip() for x in re.split(r"[+,/\s]+", opt.slot) if x.strip()]
            has_unverified = (
                opt.slotVerificationStatus in ("CONTAINS_UNVERIFIED", "MISSING_OR_INVALID")
                or not atomic_slots
                or any(t not in DataStore.slot_times for t in atomic_slots)
            )
            if has_unverified:
                excluded_offerings.append({
                    "courseCode": s.courseCode,
                    "facultyName": opt.facultyName,
                    "slot": opt.slot,
                    "reason": "Unverified or malformed slot code cannot be safely verified for timetable clash detection"
                })
                continue

            # Evening policy has a hard morning boundary. Combined offerings
            # containing any 08:30 meeting are not eligible.
            if prefs.timePreference == "evening" and any(start == "08:30" for _, start, _, _ in expand_slot(opt.slot)):
                excluded_offerings.append({
                    "courseCode": s.courseCode, "facultyName": opt.facultyName,
                    "slot": opt.slot,
                    "reason": "The Evening policy excludes offerings containing an 08:30 AM class.",
                })
                continue

            # 2. Seat availability by mode
            if mode == "LIVE_REGISTRATION":
                if (opt.seatsAvailable is not None and opt.seatsAvailable <= 0) or opt.seatState == "FULL":
                    excluded_offerings.append({
                        "courseCode": s.courseCode,
                        "facultyName": opt.facultyName,
                        "slot": opt.slot,
                        "reason": "No seats available (LIVE_REGISTRATION mode)"
                    })
                    continue
                if opt.seatState == "UNKNOWN" or opt.seatsAvailable is None:
                    excluded_offerings.append({
                        "courseCode": s.courseCode,
                        "facultyName": opt.facultyName,
                        "slot": opt.slot,
                        "reason": "Unknown seat count cannot be confirmed available (LIVE_REGISTRATION mode)"
                    })
                    continue
            else:
                # PLANNING mode: retain 0-seat and unknown options for pre-registration simulation
                pass

            valid_options.append(opt)

        if not valid_options:
            infeasible_courses.append(s.courseCode)
        else:
            filtered_subjects.append(Subject(
                courseCode=s.courseCode,
                courseName=s.courseName,
                category=s.category,
                credits=s.credits,
                courseType=s.courseType,
                options=valid_options
            ))

    # If any required course has no compatible offerings, do NOT silently drop it!
    if infeasible_courses:
        explanation = (
            f"Cannot schedule timetable: required course(s) {', '.join(infeasible_courses)} have no available "
            f"or verified offerings in {mode} mode."
        )
        return OptimizeResult(
            timetables=[],
            durationMs=int(time.time() * 1000) - start_ms,
            feasibleCount=0,
            mode=mode,
            infeasibleExplanation=explanation,
            infeasibleCourses=infeasible_courses,
            excludedOfferings=excluded_offerings,
            selectionValid=(False if selection_map is not None else None),
            selectionErrors=([
                {"courseCode": code, "reason": "OFFERING_NOT_ELIGIBLE"}
                for code in infeasible_courses if code.upper() in selection_by_code
            ] if selection_map is not None else []),
        )

    if not filtered_subjects:
        return OptimizeResult(
            timetables=[],
            durationMs=int(time.time() * 1000) - start_ms,
            feasibleCount=0,
            mode=mode,
            infeasibleExplanation="No valid course offerings available after validation.",
            excludedOfferings=excluded_offerings
        )

    model        = cp_model.CpModel()
    n            = len(filtered_subjects)
    option_lists = [s.options for s in filtered_subjects]

    # ── Decision variables ────────────────────────────────────────────────────
    choice_vars = [
        model.NewIntVar(0, len(option_lists[i]) - 1, f"choice_{i}")
        for i in range(n)
    ]

    # ── Stage 2: slot-clash hard constraint ───────────────────────────────────
    for i1 in range(n):
        for i2 in range(i1 + 1, n):
            for j1, opt1 in enumerate(option_lists[i1]):
                for j2, opt2 in enumerate(option_lists[i2]):
                    if slots_clash(opt1.slot, opt2.slot):
                        b1 = model.NewBoolVar(f"c_{i1}_{j1}_{i2}_{j2}_a")
                        b2 = model.NewBoolVar(f"c_{i1}_{j1}_{i2}_{j2}_b")
                        model.Add(choice_vars[i1] == j1).OnlyEnforceIf(b1)
                        model.Add(choice_vars[i1] != j1).OnlyEnforceIf(b1.Not())
                        model.Add(choice_vars[i2] == j2).OnlyEnforceIf(b2)
                        model.Add(choice_vars[i2] != j2).OnlyEnforceIf(b2.Not())
                        model.AddBoolOr([b1.Not(), b2.Not()])

    # ── Complete-assignment search ─────────────────────────────────
    # Enumerate feasible choices and rank by the complete timetable score.
    # No truncated CP-SAT objective pool can discard a globally better result.
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 8.0
    solver.parameters.num_workers = 1
    solver.parameters.enumerate_all_solutions = True
    callback = TimetableSolutionCallback(choice_vars, filtered_subjects, option_lists, prefs, max_solutions=top_n)
    status = solver.Solve(model, callback)
    all_solutions = callback.solutions
    optimization_optimal = status == cp_model.OPTIMAL

    duration_ms = int(time.time() * 1000) - start_ms

    if not all_solutions:
        selection_conflicts = []
        if selection_map is not None:
            for i, (left_subject, left_opt) in enumerate(selected_options):
                for right_subject, right_opt in selected_options[i + 1:]:
                    if slots_clash(left_opt.slot, right_opt.slot):
                        left_slots = left_opt.slots or [x.strip() for x in re.split(r"[+,/\s]+", left_opt.slot) if x.strip()]
                        right_slots = right_opt.slots or [x.strip() for x in re.split(r"[+,/\s]+", right_opt.slot) if x.strip()]
                        selection_conflicts.append({
                            "courseCodes": [left_subject.courseCode, right_subject.courseCode],
                            "offeringIds": [left_opt.offeringId, right_opt.offeringId],
                            "slots": sorted(set(left_slots).intersection(right_slots)),
                            "reason": "SLOT_CLASH",
                        })
        return OptimizeResult(
            timetables=[],
            durationMs=duration_ms,
            feasibleCount=0,
            mode=mode,
            infeasibleExplanation="No clash-free timetable combination exists across all requested courses and slot constraints.",
            excludedOfferings=excluded_offerings,
            selectionValid=(not selection_conflicts if selection_map is not None else None),
            selectionConflicts=selection_conflicts,
        )

    all_solutions.sort(key=lambda item: callback._rank_key(item[0], item[1]))

    timetables: List[RankedTimetable] = []
    for selected, score in all_solutions:
        candidate = RankedTimetable(
            rank=len(timetables) + 1,
            score=score,
            grid=build_grid(selected),
            courses=build_courses(selected),
        )
        if _schedule_final_valid(candidate, inp):
            timetables.append(candidate)
        if len(timetables) >= top_n:
            break
    if not timetables:
        return OptimizeResult(
            timetables=[], durationMs=duration_ms, feasibleCount=0, mode=mode,
            infeasibleExplanation="No candidate timetable passed final independent validation.",
            excludedOfferings=excluded_offerings,
            selectionValid=(False if selection_map is not None else None),
        )

    lunch_note = None
    if mandatory_lunch:
        has_after_period = any(
            start == "13:15"
            for timetable in timetables
            for course in timetable.courses
            for _, start, _, _ in expand_slot(course.slot)
        )
        if has_after_period:
            has_paired_day = False
            for timetable in timetables:
                starts_by_day: Dict[str, set[str]] = {}
                for course in timetable.courses:
                    for day, start, _, _ in expand_slot(course.slot):
                        starts_by_day.setdefault(day, set()).add(start)
                has_paired_day = has_paired_day or any(
                    {"11:40", "13:15"}.issubset(starts) for starts in starts_by_day.values()
                )
            lunch_note = (
                "Some returned options include a 1:15–2:45 PM class because lunch is a soft preference; "
                "the optimizer keeps it eligible and compares it with the rest of the schedule."
            )
            if has_paired_day:
                lunch_note += " Options that also use 11:40–1:10 PM on that day receive an additional lunch score cost."

    policy_fallback_note = None
    selected_starts = [start for timetable in timetables for course in timetable.courses for _, start, _, _ in expand_slot(course.slot)]
    if prefs.timePreference == "morning" and any(start >= "13:15" for start in selected_starts):
        policy_fallback_note = "At least one returned Morning alternative includes a post-lunch meeting. The returned alternatives are ranked by the Morning policy; some may fit the before-lunch preference."
    elif prefs.timePreference == "evening" and any(start < "13:15" for start in selected_starts):
        policy_fallback_note = "At least one returned Evening alternative uses an earlier-than-13:15 fallback; 08:30 remains excluded. The returned alternatives are ranked by the Evening fallback policy."

    return OptimizeResult(
        timetables=timetables,
        durationMs=duration_ms,
        # This is the number visited, not the number returned. It is the total
        # feasible count only when optimizationOptimal is true.
        feasibleCount=callback.visited,
        mode=mode,
        excludedOfferings=excluded_offerings,
        selectionValid=(True if selection_map is not None else None),
        lunchPreferenceNote=lunch_note,
        optimizationOptimal=optimization_optimal,
        policyFallbackNote=policy_fallback_note,
    )


def _schedule_final_valid(timetable: RankedTimetable, inp: OptimizeInput) -> bool:
    """Independently validate completeness, offering eligibility, slots, and clashes."""
    prefs = inp.preferences
    mode = (prefs.mode or "LIVE_REGISTRATION").strip().upper()
    actual_codes = [course.courseCode.upper() for course in timetable.courses]
    expected_codes = [subject.courseCode.upper() for subject in inp.subjects]
    if len(actual_codes) != len(set(actual_codes)) or set(actual_codes) != set(expected_codes):
        return False

    slots: List[str] = []
    locked_selections = {str(code).upper(): offering_id for code, offering_id in (prefs.selectedOfferings or {}).items()}
    if any(code not in expected_codes for code in locked_selections):
        return False
    for course in timetable.courses:
        slots.append(course.slot)
        subject = next((item for item in inp.subjects if item.courseCode.upper() == course.courseCode.upper()), None)
        if subject is None:
            return False
        if course.offeringId:
            matching_offerings = [option for option in subject.options if option.offeringId == course.offeringId]
        else:
            matching_offerings = [option for option in subject.options if (
                option.slot == course.slot and option.facultyName == course.facultyName
            )]
        if len(matching_offerings) != 1:
            return False
        offering = matching_offerings[0]
        locked_id = locked_selections.get(course.courseCode.upper())
        if locked_id is not None:
            # Validate both identity and the serialized offering fields. This
            # prevents a stale or tampered result from retaining an ID while
            # substituting another faculty, slot combination, or venue.
            if course.offeringId != locked_id:
                return False
            if (
                course.facultyName != offering.facultyName
                or course.slot != offering.slot
                or course.slots != offering.slots
                or course.venue != offering.venue
                or course.componentType != offering.componentType
                or course.building != offering.building
            ):
                return False
        if offering is None or offering.slotVerificationStatus in ("CONTAINS_UNVERIFIED", "MISSING_OR_INVALID"):
            return False
        atomic = offering.slots or [part.strip() for part in re.split(r"[+,/\s]+", offering.slot) if part.strip()]
        if not atomic or any(code not in DataStore.slot_times for code in atomic):
            return False
        meetings = expand_slot(offering.slot)
        if not meetings:
            return False
        if prefs.timePreference == "evening" and any(start == "08:30" for _, start, _, _ in meetings):
            return False
        if mode == "LIVE_REGISTRATION" and (
            offering.seatState == "UNKNOWN" or offering.seatState == "FULL" or
            offering.seatsAvailable is None or offering.seatsAvailable <= 0
        ):
            return False

    for index, left in enumerate(slots):
        if any(slots_clash(left, right) for right in slots[index + 1:]):
            return False
    return True
