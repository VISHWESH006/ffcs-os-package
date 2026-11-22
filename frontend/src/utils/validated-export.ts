import type { PlannerState } from './storage';

export function hasCurrentValidation(state: PlannerState): boolean {
  const timetable = state.validatedTimetable;
  return Boolean(
    timetable && state.validation?.selectionValid === true &&
    timetable.courses.length === state.selectedCourses.length &&
    Object.keys(state.offeringSelections).length === state.selectedCourses.length &&
    timetable.courses.every(course => state.selectedCourses.includes(course.courseCode) &&
      state.offeringSelections[course.courseCode] === course.offeringId),
  );
}

export function makeValidatedExport(state: PlannerState) {
  if (!hasCurrentValidation(state) || !state.validatedTimetable) return null;
  return {
    schemaVersion: 'ffcs-validated-timetable-v1',
    validatedAt: new Date().toISOString(),
    mode: state.preferences.mode,
    selectedOfferings: { ...state.offeringSelections },
    timetable: state.validatedTimetable,
  };
}
