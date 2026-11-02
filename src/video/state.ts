import type { Session } from '../types';
import { parseYouTubeUrl, validateSegments } from './model';
import type { VideoCacheIdentity, VideoSegment, VideoSource, VideoStateV1 } from './model';

const LIMIT = 65536;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 2048;
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function checkSize(value: unknown): void {
  const json = JSON.stringify(value);
  if (json === undefined || new TextEncoder().encode(json).length > LIMIT) {
    throw new Error('Video preferences exceed the 64 KiB local storage limit. Remove mappings before saving.');
  }
}

export function defaultVideoState(session: Session, contentVersion: string): VideoStateV1 {
  return { version: 1, sessionId: session.id, contentVersion, source: null, segments: [], selectedSegmentId: null,
    preferences: { panelHeight: 400, playbackRate: 1, pausedVideoTime: 0 } };
}

function readSource(raw: unknown): VideoSource | null {
  if (raw === null) return null;
  if (!record(raw)) throw new Error('The saved video source is damaged. Choose the video again to repair it.');
  if (raw.type === 'local' && text(raw.path) && (raw.path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw.path) || raw.path.startsWith('\\\\'))
    && nonnegative(raw.size) && Number.isSafeInteger(raw.size) && nonnegative(raw.modifiedMs)) {
    return { type: 'local', path: raw.path, size: raw.size, modifiedMs: raw.modifiedMs };
  }
  if (raw.type === 'youtube' && text(raw.url) && text(raw.videoId)) {
    const source = parseYouTubeUrl(raw.url);
    if (source?.type === 'youtube' && source.videoId === raw.videoId) {
      if (raw.cache === undefined) return source;
      if (record(raw.cache) && /^[a-f0-9]{64}$/.test(String(raw.cache.sha256)) && Number.isSafeInteger(raw.cache.size) && nonnegative(raw.cache.size) && raw.cache.size > 0
        && typeof raw.cache.durationSeconds === 'number' && Number.isFinite(raw.cache.durationSeconds) && raw.cache.durationSeconds > 0
        && typeof raw.cache.trackStartSeconds === 'number' && Number.isFinite(raw.cache.trackStartSeconds)) {
        const cache: VideoCacheIdentity = { sha256: raw.cache.sha256 as string, size: raw.cache.size as number, durationSeconds: raw.cache.durationSeconds, trackStartSeconds: raw.cache.trackStartSeconds };
        return { ...source, cache };
      }
    }
  }
  throw new Error('The saved video source is damaged. Choose the video again to repair it.');
}

function readSegments(raw: unknown): VideoSegment[] {
  if (!Array.isArray(raw) || raw.length > 100) throw new Error('Video mappings must contain at most 100 segments; no mappings were restored.');
  return raw.map(value => {
    if (!record(value) || !text(value.id) || !['videoStart', 'videoEnd', 'anchorVideoTime', 'anchorTelemetryTime', 'correctionSeconds'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))
      || (value.anchorLapId !== undefined && !text(value.anchorLapId))) throw new Error('The saved video mappings are damaged; no mappings were restored.');
    return { id: value.id, videoStart: value.videoStart as number, videoEnd: value.videoEnd as number,
      anchorVideoTime: value.anchorVideoTime as number, anchorTelemetryTime: value.anchorTelemetryTime as number,
      ...(value.anchorLapId === undefined ? {} : { anchorLapId: value.anchorLapId as string }), correctionSeconds: value.correctionSeconds as number };
  });
}

function readPreferences(raw: unknown, warnings: string[]): VideoStateV1['preferences'] {
  const value = record(raw) ? raw : {};
  function bounded(key: string, fallback: number, min: number, max: number): number {
    const number = value[key];
    if (typeof number === 'number' && Number.isFinite(number) && number >= min && number <= max) return number;
    warnings.push(`Invalid video preference ${key} was reset to its default.`);
    return fallback;
  }
  return { panelHeight: bounded('panelHeight', 400, 200, 900), playbackRate: bounded('playbackRate', 1, .25, 4), pausedVideoTime: bounded('pausedVideoTime', 0, 0, Number.MAX_VALUE) };
}

