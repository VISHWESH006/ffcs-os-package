# FFCS OS — REST API Reference

Base URL: `http://localhost:8080/api`

All requests and responses use `application/json`.

---

## Health

### `GET /healthz`
Returns server status.

**Response 200**
```json
{ "status": "ok", "service": "ffcs-os-api", "timestamp": "2026-08-01T12:00:00.000Z" }
```

---

## Parse

### `POST /parse`
Validates and normalises the JSON array extracted from VTOP by the browser extension.

**Request body**
```json
{ "rawData": "[{ \"courseCode\": \"CSE1001\", ... }]" }
```

**Response 200**
```json
{
  "subjects": [
    {
      "courseCode": "CSE1001",
      "courseName": "Engineering Mathematics",
      "category": "TH",
      "credits": 4,
      "courseType": "Theory",
      "options": [
        {
          "facultyName": "Anil Kumar Sharma",
          "slot": "A1+TA1",
          "venue": "SJT-304",
          "building": "SJT",
          "seatsAvailable": 20,
          "totalSeats": 70,
          "classStatus": "Open",
          "courseType": "TH"
        }
      ]
    }
  ],
  "errors": [],
  "warnings": ["CSE2001: 1 option(s) skipped — no seats available"]
}
```

---

> Phase 1.2: Faculty rating preferences are deprecated and ignored by timetable optimization. Use `preferences.mode` (`PLANNING` or `LIVE_REGISTRATION`). Faculty names remain in results; ratings are not used to rank schedules.

#### Student-selected offerings

`POST /optimize` also accepts an optional `preferences.selectedOfferings` map keyed by course code. Each value must be the exact `offeringId` from the parsed subject options. The parser preserves an imported ID or generates the extension's canonical composite identity when the import has none. Supplying the map requires one choice for every subject; selected offerings are then checked by the normal slot and seat validation.

```json
{
  "preferences": {
    "mode": "PLANNING",
    "selectedOfferings": {
      "CSE1001": "[\"CSE1001\",\"THEORY\",[\"A11\"],\"FACULTY A\",\"AB01-101\"]"
    }
  }
}
```

The response adds `selectionValid`, `selectionErrors`, and `selectionConflicts`. Invalid IDs, missing choices, and ineligible selections return structured errors. A conflict includes both course codes, offering IDs, conflicting atomic slots, and `reason: "SLOT_CLASH"`. A valid selected timetable returns the selected offering ID and metadata with each course. Omitting `selectedOfferings` retains the existing behavior of returning schedule alternatives.

## Optimize

### `POST /optimize`
Runs the CP-SAT optimizer and returns top-N ranked timetables.

**Request body**
```json
{
  "subjects": [ /* array of Subject objects from /parse */ ],
  "preferences": {
    "timePreference": "morning",
    "maxGap": 2,
    "maxClassesPerDay": 5,
    "mode": "PLANNING",
    
    
    "preferredFreeDay": "Wednesday",
    "avoidSaturday": true,
    "avoidEarlyMorning": false,
    "walkingPriority": true
  },
  "topN": 20
}
```

**Response 200**
```json
{
  "timetables": [
    {
      "rank": 1,
      "score": {
        "overall": 87.4,
        "teacherScore": -1.0,
        "gapScore": 85.0,
        "travelScore": 78.0,
        "difficulty": 2.8,
        "attendance": 82.5,
        "morningScore": 90.0,
        "conflictCount": 0
      },
      "courses": [
        {
          "courseCode": "CSE1001",
          "courseName": "Engineering Mathematics",
          "facultyName": "Anil Kumar Sharma",
          "slot": "A1+TA1",
          "venue": "SJT-304",
          "building": "SJT",
          "credits": 4,
          "rating": null,
          "difficulty": 2.5,
          "attendance": 85.0
        }
      ],
      "grid": [
        {
          "day": "Monday",
          "timeSlot": "08:30–10:05",
          "slotCode": "A1",
          "courseCode": "CSE1001",
          "courseName": "Engineering Mathematics",
          "facultyName": "Anil Kumar Sharma",
          "venue": "SJT-304",
          "building": "SJT"
        }
      ]
    }
  ],
  "durationMs": 1240,
  "feasibleCount": 48
}
```

**Notes:**
- Runs the Google OR-Tools CP-SAT solver with an 8-second time limit
- Collects up to 60 feasible solutions, returns top-N re-sorted by multi-factor score
- Returns immediately if no feasible solution exists (hard constraint violation)

---

## Preferences

### `GET /preferences`
Returns the stored preferences object.

### `PUT /preferences`
Saves preferences. Body: same `PreferencesInput` schema as the `preferences` field in `/optimize`.

**Preference fields**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `timePreference` | `"morning"` \| `"evening"` \| `"balanced"` | `"balanced"` | Preferred time-of-day |
| `maxGap` | number | `4` | Max idle hours between classes per day |
| `maxClassesPerDay` | number | `5` | Hard cap on classes per day |
| `teacherPriority` | boolean | deprecated | Accepted for compatibility; ignored by optimizer |
| `prioritizeDifficulty` | boolean | deprecated | Accepted for compatibility; ignored by optimizer |
| `prioritizeAttendance` | boolean | deprecated | Accepted for compatibility; ignored by optimizer |
| `preferredFreeDay` | string \| null | `null` | Day with no classes (e.g. `"Wednesday"`) |
| `avoidSaturday` | boolean | `false` | Penalise Saturday classes |
| `avoidEarlyMorning` | boolean | `false` | Penalise 08:00 slots |
| `walkingPriority` | boolean | `false` | Minimise building switching |

---

## Timetables (Saved)

### `GET /timetables`
Returns list of saved timetables (without `grid` for brevity).

### `POST /timetables`
Save a timetable only after the API reparses the imported source JSON and reruns the optimizer with the complete exact-offering selection. Client-supplied scores, courses, grids, validation flags, and timestamps are ignored. Invalid selections return `422` and are not persisted. Body:
```json
{
  "name": "My Best Schedule",
  "notes": "Free Wednesday!",
  "rawData": "{\"schemaVersion\":\"1.5.0\",\"courses\":[...]}",
  "preferences": { "mode": "PLANNING" },
  "courseCodes": ["CSE1001", "MAT1001"],
  "selectedOfferings": {
    "CSE1001": "<exact offeringId>",
    "MAT1001": "<exact offeringId>"
  }
}
```

The response contains canonical timetable course details, score, and grid computed by the server. The source JSON is the import trust boundary; the API cannot independently verify that a user-provided export is authentic VTOP data.

### `GET /timetables/:id`
Returns full timetable including `grid`.

### `DELETE /timetables/:id`
Deletes a timetable. Returns `204 No Content`.

---

## History

### `GET /history`
Returns past optimization runs (most recent first, up to 50 entries, without the full subjects/preferences payload).

---

## Reference Data

### `GET /faculty/search?q=<query>`
Fuzzy-searches the bundled `faculty_ratings.csv`. Returns matching faculty with rating, difficulty, attendance, internalMarks, and building info.

### `GET /slots`
Returns the full FFCS slot schedule (all A1–TG2 theory slots and L1–L48 lab slots).

### `GET /buildings`
Returns campus buildings with walking penalty scores.

### `GET /stats`
Returns dashboard summary:
```json
{
  "savedTimetables": 3,
  "totalOptimizations": 12,
  "avgScore": 84,
  "lastOptimization": "2026-08-01T10:30:00.000Z"
}
```
