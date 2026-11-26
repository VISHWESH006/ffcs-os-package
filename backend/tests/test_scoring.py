"""Optimizer integrity tests (faculty ratings must not affect results)."""
import pytest

from backend.data_loader import DataStore
from backend.models import FacultyOption, OptimizeInput, PreferencesInput, Subject
from backend.optimizer import (
    TimetableSolutionCallback, _official_periods, _schedule_final_valid,
    _score_day_scholar_meetings,
    _score_gaps, _score_lunch, compute_score, optimize, slots_clash,
)


def _option(slot="A11", seats=None, state="UNKNOWN", faculty="Faculty A", status="CONFIRMED_THEORY"):
    return FacultyOption(facultyName=faculty, slot=slot, rawSlot=slot, slots=slot.split("+"),
                         slotVerificationStatus=status, venue="AB01-101", building="AB01",
                         seatsAvailable=seats, availableSeats=seats, seatState=state,
                         componentType="Theory")


def _subject(code, *options):
    return Subject(courseCode=code, courseName=code, credits=3, options=list(options))


def setup_function():
    DataStore.load()


def test_planning_keeps_zero_and_unknown_seats():
    result = optimize(OptimizeInput(subjects=[
        _subject("CSE1001", _option("A11", 0, "FULL")),
        _subject("MAT1001", _option("B11", None, "UNKNOWN", "Faculty B")),
    ], preferences=PreferencesInput(mode="PLANNING"), topN=3))
    assert result.feasibleCount > 0


def test_live_registration_rejects_zero_and_unknown_seats_with_reasons():
    result = optimize(OptimizeInput(subjects=[_subject("CSE1001",
        _option("A11", 0, "FULL"), _option("B11", None, "UNKNOWN", "Faculty B"))],
        preferences=PreferencesInput(mode="LIVE_REGISTRATION")))
    assert result.infeasibleCourses == ["CSE1001"]
    assert len(result.excludedOfferings) == 2


def test_unverified_and_missing_faculty_are_never_optimized():
    result = optimize(OptimizeInput(subjects=[_subject("CSE1001",
        _option("A11+ZZ99", 10, "AVAILABLE", status="CONTAINS_UNVERIFIED"),
        _option("B11", 10, "AVAILABLE", faculty=None))], preferences=PreferencesInput()))
    assert result.feasibleCount == 0
    assert len(result.excludedOfferings) == 2


def test_multiple_atomic_slots_expand_and_clash():
    assert slots_clash("A11+A12", "A12")
    result = optimize(OptimizeInput(subjects=[
        _subject("CSE1001", _option("A11+A12", 10, "AVAILABLE")),
        _subject("MAT1001", _option("A12", 10, "AVAILABLE", "Faculty B")),
    ], preferences=PreferencesInput()))
    assert result.feasibleCount == 0
    assert result.infeasibleExplanation


def test_official_period_order_comes_from_all_seven_verified_periods():
    assert _official_periods() == [
        ("08:30", "10:00"), ("10:05", "11:35"), ("11:40", "13:10"),
        ("13:15", "14:45"), ("14:50", "16:20"), ("16:25", "17:55"),
        ("18:00", "19:30"),
    ]


def test_gap_score_treats_consecutive_official_periods_as_continuous():
    assert _score_gaps([_option("A11"), _option("B11", faculty="Faculty B")], 0) == 1.0
    assert _score_gaps([_option("A11"), _option("C11", faculty="Faculty B")], 0) < 1.0


def test_teacher_ratings_do_not_change_timetable_score_or_selected_faculty_data():
    a = _option("A11", 10, "AVAILABLE", "Faculty A")
    b = _option("A11", 10, "AVAILABLE", "Faculty B")
    subject = _subject("CSE1001", a, b)
    score_a = compute_score([(subject, a)], PreferencesInput())
    score_b = compute_score([(subject, b)], PreferencesInput())
    assert score_a.overall == score_b.overall
    result = optimize(OptimizeInput(subjects=[subject], preferences=PreferencesInput(), topN=5))
    assert result.timetables
    assert all(c.overallRating is None and c.confidenceScore is None for tt in result.timetables for c in tt.courses)
    assert {c.facultyName for tt in result.timetables for c in tt.courses} == {"Faculty A", "Faculty B"}


