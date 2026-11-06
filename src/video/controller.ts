import { telemetryToVideo, videoToTelemetry, type MappingResult, type VideoSegment } from './model';
import type { PlayerSnapshot, VideoPlayer } from './player';

interface ControllerOptions {
  nowMs: () => number;
  segments: () => VideoSegment[];
  onTime: (result: MappingResult) => void;
  onError: (message: string) => void;
}

/** Observations drive telemetry; ticks never seek the source. */
export function createSyncController(player: VideoPlayer, options: ControllerOptions) {
  let sample = player.snapshot();
  let disposed = false;
  let visible = true;
  let predict = true;
  let generation = 0;
  let lastTick = -Infinity;
  let pending: { abort: AbortController; resume: boolean; pausedObserved: boolean } | undefined;
  let heldResult: MappingResult | null = null;
  let pausedTarget: {videoTime:number;telemetry:MappingResult;segments:VideoSegment[]} | null = null;
  let pausedAfterHold = false;
  let observationFloor = -Infinity;
  let desiredPlaying = sample.state === 'playing';
  let resumesInFlight = 0;
  if (sample.state === 'error') options.onError(sample.error ?? 'Video playback failed. Check the source player for details.');
  const unsubscribe = player.subscribe((next: PlayerSnapshot) => {
    if (disposed || next.observedAtMs < sample.observedAtMs || next.observedAtMs < observationFloor) return;
    if (next.state === 'error') options.onError(next.error ?? 'Video playback failed. Check the source player for details.');
    if (pending) { if (next.state === 'paused') pending.pausedObserved = true; return; }
    // Keep a verified paused seek while its observed media position is stable.
    // Round-trip cancellation at a lap boundary must not select the prior lap.
    if (pausedTarget && (next.state !== 'paused' || next.seeking || Math.abs(next.time-pausedTarget.videoTime)>.05)) pausedTarget = null;
    if (heldResult && next.state === 'paused') pausedAfterHold = true;
    if (heldResult && resumesInFlight === 0 && pausedAfterHold && next.state === 'playing' && sample.state !== 'playing') heldResult = null;
    if (!heldResult) desiredPlaying = next.state === 'playing';
    sample = { ...next }; predict = visible;
  });
  const runSeek = async (lookup: MappingResult, telemetry: MappingResult): Promise<MappingResult> => {
    if (disposed) return { kind: 'unavailable' };
    const resume = pending?.resume ?? sample.state === 'playing';
    const seekSegments = options.segments();
    const request = ++generation;
    pausedTarget = null;
    pending?.abort.abort();
    const abort = new AbortController();
    pending = { abort, resume, pausedObserved: sample.state === 'paused' };
    desiredPlaying = false;
    const hold = (result: MappingResult) => {
      heldResult = result; desiredPlaying = false; pausedAfterHold = pending?.pausedObserved ?? false;
      sample = { ...sample, state: 'paused', seeking: false }; predict = false;
      options.onTime(result);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    const current = () => !disposed && generation === request;
    try {
      const cancelled = new Promise<never>((_resolve, reject) => {
        cancel = () => reject(new DOMException('Video seek cancelled.', 'AbortError'));
        abort.signal.addEventListener('abort', cancel, { once: true });
      });
      // Race the whole operation so even a stalled readiness/pause can be cancelled.
      timer = setTimeout(() => abort.abort(new Error('Video seek timed out.')), 5000);
      const operation = async () => {
        await player.pause();
        if (!current() || abort.signal.aborted) return;
        if (lookup.kind !== 'mapped') { hold(lookup); return; }
        await player.seek(lookup.time, abort.signal);
        if (!current() || abort.signal.aborted) return;
        // Keep the verified target until playback, native seeking or mapping edits.
        observationFloor = options.nowMs();
        const observed = player.snapshot();
        sample = { ...observed, time: lookup.time, state: 'paused', seeking: false, observedAtMs: observationFloor };
        predict = false; heldResult = null;
        pausedTarget = {videoTime:observed.time,telemetry,segments:seekSegments};
        options.onTime(telemetry);
        if (resume) {
          desiredPlaying = true; resumesInFlight++;
          try {
            await player.play();
            // A cancelled play may settle after its timeout, or after another seek owns playback.
            if ((!current() || abort.signal.aborted) && !desiredPlaying) await player.pause();
          } finally { resumesInFlight--; }
        }
      };
      await Promise.race([operation(), cancelled]);
      return current() ? telemetry : { kind: 'unavailable' };
    } catch (error) {
      if (current()) {
        const reason = abort.signal.reason;
        if (reason instanceof Error && reason.name !== 'AbortError') options.onError(reason.message);
        else if (!(error instanceof Error && error.name === 'AbortError')) options.onError(error instanceof Error ? error.message : String(error));
        hold({ kind: 'unavailable' });
        void player.pause().catch(() => {});
      }
      return { kind: 'unavailable' };
    } finally {
      clearTimeout(timer);
      if (cancel) abort.signal.removeEventListener('abort', cancel);
      if (current()) pending = undefined;
    }
  };
  return {
    tick() {
      const now = options.nowMs();
      if (disposed || !visible || pending || sample.seeking || now - lastTick < 50) return;
      lastTick = now;
      const segments = options.segments();
      if (pausedTarget && pausedTarget.segments !== segments) pausedTarget = null;
      const elapsed = predict && sample.state === 'playing' ? Math.max(0, Math.min(100, now - sample.observedAtMs)) : 0;
      options.onTime(heldResult ?? (sample.state === 'error' || sample.state === 'loading'
        ? { kind: 'unavailable' }
        : pausedTarget?.telemetry ?? videoToTelemetry(segments, sample.time + elapsed * sample.rate / 1000)));
    },
    setVisible(value: boolean) { visible = value; predict = false; lastTick = -Infinity; },
    seekTelemetry(time: number, segmentId?: string) {
      const lookup = telemetryToVideo(options.segments(), time, segmentId);
      const telemetry: MappingResult = lookup.kind === 'mapped' ? { ...lookup, time } : lookup;
      return runSeek(lookup, telemetry);
    },
    seekVideo(time: number) {
      const telemetry = videoToTelemetry(options.segments(), time);
      const lookup = telemetry.kind === 'mapped' ? { ...telemetry, time } : telemetry;
      return runSeek(lookup, telemetry);
    },
    dispose() { if (disposed) return; disposed = true; desiredPlaying = false; generation++; pending?.abort.abort(); pending = undefined; unsubscribe(); },
  };
}
