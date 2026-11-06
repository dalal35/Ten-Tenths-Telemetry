import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from './types';
import { defaultExplorerPreferences, formatRecordingDate, organizeSessions, readExplorerPreferences, writeExplorerPreferences, type SessionSort } from './sessionExplorer';

const entry = (id: string, overrides: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id, contentVersion: '1', source: id, name: id, driver: '', track: '', recordedAt: '', lapCount: 1,
  channelCount: 1, status: 'ready', workspace: null, lastUsed: 0, ...overrides,
});
const ids = (entries: LibraryEntry[], sort: SessionSort) => organizeSessions(entries, sort, 'none').flatMap(group => group.entries.map(item => item.id));

describe('session organization', () => {
  const entries = [entry('old', { recordedAt: '2026-10-13 23:59:59', driver: 'Zoe', track: 'Zolder' }), entry('new', { recordedAt: '2026-10-14 00:00:00', driver: 'Ada', track: 'Brands' }), entry('unknown')];
  it.each([
    ['date-desc', ['new', 'old', 'unknown']], ['date-asc', ['old', 'new', 'unknown']],
    ['driver-asc', ['new', 'old', 'unknown']], ['driver-desc', ['old', 'new', 'unknown']],
    ['circuit-asc', ['new', 'old', 'unknown']], ['circuit-desc', ['old', 'new', 'unknown']],
  ] as [SessionSort, string[]][])('orders %s with unknown metadata last', (sort, expected) => expect(ids(entries, sort)).toEqual(expected));

  it('uses deterministic recording date, name and id tie breakers independently of input order', () => {
    const entries = [entry('z', { name: 'Same', driver: 'Ada', recordedAt: '2026-10-14' }), entry('a', { name: 'Same', driver: 'ada', recordedAt: '2026-10-14' }), entry('older', { driver: 'ADA', recordedAt: '2026-10-13' })];
    expect(ids(entries, 'driver-asc')).toEqual(['a', 'z', 'older']);
    expect(ids([...entries].reverse(), 'driver-asc')).toEqual(['a', 'z', 'older']);
  });
  it.each(['driver', 'circuit'] as const)('normalizes %s grouping and orders groups separately from entries', grouping => {
    const entries = [entry('z', { driver: ' Zoe ', track: ' Zolder ', recordedAt: '2026-10-15' }), entry('b', { driver: ' ADA ', track: ' BRANDS ', recordedAt: '2026-10-14' }), entry('a', { driver: 'ada', track: 'brands', recordedAt: '2026-10-16' }), entry('missing', { driver: '  ', track: '' })];
    const groups = organizeSessions(entries, 'date-desc', grouping);
    expect(groups.map(group => group.entries.map(item => item.id))).toEqual([['a', 'b'], ['z'], ['missing']]);
    expect(groups.at(-1)?.label).toBe(grouping === 'driver' ? 'Unknown driver' : 'Unknown circuit');
    expect(organizeSessions([...entries].reverse(), 'date-desc', grouping)).toEqual(groups);
  });
  it('orders grouped metadata in its selected descending direction', () => {
    expect(organizeSessions(entries, 'driver-desc', 'driver').map(group => group.label)).toEqual(['Zoe', 'Ada', 'Unknown driver']);
  });
  it('groups local recording days without timezone shifts and validates impossible dates and reads slash dates month-first', () => {
    const entries = [entry('midnight', { recordedAt: '2026-10-14' }), entry('late', { recordedAt: '2026-10-14T23:30:00-07:00' }), entry('slash', { recordedAt: '15/10/2026 00:00:01' }), entry('ambiguous', { recordedAt: '10/11/2026 12:00:00' }), entry('bad-day', { recordedAt: '2026-02-30 12:00:00' }), entry('bad-time', { recordedAt: '2026-10-14 25:00:00' }), entry('bad', { recordedAt: 'yesterday' })];
    const groups = organizeSessions(entries, 'date-desc', 'date');
    expect(groups.map(group => group.label)).toEqual(['2026-10-15', '2026-10-14', '2026-10-11', 'Unknown date']);
    expect(groups[1].entries.map(item => item.id)).toEqual(['late', 'midnight']);
    expect(organizeSessions(entries, 'date-asc', 'date').map(group => group.label)).toEqual(['2026-10-11', '2026-10-14', '2026-10-15', 'Unknown date']);
  });
  it('uses no inferred filename metadata and never modifies or clones source entries', () => {
    const original = entry('2026-10-14 Driver Circuit.xrk');
    const entries = Object.freeze([Object.freeze(original)]);
    const before = JSON.stringify(entries);
    const groups = organizeSessions(entries, 'date-desc', 'date');
    expect(groups[0].label).toBe('Unknown date');
    expect(groups[0].entries[0]).toBe(original);
    expect(JSON.stringify(entries)).toBe(before);
    expect(organizeSessions([], 'date-desc', 'none')).toEqual([]);
  });
});