def test_required_course_is_not_silently_dropped():
    result = optimize(OptimizeInput(subjects=[_subject("CSE1001", _option("XYZ99", 10, "AVAILABLE", status="CONTAINS_UNVERIFIED"))],
        preferences=PreferencesInput()))
    assert result.infeasibleCourses == ["CSE1001"]
    assert "no available or verified offerings" in result.infeasibleExplanation


def test_student_selected_offering_is_preserved_and_returned():
    chosen = _option("A11", 0, "FULL", "Faculty B")
    chosen.offeringId = '["CSE1001","THEORY",["A11"],"FACULTY B","AB01-101"]'
    other = _option("B11", 10, "AVAILABLE", "Faculty A")
    other.offeringId = "other-offering"
    result = optimize(OptimizeInput(subjects=[_subject("CSE1001", chosen, other)],
        preferences=PreferencesInput(mode="PLANNING", selectedOfferings={"CSE1001": chosen.offeringId})))
    assert result.selectionValid is True
    assert result.timetables[0].courses[0].facultyName == "Faculty B"
    assert result.timetables[0].courses[0].offeringId == chosen.offeringId
    assert result.timetables[0].courses[0].seatState == "FULL"  # PLANNING keeps full classes visible.


def test_student_selection_rejects_stale_ids_but_allows_unlocked_courses():
    subject = _subject("CSE1001", _option("A11", 10, "AVAILABLE"))
    unknown = optimize(OptimizeInput(subjects=[subject],
        preferences=PreferencesInput(selectedOfferings={"CSE1001": "stale"})))
    assert unknown.selectionValid is False
    assert unknown.selectionErrors[0]["reason"] == "UNKNOWN_OFFERING"
    missing = optimize(OptimizeInput(subjects=[subject],
        preferences=PreferencesInput(selectedOfferings={})))
    assert missing.selectionValid is True
    assert missing.timetables


def test_partial_offering_lock_keeps_exact_identity_and_allows_unlocked_exploration():
    locked = _option("A11+A12+A13", 0, "FULL", "Chosen Faculty")
    locked.offeringId = "locked-combined"
    locked.venue = "AB02-119"
    locked.building = "AB02"
    alternate = _option("B11", 20, "AVAILABLE", "Other Faculty")
    alternate.offeringId = "locked-alternate"
    unlocked_a = _option("C11", 20, "AVAILABLE", "Flexible A")
    unlocked_a.offeringId = "free-a"
    unlocked_b = _option("D11", 20, "AVAILABLE", "Flexible B")
    unlocked_b.offeringId = "free-b"
    subjects = [_subject("CSE1001", locked, alternate), _subject("MAT1001", unlocked_a, unlocked_b)]
    result = optimize(OptimizeInput(subjects=subjects, preferences=PreferencesInput(
        mode="PLANNING", selectedOfferings={"CSE1001": "locked-combined"}), topN=10))
    assert result.selectionValid is True
    assert result.timetables
    assert {tt.courses[0].offeringId for tt in result.timetables} == {"locked-combined"}
    assert {tt.courses[0].facultyName for tt in result.timetables} == {"Chosen Faculty"}
    assert {tt.courses[0].slot for tt in result.timetables} == {"A11+A12+A13"}
    assert {tuple(tt.courses[0].slots) for tt in result.timetables} == {("A11", "A12", "A13")}
    assert {tt.courses[0].venue for tt in result.timetables} == {"AB02-119"}
    assert {tt.courses[1].offeringId for tt in result.timetables} == {"free-a", "free-b"}


