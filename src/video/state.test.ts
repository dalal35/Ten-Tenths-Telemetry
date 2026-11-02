import { describe, expect, it } from 'vitest';
import type { Session } from '../types';
import type { VideoStateV1, VideoSource } from './model';
import { assessVideoReference, chooseVideoReference, defaultVideoState, restoreVideoState, serializeVideoState } from './state';

const session: Session = { id: 'session', source: 'a.xrk', name: 'a', driver: '', track: '', recordedAt: '', channels: [], warnings: [], laps: [{ id: 'lap', number: 1, start: 0, end: 100, duration: 100, complete: true }] };
const local: VideoSource = { type: 'local', path: '/video/lap.mp4', size: 500, modifiedMs: 1234 };
const valid = (): VideoStateV1 => ({ version: 1, sessionId: session.id, contentVersion: 'source-1', source: local, segments: [{ id: 'segment', videoStart: 0, videoEnd: 50, anchorVideoTime: 0, anchorTelemetryTime: 10, anchorLapId: 'lap', correctionSeconds: .2 }], selectedSegmentId: 'segment', preferences: { panelHeight: 400, playbackRate: 1, pausedVideoTime: 12 } });
const restore = (raw: unknown) => restoreVideoState(raw, session, 'source-1');

describe('video state restoration', () => {
  it('keeps old telemetry workspaces free of video and creates defaults on demand', () => {
    expect(restore(undefined)).toEqual({ state: null, warnings: [] });
    expect(serializeVideoState(restore(undefined))).toBeUndefined();
    expect(defaultVideoState(session, 'source-1')).toEqual({ version: 1, sessionId: session.id, contentVersion: 'source-1', source: null, segments: [], selectedSegmentId: null, preferences: { panelHeight: 400, playbackRate: 1, pausedVideoTime: 0 } });
  });
  it.each(["C:\\Telemetry café\\走行 [final].MP4", "\\\\server\\laps\\走行 clip.mov", "\\\\?\\C:\\Telemetry\\走行.MP4", "\\\\?\\UNC\\server\\laps\\走行.mov"])('preserves a Windows video reference and mapping across serialization: %s', path => {
    const saved = { ...valid(), source: { ...local, path } };
    const restored = restore(saved);
    expect(restored.state?.source).toEqual({ ...local, path });
    expect(serializeVideoState(restored)).toEqual(saved);
  });
  it('round trips only persistent fields and always restores paused', () => {
    const result = restore({ ...valid(), playing: true, objectUrl: 'blob:secret', timer: 9, preferences: { ...valid().preferences, playing: true } });
    expect(result).toEqual({ state: valid(), warnings: [] });
    expect(serializeVideoState(result)).toEqual(valid());
    expect(JSON.stringify(result)).not.toMatch(/playing|blob:secret|timer/);
  });
  it.each([null, [], 'bad', { version: 1 }, { ...valid(), source: [] }, { ...valid(), segments: null }, { ...valid(), segments: [null] }, { ...valid(), source: { ...local, size: Infinity } }, { ...valid(), source: { ...local, path: 'blob:transient' } }, { ...valid(), source: { type: 'youtube', url: 'https://example.com', videoId: 'abcdefghijk' } }, { ...valid(), source: { ...local, path: 'a'.repeat(2049) } }].map(raw => [raw]))('handles absent or corrupt nested input safely: %j', raw => {
    const result = restore(raw);
    expect(result.state).toBeNull();
    if (raw !== null) expect(result.warnings.length).toBeGreaterThan(0);
  });
  it.each([{ ...valid(), sessionId: 'other' }, { ...valid(), contentVersion: 'old' }])('invalidates mappings belonging to other telemetry: %j', raw => {
    expect(restore(raw).state).toBeNull();
    expect(restore(raw).warnings.join(' ')).toMatch(/session|changed|version/i);
  });
  it.each([{ videoEnd: 0 }, { anchorVideoTime: 80 }, { anchorTelemetryTime: 101 }, { anchorLapId: 'lost' }, { correctionSeconds: NaN }])('rejects malformed mappings without partial truncation: %j', patch => {
    const raw = valid(); raw.segments[0] = { ...raw.segments[0], ...patch };
    expect(restore(raw).state).toBeNull();
    expect(restore(raw).warnings.length).toBeGreaterThan(0);
  });
  it('rejects overlap, duplicate IDs, unknown selection and more than 100 segments', () => {
    const raw = valid();
    expect(restore({ ...raw, segments: [...raw.segments, { ...raw.segments[0] }] }).state).toBeNull();
    expect(restore({ ...raw, selectedSegmentId: 'missing' }).state?.selectedSegmentId).toBeNull();
    expect(restore({ ...raw, segments: Array.from({ length: 101 }, (_, i) => ({ ...raw.segments[0], id: `s${i}`, videoStart: i, videoEnd: i + 1, anchorVideoTime: i })) }).state).toBeNull();
  });
  it('accepts exactly 100 segments and refuses to serialize 101', () => {
    const raw = valid(); raw.segments = Array.from({ length: 100 }, (_, i) => ({ ...raw.segments[0], id: `s${i}`, videoStart: i, videoEnd: i + 1, anchorVideoTime: i })); raw.selectedSegmentId = 's0';
    expect(restore(raw).state?.segments).toHaveLength(100);
    expect((serializeVideoState(restore(raw)) as VideoStateV1).segments).toHaveLength(100);
    expect(() => serializeVideoState({ state: { ...raw, segments: [...raw.segments, { ...raw.segments[0], id: 's100' }] }, warnings: [] })).toThrow(/100/);
  });
  it('defaults invalid preferences with warnings while preserving mappings', () => {
    const result = restore({ ...valid(), preferences: { panelHeight: 901, playbackRate: .1, pausedVideoTime: -1 } });
    expect(result.state).toEqual({ ...valid(), preferences: { panelHeight: 400, playbackRate: 1, pausedVideoTime: 0 } });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(restore({ ...valid(), preferences: null }).state?.preferences).toEqual({ panelHeight: 400, playbackRate: 1, pausedVideoTime: 0 });
  });
  it('accepts preference boundaries and canonical YouTube identity', () => {
    const raw = { ...valid(), source: { type: 'youtube', url: 'https://youtu.be/abcdefghijk', videoId: 'abcdefghijk' }, preferences: { panelHeight: 200, playbackRate: .25, pausedVideoTime: 0 } };
    expect(restore(raw).state?.source).toEqual({ type: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', videoId: 'abcdefghijk' });
    expect(restore({ ...raw, preferences: { panelHeight: 900, playbackRate: 4, pausedVideoTime: 500 } }).warnings).toEqual([]);
  });
  it('restores YouTube cache identity without persisting a runtime path', () => {
    const cache = { sha256: 'a'.repeat(64), size: 1234, durationSeconds: 61.5, trackStartSeconds: 0.04 };
    const raw = { ...valid(), source: { type: 'youtube', url: 'https://youtu.be/abcdefghijk', videoId: 'abcdefghijk', cache } };
    expect(restore(raw).state?.source).toEqual({ type: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', videoId: 'abcdefghijk', cache });
    expect(JSON.stringify(serializeVideoState(restore(raw)))).not.toContain('path');
  });
  it.each([{ sha256: 'bad' }, { size: 0 }, { durationSeconds: Infinity }, { trackStartSeconds: NaN }])('rejects malformed YouTube cache identity: %j', patch => {
    const cache = { sha256: 'a'.repeat(64), size: 1234, durationSeconds: 61.5, trackStartSeconds: 0.04, ...patch };
    expect(restore({ ...valid(), source: { type: 'youtube', url: 'https://youtu.be/abcdefghijk', videoId: 'abcdefghijk', cache } }).state).toBeNull();
  });
  it('preserves future versions byte-equivalent through ordinary serialization', () => {
    const future = { ...valid(), version: 2, additions: { opaque: [1, '二', { sourceUrl: 'custom' }] } };
    const result = restore(future);
    expect(result.state).toBeNull();
    expect(result.warnings.join(' ')).toMatch(/newer|update/i);
    expect(JSON.stringify(serializeVideoState(result))).toBe(JSON.stringify(future));
    expect(restore({ ...future, sessionId: 'other' }).futureRaw).toBeUndefined();
  });
  it('rejects oversized state rather than silently dropping mappings', () => {
    const raw = valid(); raw.segments = Array.from({ length: 100 }, (_, i) => ({ ...raw.segments[0], id: `${i}${'二'.repeat(1000)}`, videoStart: i, videoEnd: i + 1, anchorVideoTime: i }));
    expect(restore(raw).state).toBeNull();
    expect(() => serializeVideoState({ state: raw, warnings: [] })).toThrow(/limit|large/i);
    expect(restore({ ...valid(), version: 2, data: 'x'.repeat(65536) }).futureRaw).toBeUndefined();
  });
});

describe('runtime video reference availability', () => {
  it('preserves mappings for a missing reference and offers repair', () => {
    const state = valid(); const before = JSON.stringify(state);
    expect(assessVideoReference(local, null)).toEqual({ status: 'missing', canPlay: false, needsRepair: true, requiresConfirmation: false });
    expect(JSON.stringify(state)).toBe(before);
  });
  it('requires confirmation for changed size or mtime before playback', () => {
    for (const metadata of [{ size: 501, modifiedMs: 1234 }, { size: 500, modifiedMs: 1235 }]) {
      expect(assessVideoReference(local, metadata)).toMatchObject({ status: 'changed', canPlay: false, requiresConfirmation: true });
      expect(assessVideoReference(local, metadata, true)).toMatchObject({ status: 'changed', canPlay: true });
    }
    expect(assessVideoReference(local, { size: 500, modifiedMs: 1234 })).toMatchObject({ status: 'ready', canPlay: true });
  });
  it('preserves the old reference on picker cancellation or declined confirmation', () => {
    const changed: VideoSource = { ...local, size: 501 };
    expect(chooseVideoReference(local, null)).toBe(local);
    expect(chooseVideoReference(local, changed)).toBe(local);
    expect(chooseVideoReference(local, changed, true)).toBe(changed);
    expect(chooseVideoReference(local, { ...local, path: '/new.mp4' })).toMatchObject({ path: '/new.mp4' });
  });
});
