# Lunch preference

“Keep the lunch period free” is a soft preference for every student. The checkbox is independent of the Day Scholar choice, remains enabled for both routines, and never removes a course offering or rejects an otherwise valid schedule.

## Slot data

The optimizer uses the confirmed periods in [`backend/data/slots.csv`](../backend/data/slots.csv). In particular, C11/F11/C12/F12/C13/F13 start at 11:40 and A21/D21/A22/D22/A23/D23 start at 13:15. The two slots do not overlap in the verified mapping.

When lunch preference is enabled, `_score_lunch` gives a soft cost for a 13:15 class and an additional cost if the same day also has an 11:40 class. Day Scholar status does not alter this score. Lunch never becomes a hard prohibition.

The optimizer enumerates feasible CP-SAT assignments and ranks them with the full timetable score. It reports `optimizationOptimal` to distinguish completed enumeration from a search interrupted by the eight-second time limit. See [OPTIMIZATION_FLOW.md](OPTIMIZATION_FLOW.md) for hard constraints, Morning/Evening policy tiers, score/search behavior, and the actual flowchart.