@pytest.mark.parametrize(
    ("name", "locked_slot", "flexible_slots", "preferences", "top_flexible_id"),
    [
        ("morning", "A14+B14", ("A11", "A21"), {"timePreference": "morning"}, "flex-0"),
        ("evening", "A14+B14", ("B11", "A21"), {"timePreference": "evening"}, "flex-1"),
        ("preferred day off", "A14+B14", ("A13", "D11"), {"preferredFreeDay": "FRI"}, "flex-1"),
        ("maximum gap", "A11", ("B11", "C11"), {"maxGap": 0}, "flex-0"),
        ("lunch", "C11+C12", ("A21", "D21"), {"mandatoryLunch": True}, "flex-1"),
        ("Day Scholar routine", "A14+B14", ("A11", "C21"), {"dayScholar": True}, "flex-0"),
    ],
    ids=lambda value: value if isinstance(value, str) else None,
)
def test_explicit_offering_lock_survives_each_soft_preference(name, locked_slot, flexible_slots, preferences, top_flexible_id):
    locked = _option(locked_slot, 10, "AVAILABLE", "Locked Faculty")
    locked.offeringId = "locked-offering"
    locked.venue = "AB02-119"
    flexible = [
        _option(slot, 10, "AVAILABLE", f"Flexible Faculty {index}")
        for index, slot in enumerate(flexible_slots)
    ]
    for index, option in enumerate(flexible):
        option.offeringId = f"flex-{index}"
    result = optimize(OptimizeInput(
        subjects=[_subject("CSE1001", locked), _subject("MAT1001", *flexible)],
        preferences=PreferencesInput(mode="PLANNING", selectedOfferings={"CSE1001": "locked-offering"}, **preferences),
        topN=20,
    ))

    assert result.timetables, name
    assert result.timetables[0].courses[1].offeringId == top_flexible_id, f"{name} preference should still rank unlocked choices"
    assert {tt.courses[0].offeringId for tt in result.timetables} == {"locked-offering"}
    assert {tt.courses[0].facultyName for tt in result.timetables} == {"Locked Faculty"}
    assert {tt.courses[0].slot for tt in result.timetables} == {locked_slot}
    assert {tuple(tt.courses[0].slots) for tt in result.timetables} == {tuple(locked_slot.split("+"))}
    assert {tt.courses[0].venue for tt in result.timetables} == {"AB02-119"}
    assert {tt.courses[1].offeringId for tt in result.timetables} == {option.offeringId for option in flexible}


def test_ineligible_partial_lock_error_only_identifies_the_locked_course():
    locked = _option("A11", 0, "FULL", "Chosen Faculty")
    locked.offeringId = "locked-full"
    unavailable_unlocked = _option("XYZ99", 10, "AVAILABLE", "Unverified Faculty", "CONTAINS_UNVERIFIED")
    result = optimize(OptimizeInput(
        subjects=[_subject("CSE1001", locked), _subject("MAT1001", unavailable_unlocked)],
        preferences=PreferencesInput(mode="LIVE_REGISTRATION", selectedOfferings={"CSE1001": "locked-full"}),
    ))
    assert result.timetables == []
    assert result.selectionErrors == [{"courseCode": "CSE1001", "reason": "OFFERING_NOT_ELIGIBLE"}]
    assert {item["courseCode"] for item in result.excludedOfferings} == {"CSE1001", "MAT1001"}


def test_locked_offering_is_not_substituted_when_seat_mode_excludes_it():
    full = _option("A11", 0, "FULL", "Chosen Faculty")
    full.offeringId = "locked-full"
    available = _option("B11", 10, "AVAILABLE", "Other Faculty")
    available.offeringId = "available-substitute"
    subject = _subject("CSE1001", full, available)
    planning = optimize(OptimizeInput(subjects=[subject], preferences=PreferencesInput(
        mode="PLANNING", selectedOfferings={"CSE1001": "locked-full"})))
    live = optimize(OptimizeInput(subjects=[subject], preferences=PreferencesInput(
        mode="LIVE_REGISTRATION", selectedOfferings={"CSE1001": "locked-full"})))
    assert planning.timetables[0].courses[0].offeringId == "locked-full"
    assert live.timetables == []
    assert live.selectionValid is False


