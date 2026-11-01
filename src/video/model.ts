import type { Axis, Lap, LapView } from '../types';
import { interpolate } from '../telemetry';

export type VideoSource =
  | { type: 'youtube'; url: string; videoId: string; cache?: VideoCacheIdentity }
  | { type: 'local'; path: string; size: number; modifiedMs: number };

export interface VideoCacheIdentity { sha256: string; size: number; durationSeconds: number; trackStartSeconds: number }

export interface VideoSegment {
  id: string;
  videoStart: number;
  videoEnd: number;
  anchorVideoTime: number;
  anchorTelemetryTime: number;
  anchorLapId?: string;
  correctionSeconds: number;
}

export interface VideoStateV1 {
  version: 1;
  sessionId: string;
  contentVersion: string;
  source: VideoSource | null;
  segments: VideoSegment[];
  selectedSegmentId: string | null;
  preferences: { panelHeight: number; playbackRate: number; pausedVideoTime: number };
}

export type MappingResult =
  | { kind: 'mapped'; time: number; segmentId: string }
  | { kind: 'unavailable' }
  | { kind: 'ambiguous'; segmentIds: string[] };

export function parseYouTubeUrl(input: string): Extract<VideoSource,{type:'youtube'}> | null {
  let url: URL;
  try { url = new URL(input.trim()); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = url.hostname;
  let videoId: string | null = null;
  if (host === 'youtu.be') {
    videoId = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1] ?? null;
  } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
    if (url.pathname === '/watch' && url.searchParams.getAll('v').length === 1) {
      videoId = url.searchParams.get('v');
    } else {
      videoId = /^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1] ?? null;
    }
  } else if (['youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) {
    videoId = /^\/embed\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1] ?? null;
  }
  return videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId)
    ? { type: 'youtube', videoId, url: `https://www.youtube.com/watch?v=${videoId}` }
    : null;
}

const offset = (segment: VideoSegment) =>
  segment.anchorTelemetryTime - segment.anchorVideoTime + segment.correctionSeconds;

function validSegment(segment: VideoSegment): boolean {
  return !!segment && typeof segment.id === 'string' && segment.id.trim().length > 0
    && [segment.videoStart, segment.videoEnd, segment.anchorVideoTime,
      segment.anchorTelemetryTime, segment.correctionSeconds].every(Number.isFinite)
    && segment.videoStart >= 0 && segment.videoEnd > segment.videoStart
    && segment.anchorVideoTime >= segment.videoStart && segment.anchorVideoTime < segment.videoEnd
    && Number.isFinite(segment.videoStart + offset(segment))
    && Number.isFinite(segment.videoEnd + offset(segment));
}

export function validateSegments(segments: VideoSegment[], laps: Lap[], duration?: number): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  if (duration !== undefined && (!Number.isFinite(duration) || duration < 0)) {
    errors.push('Video duration must be a finite nonnegative number.');
  }
  for (const segment of segments) {
    if (!validSegment(segment)) {
      errors.push('Each segment needs a unique nonempty ID, finite times, positive video bounds and an anchor inside its video interval.');
      continue;
    }
    if (ids.has(segment.id)) errors.push(`Duplicate segment ID: ${segment.id}.`);
    ids.add(segment.id);
    if (duration !== undefined && segment.videoEnd > duration) {
      errors.push(`Segment ${segment.id} ends beyond the video duration.`);
    }
    if (!laps.some(lap => segment.anchorTelemetryTime >= lap.start && segment.anchorTelemetryTime < lap.end)) {
      errors.push(`Segment ${segment.id} telemetry anchor is outside recorded laps.`);
    }
    if (segment.anchorLapId !== undefined && !laps.some(lap => lap.id === segment.anchorLapId)) {
      errors.push(`Segment ${segment.id} anchor lap is unavailable.`);
    }
  }
  const ordered = segments.filter(validSegment).sort((a, b) => a.videoStart - b.videoStart);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].videoStart < ordered[i - 1].videoEnd) {
      errors.push(`Segments ${ordered[i - 1].id} and ${ordered[i].id} overlap.`);
    }
  }
  return errors;
}

function mappingResult(matches: { segmentId: string; time: number }[]): MappingResult {
  if (!matches.length) return { kind: 'unavailable' };
  if (matches.length > 1) return { kind: 'ambiguous', segmentIds: matches.map(match => match.segmentId) };
  return { kind: 'mapped', ...matches[0] };
}

