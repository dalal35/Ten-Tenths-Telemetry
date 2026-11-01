import type { PlaybackState, PlayerSnapshot, VideoPlayer } from './player';

/** Native seek completion validates observed time to 0.05 s, not frame accuracy. */
export function createHtmlPlayer(element: HTMLVideoElement, url: string): VideoPlayer {
  let disposed = false;
  let loaded = false;
  let failure: Error | null = null;
  let state: PlaybackState = 'loading';
  let frame: number | undefined;
  let pending: { time: number; finish(error?: Error): void } | undefined;
  const listeners = new Set<(sample: PlayerSnapshot) => void>();
  let sample: PlayerSnapshot = { time: 0, duration: null, rate: 1, state, observedAtMs: performance.now(), seeking: false };
  let resolveReady: () => void;
  let rejectReady: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  void ready.catch(() => {});
  const observe = (mediaTime?: number) => {
    if (disposed) return;
    if (state === 'ended' && element.paused && !element.ended && element.currentTime < element.duration) state = 'paused';
    sample = { time: mediaTime ?? element.currentTime, duration: Number.isFinite(element.duration) ? element.duration : null,
      rate: element.playbackRate, state, seeking: !!pending || element.seeking, observedAtMs: performance.now(), error: failure?.message };
    listeners.forEach(listener => listener({ ...sample }));
  };
  const fail = (error: Error) => {
    if (disposed || failure) return;
    failure = error; state = 'error'; clearTimeout(readinessTimer); rejectReady(error); pending?.finish(error); observe();
  };
  const readinessTimer = setTimeout(() => fail(new Error('Local video readiness timed out. Check the file and codec.')), 15_000);
  const mediaError = () => {
    const codes: Record<number, string> = { 1: 'Video loading was aborted.', 2: 'Video file could not be read.',
      3: 'Video decoding failed. This codec may not be supported.', 4: 'Video format or codec is not supported.' };
    const detail = element.error?.message;
    fail(new Error(`${codes[element.error?.code ?? 0] ?? 'Local video playback failed.'}${detail ? ` ${detail}` : ''}`));
  };
  const events: Record<string, () => void> = {
    loadedmetadata() {
      if (failure) return;
      if (!element.videoWidth || !element.videoHeight) {
        fail(new Error('No playable video track was found. Re-download the video or choose a supported H.264 MP4 / MOV file.')); return;
      }
      loaded = true; state = element.paused ? 'paused' : 'playing'; clearTimeout(readinessTimer); resolveReady(); observe();
    },
    playing() { if (!failure) { state = 'playing'; observe(); } },
    pause() { if (!failure) { state = 'paused'; observe(); } },
    waiting() { if (!failure) { state = 'buffering'; observe(); } },
    stalled() { if (!failure) { state = 'buffering'; observe(); } },
    ended() { if (!failure) { state = 'ended'; observe(); } },
    seeked() { if (pending && !element.seeking && Math.abs(element.currentTime - pending.time) <= .05) pending.finish(); observe(); },
    seeking: () => observe(), timeupdate: () => observe(), durationchange: () => observe(), ratechange: () => observe(), error: mediaError,
  };
  Object.entries(events).forEach(([event, listener]) => element.addEventListener(event, listener));
  const nextFrame = () => {
    if (!disposed && element.requestVideoFrameCallback) {
      frame = element.requestVideoFrameCallback((_now, metadata) => {
        // Decoded frame times may precede a paused seek's requested element clock.
        observe(state === 'playing' && !element.paused && !pending && !element.seeking ? metadata.mediaTime : undefined);
        nextFrame();
      });
    }
  };
  element.src = url;
  element.load();
  if (element.readyState >= 1) events.loadedmetadata();
  nextFrame();
  const requireReady = async () => {
    await ready;
    if (disposed) throw new Error('Local video player was disposed.');
    if (failure) throw failure;
  };
  const rates = [.25, .5, .75, 1, 1.25, 1.5, 2, 3, 4];
  return {
    ready,
    async play() { await requireReady(); await element.play(); },
    async pause() { if (!disposed) { element.pause(); if (!failure && loaded) state = 'paused'; observe(); } },
    async setRate(rate) {
      await requireReady();
      if (!rates.includes(rate)) throw new Error('This playback rate is not supported by the local video.');
      element.playbackRate = rate; observe();
    },
    supportedRates: () => loaded && !disposed && !failure ? [...rates] : [],
    seek(time, signal) {
      pending?.finish(new DOMException('Video seek superseded.', 'AbortError'));
      return new Promise<void>((resolve, reject) => {
        if (disposed || failure) { reject(failure ?? new Error('Local video player was disposed.')); return; }
        if (!Number.isFinite(time) || time < 0) { reject(new Error('Video seek time must be finite and nonnegative.')); return; }
        if (signal.aborted) { reject(new DOMException('Video seek cancelled.', 'AbortError')); return; }
        let settled = false;
        const abort = () => operation.finish(new DOMException('Video seek cancelled.', 'AbortError'));
        const timer = setTimeout(() => operation.finish(new Error('Local video seek timed out.')), 5000);
        const operation = { time, finish(error?: Error) {
          if (settled) return;
          settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
          if (pending === operation) pending = undefined;
          if (error && !disposed) { element.pause(); if (!failure && loaded) state = 'paused'; }
          observe(); if (error) reject(error); else resolve();
        } };
        pending = operation; signal.addEventListener('abort', abort, { once: true });
        void ready.then(() => {
          if (settled) return;
          if (element.duration < time) return operation.finish(new Error('Video seek time is beyond the video duration.'));
          if (!element.seeking && element.currentTime === time) return operation.finish();
          try { element.currentTime = time; observe(); } catch (error) { operation.finish(error instanceof Error ? error : new Error(String(error))); }
        }, error => operation.finish(error));
      });
    },
    snapshot: () => ({ ...sample }),
    subscribe(listener) { if (!disposed) listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() {
      if (disposed) return;
      disposed = true; pending?.finish(new Error('Local video player was disposed.')); rejectReady(new Error('Local video player was disposed.'));
      clearTimeout(readinessTimer);
      if (frame !== undefined) element.cancelVideoFrameCallback?.(frame);
      Object.entries(events).forEach(([event, listener]) => element.removeEventListener(event, listener));
      listeners.clear(); element.pause(); element.removeAttribute('src'); element.load();
    },
  };
}