def test_student_selection_rejects_duplicate_ids_and_missing_faculty():
    duplicate_a = _option("A11", 10, "AVAILABLE", "Faculty A")
    duplicate_b = _option("B11", 10, "AVAILABLE", "Faculty B")
    duplicate_a.offeringId = duplicate_b.offeringId = "duplicate"
    ambiguous = optimize(OptimizeInput(subjects=[_subject("CSE1001", duplicate_a, duplicate_b)],
        preferences=PreferencesInput(selectedOfferings={"CSE1001": "duplicate"})))
    assert ambiguous.selectionErrors[0]["reason"] == "AMBIGUOUS_OFFERING"

    no_faculty = _option("A11", 10, "AVAILABLE", faculty=None)
    no_faculty.offeringId = "missing-faculty"
    incomplete = optimize(OptimizeInput(subjects=[_subject("CSE1001", no_faculty)],
        preferences=PreferencesInput(selectedOfferings={"CSE1001": "missing-faculty"})))
    assert incomplete.selectionValid is False
    assert incomplete.selectionErrors[0]["reason"] == "OFFERING_NOT_ELIGIBLE"


def test_selected_unknown_seats_follow_registration_mode():
    unknown = _option("A11", None, "UNKNOWN")
    unknown.offeringId = "unknown-seats"
    planning = optimize(OptimizeInput(subjects=[_subject("CSE1001", unknown)],
        preferences=PreferencesInput(mode="PLANNING", selectedOfferings={"CSE1001": "unknown-seats"})))
    live = optimize(OptimizeInput(subjects=[_subject("CSE1001", unknown)],
        preferences=PreferencesInput(mode="LIVE_REGISTRATION", selectedOfferings={"CSE1001": "unknown-seats"})))
    assert planning.selectionValid is True
    assert live.selectionValid is False
    assert live.selectionErrors[0]["reason"] == "OFFERING_NOT_ELIGIBLE"


def test_final_validator_rejects_locked_offering_identity_and_metadata_substitution():
    chosen = _option("A11+A12", 10, "AVAILABLE", "Chosen Faculty")
    chosen.offeringId = "locked"
    alternate = _option("B11", 10, "AVAILABLE", "Other Faculty")
    alternate.offeringId = "other"
    inp = OptimizeInput(subjects=[_subject("CSE1001", chosen, alternate)], preferences=PreferencesInput(
        mode="PLANNING", selectedOfferings={"CSE1001": "locked"}))
    valid = optimize(inp).timetables[0]
    assert _schedule_final_valid(valid, inp)
    valid.courses[0].offeringId = "other"
    assert not _schedule_final_valid(valid, inp)
    substituted = optimize(inp).timetables[0]
    substituted.courses[0].facultyName = "Other Faculty"
    assert not _schedule_final_valid(substituted, inp)
    inp.preferences.selectedOfferings = {"UNKNOWN": "locked"}
    unlocked_result = optimize(OptimizeInput(subjects=inp.subjects,
        preferences=PreferencesInput(mode="PLANNING")))
    assert not _schedule_final_valid(unlocked_result.timetables[0], inp)


def test_student_faculty_change_is_revalidated_for_slot_clash():
    a = _option("A11", 10, "AVAILABLE", "Faculty A")
    a.offeringId = "a"
    b1 = _option("B11", 10, "AVAILABLE", "Faculty B1")
    b1.offeringId = "b1"
    b2 = _option("A11", 10, "AVAILABLE", "Faculty B2")
    b2.offeringId = "b2"
    result = optimize(OptimizeInput(subjects=[_subject("CSE1001", a), _subject("MAT1001", b1, b2)],
        preferences=PreferencesInput(selectedOfferings={"CSE1001": "a", "MAT1001": "b2"})))
    assert result.feasibleCount == 0
    assert result.selectionValid is False
    assert result.selectionConflicts == [{
        "courseCodes": ["CSE1001", "MAT1001"], "offeringIds": ["a", "b2"],
        "slots": ["A11"], "reason": "SLOT_CLASH",
    }]


