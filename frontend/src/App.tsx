import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import {
  ArrowRight, BookOpen, CalendarDays, Check, CheckCircle2, ChevronDown,
  ChevronRight, CircleHelp, Clock3, FileJson2, Filter, GraduationCap, LayoutDashboard,
  LoaderCircle, LogOut, MapPin, Menu, MoreHorizontal, Printer, Search, Settings2, Sparkles, Trash2,
  Upload, Users, X,
} from 'lucide-react';
import { checkApiHealth, deleteAccount as deleteAccountApi, deleteSaved, listSaved, optimize, parseImport, saveTimetable } from './api/client';
import slots from './data/slots.json';
import type { Course, OfficialSlot, Offering, OptimizeResult, PageId, Preferences, RankedTimetable, SavedTimetableSummary } from './types';
import { clearStoredState, EMPTY_STATE, readStoredState, writeStoredState, type PlannerState } from './utils/storage';
import { hasCurrentValidation } from './utils/validated-export';
import { useAuth } from './auth/AuthContext';
import { trackPageView } from './analytics';

const NAV: { id: PageId; title: string; icon: typeof LayoutDashboard; group: string }[] = [
  { id: 'dashboard', title: 'Overview', icon: LayoutDashboard, group: 'Workspace' },
  { id: 'import', title: 'Import data', icon: FileJson2, group: 'Workspace' },
  { id: 'courses', title: 'Course workspace', icon: BookOpen, group: 'Plan' },
  { id: 'builder', title: 'Timetable builder', icon: Sparkles, group: 'Plan' },
  { id: 'saved', title: 'My timetables', icon: CheckCircle2, group: 'Library' },
];
const DAY_NAMES: Record<string, string> = { MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday' };
const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const defaultPrefs: Preferences = { mode: 'LIVE_REGISTRATION', timePreference: 'balanced', maxGap: 2, maxClassesPerDay: 6, preferredFreeDay: null, avoidEarlyMorning: false, walkingPriority: true, mandatoryLunch: true, dayScholar: false };

function usePlanner(uid: string) {
  const [initial] = useState(() => readStoredState(EMPTY_STATE, uid));
  const [state, setState] = useState<PlannerState>(initial.value);
  const [storageIssue, setStorageIssue] = useState<string | null>(initial.error);
  const [storageWritable, setStorageWritable] = useState(initial.writable);
  useEffect(() => {
    if (!storageWritable) return;
    const result = writeStoredState(state, uid);
    if (!result.ok) {
      setStorageWritable(false);
      setStorageIssue(result.error);
    }
  }, [state, storageWritable, uid]);
  return [state, setState, storageIssue] as const;
}

function App() {
  const { user, signOut, reauthenticate } = useAuth();
  const uid = user?.uid ?? 'anonymous';
  const [state, setState, storageIssue] = usePlanner(uid);
  const [page, setPage] = useState<PageId>('dashboard');
  const [mobileNav, setMobileNav] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [validationAttempt, setValidationAttempt] = useState<OptimizeResult | null>(null);
  const [alternatives, setAlternatives] = useState<RankedTimetable[]>(state.latestAlternatives);
  const [previewRank, setPreviewRank] = useState<number | null>(state.latestAlternatives[0]?.rank ?? null);
  const [compareRanks, setCompareRanks] = useState<number[]>([]);
  const [saved, setSaved] = useState<SavedTimetableSummary[]>([]);
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [apiReady, setApiReady] = useState<boolean | null>(null);
  const [search, setSearch] = useState('');
  const [courseFilter, setCourseFilter] = useState('All courses');
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [saveName, setSaveName] = useState('My timetable');
  const [printRequest, setPrintRequest] = useState<{ timetable: RankedTimetable; title: string } | null>(null);
  const requestRevision = useRef(0);
  const currentState = useRef(state);
  currentState.current = state;

  function invalidateRequests() {
    const revision = ++requestRevision.current;
    setBusy(false);
    return revision;
  }

  const selectedCourses = useMemo(() => state.courses.filter(c => state.selectedCourses.includes(c.courseCode)), [state.courses, state.selectedCourses]);
  const filteredCourses = useMemo(() => state.courses.filter(course => {
    const query = search.trim().toLowerCase();
    const match = !query || course.courseCode.toLowerCase().includes(query) || course.courseName.toLowerCase().includes(query);
    const type = courseFilter === 'All courses' || (course.courseType ?? 'Unknown') === courseFilter;
    return match && type;
  }), [state.courses, search, courseFilter]);
  const readyToValidate = selectedCourses.length > 0 && selectedCourses.every(c => Boolean(state.offeringSelections[c.courseCode]));

  useEffect(() => {
    checkApiHealth().then(setApiReady);
  }, []);

  useEffect(() => { trackPageView(page); }, [page]);

  useEffect(() => {
    if (!printRequest) return;
    const finishPrinting = () => setPrintRequest(null);
    window.addEventListener('afterprint', finishPrinting);
    const timer = window.setTimeout(() => {
      window.print();
      window.setTimeout(finishPrinting, 500);
    }, 200);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', finishPrinting);
    };
  }, [printRequest]);

  useEffect(() => {
    if (page === 'saved' && !savedLoaded) {
      listSaved().then(setSaved).catch(error => setNotice({ type: 'error', text: error.message })).finally(() => setSavedLoaded(true));
    }
  }, [page, savedLoaded]);

  function changePage(next: PageId) {
    invalidateRequests();
    setPage(next);
    setMobileNav(false);
    setNotice(null);
  }

  async function handleImport(raw: string, name = 'pasted JSON') {
    const revision = invalidateRequests();
    setBusy(true); setNotice(null);
    try {
      JSON.parse(raw);
      const result = await parseImport(raw);
      if (revision !== requestRevision.current) return;
      if (result.errors?.length && !result.subjects?.length) throw new Error(result.errors.join(' '));
      const importedCourses = result.subjects ?? [];
      setState({
        ...EMPTY_STATE,
        courses: importedCourses,
        selectedCourses: importedCourses.map(course => course.courseCode),
        importRawData: raw,
        importWarnings: [...(result.errors ?? []), ...(result.warnings ?? [])],
        importMeta: { totalParsed: result.totalParsed, invalidRecords: result.invalidRecords, validIncompleteRecords: result.validIncompleteRecords, optimizerCompatibleRecords: result.optimizerCompatibleRecords, possibleMatches: result.possibleMatches ?? [] },
        preferences: { ...defaultPrefs },
      });
      setAlternatives([]);
      setPreviewRank(null);
      setFileName(name);
      setNotice({ type: importedCourses.length ? 'success' : 'info', text: `${importedCourses.length} course${importedCourses.length === 1 ? '' : 's'} imported and selected from ${name}. Choose a schedule option to review offerings.` });
      setPage('courses');
    } catch (error) {
      if (revision !== requestRevision.current) return;
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not import this file.' });
    } finally { if (revision === requestRevision.current) setBusy(false); }
  }

  function handleFile(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => void handleImport(String(reader.result ?? ''), file.name);
    reader.onerror = () => setNotice({ type: 'error', text: 'The selected file could not be read.' });
    reader.readAsText(file);
  }

  function clearImportedData() {
    if (!state.courses.length) return;
    const confirmed = window.confirm('Clear the imported courses and current planning selections? Saved timetables will be kept.');
    if (!confirmed) return;

    invalidateRequests();
    setState({ ...EMPTY_STATE });
    setAlternatives([]);
    setPreviewRank(null);
    setCompareRanks([]);
    setValidationAttempt(null);
    setExpandedCourse(null);
    setSearch('');
    setCourseFilter('All courses');
    setFileName('');
    setJsonText('');
    setNotice({ type: 'success', text: 'Imported course data and planning selections cleared. Saved timetables were kept.' });
  }

  function toggleCourse(code: string) {
    invalidateRequests();
    setValidationAttempt(null);
    setState(prev => {
      const selected = new Set(prev.selectedCourses);
      const choices = { ...prev.offeringSelections };
      if (selected.has(code)) { selected.delete(code); delete choices[code]; }
      else selected.add(code);
      return { ...prev, selectedCourses: [...selected], offeringSelections: choices, validation: null, validatedTimetable: null, latestAlternatives: [] };
    });
    setAlternatives([]);
    setPreviewRank(null);
  }

  async function validateSelection(selectionMap: Record<string, string>, courseCodes = state.selectedCourses, commitOnValid = true, preserveOptionRank?: number) {
    const chosen = state.courses.filter(c => courseCodes.includes(c.courseCode));
    if (!chosen.length || chosen.length !== Object.keys(selectionMap).length || chosen.some(c => !selectionMap[c.courseCode])) {
      setNotice({ type: 'info', text: 'Choose one specific offering for every required course before validating the complete timetable.' });
      return false;
    }
    const revision = ++requestRevision.current;
    const sourceSnapshot = JSON.stringify([state.courses, state.selectedCourses, state.preferences, state.importRawData]);
    setBusy(true); setNotice(null);
    try {
      const result = await optimize(chosen, { ...state.preferences, selectedOfferings: selectionMap }, 20);
      if (revision !== requestRevision.current || sourceSnapshot !== JSON.stringify([currentState.current.courses, currentState.current.selectedCourses, currentState.current.preferences, currentState.current.importRawData])) return false;
      const timetable = result.selectionValid === true && result.timetables.length ? result.timetables[0] : null;
      if (!timetable) {
        setValidationAttempt(result);
        const conflict = result.selectionConflicts?.[0];
        const reason = conflict ? `${conflict.courseCodes.join(' and ')} conflict at ${conflict.slots.join(', ')}.` : result.selectionErrors?.map(e => `${e.courseCode ?? 'Selection'}: ${e.reason}`).join(' · ') || result.infeasibleExplanation || 'The selected offerings could not be validated.';
        setNotice({ type: 'error', text: reason });
        return false;
      }
      if (commitOnValid) {
        const previewTimetable = preserveOptionRank === undefined ? timetable : { ...timetable, rank: preserveOptionRank };
        setValidationAttempt(null);
        setState(prev => ({
          ...prev,
          offeringSelections: selectionMap,
          validation: result,
          validatedTimetable: timetable,
          latestAlternatives: preserveOptionRank === undefined
            ? [timetable]
            : prev.latestAlternatives.map(option => option.rank === preserveOptionRank ? previewTimetable : option),
        }));
        if (preserveOptionRank === undefined) setAlternatives([timetable]);
        else setAlternatives(current => current.map(option => option.rank === preserveOptionRank ? previewTimetable : option));
        setPreviewRank(preserveOptionRank ?? timetable.rank);
      }
      setNotice({ type: 'success', text: result.lunchPreferenceNote ? `All selected offerings passed backend timetable validation. ${result.lunchPreferenceNote}` : 'All selected offerings passed backend timetable validation.' });
      return true;
    } catch (error) {
      setValidationAttempt(null);
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Validation request failed.' });
      return false;
    } finally { if (revision === requestRevision.current) setBusy(false); }
  }

  async function changeOffering(courseCode: string, offeringId: string) {
    invalidateRequests();
    setValidationAttempt(null);
    if (!state.selectedCourses.includes(courseCode)) {
      setNotice({ type: 'info', text: 'Select this course as required before choosing an offering.' });
      return;
    }
    const candidate = { ...state.offeringSelections, [courseCode]: offeringId };
    const allChosen = state.selectedCourses.every(code => Boolean(candidate[code]));
    if (!allChosen) {
      setState(prev => ({ ...prev, offeringSelections: candidate, validation: null, validatedTimetable: null, latestAlternatives: [] }));
      setAlternatives([]);
      setPreviewRank(null);
      setNotice({ type: 'info', text: 'Choice saved. Select an offering for each remaining course to validate the complete timetable.' });
      return;
    }
    // Keep the last valid map in state while checking the candidate. A conflicting change is rejected.
    await validateSelection(candidate, state.selectedCourses, true, previewRank ?? undefined);
  }

  async function generateAlternatives() {
    const revision = ++requestRevision.current;
    const sourceSnapshot = JSON.stringify([state.courses, state.selectedCourses, state.preferences, state.importRawData]);
    setValidationAttempt(null);
    if (!selectedCourses.length) { setNotice({ type: 'info', text: 'Select at least one required course first.' }); return; }
    setBusy(true); setNotice(null);
    try {
      const result = await optimize(selectedCourses, state.preferences, 20);
      if (revision !== requestRevision.current || sourceSnapshot !== JSON.stringify([currentState.current.courses, currentState.current.selectedCourses, currentState.current.preferences, currentState.current.importRawData])) return;
      setAlternatives(result.timetables ?? []);
      setPreviewRank(result.timetables?.[0]?.rank ?? null);
      setCompareRanks([]);
      setState(prev => ({ ...prev, latestAlternatives: result.timetables ?? [], validation: result, validatedTimetable: null }));
      if (!result.timetables?.length) setNotice({ type: 'error', text: result.infeasibleExplanation ?? `No valid schedule was found. ${result.excludedOfferings?.length ?? 0} offerings were excluded by validation.` });
      else setNotice({ type: 'success', text: `${result.feasibleCount} valid timetable option${result.feasibleCount === 1 ? '' : 's'} generated. Choose an option to confirm its exact offerings.${result.lunchPreferenceNote ? ` ${result.lunchPreferenceNote}` : ''}` });
    } catch (error) { if (revision === requestRevision.current) setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Optimization failed.' }); }
    finally { if (revision === requestRevision.current) setBusy(false); }
  }

  function toggleCompare(rank: number) {
    setCompareRanks(current => current.includes(rank)
      ? current.filter(value => value !== rank)
      : current.length < 2 ? [...current, rank] : [current[1], rank]);
  }

  async function chooseAlternative(timetable: RankedTimetable) {
    const map: Record<string, string> = {};
    for (const course of timetable.courses) if (course.offeringId) map[course.courseCode] = course.offeringId;
    await validateSelection(map, state.selectedCourses, true, timetable.rank);
  }

  async function changePreviewOffering(timetable: RankedTimetable, courseCode: string, offeringId: string) {
    const map = Object.fromEntries(timetable.courses.flatMap(course => course.offeringId
      ? [[course.courseCode, course.offeringId]]
      : []));
    map[courseCode] = offeringId;
    await validateSelection(map, state.selectedCourses, true, timetable.rank);
  }

  function changePreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    invalidateRequests();
    setValidationAttempt(null);
    setState(prev => ({ ...prev, preferences: {
      ...prev.preferences,
      [key]: value,
    }, validation: null, validatedTimetable: null, latestAlternatives: [] }));
    setAlternatives([]);
    setPreviewRank(null);
  }

  async function verifyCurrentSelection() {
    if (busy) return null;
    const chosen = state.courses.filter(course => state.selectedCourses.includes(course.courseCode));
    const map = state.offeringSelections;
    if (!chosen.length || chosen.length !== Object.keys(map).length || chosen.some(course => !map[course.courseCode])) {
      setNotice({ type: 'error', text: 'Choose one offering for every required course before saving or exporting.' });
      return null;
    }
    const revision = ++requestRevision.current;
    const sourceSnapshot = JSON.stringify([state.courses, state.selectedCourses, state.preferences, state.offeringSelections, state.importRawData]);
    setBusy(true);
    try {
      const result = await optimize(chosen, { ...state.preferences, selectedOfferings: map }, 1);
      if (revision !== requestRevision.current || sourceSnapshot !== JSON.stringify([currentState.current.courses, currentState.current.selectedCourses, currentState.current.preferences, currentState.current.offeringSelections, currentState.current.importRawData])) return null;
      const timetable = result.selectionValid === true ? result.timetables[0] : null;
      const refreshed = { ...state, validation: result, validatedTimetable: timetable ?? null };
      if (!timetable || !hasCurrentValidation(refreshed)) {
        setValidationAttempt(result);
        setState(prev => ({ ...prev, validation: null, validatedTimetable: null }));
        const conflict = result.selectionConflicts[0];
        setNotice({ type: 'error', text: conflict ? `${conflict.courseCodes.join(' and ')} conflict at ${conflict.slots.join(', ')}.` : result.infeasibleExplanation || 'Backend validation failed. The timetable was not saved or exported.' });
        return null;
      }
      setValidationAttempt(null);
      setState(prev => ({ ...prev, validation: result, validatedTimetable: timetable, latestAlternatives: [timetable] }));
      return { result, timetable, revision, rawData: state.importRawData, preferences: { ...state.preferences }, courseCodes: [...state.selectedCourses], selectedOfferings: { ...map } };
    } catch (error) {
      if (revision !== requestRevision.current) return null;
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not revalidate this timetable.' });
      return null;
    } finally { if (revision === requestRevision.current) setBusy(false); }
  }

  async function exportPdf() {
    const fresh = await verifyCurrentSelection();
    if (!fresh) return;
    setPrintRequest({ timetable: fresh.timetable, title: saveName.trim() || 'My timetable' });
  }

  async function saveValidated() {
    const fresh = await verifyCurrentSelection();
    if (!fresh) return;
    if (fresh.revision !== requestRevision.current) return;
    setBusy(true);
    try {
      await saveTimetable(saveName.trim() || 'My timetable', fresh.rawData, fresh.preferences, fresh.courseCodes, fresh.selectedOfferings);
      setSavedLoaded(false);
      setNotice({ type: 'success', text: 'Validated timetable saved.' });
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Save failed.' }); }
    finally { setBusy(false); }
  }

  async function removeSaved(id: number) {
    try { await deleteSaved(id); setSaved(current => current.filter(t => t.id !== id)); }
    catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not delete saved timetable.' }); }
  }

  async function deleteAccount() {
    if (!user || !window.confirm('Permanently delete your Google sign-in and all saved FFCS OS data for this account? This cannot be undone.')) return;
    try {
      await reauthenticate();
      await deleteAccountApi();
      clearStoredState(uid);
      await signOut();
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Account deletion could not be completed.' });
    }
  }

  const activeTitle = NAV.find(item => item.id === page)?.title ?? 'Overview';
  const offeringCount = state.courses.reduce((sum, course) => sum + course.options.length, 0);

  return (
    <>
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="brand"><span className="brand-mark"><GraduationCap size={20} /></span><div><strong>ffcs<span>os</span></strong><small>STUDENT PLANNER</small></div><button className="icon-btn mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={18} /></button></div>
        <div className="term-chip"><span className="status-dot" />LOCAL WORKSPACE <ChevronDown size={13} /></div>
        {['Workspace', 'Plan', 'Library'].map(group => <div className="nav-group" key={group}><p className="nav-label">{group}</p>{NAV.filter(item => item.group === group).map(item => <button key={item.id} onClick={() => changePage(item.id)} className={`nav-link ${page === item.id ? 'active' : ''}`}><item.icon size={17} /><span>{item.title}</span>{item.id === 'courses' && state.selectedCourses.length > 0 && <i>{state.selectedCourses.length}</i>}</button>)}</div>)}
        <div className="sidebar-bottom"><div className="local-note"><span className="shield-dot" /><div><b>Your data stays local</b><small>Planner data is stored in this browser.</small></div></div><div className="profile"><div className="avatar">S</div><div><b>Student workspace</b><small>VIT Bhopal</small></div><MoreHorizontal size={18} className="profile-more" /></div></div>
      </aside>
      {mobileNav && <button className="scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
      <main className="main-area">
        <header className="topbar"><button className="icon-btn mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={20} /></button><div className="breadcrumbs"><span>FFCS OS</span><ChevronRight size={14} /><b>{activeTitle}</b></div><div className="top-actions"><span className={`api-status ${apiReady === false ? 'api-disconnected' : ''}`}><span className="status-dot" />{apiReady === null ? 'Checking API' : apiReady ? 'API connected' : 'API unavailable'}</span><span className="account-email">{user?.email}</span><button className="icon-btn auth-action" onClick={() => void signOut()} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button><button className="icon-btn auth-action auth-delete" onClick={() => void deleteAccount()} aria-label="Delete account" title="Delete account"><Trash2 size={17} /></button></div></header>
        <div className="page-wrap">
          {storageIssue && <div role="alert" className="notice notice-error"><span>{storageIssue}</span></div>}
          {notice && <div role="status" className={`notice notice-${notice.type}`}><span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="Dismiss notice"><X size={16} /></button></div>}
          {page === 'dashboard' && <Dashboard state={state} selectedCount={selectedCourses.length} offeringCount={offeringCount} navigate={changePage} />}
          {page === 'import' && <ImportPage busy={busy} filename={fileName} jsonText={jsonText} setJsonText={setJsonText} onFile={handleFile} onImport={() => void handleImport(jsonText)} onReset={clearImportedData} state={state} />}
          {page === 'courses' && <CoursesPage courses={filteredCourses} selected={state.selectedCourses} selections={state.offeringSelections} expanded={expandedCourse} setExpanded={setExpandedCourse} toggleCourse={toggleCourse} changeOffering={changeOffering} busy={busy} search={search} setSearch={setSearch} filter={courseFilter} setFilter={setCourseFilter} />}
          {page === 'builder' && <BuilderPage state={state} validationAttempt={validationAttempt} selectedCourses={selectedCourses} alternatives={alternatives} previewRank={previewRank} setPreviewRank={setPreviewRank} compareRanks={compareRanks} onToggleCompare={toggleCompare} onClearCompare={() => setCompareRanks([])} busy={busy} readyToValidate={readyToValidate} onPreference={changePreference} onGenerate={generateAlternatives} onChoose={chooseAlternative} onPreviewOffering={changePreviewOffering} onChangeOffering={changeOffering} onValidate={() => void validateSelection(state.offeringSelections)} onExportPdf={exportPdf} onSave={saveValidated} saveName={saveName} setSaveName={setSaveName} />}
          {page === 'saved' && <SavedPage saved={saved} loading={!savedLoaded} onDelete={removeSaved} />}
        </div>
      </main>
    </div>
    {printRequest && <main className="print-root"><header className="print-heading"><div><b>FFCS OS · STUDENT PLANNER</b><h1>{printRequest.title}</h1></div><span>Validated timetable · {new Date().toLocaleDateString()}</span></header><TimetableView timetable={printRequest.timetable} /><p className="print-footnote">Times and slot codes follow the official timetable map. Confirm final registration details on VTOP.</p></main>}
    </>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="subheading">{description}</p></div>{action && <div className="heading-action">{action}</div>}</div>;
}

function Dashboard({ state, selectedCount, offeringCount, navigate }: { state: PlannerState; selectedCount: number; offeringCount: number; navigate: (page: PageId) => void }) {
  const knownAvailableSeats = state.courses.flatMap(course => course.options)
    .filter(option => option.seatState === 'AVAILABLE')
    .reduce((sum, option) => sum + (option.seatsAvailable ?? option.availableSeats ?? 0), 0);
  const sectionsWithSeats = state.courses.flatMap(course => course.options)
    .filter(option => option.seatState === 'AVAILABLE' && (option.seatsAvailable ?? option.availableSeats ?? 0) > 0).length;
  const stats = [
    { label: 'Imported courses', value: state.courses.length, note: state.courses.length ? 'In current dataset' : 'Import data to begin', icon: BookOpen, color: 'mint' },
    { label: 'Available offerings', value: offeringCount, note: 'Across imported courses', icon: Users, color: 'lavender' },
    { label: 'Required courses', value: selectedCount, note: selectedCount ? 'Selected for planning' : 'Choose from workspace', icon: CheckCircle2, color: 'peach' },
    { label: 'Known available seats', value: state.courses.length ? knownAvailableSeats : '—', note: `${sectionsWithSeats} sections report positive seats`, icon: Users, color: 'blue' },
    { label: 'Confirmed timetable', value: state.validatedTimetable ? 'Ready' : '—', note: state.validatedTimetable ? 'Backend validated' : 'Not validated yet', icon: CalendarDays, color: 'blue' },
  ];
  return <><PageHeading eyebrow="YOUR PLANNING SPACE" title="Plan your semester" description="Build a timetable around the courses and offerings you choose." action={<button className="btn btn-primary" onClick={() => navigate(state.courses.length ? 'courses' : 'import')}><Sparkles size={16} />{state.courses.length ? 'Continue planning' : 'Import course data'}</button>} />
    <section className="stat-grid">{stats.map(item => <div className="stat-card" key={item.label}><div className={`stat-icon ${item.color}`}><item.icon size={18} /></div><span className="stat-label">{item.label}</span><strong className="stat-value">{item.value}</strong><small>{item.note}</small></div>)}</section>
    <section className="dashboard-grid"><div className="panel journey-panel"><div className="panel-head"><div><p className="eyebrow">GETTING STARTED</p><h2>Your planning flow</h2></div><span className="muted-small">{state.courses.length ? 'In progress' : '4 simple steps'}</span></div><div className="journey-list">{[
      { n: '01', title: 'Import your VTOP data', detail: 'Use the JSON export from the FFCS browser extension.', id: 'import' as PageId, done: state.courses.length > 0 },
      { n: '02', title: 'Choose your courses', detail: 'Explore real offerings and mark the courses you need.', id: 'courses' as PageId, done: selectedCount > 0 },
      { n: '03', title: 'Explore timetable options', detail: 'Review slot combinations and choose your preferred sections.', id: 'builder' as PageId, done: Boolean(state.validatedTimetable) },
      { n: '04', title: 'Save a validated schedule', detail: 'Export or save only after the backend confirms your choices.', id: 'builder' as PageId, done: false },
    ].map(step => <button className="journey-step" key={step.n} onClick={() => navigate(step.id)}><span className={`step-number ${step.done ? 'done' : ''}`}>{step.done ? <Check size={14} /> : step.n}</span><span className="step-copy"><b>{step.title}</b><small>{step.detail}</small></span><ChevronRight size={17} className="journey-arrow" /></button>)}</div></div>
      <div className="panel status-panel"><div className="panel-head"><div><p className="eyebrow">DATA STATUS</p><h2>Current import</h2></div><FileJson2 size={18} className="muted-icon" /></div>{state.courses.length ? <><div className="import-ready"><span className="ready-icon"><CheckCircle2 size={19} /></span><div><b>Data is ready to plan</b><small>{state.importMeta?.totalParsed ?? offeringCount} offerings parsed</small></div></div><div className="status-rows"><div><span>Incomplete records</span><b>{state.importMeta?.validIncompleteRecords ?? 0}</b></div><div><span>Invalid records</span><b>{state.importMeta?.invalidRecords ?? 0}</b></div><div><span>Possible matches</span><b>{state.importMeta?.possibleMatches.length ?? 0}</b></div></div><button className="btn btn-secondary full-btn" onClick={() => navigate('import')}>Replace imported dataset <ArrowRight size={15} /></button></> : <div className="empty-small"><FileJson2 size={25} /><p>No course data imported</p><button className="text-btn" onClick={() => navigate('import')}>Import a JSON export <ArrowRight size={14} /></button></div>}</div></section>
    {state.importWarnings.length > 0 && <section className="panel warnings-panel"><div className="panel-head"><div><p className="eyebrow">IMPORT REVIEW</p><h2>Data notes <span className="count-badge">{state.importWarnings.length}</span></h2></div><CircleHelp size={17} className="muted-icon" /></div><ul>{state.importWarnings.slice(0, 5).map((warning, i) => <li key={`${warning}-${i}`}>{warning}</li>)}</ul></section>}
  </>;
}

function ImportPage({ busy, filename, jsonText, setJsonText, onFile, onImport, onReset, state }: { busy: boolean; filename: string; jsonText: string; setJsonText: (v: string) => void; onFile: (file?: File) => void; onImport: () => void; onReset: () => void; state: PlannerState }) {
  return <><PageHeading eyebrow="START WITH YOUR DATA" title="Import VTOP data" description="Load the JSON export from the FFCS extension. Imports replace the current dataset so unrelated sessions are never merged." />
    <div className="import-layout"><section className="panel import-panel"><div className="panel-head"><div><p className="eyebrow">JSON IMPORT</p><h2>Bring in your course offerings</h2></div><span className="tag tag-neutral">v1.5.0 supported</span></div><label className="dropzone"><input key={filename || 'empty'} type="file" accept="application/json,.json" onChange={e => onFile(e.target.files?.[0])} /><span className="drop-icon"><Upload size={20} /></span><b>Choose a JSON file</b><small>Extension exports and supported legacy arrays · max size depends on browser</small><span className="btn btn-secondary btn-compact">Browse files</span></label>{filename && <div className="file-pill"><FileJson2 size={16} /><span>{filename}</span><CheckCircle2 size={16} className="success-icon" /></div>}<div className="divider-label"><span />or paste JSON<span /></div><textarea className="json-input" value={jsonText} onChange={e => setJsonText(e.target.value)} placeholder={'{\n  "schemaVersion": "1.5.0",\n  "courses": [...]\n}'} spellCheck={false} /><div className="import-actions"><small>Data is sent to the local FFCS API for parsing.</small><button className="btn btn-primary" disabled={busy || !jsonText.trim()} onClick={onImport}>{busy ? <LoaderCircle size={16} className="spin" /> : <Upload size={16} />}Import JSON</button></div></section>
      <aside className="panel import-aside"><div className="panel-head"><div><p className="eyebrow">ABOUT YOUR DATA</p><h2>What gets imported</h2></div></div><ul className="check-list"><li><CheckCircle2 size={16} />Course codes, names and credits</li><li><CheckCircle2 size={16} />Distinct faculty and slot offerings</li><li><CheckCircle2 size={16} />Seat counts and availability states</li><li><CheckCircle2 size={16} />Missing data and extraction warnings</li></ul><div className="privacy-note"><span className="shield-dot" /><p><b>Local processing</b><small>Course data is parsed by the API running on your computer.</small></p></div>{state.courses.length > 0 && <><div className="current-data"><small>Current dataset</small><b>{state.courses.length} courses · {state.courses.reduce((n, c) => n + c.options.length, 0)} offerings</b></div><button className="btn btn-outline full-btn" onClick={onReset}><Trash2 size={15} />Clear imported data</button><small>Saved timetables are kept.</small></>}</aside></div>
  </>;
}

function OfferCard({ course, option, selected, onSelect, busy = false }: { course: Course; option: Offering; selected: boolean; onSelect: () => void; busy?: boolean }) {
  const slots = option.slots?.length ? option.slots.join(' · ') : (option.rawSlot || option.slot || 'Slot not provided');
  return <div className={`offering-card ${selected ? 'offering-selected' : ''}`}><div className="offering-main"><div className="offering-slots"><span className={`slot-verification ${option.slotVerificationStatus === 'CONFIRMED_THEORY' ? 'verified' : 'unverified'}`}>{option.slotVerificationStatus === 'CONFIRMED_THEORY' ? 'Verified' : 'Unverified'}</span><b>{slots}</b></div><div className="offering-details"><span><Users size={14} />{option.facultyName || 'Faculty not provided'}</span><span><MapPin size={14} />{option.venue || 'Venue not provided'}{option.building ? ` · ${option.building}` : ''}</span><span><BookOpen size={14} />{option.componentType || course.courseType || 'Component unknown'}</span><span className={`seat-state ${option.seatState === 'AVAILABLE' ? 'seat-open' : option.seatState === 'FULL' ? 'seat-full' : 'seat-unknown'}`}><span />{option.seatState === 'AVAILABLE' ? `${option.seatsAvailable ?? option.availableSeats ?? 'Available'} seats` : option.seatState === 'FULL' ? 'Full · planning only' : 'Seat count unknown'}</span></div>{option.missingFields?.length > 0 && <small className="missing-note">Missing: {option.missingFields.join(', ')}</small>}</div><button className={`btn ${selected ? 'btn-selected' : 'btn-outline'}`} onClick={onSelect} disabled={busy || option.slotVerificationStatus !== 'CONFIRMED_THEORY' || !option.offeringId}>{selected ? <><Check size={15} />Selected</> : 'Choose offering'}</button></div>;
}

function CoursesPage({ courses, selected, selections, expanded, setExpanded, toggleCourse, changeOffering, busy, search, setSearch, filter, setFilter }: { courses: Course[]; selected: string[]; selections: Record<string, string>; expanded: string | null; setExpanded: (v: string | null) => void; toggleCourse: (code: string) => void; changeOffering: (code: string, id: string) => void; busy: boolean; search: string; setSearch: (v: string) => void; filter: string; setFilter: (v: string) => void }) {
  const types = [...new Set(courses.map(c => c.courseType || 'Unknown'))];
  return <><PageHeading eyebrow="COURSE CATALOGUE" title="Course workspace" description="Choose the courses you need, then review every imported section. Selecting a course never chooses its faculty for you." action={<span className="selection-count"><CheckCircle2 size={16} />{selected.length} selected</span>} />
    <div className="toolbar"><label className="searchbox"><Search size={17} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search courses or course code" /></label><label className="select-filter"><Filter size={15} /><select value={filter} onChange={e => setFilter(e.target.value)}><option>All courses</option>{types.map(type => <option key={type}>{type}</option>)}</select></label></div>
    {!courses.length ? <EmptyPanel icon={<BookOpen size={25} />} title="No courses to show" detail="Import a VTOP JSON export or change your filters." /> : <div className="course-list">{courses.map(course => { const isSelected = selected.includes(course.courseCode); const isExpanded = expanded === course.courseCode; const chosen = selections[course.courseCode]; return <article className={`course-card ${isSelected ? 'course-card-selected' : ''}`} key={course.courseCode}><div className="course-summary"><button className={`course-check ${isSelected ? 'checked' : ''}`} onClick={() => toggleCourse(course.courseCode)} aria-label={`${isSelected ? 'Deselect' : 'Select'} ${course.courseCode}`}>{isSelected && <Check size={14} />}</button><button className="course-toggle" onClick={() => setExpanded(isExpanded ? null : course.courseCode)}><span className="course-code">{course.courseCode}</span><b>{course.courseName}</b><span className="course-subtitle">{course.credits} credits{course.courseStructure ? ` · ${course.courseStructure}` : ' · Structure not provided'}</span></button><div className="course-meta"><span className="tag tag-neutral">{course.courseType || 'Type unknown'}</span><span className="offering-count">{course.options.length} offerings</span>{chosen && <span className="tag tag-green">Faculty chosen</span>}<button className="icon-btn" onClick={() => setExpanded(isExpanded ? null : course.courseCode)} aria-label={`${isExpanded ? 'Collapse' : 'Expand'} offerings`}>{isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</button></div></div>{isExpanded && <div className="offerings-wrap"><div className="offerings-head"><div><b>Imported offerings</b><small>Choose a specific section. Each offering is tied to its own ID and slots.</small></div>{!isSelected && <button className="text-btn" onClick={() => toggleCourse(course.courseCode)}>Select course first <ArrowRight size={13} /></button>}</div>{course.options.length ? course.options.map((option, i) => <OfferCard key={`${option.offeringId ?? 'missing'}-${i}`} course={course} option={option} selected={Boolean(chosen && option.offeringId === chosen)} onSelect={() => option.offeringId && changeOffering(course.courseCode, option.offeringId)} busy={busy} />) : <p className="muted-paragraph">No offerings were included for this course.</p>}{busy && <div className="inline-busy"><LoaderCircle className="spin" size={15} />Checking the complete timetable…</div>}</div>}</article>; })}</div>}
  </>;
}

function BuilderPage({ state, validationAttempt, selectedCourses, alternatives, previewRank, setPreviewRank, compareRanks, onToggleCompare, onClearCompare, busy, readyToValidate, onPreference, onGenerate, onChoose, onPreviewOffering, onChangeOffering, onValidate, onExportPdf, onSave, saveName, setSaveName }: {
  state: PlannerState;
  validationAttempt: OptimizeResult | null;
  selectedCourses: Course[];
  alternatives: RankedTimetable[];
  previewRank: number | null;
  setPreviewRank: (rank: number) => void;
  compareRanks: number[];
  onToggleCompare: (rank: number) => void;
  onClearCompare: () => void;
  busy: boolean;
  readyToValidate: boolean;
  onPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  onGenerate: () => void;
  onChoose: (timetable: RankedTimetable) => void;
  onPreviewOffering: (timetable: RankedTimetable, courseCode: string, offeringId: string) => void;
  onChangeOffering: (courseCode: string, offeringId: string) => void;
  onValidate: () => void;
  onExportPdf: () => void;
  onSave: () => void;
  saveName: string;
  setSaveName: (value: string) => void;
}) {
  const validated = hasCurrentValidation(state);
  const preview = alternatives.find(option => option.rank === previewRank) ?? alternatives[0];
  const previewMatchesValidation = Boolean(validated && preview && preview.courses.every(course => state.offeringSelections[course.courseCode] === course.offeringId));

  return <>
    <PageHeading
      eyebrow="STEP 2 OF 3 · BUILD YOUR WEEK"
      title="Find a timetable that fits"
      description="Set your routine, generate schedule options, preview exact class times, then choose the sections you want."
      action={validated ? <span className="validation-badge"><CheckCircle2 size={15} />Choices checked</span> : <span className="tag tag-neutral">Not checked yet</span>}
    />
    <div className="builder-layout">
      <section className="builder-main">
        <div className="panel preferences-panel">
          <div className="panel-head"><div><p className="eyebrow">STEP 1 · YOUR ROUTINE</p><h2>What works for your week?</h2></div><Settings2 size={18} className="muted-icon" /></div>
          <div className="preferences-grid">
            <label>Planning mode<select value={state.preferences.mode} onChange={event => onPreference('mode', event.target.value as Preferences['mode'])}><option value="PLANNING">Explore options, including full or unknown seats</option><option value="LIVE_REGISTRATION">Only use offerings with confirmed seats</option></select></label>
            <label>Class-time preference<select value={state.preferences.timePreference} onChange={event => onPreference('timePreference', event.target.value as Preferences['timePreference'])}><option value="balanced">No preference</option><option value="morning">Prefer earlier classes</option><option value="evening">Prefer later classes</option></select></label>
            <label>Student routine<select value={state.preferences.dayScholar ? 'day-scholar' : 'flexible'} onChange={event => onPreference('dayScholar', event.target.value === 'day-scholar')}><option value="flexible">Campus resident / flexible commute</option><option value="day-scholar">Day scholar · prefer to finish by 6 PM</option></select><small className="preference-help">This is a soft preference. Later classes remain eligible and are scored lower; earlier daily finishes are preferred.</small></label>
            <label>Preferred day off<select value={state.preferences.preferredFreeDay ?? ''} onChange={event => onPreference('preferredFreeDay', event.target.value || null)}><option value="">No preference</option>{['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map(day => <option key={day} value={day}>{({ MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday' } as Record<string, string>)[day]}</option>)}</select></label>
            <label>Maximum gap between classes<select value={state.preferences.maxGap} onChange={event => onPreference('maxGap', Number(event.target.value))}><option value={0}>0 free periods</option><option value={1}>1 free period</option><option value={2}>2 free periods</option><option value={3}>3 free periods</option><option value={4}>4 free periods</option></select></label>
            <label className="check-setting"><input type="checkbox" checked={state.preferences.mandatoryLunch} onChange={event => onPreference('mandatoryLunch', event.target.checked)} />Keep the lunch period free</label>
            {state.preferences.mandatoryLunch && <small className="preference-help">Optional soft preference for any student. The optimizer favors keeping 1:15–2:45 PM free, especially after an 11:40 AM class; it never blocks otherwise valid schedules.</small>}
          </div>
          <div className="builder-actions"><span>{selectedCourses.length} required course{selectedCourses.length === 1 ? '' : 's'} · {selectedCourses.reduce((sum, course) => sum + course.credits, 0)} credits</span><button className="btn btn-primary" onClick={onGenerate} disabled={busy || selectedCourses.length === 0}>{busy ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}{alternatives.length ? 'Refresh schedule options' : 'Show schedule options'}</button></div>
          {!selectedCourses.length && <p className="preference-help">First choose your required courses in Course workspace.</p>}
        </div>

        {validationAttempt && (!validationAttempt.selectionValid || validationAttempt.selectionErrors.length > 0 || validationAttempt.selectionConflicts.length > 0) && <div className="panel conflict-panel"><div className="panel-head"><div><p className="eyebrow">CHECK YOUR CHOICE</p><h2>This combination needs changes</h2></div><X size={18} /></div>{validationAttempt.selectionConflicts.map((conflict, index) => <p key={`c-${index}`}><b>{conflict.courseCodes.join(' ↔ ')}</b> · {conflict.slots.join(', ')} · {conflict.reason}</p>)}{validationAttempt.selectionErrors.map((error, index) => <p key={`e-${index}`}><b>{error.courseCode ?? 'Offering'}</b> · {error.reason}</p>)}{validationAttempt.excludedOfferings.map((error, index) => <p key={`x-${index}`}><b>{error.courseCode ?? 'Offering'}</b> · {error.reason}</p>)}</div>}

        {alternatives.length > 0 && <section className="alternatives-section">
          <div className="section-title"><div><p className="eyebrow">STEP 2 · COMPARE</p><h2>{alternatives.length} schedule option{alternatives.length === 1 ? '' : 's'}</h2></div><span className="muted-small">Preview an option, or select two to compare.</span></div>
          <div className="timetable-option-list">{alternatives.map(timetable => <TimetableOptionCard key={timetable.rank} timetable={timetable} previewing={preview?.rank === timetable.rank} selected={validated && timetable.courses.every(course => state.offeringSelections[course.courseCode] === course.offeringId)} comparing={compareRanks.includes(timetable.rank)} canCompare={alternatives.length > 1} onPreview={() => setPreviewRank(timetable.rank)} onToggleCompare={() => onToggleCompare(timetable.rank)} />)}</div>
          {state.validation?.optimizationOptimal === false && <p className="preference-help" role="status">The search reached its time limit. These are the best options found so far; a global best is not proven.</p>}
          {state.validation?.policyFallbackNote && <p className="preference-help" role="status">{state.validation.policyFallbackNote}</p>}
          {compareRanks.length === 1 && <div className="compare-status" role="status"><span><CheckCircle2 size={15} />Option {compareRanks[0]} selected. Choose one more option to compare.</span><button type="button" onClick={onClearCompare}>Clear selection</button></div>}
          {compareRanks.length === 2 && <><div className="compare-status" role="status"><span><CheckCircle2 size={15} />Comparing options {compareRanks[0]} and {compareRanks[1]}.</span><button type="button" onClick={onClearCompare}>Clear comparison</button></div><CompareOptions options={alternatives.filter(timetable => compareRanks.includes(timetable.rank))} /></>}
          {preview && !previewMatchesValidation && <div className="panel schedule-preview-panel">
            <div className="preview-heading"><div><p className="eyebrow">OPTION {preview.rank} · LIVE PREVIEW</p><h2>Weekly class times</h2><p>Choose a teacher in the timetable where the same course and time has another section.</p></div><button className="btn btn-primary" onClick={() => onChoose(preview)} disabled={busy}><CheckCircle2 size={15} />Use this timetable</button></div>
            <TimetableView timetable={preview} sourceCourses={state.courses} busy={busy} onOfferingChange={(courseCode, offeringId) => onPreviewOffering(preview, courseCode, offeringId)} />
          </div>}
        </section>}

        {validated && <section className="panel validated-panel"><div className="panel-head"><div><p className="eyebrow">STEP 3 · CHECKED</p><h2>Your chosen timetable</h2></div><span className="validation-badge"><CheckCircle2 size={15} />No slot clashes</span></div><TimetableView timetable={state.validatedTimetable!} sourceCourses={state.courses} busy={busy} onOfferingChange={(courseCode, offeringId) => onChangeOffering(courseCode, offeringId)} /><div className="save-row"><label>Schedule name<input value={saveName} onChange={event => setSaveName(event.target.value)} /></label><div><button className="btn btn-secondary" onClick={onExportPdf} disabled={busy}><Printer size={16} />Export as PDF</button><button className="btn btn-primary" onClick={onSave} disabled={busy}><CheckCircle2 size={16} />Save timetable</button></div></div><small className="pdf-help">Choose “Save as PDF” in the print dialog.</small></section>}
      </section>
      <aside className="builder-aside">
        <div className="panel selection-panel"><div className="panel-head"><div><p className="eyebrow">COURSES IN THIS PLAN</p><h2>Required courses</h2></div><span className="count-badge">{selectedCourses.length}</span></div>{!selectedCourses.length ? <EmptyPanel icon={<BookOpen size={22} />} title="No courses selected" detail="Open Course workspace and select the courses you need." compact /> : <div className="selection-status-list">{selectedCourses.map(course => { const offering = course.options.find(option => option.offeringId === state.offeringSelections[course.courseCode]); return <div key={course.courseCode} className="selection-status-item"><div><b>{course.courseCode}</b><small>{offering?.facultyName || (state.offeringSelections[course.courseCode] ? 'Offering selected' : 'Choose a section in the preview')}</small></div>{offering ? <CheckCircle2 size={17} className="success-icon" /> : <span className="pending-dot" />}</div>; })}</div>}{readyToValidate && !validated && <button className="btn btn-secondary full-btn" disabled={busy} onClick={onValidate}><CheckCircle2 size={15} />Check my current choices</button>}{validated && <small className="safe-note">Teacher changes are checked before the schedule updates.</small>}</div>
        <div className="panel seat-note-panel"><div className="panel-head"><div><p className="eyebrow">SEAT AVAILABILITY</p><h2>Planning vs registration</h2></div><Users size={17} className="muted-icon" /></div><p><b>Planning</b> can include full or unknown-seat classes.</p><p><b>Live registration</b> needs a known positive seat count.</p><p className="safe-note">Always confirm current seats on VTOP before registering.</p></div>
      </aside>
    </div>
  </>;
}

function TimetableOptionCard({ timetable, previewing, selected, comparing, canCompare, onPreview, onToggleCompare }: { timetable: RankedTimetable; previewing: boolean; selected: boolean; comparing: boolean; canCompare: boolean; onPreview: () => void; onToggleCompare: () => void }) {
  const summary = summarizeSchedule(timetable);
  return <article className={`timetable-option ${previewing ? 'timetable-option-active' : ''}`}>
    <button className="timetable-option-main" aria-pressed={previewing} onClick={onPreview}>
      <span className="option-title">Option {timetable.rank}{selected ? ' · Checked' : ''}</span>
      <span className="option-time-range">{summary.timeRange}</span>
      <span className="option-details">{summary.gapCount} free gaps · {summary.campusDays} campus days · score {timetable.score.overall}</span>
    </button>
    <button type="button" className={`option-compare ${comparing ? 'active' : ''}`} aria-pressed={comparing} disabled={!canCompare} title={canCompare ? comparing ? `Remove option ${timetable.rank} from comparison` : `Add option ${timetable.rank} to comparison` : 'Generate at least two options to compare'} onClick={onToggleCompare}>{comparing ? <><Check size={12} />Selected</> : 'Compare'}</button>
  </article>;
}

function CompareOptions({ options }: { options: RankedTimetable[] }) {
  const codes = [...new Set(options.flatMap(option => option.courses.map(course => course.courseCode)))];
  return <div className="panel compare-panel"><div className="panel-head"><div><p className="eyebrow">SIDE-BY-SIDE</p><h2>Compare your two options</h2></div></div><div className="compare-grid"><div className="compare-labels"><b>Time range</b><b>Free gaps · campus days</b>{codes.map(code => <b key={code}>{code}</b>)}</div>{options.map(option => { const summary = summarizeSchedule(option); return <div className="compare-option" key={option.rank}><b>Option {option.rank} · {option.score.overall}</b><span>{summary.timeRange}</span><span>{summary.gapCount} gaps · {summary.campusDays} days</span>{codes.map(code => { const course = option.courses.find(item => item.courseCode === code); return <span key={code}>{course ? `${course.facultyName || 'Faculty unknown'} · ${course.slot}` : 'No course in this option'}</span>; })}</div>; })}</div></div>;
}

function summarizeSchedule(timetable: Pick<RankedTimetable, 'grid'>) {
  const official = slots as OfficialSlot[];
  const meetings = timetable.grid.flatMap(cell => {
    const period = official.find(slot => slot.slotCode === cell.slotCode && DAY_NAMES[slot.day] === cell.day);
    return period ? [{ day: cell.day, slotCode: cell.slotCode, timeStart: period.timeStart, timeEnd: period.timeEnd }] : [];
  });
  const occupiedByDay = new Map<string, Set<string>>();
  for (const meeting of meetings) {
    const occupied = occupiedByDay.get(meeting.day) ?? new Set<string>();
    occupied.add(meeting.slotCode);
    occupiedByDay.set(meeting.day, occupied);
  }
  const gapCount = [...occupiedByDay].reduce((total, [day, occupied]) => {
    const periods = official.filter(slot => DAY_NAMES[slot.day] === day);
    const indices = periods.map((slot, index) => occupied.has(slot.slotCode) ? index : -1).filter(index => index >= 0);
    return total + (indices.length ? indices[indices.length - 1] - indices[0] + 1 - occupied.size : 0);
  }, 0);
  const starts = meetings.map(meeting => meeting.timeStart).sort();
  const ends = meetings.map(meeting => meeting.timeEnd).sort();
  return {
    timeRange: starts.length ? `${starts[0]}–${ends[ends.length - 1]}` : 'Times unavailable',
    campusDays: occupiedByDay.size,
    gapCount,
  };
}

function TimetableView({ timetable, sourceCourses = [], busy = false, onOfferingChange }: { timetable: Pick<RankedTimetable, 'grid' | 'courses'>; sourceCourses?: Course[]; busy?: boolean; onOfferingChange?: (courseCode: string, offeringId: string) => void }) {
  const [editingCourseCode, setEditingCourseCode] = useState<string | null>(null);
  const official = slots as OfficialSlot[];
  const periods = [...new Map(official.map(slot => [slot.timeStart, slot])).values()].sort((a, b) => a.timeStart.localeCompare(b.timeStart));
  const cellsByDayAndPeriod = new Map<string, typeof timetable.grid>();
  for (const cell of timetable.grid) {
    const mappedSlot = official.find(slot => slot.slotCode === cell.slotCode && DAY_NAMES[slot.day] === cell.day);
    if (!mappedSlot) continue;
    const key = `${cell.day}|${mappedSlot.timeStart}`;
    cellsByDayAndPeriod.set(key, [...(cellsByDayAndPeriod.get(key) ?? []), cell]);
  }
  const summary = summarizeSchedule(timetable);
  const canonicalSlots = (value: string[] | undefined, fallback: string) => (value?.length ? value : fallback.split(/[+,/]/).filter(Boolean)).slice().sort().join('|');

  return <>
    <div className="schedule-summary"><span><Clock3 size={14} /><b>{summary.timeRange}</b> class window</span><span><CalendarDays size={14} /><b>{summary.campusDays}</b> campus days</span><span><span className="gap-dot" /><b>{summary.gapCount}</b> free gaps</span></div>
    <div className="timetable-scroll screenshot-timetable-scroll"><table className="timetable screenshot-timetable"><thead><tr><th className="day-heading" rowSpan={2}>Theory</th>{periods.slice(0, 3).map(period => <th key={period.timeStart}>{period.timeStart}</th>)}<th className="lunch-heading" rowSpan={2}>Lunch</th>{periods.slice(3).map(period => <th key={period.timeStart}>{period.timeStart}</th>)}</tr><tr>{periods.slice(0, 3).map(period => <th key={period.timeStart}>{period.timeEnd}</th>)}{periods.slice(3).map(period => <th key={period.timeStart}>{period.timeEnd}</th>)}</tr></thead><tbody>{dayOrder.map(day => <tr key={day}><th className="day-name">{day.slice(0, 3).toUpperCase()}</th>{periods.slice(0, 3).map(period => <td className="empty-period" key={`${day}-${period.timeStart}`}>{renderPeriod(day, period)}</td>)}<td className="lunch-cell">Lunch</td>{periods.slice(3).map(period => <td className="empty-period" key={`${day}-${period.timeStart}`}>{renderPeriod(day, period)}</td>)}</tr>)}</tbody></table></div>
    {editingCourseCode && <OfferingPicker courseCode={editingCourseCode} options={getFacultyOptions(editingCourseCode)} selectedId={timetable.courses.find(course => course.courseCode === editingCourseCode)?.offeringId ?? ''} busy={busy} onClose={() => setEditingCourseCode(null)} onChoose={offeringId => { onOfferingChange?.(editingCourseCode, offeringId); }} />}
  </>;

  function renderPeriod(day: string, period: OfficialSlot) {
    const mapped = cellsByDayAndPeriod.get(`${day}|${period.timeStart}`) ?? [];
    if (!mapped.length) return <span className="empty-slot-code">{official.find(slot => DAY_NAMES[slot.day] === day && slot.timeStart === period.timeStart)?.slotCode ?? '—'}</span>;
    return mapped.map((cell, index) => {
      const course = timetable.courses.find(item => item.courseCode === cell.courseCode);
      if (!course) return null;
      const facultyOptions = getFacultyOptions(cell.courseCode);
      const canChangeFaculty = Boolean(onOfferingChange && facultyOptions.length > 1);
      return <div className={`timetable-cell ${index % 2 ? 'timetable-cell-alt' : ''}`} key={`${cell.courseCode}-${cell.slotCode}`}>
        <b>{cell.courseCode}</b>
        <span className="timetable-faculty">{cell.facultyName || 'Faculty not provided'}</span>
        {canChangeFaculty && <button className="change-teacher-button" type="button" disabled={busy} onClick={() => setEditingCourseCode(cell.courseCode)}>Change teacher <span>{facultyOptions.length}</span></button>}
        <small>{cell.slotCode} · {cell.venue || 'Venue not provided'}</small>
      </div>;
    });
  }

  function getFacultyOptions(courseCode: string) {
    const course = timetable.courses.find(item => item.courseCode === courseCode);
    const imported = sourceCourses.find(item => item.courseCode === courseCode);
    if (!course || !imported) return [];
    const selectedSlots = canonicalSlots(course.slots, course.slot);
    return imported.options.filter(option => option.offeringId && option.slotVerificationStatus === 'CONFIRMED_THEORY' && canonicalSlots(option.slots, option.slot) === selectedSlots);
  }
}

function OfferingPicker({ courseCode, options, selectedId, busy, onClose, onChoose }: { courseCode: string; options: Offering[]; selectedId: string; busy: boolean; onClose: () => void; onChoose: (offeringId: string) => void }) {
  return <div className="offering-picker-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="offering-picker" role="dialog" aria-modal="true" aria-labelledby="offering-picker-title">
      <div className="offering-picker-heading"><div><p className="eyebrow">SAME SLOT · {options.length} SECTIONS</p><h2 id="offering-picker-title">Choose a teacher for {courseCode}</h2><p>Every option keeps the current timetable slot.</p></div><button className="icon-btn" onClick={onClose} aria-label="Close teacher choices"><X size={18} /></button></div>
      <div className="offering-picker-list">{options.map(option => <button key={option.offeringId} type="button" className={`offering-picker-option ${option.offeringId === selectedId ? 'selected' : ''}`} disabled={busy || option.offeringId === selectedId} onClick={() => onChoose(option.offeringId!)}><span className="offering-picker-check">{option.offeringId === selectedId ? <CheckCircle2 size={17} /> : <Users size={17} />}</span><span className="offering-picker-copy"><b>{option.facultyName || 'Faculty not provided'}</b><small>{option.venue || 'Venue not provided'} · {option.slots?.join(' + ') || option.slot}</small></span><span className="offering-picker-seat">{option.seatState === 'AVAILABLE' ? `${option.seatsAvailable ?? option.availableSeats ?? '?'} seats` : option.seatState === 'FULL' ? 'Full' : 'Seats unknown'}</span></button>)}</div>
      {busy && <p className="offering-picker-status">Checking this section against the complete timetable…</p>}
      <button className="btn btn-secondary offering-picker-done" type="button" onClick={onClose}>Done</button>
    </section>
  </div>;
}

function SavedPage({ saved, loading, onDelete }: { saved: SavedTimetableSummary[]; loading: boolean; onDelete: (id: number) => void }) {
  return <><PageHeading eyebrow="YOUR LIBRARY" title="My timetables" description="Timetables saved after backend validation. Open a saved schedule to review its courses and times." />{loading ? <div className="loading-state"><LoaderCircle size={20} className="spin" />Loading saved timetables…</div> : saved.length ? <div className="saved-list">{saved.map(item => <article className="panel saved-card" key={item.id}><div className="saved-title"><span className="saved-icon"><CalendarDays size={18} /></span><div><b>{item.name}</b><small>{item.courses.length} courses · Saved {new Date(item.savedAt).toLocaleDateString()}</small></div></div><span className="score score-compact">{item.score?.overall ?? '—'}<small>score</small></span><div className="saved-courses">{item.courses.map(course => <span key={course.courseCode}>{course.courseCode} · {course.facultyName || 'Faculty unknown'} · {course.slot}</span>)}</div><div className="saved-timetable"><TimetableView timetable={item} /><button className="btn btn-outline" onClick={() => onDelete(item.id)} aria-label={`Delete ${item.name}`}><Trash2 size={16} />Delete timetable</button></div></article>)}</div> : <EmptyPanel icon={<CalendarDays size={25} />} title="No saved timetables yet" detail="Validate a complete offering selection in the timetable builder, then save it here." />}</>;
}

function EmptyPanel({ icon, title, detail, compact = false }: { icon: React.ReactNode; title: string; detail: string; compact?: boolean }) {
  return <div className={`empty-panel ${compact ? 'empty-compact' : ''}`}><span className="empty-icon">{icon}</span><b>{title}</b><p>{detail}</p></div>;
}

export default App;
