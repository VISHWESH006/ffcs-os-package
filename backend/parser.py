"""Strict, loss-aware parser for extension exports and legacy course arrays."""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

from .data_loader import DataStore
from .models import FacultyOption, ParseResult, Subject

SUPPORTED_SCHEMA_VERSIONS = {"1.5.0", "1.1.0", "1.0.0"}
_SLOT_SPLIT = re.compile(r"[+,/\s]+")
_ATOM = re.compile(r"^[A-Z][A-Z0-9]{1,5}$")


def _text(value: Any) -> Optional[str]:
    if value is None:
        return None
    result = str(value).strip()
    return result or None


def _component(value: Any) -> Optional[str]:
    raw = _text(value)
    if raw is None:
        return None
    key = raw.strip().upper()
    return {"TH": "Theory", "THEORY": "Theory", "LO": "Lab", "LAB": "Lab",
            "TL": "Theory+Lab", "ELA": "Embedded Lab", "ETH": "Embedded Theory"}.get(key, raw)


def _seat(value: Any) -> tuple[Optional[int], str, Optional[str]]:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None, "UNKNOWN", None
    try:
        n = int(value)
        if n < 0:
            raise ValueError
    except (ValueError, TypeError, OverflowError):
        return None, "UNKNOWN", f"Invalid available seat value {value!r}; availability is UNKNOWN"
    return n, "FULL" if n == 0 else "AVAILABLE", None


def _same_offering(left: FacultyOption, right: FacultyOption) -> bool:
    left_id = left.scopedSourceId or left.sourceOfferingId
    right_id = right.scopedSourceId or right.sourceOfferingId
    if left_id and right_id:
        same_source = left_id == right_id and left.componentType == right.componentType
        if not same_source:
            return False
        return (tuple(left.slots), left.facultyName, left.venue) == (tuple(right.slots), right.facultyName, right.venue)
    if left.offeringId and right.offeringId and left.offeringId == right.offeringId:
        return (left.componentType, tuple(left.slots), left.facultyName, left.venue) == (
            right.componentType, tuple(right.slots), right.facultyName, right.venue)
    return (left.componentType, tuple(left.slots), left.facultyName, left.venue) == (
        right.componentType, tuple(right.slots), right.facultyName, right.venue)