def test_student_selection_reports_every_simultaneous_slot_clash():
    subjects = []
    choices = {}
    for code, faculty in (("CSE1001", "Faculty A"), ("MAT1001", "Faculty B"), ("PHY1001", "Faculty C")):
        option = _option("A11+A12", 10, "AVAILABLE", faculty)
        option.offeringId = code.lower()
        subjects.append(_subject(code, option))
        choices[code] = option.offeringId
    result = optimize(OptimizeInput(subjects=subjects,
        preferences=PreferencesInput(selectedOfferings=choices)))
    assert result.timetables == []
    assert result.selectionValid is False
    assert len(result.selectionConflicts) == 3
    assert {tuple(conflict["courseCodes"]) for conflict in result.selectionConflicts} == {
        ("CSE1001", "MAT1001"), ("CSE1001", "PHY1001"), ("MAT1001", "PHY1001"),
    }
    assert all(conflict["slots"] == ["A11", "A12"] for conflict in result.selectionConflicts)


def test_parser_generates_stable_offering_id_when_source_does_not_supply_one():
    from backend.parser import parse_vtop_data
    parsed = parse_vtop_data('[{"courseCode":"CSE1001","courseTitle":"Test","credits":3,"options":[{"facultyName":"Faculty A","slot":"A11","componentType":"Theory","venue":"AB01-101"}]}]')
    offering_id = parsed.subjects[0].options[0].offeringId
    assert offering_id == '["CSE1001","THEORY",["A11"],"FACULTY A","AB01-101"]'


def test_before_lunch_class_makes_free_after_lunch_period_score_better():
    before = _option("C11", faculty="Faculty A")
    after_alt = _option("A21", faculty="Faculty B")
    later_alt = _option("A14", faculty="Faculty C")
    subjects = [_subject("CSE1001", before), _subject("MAT1001", after_alt, later_alt)]
    result = optimize(OptimizeInput(subjects=subjects,
        preferences=PreferencesInput(mode="PLANNING", mandatoryLunch=True), topN=5))
    assert result.timetables
    assert result.timetables[0].courses[1].slot == "A14"
    assert any(course.slot == "A21" for tt in result.timetables for course in tt.courses)
    assert all(_schedule_final_valid(tt, OptimizeInput(subjects=subjects,
        preferences=PreferencesInput(mode="PLANNING", mandatoryLunch=True))) for tt in result.timetables)


def test_turning_lunch_preference_off_preserves_both_period_choices():
    result = optimize(OptimizeInput(subjects=[_subject("CSE1001", _option("A21"), _option("C11"))],
        preferences=PreferencesInput(mode="PLANNING", mandatoryLunch=False), topN=5))
    assert {course.slot for tt in result.timetables for course in tt.courses} == {"A21", "C11"}


def test_evening_preference_can_outweigh_soft_lunch_cost():
    subject = _subject("CSE1001", _option("A21"), _option("A11"))
    prefs = PreferencesInput(mode="PLANNING", timePreference="evening", mandatoryLunch=True)
    result = optimize(OptimizeInput(subjects=[subject], preferences=prefs, topN=5))
    assert result.timetables
    assert result.timetables[0].courses[0].slot == "A21"
    assert "soft preference" in result.lunchPreferenceNote
    after_score = compute_score([(subject, subject.options[0])], prefs)
    morning_score = compute_score([(subject, subject.options[1])], prefs)
    assert after_score.overall > morning_score.overall


def test_without_before_class_after_lunch_is_still_only_a_soft_preference():
    subject = _subject("CSE1001", _option("A21"), _option("A11"))
    prefs = PreferencesInput(mode="PLANNING", timePreference="balanced", mandatoryLunch=True)
    result = optimize(OptimizeInput(subjects=[subject], preferences=prefs, topN=5))
    assert result.timetables
    assert result.timetables[0].courses[0].slot == "A11"
    assert all(tt.courses[0].slot in {"A11", "A21"} for tt in result.timetables)


