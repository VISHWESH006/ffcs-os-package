import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import type { Course, OptimizeResult, ParseResult, Preferences, RankedTimetable } from './types';
import { EMPTY_STATE } from './utils/storage';
import { hasCurrentValidation, makeValidatedExport } from './utils/validated-export';

const api = vi.hoisted(() => ({
  checkApiHealth: vi.fn(async () => true),
  parseImport: vi.fn(),
  optimize: vi.fn(),
  listSaved: vi.fn(async () => []),
  saveTimetable: vi.fn(async () => ({})),
  deleteSaved: vi.fn(async () => undefined),
}));
vi.mock('./api/client', () => api);

const courseData: Course[] = [
  { courseCode: 'CSE1001', courseName: 'Foundations of Computing', credits: 4, courseType: 'Theory', courseStructure: '3-0-0', options: [
    { facultyName: 'Faculty A', slot: 'A11', slots: ['A11'], slotVerificationStatus: 'CONFIRMED_THEORY', venue: 'AB01-101', building: 'AB01', seatsAvailable: 20, availableSeats: 20, seatState: 'AVAILABLE', componentType: 'Theory', offeringId: 'cse-a', missingFields: [], warnings: [] },
    { facultyName: 'Faculty B', slot: 'B11', slots: ['B11'], slotVerificationStatus: 'CONFIRMED_THEORY', venue: 'AB02-101', building: 'AB02', seatsAvailable: null, availableSeats: null, seatState: 'UNKNOWN', componentType: 'Theory', offeringId: 'cse-b', missingFields: [], warnings: [] },
  ] },
  { courseCode: 'MAT1001', courseName: 'Calculus', credits: 3, courseType: 'Theory', courseStructure: '3-0-0', options: [
    { facultyName: 'Faculty C', slot: 'A11', slots: ['A11'], slotVerificationStatus: 'CONFIRMED_THEORY', venue: 'AB01-102', building: 'AB01', seatsAvailable: 14, availableSeats: 14, seatState: 'AVAILABLE', componentType: 'Theory', offeringId: 'mat-a', missingFields: [], warnings: [] },
    { facultyName: 'Faculty D', slot: 'B11', slots: ['B11'], slotVerificationStatus: 'CONFIRMED_THEORY', venue: 'AB02-102', building: 'AB02', seatsAvailable: 8, availableSeats: 8, seatState: 'AVAILABLE', componentType: 'Theory', offeringId: 'mat-b', missingFields: [], warnings: [] },
  ] },
];

function timetable(map: Record<string, string>): RankedTimetable {
  return {
    rank: 1,
    score: { overall: 82, gapScore: 80, travelScore: 70, lunchScore: 90, morningScore: 75, preferenceMatch: 85 },
    grid: [],
    courses: courseData.filter(c => map[c.courseCode]).map(c => {
      const option = c.options.find(o => o.offeringId === map[c.courseCode])!;
      return { courseCode: c.courseCode, courseName: c.courseName, facultyName: option.facultyName, slot: option.slot, venue: option.venue, building: option.building, credits: c.credits, offeringId: option.offeringId, componentType: option.componentType, slots: option.slots, seatState: option.seatState };
    }),
  };
}

function result(map?: Record<string, string>, conflicts: OptimizeResult['selectionConflicts'] = []): OptimizeResult {
  const schedule = map ? timetable(map) : timetable({ CSE1001: 'cse-a', MAT1001: 'mat-b' });
  return { timetables: conflicts.length ? [] : [schedule], durationMs: 2, feasibleCount: conflicts.length ? 0 : 1, mode: 'PLANNING', infeasibleCourses: [], excludedOfferings: [], selectionValid: conflicts.length ? false : true, selectionErrors: [], selectionConflicts: conflicts };
}

async function importFixture() {
  fireEvent.click(screen.getByRole('button', { name: 'Import data' }));
  fireEvent.change(screen.getByPlaceholderText(/schemaVersion/i), { target: { value: '{"schemaVersion":"1.5.0","courses":[]}' } });
  fireEvent.click(screen.getByRole('button', { name: /import json/i }));
  await screen.findByRole('heading', { name: 'Course workspace' });
}

function courseCard(code: string) {
  return screen.getByText(code).closest('.course-card') as HTMLElement;
}