def parse_vtop_data(raw_data: str) -> ParseResult:
    """Parse v1.5.0 wrapper or legacy array while retaining invalid offerings."""
    if not isinstance(raw_data, str) or not raw_data.strip():
        return ParseResult(subjects=[], errors=["Input data is empty."], warnings=[], totalParsed=0)
    try:
        data = json.loads(raw_data)
    except json.JSONDecodeError as exc:
        return ParseResult(subjects=[], errors=[f"Invalid JSON: {exc}"], warnings=[], totalParsed=0)

    errors: List[str] = []
    warnings: List[str] = []
    rejected: List[Dict[str, Any]] = []
    matches: List[Dict[str, Any]] = []
    metadata: Dict[str, Any] = {}
    version: Optional[str] = None
    if isinstance(data, dict):
        if "schemaVersion" not in data:
            return ParseResult(subjects=[], errors=["Wrapped export is missing required schemaVersion."], warnings=[], totalParsed=0)
        version = str(data["schemaVersion"])
        if version not in SUPPORTED_SCHEMA_VERSIONS:
            return ParseResult(schemaVersion=version, subjects=[], errors=[
                f"Unsupported schemaVersion {version!r}. Supported versions: {sorted(SUPPORTED_SCHEMA_VERSIONS)}"
            ], warnings=[], totalParsed=0)
        courses = data.get("courses", data.get("subjects"))
        if not isinstance(courses, list):
            return ParseResult(schemaVersion=version, subjects=[], errors=["Expected a 'courses' array in wrapped export."], warnings=[], totalParsed=0)
        metadata = {k: data[k] for k in ("source", "importSession", "pageHistory", "extractionReport", "possibleMatches") if k in data}
        matches = data.get("possibleMatches") or (data.get("extractionReport") or {}).get("possibleMatches") or []
        if not isinstance(matches, list):
            warnings.append("possibleMatches was not an array; preserved in extraction metadata and ignored for match listing")
            matches = []
    elif isinstance(data, list):
        courses = data
    else:
        return ParseResult(subjects=[], errors=["Expected a JSON array or wrapped export object."], warnings=[], totalParsed=0)

    # Fail visibly on broken reference data. Unknown/malformed slots must never
    # become confirmed merely because reference data failed to load.
    if not DataStore.slot_times:
        DataStore.load()

    subject_by_code: Dict[str, Subject] = {}
    total = invalid = incomplete = compatible = 0
    for i, raw_course in enumerate(courses):
        if not isinstance(raw_course, dict):
            reason = f"Item {i}: expected object, got {type(raw_course).__name__}"
            errors.append(reason); rejected.append({"itemIndex": i, "reason": reason}); invalid += 1
            continue
        code = _text(raw_course.get("courseCode", raw_course.get("code")))
        if not code:
            reason = f"Item {i}: missing required courseCode"
            errors.append(reason); rejected.append({"itemIndex": i, "reason": reason, "raw": raw_course}); invalid += 1
            continue
        code = code.upper()
        title = _text(raw_course.get("courseTitle", raw_course.get("courseName", raw_course.get("title")))) or code
        try:
            credits = int(raw_course.get("credits") or 0)
        except (ValueError, TypeError):
            credits = 0
            warnings.append(f"{code}: invalid credits; retained course with credits=0")
        options_raw = raw_course.get("options", [])
        if not isinstance(options_raw, list):
            reason = f"{code}: options must be an array"
            errors.append(reason); rejected.append({"courseCode": code, "reason": reason}); invalid += 1
            options_raw = []
        subject = subject_by_code.get(code)
        if subject is None:
            subject = Subject(courseCode=code, courseName=title, category=raw_course.get("category") or ((raw_course.get("categories") or [None])[0]), credits=credits,
                              courseType=raw_course.get("courseType") or raw_course.get("componentType"), options=[],
                              courseStructure=raw_course.get("courseStructure"), source={k:v for k,v in raw_course.items() if k not in {"options"}})
            subject_by_code[code] = subject
        elif subject.courseStructure is None and raw_course.get("courseStructure") is not None:
            subject.courseStructure = raw_course["courseStructure"]

        for j, raw in enumerate(options_raw):
            if not isinstance(raw, dict):
                reason = f"{code} option {j}: expected object"
                errors.append(reason); rejected.append({"courseCode": code, "optionIndex": j, "reason": reason}); invalid += 1
                continue
            raw_slot = _text(raw.get("rawSlot"))
            if raw_slot is None:
                raw_slot = _text(raw.get("slot"))
            slot_items = raw.get("slots")
            if _text(raw_slot):
                raw_tokens = [x for x in _SLOT_SPLIT.split(raw_slot) if x]
            elif isinstance(slot_items, list):
                raw_tokens = [str(x).strip() for x in slot_items if x is not None and str(x).strip()]
            elif _text(raw.get("slot")):
                raw_tokens = [x for x in _SLOT_SPLIT.split(str(raw.get("slot")).strip()) if x]
            elif _text(raw_slot):
                raw_tokens = [x for x in _SLOT_SPLIT.split(str(raw_slot).strip()) if x]
            else:
                raw_tokens = []
            tokens: List[str] = []
            option_warnings: List[str] = []
            malformed = False
            for token in raw_tokens:
                upper = token.upper()
                if not _ATOM.fullmatch(upper):
                    malformed = True
                elif upper in tokens:
                    warning = f"DUPLICATE_SLOT_TOKEN: {upper} occurs more than once."
                    if warning not in option_warnings: option_warnings.append(warning)
                else:
                    tokens.append(upper)
            all_verified = bool(tokens) and all(t in DataStore.slot_times for t in tokens)
            supplied_status = raw.get("slotVerificationStatus")
            status = supplied_status or ("MISSING_OR_INVALID" if malformed or not tokens else "CONFIRMED_THEORY" if all_verified else "CONTAINS_UNVERIFIED")
            if status not in {"CONFIRMED_THEORY", "CONTAINS_UNVERIFIED", "MISSING_OR_INVALID"}:
                option_warnings.append(f"Unrecognized slotVerificationStatus {status!r}; treated as unverified")
                status = "CONTAINS_UNVERIFIED" if tokens and not malformed else "MISSING_OR_INVALID"
            if status == "CONFIRMED_THEORY" and (malformed or not all_verified):
                status = "CONTAINS_UNVERIFIED" if tokens and not malformed else "MISSING_OR_INVALID"
                option_warnings.append("Source marked slots verified, but local slot mapping does not verify them")
            if malformed:
                status = "MISSING_OR_INVALID"
                option_warnings.append("Malformed slot token retained; offering is not optimizer compatible")

            avail_key = "availableSeats" if "availableSeats" in raw else "seatsAvailable"
            seats, seat_state, seat_warning = _seat(raw.get(avail_key))
            if seat_warning: option_warnings.append(seat_warning)
            total_seats, _, total_warning = _seat(raw.get("totalSeats"))
            if total_warning: option_warnings.append(total_warning)
            component = _component(raw.get("componentType", raw.get("courseType", raw_course.get("courseType"))))
            if component is None:
                component = "UNKNOWN"
                option_warnings.append("Component type not specified in source; marked UNKNOWN")
            venue = _text(raw.get("venue"))
            building = _text(raw.get("building"))
            faculty_name = _text(raw.get("facultyName", raw.get("faculty", raw.get("teacher"))))
            offering_id = _text(raw.get("offeringId"))
            if offering_id is None:
                norm_faculty = re.sub(r"\s+", " ", faculty_name).strip().upper() if faculty_name else None
                norm_venue = re.sub(r"\s+", " ", venue).strip().upper() if venue else None
                offering_id = json.dumps([code, component.upper(), sorted(tokens), norm_faculty, norm_venue], separators=(",", ":"), ensure_ascii=False)
            if not building and venue:
                match = re.match(r"^(AB01|AB02|LC|AR)(?:[-\s]|$)", venue, re.I)
                if match: building = match.group(1).upper()
            missing = [name for name, value in (("facultyName", _text(raw.get("facultyName", raw.get("faculty", raw.get("teacher"))))), ("venue", venue), ("availableSeats", seats), ("totalSeats", total_seats), ("slots", tokens if status != "MISSING_OR_INVALID" else None)) if value is None]
            if component == "UNKNOWN": missing.append("componentType")
            option = FacultyOption(
                facultyName=faculty_name,
                slot="+".join(tokens), rawSlot=raw_slot, slots=tokens, slotVerificationStatus=status,
                venue=venue, building=building, room=raw.get("room"), seatsAvailable=seats,
                availableSeats=seats, totalSeats=total_seats, seatState=seat_state,
                classStatus=raw.get("classStatus"), courseType=_component(raw.get("courseType")) or component, componentType=component,
                offeringId=offering_id, sourceOfferingId=raw.get("sourceOfferingId"),
                scopedSourceId=raw.get("scopedSourceId"), missingFields=missing, warnings=option_warnings, raw=raw)
            previous = next((o for o in subject.options if _same_offering(o, option)), None)
            if previous:
                # Same native ID is an update; never merge conflicting IDs.
                if seats is not None: previous.availableSeats = previous.seatsAvailable = seats; previous.seatState = seat_state
                if total_seats is not None: previous.totalSeats = total_seats
                previous.raw.update(raw)
            else:
                subject.options.append(option)
                total += 1
            if option.missingFields: incomplete += 1
            else: compatible += 1
            if status != "CONFIRMED_THEORY" or not tokens or not option.facultyName:
                warnings.append(f"{code} option {j}: retained but not optimizer compatible ({status})")

    return ParseResult(schemaVersion=version, subjects=list(subject_by_code.values()), errors=errors, warnings=warnings,
                       rejectedRecords=rejected, possibleMatches=matches, totalParsed=total,
                       invalidRecords=invalid, validIncompleteRecords=incomplete,
                       optimizerCompatibleRecords=compatible, extractionMetadata=metadata)