def test_after_lunch_offering_is_allowed_when_it_is_the_only_valid_option():
    result = optimize(OptimizeInput(subjects=[_subject("CSE1001", _option("A21"))],
        preferences=PreferencesInput(mode="PLANNING", mandatoryLunch=True)))
    assert result.timetables
    assert result.timetables[0].courses[0].slot == "A21"


def test_before_and_after_periods_may_both_be_scheduled_without_a_real_clash():
    subjects = [
        _subject("CSE1001", _option("C11")),
        _subject("MAT1001", _option("A21", faculty="Faculty B")),
    ]
    result = optimize(OptimizeInput(subjects=subjects,
        preferences=PreferencesInput(mode="PLANNING", mandatoryLunch=True)))
    assert result.timetables
    assert {course.slot for course in result.timetables[0].courses} == {"C11", "A21"}
    assert "additional lunch score cost" in result.lunchPreferenceNote
    assert _schedule_final_valid(result.timetables[0], OptimizeInput(subjects=subjects,
        preferences=PreferencesInput(mode="PLANNING", mandatoryLunch=True)))


def test_day_scholar_and_lunch_preferences_are_independent():
    result = optimize(OptimizeInput(subjects=[_subject("CSE1001", _option("A11"), _option("C11"))],
        preferences=PreferencesInput(mode="PLANNING", dayScholar=True, mandatoryLunch=True)))
    assert result.timetables
    assert result.mode == "PLANNING"


def test_day_scholar_prefers_530_finish_to_630_finish():
    # This isolates finish-time scoring. The official slot map has no exact
    # 17:30 or 18:30 end times; end-to-end behavior is covered below using it.
    finish_530 = _score_day_scholar_meetings([("MON", "17:00", "17:30", "fixture")])
    finish_630 = _score_day_scholar_meetings([("MON", "18:00", "18:30", "fixture")])
    assert finish_530 > finish_630
    assert finish_530 > 0.9
    assert finish_630 < 0.9


def test_day_scholar_strongly_rewards_by_six_and_penalizes_later_finish_progressively():
    finish_by_six = _score_day_scholar_meetings([("MON", "16:25", "18:00", "fixture")])
    five_minutes_late = _score_day_scholar_meetings([("MON", "18:00", "18:05", "fixture")])
    six_thirty = _score_day_scholar_meetings([("MON", "18:00", "18:30", "fixture")])
    latest_official = _score_day_scholar_meetings([("MON", "18:00", "19:30", "fixture")])
    assert finish_by_six == 0.9
    assert finish_by_six > five_minutes_late > six_thirty > latest_official
    assert latest_official == 0.0


def test_day_scholar_prefers_official_before_six_finish_but_keeps_late_alternative():
    subject = _subject("CSE1001", _option("B21"), _option("C21", faculty="Faculty B"))
    inp = OptimizeInput(subjects=[subject], preferences=PreferencesInput(
        mode="PLANNING", dayScholar=True,
    ), topN=5)
    result = optimize(inp)
    assert [tt.courses[0].slot for tt in result.timetables][0] == "B21"  # Ends 17:55.
    assert "C21" in [tt.courses[0].slot for tt in result.timetables]  # Ends 19:30; remains valid.
    assert all(_schedule_final_valid(tt, inp) for tt in result.timetables)


def test_day_scholar_late_only_offering_is_not_infeasible():
    result = optimize(OptimizeInput(subjects=[_subject("CSE1001", _option("C21"))],
        preferences=PreferencesInput(mode="PLANNING", dayScholar=True)))
    assert result.timetables
    assert result.timetables[0].courses[0].slot == "C21"
    assert result.infeasibleCourses == []


