import type { OptimizeResult, ParseResult, Preferences, Course, SavedTimetableSummary } from '../types';
import { currentFirebaseIdToken } from '../auth/firebase';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

export async function checkApiHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/healthz`);
    return response.ok;
  } catch { return false; }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    const idToken = await currentFirebaseIdToken();
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}`, ...init?.headers },
    });
  } catch {
    throw new Error(`Could not reach FFCS API at ${API_BASE}. Start the application with start.bat.`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body as T;
}

export function parseImport(rawData: string) {
  return request<ParseResult>('/parse', { method: 'POST', body: JSON.stringify({ rawData }) });
}

export function optimize(subjects: Course[], preferences: Preferences, topN = 20) {
  return request<OptimizeResult>('/optimize', { method: 'POST', body: JSON.stringify({ subjects, preferences, topN }) });
}

export function listSaved() {
  return request<SavedTimetableSummary[]>('/timetables');
}

export function saveTimetable(name: string, rawData: string, preferences: Preferences, courseCodes: string[], selectedOfferings: Record<string, string>) {
  return request<SavedTimetableSummary>('/timetables', {
    method: 'POST', body: JSON.stringify({ name, rawData, preferences, courseCodes, selectedOfferings }),
  });
}

export function deleteSaved(id: number) {
  return request<void>(`/timetables/${id}`, { method: 'DELETE' });
}

export function deleteAccount() {
  return request<void>('/account', { method: 'DELETE' });
}