/** Restores persistent values only. The player must begin paused; file checks happen separately. */
export function restoreVideoState(raw: unknown, session: Session, contentVersion: string): { state: VideoStateV1 | null; warnings: string[]; futureRaw?: unknown } {
  const warnings: string[] = [];
  if (raw === undefined || raw === null) return { state: null, warnings };
  try {
    checkSize(raw);
    if (!record(raw)) throw new Error('The saved video workspace is damaged. Telemetry is still available.');
    if (raw.sessionId !== session.id || raw.contentVersion !== contentVersion) throw new Error('Video mappings belong to another session or a changed telemetry content version; attach the video again.');
    if (typeof raw.version === 'number' && Number.isSafeInteger(raw.version) && raw.version > 1) {
      return { state: null, warnings: ['This video workspace uses a newer version. Update Ten Tenths Telemetry to edit it; its saved data is preserved.'], futureRaw: raw };
    }
    if (raw.version !== 1) throw new Error('The saved video workspace version is unsupported. Telemetry is still available.');
    const source = readSource(raw.source), segments = readSegments(raw.segments);
    const errors = validateSegments(segments, session.laps);
    if (errors.length) throw new Error(`The saved video mappings are invalid: ${errors.join(' ')}`);
    const selectedSegmentId = typeof raw.selectedSegmentId === 'string' && segments.some(segment => segment.id === raw.selectedSegmentId) ? raw.selectedSegmentId : null;
    if (raw.selectedSegmentId !== null && selectedSegmentId === null) warnings.push('The saved video segment selection is unavailable and was cleared.');
    return { state: { version: 1, sessionId: session.id, contentVersion, source, segments, selectedSegmentId, preferences: readPreferences(raw.preferences, warnings) }, warnings };
  } catch (error) {
    return { state: null, warnings: [error instanceof Error ? error.message : 'The saved video workspace is damaged. Telemetry is still available.'] };
  }
}

/** Unknown versions remain opaque until the user explicitly replaces the video state. */
export function serializeVideoState(restored: ReturnType<typeof restoreVideoState>): unknown {
  if (restored.futureRaw !== undefined) { checkSize(restored.futureRaw); return restored.futureRaw; }
  if (!restored.state) return undefined;
  const state = restored.state, warnings: string[] = [];
  const persistent: VideoStateV1 = { version: 1, sessionId: state.sessionId, contentVersion: state.contentVersion,
    source: readSource(state.source), segments: readSegments(state.segments), selectedSegmentId: state.selectedSegmentId,
    preferences: readPreferences(state.preferences, warnings) };
  if (warnings.length) throw new Error('Video preferences are outside the supported limits.');
  checkSize(persistent);
  return persistent;
}

export interface VideoReferenceMetadata { size: number; modifiedMs: number }
/** A missing or changed file never mutates the saved reference or mappings. */
export function assessVideoReference(source: VideoSource, metadata: VideoReferenceMetadata | null, confirmed = false): {
  status: 'ready' | 'missing' | 'changed'; canPlay: boolean; needsRepair: boolean; requiresConfirmation: boolean;
} {
  if (source.type === 'youtube') return { status: 'ready', canPlay: true, needsRepair: false, requiresConfirmation: false };
  if (!metadata || !nonnegative(metadata.size) || !nonnegative(metadata.modifiedMs)) return { status: 'missing', canPlay: false, needsRepair: true, requiresConfirmation: false };
  const changed = metadata.size !== source.size || metadata.modifiedMs !== source.modifiedMs;
  return { status: changed ? 'changed' : 'ready', canPlay: !changed || confirmed, needsRepair: false, requiresConfirmation: changed && !confirmed };
}

export function chooseVideoReference(previous: VideoSource | null, picked: VideoSource | null, confirmed = false): VideoSource | null {
  if (!picked) return previous;
  if (previous?.type === 'local' && picked.type === 'local' && picked.path === previous.path
    && !assessVideoReference(previous, picked, confirmed).canPlay) return previous;
  return picked;
}