def test_conflicting_soft_preferences_return_valid_alternatives():
    subject = _subject("CSE1001", _option("C11"), _option("C21", faculty="Faculty B"))
    prefs = PreferencesInput(mode="PLANNING", dayScholar=True, mandatoryLunch=True,
                             preferredFreeDay="MON", maxGap=0)
    result = optimize(OptimizeInput(subjects=[subject], preferences=prefs, topN=5))
    assert {tt.courses[0].slot for tt in result.timetables} == {"C11", "C21"}
    assert result.feasibleCount == 2
    assert all(_schedule_final_valid(tt, OptimizeInput(subjects=[subject], preferences=prefs))
               for tt in result.timetables)


def test_morning_preference_can_fall_back_to_post_lunch_without_rejecting_schedule():
    result = optimize(OptimizeInput(subjects=[_subject("CSE1001", _option("A21"))],
        preferences=PreferencesInput(mode="PLANNING", timePreference="morning")))
    assert result.timetables
    assert result.timetables[0].courses[0].slot == "A21"
    assert result.policyFallbackNote is not None


def test_retired_early_class_and_unrequested_saturday_bias_do_not_change_score():
    monday = _option("A11")
    saturday = _option("D13")
    monday_subject = _subject("CSE1001", monday)
    saturday_subject = _subject("CSE1001", saturday)
    baseline = compute_score([(monday_subject, monday)], PreferencesInput(mode="PLANNING"))
    old_early_flag = compute_score([(monday_subject, monday)],
        PreferencesInput(mode="PLANNING", avoidEarlyMorning=True))
    saturday_score = compute_score([(saturday_subject, saturday)], PreferencesInput(mode="PLANNING"))
    assert old_early_flag.overall == baseline.overall
    assert saturday_score.overall == baseline.overall


def test_unmapped_venue_travel_is_unknown_not_perfect():
    first, second = _option("B11"), _option("C11", faculty="Faculty B")
    for option in (first, second):
        option.venue = "AB305"
        option.building = None
    subject_a, subject_b = _subject("CSE1001", first), _subject("MAT1001", second)
    score = compute_score([(subject_a, first), (subject_b, second)], PreferencesInput(walkingPriority=True))
    assert score.travelScore is None
    assert score.travelUnknownTransitions == 1


def test_lunch_soft_score_applies_independently_to_day_scholars():
    subject = _subject("CSE1001", _option("A21"))
    score = compute_score([(subject, subject.options[0])],
        PreferencesInput(dayScholar=True, mandatoryLunch=True))
    assert score.lunchScore < 100


def test_evening_policy_rejects_0830_and_reports_fallback():
    early_only = optimize(OptimizeInput(subjects=[_subject("CSE1001", _option("A11"))],
        preferences=PreferencesInput(mode="PLANNING", timePreference="evening")))
    assert not early_only.timetables
    later = optimize(OptimizeInput(subjects=[_subject("CSE1001", _option("A11"), _option("B11"), _option("C11"), _option("A21"))],
        preferences=PreferencesInput(mode="PLANNING", timePreference="evening")))
    assert later.timetables
    assert all(course.slot != "A11" for timetable in later.timetables for course in timetable.courses)
    assert [tt.courses[0].slot for tt in later.timetables] == ["A21", "C11", "B11"]


def test_morning_policy_orders_fewer_late_sessions_before_soft_score():
    result = optimize(OptimizeInput(subjects=[_subject("CSE1001", _option("A11"), _option("A21"))],
        preferences=PreferencesInput(mode="PLANNING", timePreference="morning"), topN=2))
    assert result.timetables
    assert result.timetables[0].courses[0].slot == "A11"


def test_morning_policy_uses_verified_daily_finish_end_time():
    subject = _subject("CSE1001", _option("C11"))
    callback = TimetableSolutionCallback([], [], [], PreferencesInput(timePreference="morning"))
    score = compute_score([(subject, subject.options[0])], PreferencesInput(timePreference="morning"))
    key = callback._rank_key([(subject, subject.options[0])], score)
    assert key[1] == 13 * 60 + 10


def test_morning_schedule_that_fits_before_lunch_has_no_fallback_note():
    result = optimize(OptimizeInput(subjects=[_subject("CSE1001", _option("A11"), _option("A21"))],
        preferences=PreferencesInput(mode="PLANNING", timePreference="morning"), topN=1))
    assert result.timetables[0].courses[0].slot == "A11"
    assert result.policyFallbackNote is None