describe('student timetable workflow', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    api.checkApiHealth.mockResolvedValue(true);
    api.parseImport.mockResolvedValue({ schemaVersion: '1.5.0', subjects: courseData, errors: [], warnings: [], rejectedRecords: [], totalParsed: 4, invalidRecords: 0, validIncompleteRecords: 0, optimizerCompatibleRecords: 4, possibleMatches: [], extractionMetadata: {} } satisfies ParseResult);
    api.optimize.mockImplementation(async (_courses: Course[], preferences: Preferences) => {
      const map = preferences.selectedOfferings;
      if (map?.CSE1001 === 'cse-a' && map.MAT1001 === 'mat-a') {
        return result(map, [{ courseCodes: ['CSE1001', 'MAT1001'], offeringIds: ['cse-a', 'mat-a'], slots: ['A11'], reason: 'SLOT_CLASH' }]);
      }
      if (map) return result(map);
      return { ...result(), feasibleCount: 2, timetables: [timetable({ CSE1001: 'cse-a', MAT1001: 'mat-b' }), timetable({ CSE1001: 'cse-b', MAT1001: 'mat-a' })] };
    });
  });

  it('imports, selects exact offerings, rejects a clash and preserves the previous valid selection', async () => {
    render(<App />);
    await importFixture();
    expect(screen.getByRole('button', { name: 'Deselect CSE1001' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deselect MAT1001' })).toBeInTheDocument();
    fireEvent.click(within(courseCard('CSE1001')).getByRole('button', { name: 'Expand offerings' }));
    fireEvent.click(within(courseCard('CSE1001')).getAllByRole('button', { name: 'Choose offering' })[0]);
    fireEvent.click(within(courseCard('MAT1001')).getByRole('button', { name: 'Expand offerings' }));
    fireEvent.click(within(courseCard('MAT1001')).getAllByRole('button', { name: 'Choose offering' })[1]);
    expect(await screen.findByText('All selected offerings passed backend timetable validation.')).toBeInTheDocument();
    expect(api.optimize).toHaveBeenLastCalledWith(expect.any(Array), expect.objectContaining({ selectedOfferings: { CSE1001: 'cse-a', MAT1001: 'mat-b' } }), 20);
    fireEvent.click(screen.getByRole('button', { name: /timetable builder/i }));
    expect(screen.getByRole('button', { name: /save timetable/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /save timetable/i }));
    expect(await screen.findByText('Validated timetable saved.')).toBeInTheDocument();
    expect(api.optimize).toHaveBeenCalledTimes(2); // Selection validation plus a fresh backend check immediately before save.
    expect(api.saveTimetable).toHaveBeenCalledWith('My timetable', '{"schemaVersion":"1.5.0","courses":[]}', expect.objectContaining({ mode: 'LIVE_REGISTRATION' }), ['CSE1001', 'MAT1001'], { CSE1001: 'cse-a', MAT1001: 'mat-b' });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'evening' } });
    expect(screen.queryByRole('button', { name: /export json/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /course workspace/i }));

    fireEvent.click(within(courseCard('MAT1001')).getAllByRole('button', { name: 'Choose offering' })[0]);
    expect(await screen.findByText('CSE1001 and MAT1001 conflict at A11.')).toBeInTheDocument();
    expect(within(courseCard('MAT1001')).getByRole('button', { name: 'Selected' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /export json/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /timetable builder/i }));
    expect(screen.getByRole('heading', { name: 'This combination needs changes' })).toBeInTheDocument();
    const conflict = document.querySelector('.conflict-panel');
    expect(conflict?.querySelectorAll('.conflict-courses span')).toHaveLength(2);
    expect(conflict?.textContent).toContain('CSE1001');
    expect(conflict?.textContent).toContain('MAT1001 · A11 · SLOT_CLASH');
  });

  it('ignores an older validation response after a rapid required-course change', async () => {
    render(<App />);
    await importFixture();
    expect(screen.getByRole('button', { name: 'Deselect CSE1001' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deselect MAT1001' })).toBeInTheDocument();
    fireEvent.click(within(courseCard('CSE1001')).getByRole('button', { name: 'Expand offerings' }));
    fireEvent.click(within(courseCard('CSE1001')).getAllByRole('button', { name: 'Choose offering' })[0]);
    fireEvent.click(within(courseCard('MAT1001')).getByRole('button', { name: 'Expand offerings' }));

    let resolveOld!: (value: OptimizeResult) => void;
    api.optimize.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    fireEvent.click(within(courseCard('MAT1001')).getAllByRole('button', { name: 'Choose offering' })[1]);
    await waitFor(() => expect(api.optimize).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Deselect MAT1001' }));
    resolveOld(result({ CSE1001: 'cse-a', MAT1001: 'mat-b' }));
    await waitFor(() => expect(screen.queryByText('All selected offerings passed backend timetable validation.')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /timetable builder/i }));
    expect(screen.getByText(/1 required course · 4 credits/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /export json/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save timetable/i })).not.toBeInTheDocument();
  });

  it('keeps the removed slot explorer out of navigation while exposing the planner controls', async () => {
    render(<App />);
    await importFixture();
    expect(screen.queryByRole('button', { name: /slot explorer/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /timetable builder/i }));
    expect(screen.getByRole('checkbox', { name: /keep the lunch period free/i })).toBeInTheDocument();
    expect(screen.getAllByRole('combobox')[2]).toHaveValue('flexible');
  });

  it('requires backend validation before displaying save or export actions', async () => {
    render(<App />);
    await importFixture();
    fireEvent.click(screen.getByRole('button', { name: /timetable builder/i }));
    expect(screen.queryByRole('button', { name: /export json/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save timetable/i })).not.toBeInTheDocument();
  });

  it('keeps lunch preference independent of day scholar routine', async () => {
    render(<App />);
    await importFixture();
    fireEvent.click(screen.getByRole('button', { name: /timetable builder/i }));
    const routine = screen.getAllByRole('combobox')[2];
    const lunch = screen.getByRole('checkbox', { name: /keep the lunch period free/i });
    expect(lunch).toBeChecked();
    expect(lunch).toBeEnabled();
    fireEvent.change(routine, { target: { value: 'day-scholar' } });
    expect(lunch).toBeChecked();
    expect(lunch).toBeEnabled();
    fireEvent.change(routine, { target: { value: 'flexible' } });
    expect(lunch).toBeEnabled();
    expect(lunch).toBeChecked();
  });

  it('exports the exact selected offering IDs only for a current backend validation', () => {
    const current = {
      ...EMPTY_STATE,
      courses: courseData,
      selectedCourses: ['CSE1001', 'MAT1001'],
      offeringSelections: { CSE1001: 'cse-a', MAT1001: 'mat-b' },
      validation: result({ CSE1001: 'cse-a', MAT1001: 'mat-b' }),
      validatedTimetable: timetable({ CSE1001: 'cse-a', MAT1001: 'mat-b' }),
    };
    expect(hasCurrentValidation(current)).toBe(true);
    expect(makeValidatedExport(current)?.selectedOfferings).toEqual({ CSE1001: 'cse-a', MAT1001: 'mat-b' });
    expect(makeValidatedExport({ ...current, validation: null })).toBeNull();
    expect(makeValidatedExport({ ...current, offeringSelections: { ...current.offeringSelections, MAT1001: 'mat-a' } })).toBeNull();
  });

  it('searches and filters the imported course catalogue', async () => {
    render(<App />);
    await importFixture();
    fireEvent.change(screen.getByPlaceholderText(/search courses/i), { target: { value: 'calculus' } });
    expect(screen.getByText('MAT1001')).toBeInTheDocument();
    expect(screen.queryByText('CSE1001')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/search courses/i), { target: { value: '' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Lab' } });
    expect(screen.queryByText('CSE1001')).not.toBeInTheDocument();
    expect(screen.queryByText('MAT1001')).not.toBeInTheDocument();
  });

  it('does not send malformed JSON to the API', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Import data' }));
    fireEvent.change(screen.getByPlaceholderText(/schemaVersion/i), { target: { value: '{broken' } });
    fireEvent.click(screen.getByRole('button', { name: /import json/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/JSON|Unexpected/i);
    expect(api.parseImport).not.toHaveBeenCalled();
  });

  it('preserves unreadable local planner data and pauses writes with a visible warning', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('{truncated');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Existing data was not overwritten/);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('shows quota or storage write failures instead of silently claiming local persistence', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not save planner data: Quota exceeded/);
    expect(screen.getByRole('alert')).toHaveTextContent(/export important data before refreshing/i);
  });
});
