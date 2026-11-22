export type PageId = 'dashboard' | 'import' | 'courses' | 'builder' | 'saved';
export type SeatState = 'AVAILABLE' | 'FULL' | 'UNKNOWN' | string;

export interface Offering {
  facultyName: string | null;
  slotName?: string | null;
  slot: string;
  rawSlot?: string | null;
  slots: string[];
  slotVerificationStatus: 'CONFIRMED_THEORY' | 'CONTAINS_UNVERIFIED' | 'MISSING_OR_INVALID' | string;
  venue?: string | null;
  building?: string | null;
  room?: string | null;
  seatsAvailable?: number | null;
  availableSeats?: number | null;
  totalSeats?: number | null;
  seatState: SeatState;
  classStatus?: string | null;
  courseType?: string | null;
  componentType?: string | null;
  offeringId?: string | null;
  sourceOfferingId?: string | null;
  scopedSourceId?: string | null;
  missingFields: string[];
  warnings: string[];
  raw?: Record<string, unknown>;
}

export interface Course {
  courseCode: string;
  courseName: string;
  category?: string | null;
  credits: number;
  courseType?: string | null;
  options: Offering[];
  courseStructure?: string | null;
  source?: Record<string, unknown>;
}

export interface ParseResult {
  schemaVersion?: string | null;
  subjects: Course[];
  errors: string[];
  warnings: string[];
  rejectedRecords: Record<string, unknown>[];
  possibleMatches: Record<string, unknown>[];
  totalParsed: number;
  invalidRecords: number;
  validIncompleteRecords: number;
  optimizerCompatibleRecords: number;
  extractionMetadata: Record<string, unknown>;
}

export interface Preferences {
  mode: 'PLANNING' | 'LIVE_REGISTRATION';
  timePreference: 'morning' | 'evening' | 'balanced';
  maxGap: number;
  maxClassesPerDay: number;
  preferredFreeDay: string | null;
  avoidEarlyMorning: boolean;
  walkingPriority: boolean;
  mandatoryLunch: boolean;
  dayScholar: boolean;
  selectedOfferings?: Record<string, string>;
}

export interface TimetableCourse {
  courseCode: string;
  courseName: string;
  facultyName?: string | null;
  slot: string;
  venue?: string | null;
  building?: string | null;
  credits: number;
  offeringId?: string | null;
  componentType?: string | null;
  slots?: string[];
  seatState?: SeatState;
}

export interface TimetableCell {
  day: string;
  timeSlot: string;
  slotCode: string;
  courseCode: string;
  courseName: string;
  facultyName?: string | null;
  venue?: string | null;
  building?: string | null;
}

export interface RankedTimetable {
  rank: number;
  score: { overall: number; gapScore: number; travelScore: number | null; lunchScore: number; morningScore: number; preferenceMatch: number };
  grid: TimetableCell[];
  courses: TimetableCourse[];
}

export interface OptimizeResult {
  timetables: RankedTimetable[];
  durationMs: number;
  feasibleCount: number;
  mode: string;
  infeasibleExplanation?: string | null;
  infeasibleCourses: string[];
  excludedOfferings: { courseCode?: string; reason: string; slot?: string; facultyName?: string | null }[];
  selectionValid?: boolean | null;
  selectionErrors: { courseCode?: string; offeringId?: string; reason: string }[];
  selectionConflicts: { courseCodes: string[]; offeringIds: (string | null)[]; slots: string[]; reason: string }[];
  lunchPreferenceNote?: string | null;
  policyFallbackNote?: string | null;
  optimizationOptimal?: boolean;
}

export interface OfficialSlot {
  slotCode: string;
  day: string;
  timeStart: string;
  timeEnd: string;
  slotType: string;
}

export interface SavedTimetableSummary {
  id: number;
  name: string;
  score: { overall: number };
  courses: TimetableCourse[];
  grid: TimetableCell[];
  savedAt: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  mode: 'LIVE_REGISTRATION', timePreference: 'balanced', maxGap: 2, maxClassesPerDay: 6,
  preferredFreeDay: null, avoidEarlyMorning: false, walkingPriority: true, mandatoryLunch: true, dayScholar: false,
};