def test_lunch_period_penalties_are_symmetric_and_both_are_penalized():
    before = _score_lunch([_option("C11")])
    after = _score_lunch([_option("A21")])
    both = _score_lunch([_option("C11"), _option("A21", faculty="Faculty B")])
    assert before == after
    assert both < before


def test_disabling_lunch_removes_all_lunch_score_penalties():
    before = _option("C11")
    after = _option("A21", faculty="Faculty B")
    subject_a, subject_b = _subject("CSE1001", before), _subject("MAT1001", after)
    score = compute_score([(subject_a, before), (subject_b, after)],
        PreferencesInput(mandatoryLunch=False))
    assert score.lunchScore == 100


def test_feasible_count_is_visited_assignments_not_returned_top_n():
    result = optimize(OptimizeInput(subjects=[_subject("CSE1001", _option("A11"), _option("B11"))],
        preferences=PreferencesInput(mode="PLANNING"), topN=1))
    assert len(result.timetables) == 1
    assert result.feasibleCount == 2
    assert result.optimizationOptimal is True


def test_interrupted_enumeration_status_does_not_claim_global_optimality(monkeypatch):
    import backend.optimizer as optimizer_module

    actual_solver = optimizer_module.cp_model.CpSolver

    class InterruptedSolver:
        def __init__(self):
            self.inner = actual_solver()
            self.parameters = self.inner.parameters

        def Solve(self, model, callback):
            self.inner.Solve(model, callback)
            return optimizer_module.cp_model.FEASIBLE

    monkeypatch.setattr(optimizer_module.cp_model, "CpSolver", InterruptedSolver)
    result = optimize(OptimizeInput(subjects=[_subject("CSE1001", _option("A11"), _option("B11"))],
        preferences=PreferencesInput(mode="PLANNING"), topN=1))
    assert result.timetables
    assert result.optimizationOptimal is False


def test_lunch_preference_does_not_disable_real_slot_clash_detection():
    assert slots_clash("A11", "A11")
    result = optimize(OptimizeInput(subjects=[
        _subject("CSE1001", _option("A11")),
        _subject("MAT1001", _option("A11", faculty="Faculty B")),
    ], preferences=PreferencesInput(mode="PLANNING", mandatoryLunch=True)))
    assert not result.timetables
    assert "clash-free" in result.infeasibleExplanation


def test_preferred_day_off_and_gap_preference_still_score_with_lunch_rule():
    subject = _subject("CSE1001", _option("A11"))
    other = _subject("MAT1001", _option("A14", faculty="Faculty B"))
    selected = [(subject, subject.options[0]), (other, other.options[0])]
    no_gap = compute_score(selected, PreferencesInput(maxGap=0, mandatoryLunch=True))
    large_gap = compute_score(selected, PreferencesInput(maxGap=4, mandatoryLunch=True))
    preferred_day = compute_score(selected, PreferencesInput(preferredFreeDay="MON", mandatoryLunch=True))
    assert no_gap.gapScore < large_gap.gapScore
    assert preferred_day.preferenceMatch < no_gap.preferenceMatch


def test_every_returned_timetable_passes_independent_final_validation():
    result = optimize(OptimizeInput(subjects=[
        _subject("CSE1001", _option("A21"), _option("C11"), _option("A11")),
        _subject("MAT1001", _option("B11", faculty="Faculty B")),
    ], preferences=PreferencesInput(mode="PLANNING", mandatoryLunch=True)))
    assert result.timetables
    inp = OptimizeInput(subjects=[
        _subject("CSE1001", _option("A21"), _option("C11"), _option("A11")),
        _subject("MAT1001", _option("B11", faculty="Faculty B")),
    ], preferences=PreferencesInput(mode="PLANNING", mandatoryLunch=True))
    assert all(_schedule_final_valid(tt, inp) for tt in result.timetables)