describe('explorer preferences', () => {
  it('defaults to expanded, date grouped and newest first', () => {
    expect(defaultExplorerPreferences).toEqual({ sidebarState: 'expanded', sort: 'date-desc', grouping: 'date' });
    expect(readExplorerPreferences({ getItem: () => null })).toEqual(defaultExplorerPreferences);
  });
  it.each(['expanded', 'analysis', 'collapsed'] as const)('round trips %s', sidebarState => {
    let value = '';
    writeExplorerPreferences({ setItem: (_key, next) => { value = next; } }, { sidebarState, sort: 'circuit-desc', grouping: 'none' });
    expect(readExplorerPreferences({ getItem: () => value })).toEqual({ sidebarState, sort: 'circuit-desc', grouping: 'none' });
  });
  it.each(['{', 'null', '[]', '42', '{"sidebarState":"wrong","sort":"invalid","grouping":"track"}'])('tolerates invalid data %s', data => {
    expect(readExplorerPreferences({ getItem: () => data })).toEqual(defaultExplorerPreferences);
  });
  it('validates preference fields independently', () => {
    expect(readExplorerPreferences({ getItem: () => '{"sidebarState":"analysis","sort":3,"grouping":"driver"}' })).toEqual({ sidebarState: 'analysis', sort: 'date-desc', grouping: 'driver' });
  });
  it('tolerates denied storage access', () => {
    expect(readExplorerPreferences({ getItem: () => { throw new Error('denied'); } })).toEqual(defaultExplorerPreferences);
    expect(() => writeExplorerPreferences({ setItem: () => { throw new Error('denied'); } }, defaultExplorerPreferences)).not.toThrow();
  });
});


describe('compact recording date display', () => {
  it.each([
    ['2026-10-07 18:33:04', 'Oct 7, 6:33 PM'],
    ['2026-10-07T23:33:04-07:00', 'Oct 7, 11:33 PM'],
    ['2026-10-07T00:00:00+14:00', 'Oct 7, 12:00 AM'],
    ['2026-10-07T12:00:00Z', 'Oct 7, 12:00 PM'],
    ['2026-10-07', 'Oct 7, 2026'],
    ['15/10/2026 18:03:00', 'Oct 15, 6:03 PM'],
    ['10/15/2026 01:03:00', 'Oct 15, 1:03 AM'],
    ['2024-02-29', 'Feb 29, 2024'],
    ['', 'Unknown date'],
    ['  ', 'Unknown date'],
    ['2026-02-29', 'Unknown date'],
    ['2026-10-07 25:00:00', 'Unknown date'],
    ['10/07/2026 18:33:00', 'Oct 7, 6:33 PM'],
    ['13/13/2026 18:33:00', 'Unknown date'],
    ['2026-10-07T23:00:00+25:00', 'Unknown date'],
    ['October 7 2026', 'Unknown date'],
  ])('formats %s as %s', (input, expected) => expect(formatRecordingDate(input)).toBe(expected));
});
