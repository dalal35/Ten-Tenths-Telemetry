import type { LibraryEntry } from './types';

export type SidebarState = 'expanded' | 'analysis' | 'collapsed';
export type SessionSort = 'date-desc' | 'date-asc' | 'driver-asc' | 'driver-desc' | 'circuit-asc' | 'circuit-desc';
export type SessionGrouping = 'date' | 'driver' | 'circuit' | 'none';
export interface ExplorerPreferences { sidebarState: SidebarState; sort: SessionSort; grouping: SessionGrouping }
export interface SessionGroup { key: string; label: string; entries: LibraryEntry[] }
export const defaultExplorerPreferences: ExplorerPreferences = { sidebarState: 'expanded', sort: 'date-desc', grouping: 'date' };
const preferenceKey = 'apex-telemetry:session-explorer';
const sidebarStates: SidebarState[] = ['expanded', 'analysis', 'collapsed'];
const sorts: SessionSort[] = ['date-desc', 'date-asc', 'driver-asc', 'driver-desc', 'circuit-asc', 'circuit-desc'];
const groupings: SessionGrouping[] = ['date', 'driver', 'circuit', 'none'];

export function readExplorerPreferences(storage: Pick<Storage, 'getItem'>): ExplorerPreferences {
  try {
    const value = JSON.parse(storage.getItem(preferenceKey) ?? 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...defaultExplorerPreferences };
    return {
      sidebarState: sidebarStates.includes(value.sidebarState) ? value.sidebarState : defaultExplorerPreferences.sidebarState,
      sort: sorts.includes(value.sort) ? value.sort : defaultExplorerPreferences.sort,
      grouping: groupings.includes(value.grouping) ? value.grouping : defaultExplorerPreferences.grouping,
    };
  } catch { return { ...defaultExplorerPreferences }; }
}
export function writeExplorerPreferences(storage: Pick<Storage, 'setItem'>, preferences: ExplorerPreferences): void {
  try { storage.setItem(preferenceKey, JSON.stringify(preferences)); } catch { /* Navigation remains usable when storage is unavailable. */ }
}

interface RecordingDate { day: string; stamp: number; time?: { hour: number; minute: number } }
function recordingDate(value: string): RecordingDate | undefined {
  // Keep the logger's recording day; Date.parse would shift zoned dates and guess ambiguous slash dates.
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})(?:[T\s]+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?)?$/);
  if (!match) return undefined;
  let year: number, month: number, day: number;
  if (match[1].includes('-')) [year, month, day] = match[1].split('-').map(Number);
  else {
    const [a, b, y] = match[1].split('/').map(Number);
    if (a > 12 && b <= 12) [year, month, day] = [y, b, a];
    else if (b > 12 && a <= 12) [year, month, day] = [y, a, b];
    else return undefined;
  }
  const hour = Number(match[2] ?? 0), minute = Number(match[3] ?? 0), second = Number(match[4] ?? 0);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, Number((match[5] ?? '').padEnd(3, '0'))));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  let stamp = date.getTime();
  if (match[6] && match[6] !== 'Z') {
    const [hours, minutes] = match[6].slice(1).split(':').map(Number);
    if (hours > 23 || minutes > 59) return undefined;
    stamp -= (match[6][0] === '+' ? 1 : -1) * (hours * 60 + minutes) * 60000;
  }
  return { day: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, stamp, time: match[2] === undefined ? undefined : { hour, minute } };
}
export const recordingDay = (value:string):string => recordingDate(value)?.day??'';

const normalized = (value: string) => value.trim().toLowerCase();
const compareText = (a: string, b: string) => a.localeCompare(b, 'en') || (a < b ? -1 : a > b ? 1 : 0);
function compareKnown<T extends string | number>(a: T | undefined, b: T | undefined, descending: boolean): number {
  if (a === undefined) return b === undefined ? 0 : 1;
  if (b === undefined) return -1;
  const result = typeof a === 'number' && typeof b === 'number' ? a - b : compareText(String(a), String(b));
  return descending ? -result : result;
}

export function organizeSessions(entries: readonly LibraryEntry[], sort: SessionSort, grouping: SessionGrouping): SessionGroup[] {
  const dates = new Map(entries.map(entry => [entry.id, recordingDate(entry.recordedAt)]));
  const field = sort.startsWith('driver') ? 'driver' : 'track';
  const sorted = [...entries].sort((a, b) => {
    const dateOrder = compareKnown(dates.get(a.id)?.stamp, dates.get(b.id)?.stamp, true);
    const order = sort.startsWith('date')
      ? compareKnown(dates.get(a.id)?.stamp, dates.get(b.id)?.stamp, sort.endsWith('desc'))
      : compareKnown(normalized(a[field]) || undefined, normalized(b[field]) || undefined, sort.endsWith('desc'));
    return order || dateOrder || compareText(normalized(a.name), normalized(b.name)) || compareText(a.name, b.name) || compareText(a.id, b.id);
  });
  if (grouping === 'none') return sorted.length ? [{ key: 'all', label: 'All sessions', entries: sorted }] : [];
  const groups = new Map<string, SessionGroup>();
  for (const entry of sorted) {
    const label = grouping === 'date' ? dates.get(entry.id)?.day : (grouping === 'driver' ? entry.driver : entry.track).trim();
    const key = label ? normalized(label) : '';
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(entry);
      if (label && compareText(label, existing.label) < 0) existing.label = label;
    } else groups.set(key, { key: `${grouping}:${key}`, label: label || `Unknown ${grouping}`, entries: [entry] });
  }
  return [...groups.values()].sort((a, b) => {
    const aKey = a.key.slice(grouping.length + 1) || undefined, bKey = b.key.slice(grouping.length + 1) || undefined;
    const descending = grouping === 'date' ? sort !== 'date-asc' : sort === `${grouping}-desc`;
    return compareKnown(aKey, bKey, descending);
  });
}

export function formatRecordingDate(value: string): string {
  const recording = recordingDate(value);
  if (!recording) return 'Unknown date';
  const [year, month, day] = recording.day.split('-').map(Number);
  const monthLabel = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1];
  const dayLabel = `${monthLabel} ${day}`;
  if (!recording.time) return `${dayLabel}, ${year}`;
  const { hour, minute } = recording.time;
  return `${dayLabel}, ${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}
