import type { Course, OptimizeResult, Preferences, RankedTimetable } from '../types';

const KEY = 'ffcs-student-planner-v1';
const LIVE_MODE_MIGRATION_KEY = 'ffcs-live-registration-default-migrated';
const storageKey = (uid: string) => `${KEY}:${encodeURIComponent(uid)}`;
const migrationKey = (uid: string) => `${LIVE_MODE_MIGRATION_KEY}:${encodeURIComponent(uid)}`;
export interface PlannerState {
  courses: Course[];
  selectedCourses: string[];
  offeringSelections: Record<string, string>;
  preferences: Preferences;
  latestAlternatives: RankedTimetable[];
  validatedTimetable: RankedTimetable | null;
  validation: OptimizeResult | null;
  importWarnings: string[];
  importRawData: string;
  importMeta: { totalParsed: number; invalidRecords: number; validIncompleteRecords: number; optimizerCompatibleRecords: number; possibleMatches: Record<string, unknown>[] } | null;
}

export interface StoredStateRead<T> {
  value: T;
  error: string | null;
  writable: boolean;
}

export function readStoredState<T>(fallback: T, uid = 'anonymous'): StoredStateRead<T> {
  try {
    const raw = localStorage.getItem(storageKey(uid));
    if (!raw) return { value: fallback, error: null, writable: true };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { value: fallback, error: 'Stored planner data has an invalid structure and was left untouched.', writable: false };
    }
    const fallbackObject = fallback as Record<string, unknown>;
    const parsedObject = parsed as Record<string, unknown>;
    const merged = { ...fallbackObject, ...parsedObject };
    if (fallbackObject.preferences && typeof fallbackObject.preferences === 'object') {
      const restoredPreferences = parsedObject.preferences;
      merged.preferences = {
        ...fallbackObject.preferences as object,
        ...(restoredPreferences && typeof restoredPreferences === 'object' ? restoredPreferences as object : {}),
      };
      const preferences = merged.preferences as Record<string, unknown>;
      // Clear retired controls; Day Scholar and lunch preferences are independent.
      preferences.avoidEarlyMorning = false;
      if (typeof preferences.mandatoryLunch !== 'boolean') preferences.mandatoryLunch = true;
      delete preferences.allowLunchFallback;
      if (!localStorage.getItem(migrationKey(uid))) {
        if (preferences.mode === 'PLANNING') preferences.mode = 'LIVE_REGISTRATION';
        localStorage.setItem(migrationKey(uid), 'done');
      }
    }
    return { value: merged as T, error: null, writable: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Browser storage is unavailable.';
    return { value: fallback, error: `Could not read saved planner data: ${message}. Existing data was not overwritten.`, writable: false };
  }
}

export function writeStoredState(value: unknown, uid = 'anonymous'): { ok: true } | { ok: false; error: string } {
  try {
    localStorage.setItem(storageKey(uid), JSON.stringify(value));
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Browser storage is unavailable.';
    return { ok: false, error: `Could not save planner data: ${message}. Current changes may only remain in this tab; export important data before refreshing.` };
  }
}

export function clearStoredState(uid: string): void {
  localStorage.removeItem(storageKey(uid));
  localStorage.removeItem(migrationKey(uid));
}

export const EMPTY_STATE: PlannerState = {
  courses: [], selectedCourses: [], offeringSelections: {},
  preferences: { mode: 'LIVE_REGISTRATION', timePreference: 'balanced', maxGap: 2, maxClassesPerDay: 6, preferredFreeDay: null, avoidEarlyMorning: false, walkingPriority: true, mandatoryLunch: true, dayScholar: false },
  latestAlternatives: [], validatedTimetable: null, validation: null, importWarnings: [], importRawData: '', importMeta: null,
};