export function videoToTelemetry(segments: VideoSegment[], videoTime: number): MappingResult {
  if (!Number.isFinite(videoTime)) return { kind: 'unavailable' };
  return mappingResult(segments.filter(segment => validSegment(segment)
    && videoTime >= segment.videoStart && videoTime < segment.videoEnd)
    .map(segment => ({ segmentId: segment.id, time: videoTime + offset(segment) })));
}

export function telemetryToVideo(segments: VideoSegment[], telemetryTime: number, selectedSegmentId?: string): MappingResult {
  if (!Number.isFinite(telemetryTime)) return { kind: 'unavailable' };
  return mappingResult(segments.filter(segment => validSegment(segment)
    && (selectedSegmentId === undefined || segment.id === selectedSegmentId)
    && telemetryTime >= segment.videoStart + offset(segment)
    && telemetryTime < segment.videoEnd + offset(segment))
    .map(segment => ({ segmentId: segment.id, time: telemetryTime - offset(segment) })));
}

export function lapMarkers(segments: VideoSegment[], laps: Lap[]): { segmentId: string; lapId: string; lapNumber: number; videoTime: number }[] {
  return segments.filter(validSegment).flatMap(segment => laps.flatMap(lap => {
    const result = telemetryToVideo([segment], lap.start);
    return result.kind === 'mapped'
      ? [{ segmentId: segment.id, lapId: lap.id, lapNumber: lap.number, videoTime: result.time }]
      : [];
  })).sort((a, b) => a.videoTime - b.videoTime);
}

export function lapCoverage(segments: VideoSegment[], laps: Lap[]): Record<string, 'full' | 'partial' | 'none'> {
  const intervals = segments.filter(validSegment).map(segment => ({
    start: segment.videoStart + offset(segment), end: segment.videoEnd + offset(segment),
  })).sort((a, b) => a.start - b.start);
  return Object.fromEntries(laps.map(lap => {
    let coveredUntil = lap.start;
    let intersects = false;
    let hasGap = false;
    for (const interval of intervals) {
      const start = Math.max(lap.start, interval.start);
      const end = Math.min(lap.end, interval.end);
      if (start >= end) continue;
      intersects = true;
      if (start > coveredUntil) hasGap = true;
      coveredUntil = Math.max(coveredUntil, end);
    }
    const coverage = !intersects ? 'none' : !hasGap && coveredUntil >= lap.end ? 'full' : 'partial';
    return [lap.id, coverage];
  }));
}

function matchingLap(lap: Lap, view: LapView): boolean {
  return lap.id === view.lapId && Number.isFinite(lap.start) && Number.isFinite(lap.end)
    && lap.end > lap.start && Number.isFinite(view.duration) && view.duration > 0;
}

function validDistanceMapping(view: LapView): boolean {
  return view.mapping.length > 0 && view.mapping.every((point, index, mapping) =>
    Number.isFinite(point.time) && Number.isFinite(point.meters)
    && point.time >= 0 && point.time <= view.duration && point.meters >= 0
    && (index === 0 || (point.time > mapping[index - 1].time && point.meters > mapping[index - 1].meters)));
}

export function sessionTimeToCursor(time: number, lap: Lap, view: LapView, axis: Axis): number | null {
  if (!Number.isFinite(time) || !matchingLap(lap, view) || time < lap.start || time > lap.end) return null;
  const relative = time - lap.start;
  if (relative > view.duration) return null;
  if (axis === 'time') return relative;
  if (!validDistanceMapping(view)) return null;
  return interpolate(view.mapping.map(point => point.time), view.mapping.map(point => point.meters), relative);
}

export function cursorToSessionTime(cursor: number, lap: Lap, view: LapView, axis: Axis): number | null {
  if (!Number.isFinite(cursor) || cursor < 0 || !matchingLap(lap, view)) return null;
  let relative: number | null = cursor;
  if (axis === 'distance') {
    if (!validDistanceMapping(view)) return null;
    relative = interpolate(view.mapping.map(point => point.meters), view.mapping.map(point => point.time), cursor);
  }
  if (relative === null || relative > view.duration || lap.start + relative > lap.end) return null;
  return lap.start + relative;
}
