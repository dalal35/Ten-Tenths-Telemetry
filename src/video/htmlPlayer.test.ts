import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ open: vi.fn(), invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: native.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: native.open }));

import { authorizeLocalVideo, pickLocalVideo } from '../bridge';

describe('native local video picker bridge', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns null on cancellation without authorizing or replacing the attached source', async () => {
    native.open.mockResolvedValue(null);
    const current = { type: 'local', path: '/tmp/current.mp4', size: 16, modifiedMs: 100 };
    let attached = current;
    const selected = await pickLocalVideo();
    if (selected) attached = { type: 'local', ...selected };
    expect(selected).toBeNull();
    expect(attached).toBe(current);
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('authorizes a selected path once and returns canonical metadata', async () => {
    native.open.mockResolvedValue('/tmp/走行.MP4');
    native.invoke.mockResolvedValue({ path: '/private/tmp/走行.MP4', size: 16, modifiedMs: 100, status: 'ready' });
    expect(await pickLocalVideo()).toEqual({ path: '/private/tmp/走行.MP4', size: 16, modifiedMs: 100, status: 'ready' });
    expect(native.open).toHaveBeenCalledWith({ multiple: false, directory: false, filters: [{ name: 'Local video', extensions: ['mp4', 'mov'] }] });
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith('authorize_local_video', { path: '/tmp/走行.MP4' });
  });

  it('reauthorizes saved references through the same validator and preserves missing status', async () => {
    native.invoke.mockResolvedValue({ path: '/tmp/moved.mov', size: 0, modifiedMs: 0, status: 'missing' });
    expect(await authorizeLocalVideo('/tmp/moved.mov')).toEqual({ path: '/tmp/moved.mov', size: 0, modifiedMs: 0, status: 'missing' });
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith('authorize_local_video', { path: '/tmp/moved.mov' });
    expect(native.open).not.toHaveBeenCalled();
    native.invoke.mockRejectedValueOnce('Unreadable local video');
    await expect(authorizeLocalVideo('/tmp/unreadable.mp4')).rejects.toBe('Unreadable local video');
  });
});

import { afterEach } from 'vitest';
import { createHtmlPlayer } from './htmlPlayer';

class MediaStub extends EventTarget {
  src = ''; currentTime = 0; duration = 60; readyState = 0; paused = true; ended = false; seeking = false;
  videoWidth = 1920; videoHeight = 1080;
  playbackRate = 1; error: { code: number; message: string } | null = null;
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn();
  removeAttribute(name: string) { if (name === 'src') this.src = ''; }
  asElement() { return this as unknown as HTMLVideoElement; }
}

class FrameMediaStub extends MediaStub {
  frameCallback?: VideoFrameRequestCallback;
  requestVideoFrameCallback = vi.fn((callback: VideoFrameRequestCallback) => { this.frameCallback = callback; return 7; });
  cancelVideoFrameCallback = vi.fn();
  presentFrame(mediaTime: number) {
    this.frameCallback!(performance.now(), { mediaTime } as VideoFrameCallbackMetadata);
  }
}

describe('HTML video asynchronous adapter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  function setup(element = new MediaStub()) {
    const player = createHtmlPlayer(element.asElement(), 'asset://video.mp4');
    element.readyState = 1; element.dispatchEvent(new Event('loadedmetadata'));
    return { element, player };
  }

  it.each([[0, 1080], [1920, 0], [0, 0]])('rejects metadata without a usable video track (%s × %s)', async (width, height) => {
    const element = new MediaStub(); element.videoWidth = width; element.videoHeight = height;
    const player = createHtmlPlayer(element.asElement(), 'asset://audio-only.mp4');
    const readiness = expect(player.ready).rejects.toThrow(/video track/i);
    const seek = expect(player.seek(10, new AbortController().signal)).rejects.toThrow(/video track/i);
    element.readyState = 1; element.dispatchEvent(new Event('loadedmetadata'));
    await Promise.all([readiness, seek]);
    element.paused = false; element.currentTime = 5; element.dispatchEvent(new Event('playing'));
    expect(player.snapshot()).toMatchObject({ state: 'error', error: expect.stringMatching(/video track/i) });
    await expect(player.play()).rejects.toThrow(/video track/i);
    expect(player.supportedRates()).toEqual([]);
    player.dispose(); expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for seeked with target tolerance and resolves same-time seeks without an event', async () => {
    const { element, player } = setup(); await player.ready;
    const abort = new AbortController(); let finished = false;
    const seek = player.seek(10, abort.signal).then(() => { finished = true; });
    await Promise.resolve(); expect(element.currentTime).toBe(10); expect(finished).toBe(false);
    element.currentTime = 9; element.dispatchEvent(new Event('seeked')); await Promise.resolve(); expect(finished).toBe(false);
    element.currentTime = 10.04; element.dispatchEvent(new Event('seeked')); await seek;
    await player.seek(10.04, abort.signal); expect(player.snapshot().seeking).toBe(false); player.dispose();
  });

  it('keeps a completed paused seek clock when a preceding decoded frame arrives later', async () => {
    const element = new FrameMediaStub(); const { player } = setup(element); await player.ready;
    const seek = player.seek(26.585, new AbortController().signal);
    await Promise.resolve(); element.dispatchEvent(new Event('seeked')); await seek;
    element.presentFrame(26.5666666667);
    expect(player.snapshot()).toMatchObject({ time: 26.585, state: 'paused', seeking: false });
    player.dispose();
  });

  it('uses the element clock for frame callbacks during a pending seek', async () => {
    const element = new FrameMediaStub(); const { player } = setup(element); await player.ready;
    element.paused = false; element.dispatchEvent(new Event('playing'));
    const seek = player.seek(26.585, new AbortController().signal); await Promise.resolve();
    element.seeking = true; element.presentFrame(3);
    expect(player.snapshot()).toMatchObject({ time: 26.585, seeking: true });
    element.seeking = false; element.dispatchEvent(new Event('seeked')); await seek;
    player.dispose();
  });

  it.each(['waiting', 'pause'])('uses the element clock when a frame arrives after %s', async event => {
    const element = new FrameMediaStub(); const { player } = setup(element); await player.ready;
    element.paused = false; element.dispatchEvent(new Event('playing'));
    element.currentTime = 4;
    if (event === 'pause') element.paused = true;
    element.dispatchEvent(new Event(event)); element.presentFrame(3.9);
    expect(player.snapshot()).toMatchObject({ time: 4, state: event === 'pause' ? 'paused' : 'buffering' });
    player.dispose();
  });

  it('applies a distinct seek target within completion tolerance before resolving', async () => {
    const { element, player } = setup(); await player.ready;
    element.currentTime = 26.57; element.dispatchEvent(new Event('timeupdate'));
    let finished = false;
    const seek = player.seek(26.585, new AbortController().signal).then(() => { finished = true; });
    await Promise.resolve();
    expect(element.currentTime).toBe(26.585); expect(finished).toBe(false);
    element.dispatchEvent(new Event('seeked')); await seek;
    expect(player.snapshot().time).toBe(26.585); player.dispose();
  });

  it('reflects a native paused seek away from the endpoint after ending', async () => {
    const { element, player } = setup(); await player.ready;
    element.currentTime = 60; element.ended = true; element.dispatchEvent(new Event('ended'));
    expect(player.snapshot().state).toBe('ended');
    element.currentTime = 30; element.ended = false; element.seeking = true; element.dispatchEvent(new Event('seeking'));
    element.seeking = false; element.dispatchEvent(new Event('seeked'));
    expect(player.snapshot()).toMatchObject({ time: 30, state: 'paused', seeking: false });
    player.dispose();
  });

  it('rejects codec errors before and after readiness and notifies subscribers', async () => {
    const { element, player } = setup(); await player.ready;
    const listener = vi.fn(); player.subscribe(listener);
    element.error = { code: 4, message: 'decoder unavailable' }; element.dispatchEvent(new Event('error'));
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'error', error: expect.stringMatching(/decoder unavailable/) }));
    await expect(player.play()).rejects.toThrow(/codec|format|decoder/i); player.dispose();
    const bad = new MediaStub(); const pending = createHtmlPlayer(bad.asElement(), 'asset://bad.mov');
    const rejected = expect(pending.ready).rejects.toThrow(/codec|format|decoder/i);
    bad.error = { code: 4, message: '' }; bad.dispatchEvent(new Event('error')); await rejected; pending.dispose();
  });

  it('rejected play is recoverable through native controls and validates supported rates', async () => {
    const { element, player } = setup(); await player.ready;
    element.play.mockRejectedValueOnce(new Error('gesture required'));
    await expect(player.play()).rejects.toThrow(/gesture/); expect(player.snapshot().state).toBe('paused');
    element.paused = false; element.dispatchEvent(new Event('playing')); expect(player.snapshot().state).toBe('playing');
    await expect(player.setRate(0)).rejects.toThrow(/rate/i); await expect(player.setRate(1.3)).rejects.toThrow(/rate/i);
    await player.setRate(2); expect(element.playbackRate).toBe(2); player.dispose();
  });

  it('aborts and disposes pending seeks immediately, cancels timeouts and detaches events', async () => {
    const { element, player } = setup(); await player.ready;
    const abort = new AbortController(); const seek = player.seek(10, abort.signal);
    const rejected = expect(seek).rejects.toThrow(/cancel/i); await Promise.resolve(); abort.abort(); await rejected;
    const listener = vi.fn(); player.subscribe(listener);
    const pending = player.seek(20, new AbortController().signal); const disposed = expect(pending).rejects.toThrow(/disposed/i);
    await Promise.resolve(); player.dispose(); player.dispose(); await disposed;
    listener.mockClear(); element.dispatchEvent(new Event('timeupdate')); expect(listener).not.toHaveBeenCalled();
    expect(element.src).toBe(''); expect(vi.getTimerCount()).toBe(0);
  });

  it('times out without seeked and cancels an older overlapping seek', async () => {
    const { element, player } = setup(); await player.ready;
    const first = player.seek(10, new AbortController().signal); const superseded = expect(first).rejects.toThrow(/superseded/i);
    await Promise.resolve(); const second = player.seek(20, new AbortController().signal); await superseded;
    const timedOut = expect(second).rejects.toThrow(/timed out/i); await vi.advanceTimersByTimeAsync(5000); await timedOut;
    expect(player.snapshot().seeking).toBe(false); expect(element.paused).toBe(true); player.dispose();
  });

  it('observes media changes and frame callbacks while releasing frame work on disposal', async () => {
    const element = new MediaStub(); let callback: ((now: number, metadata: { mediaTime: number }) => void) | undefined;
    const cancel = vi.fn(); Object.assign(element, {
      requestVideoFrameCallback: vi.fn((fn: typeof callback) => { callback = fn; return 7; }), cancelVideoFrameCallback: cancel,
    });
    const player = createHtmlPlayer(element.asElement(), 'asset://video.mp4'); element.readyState = 1; element.dispatchEvent(new Event('loadedmetadata')); await player.ready;
    const listener = vi.fn(); player.subscribe(listener); element.currentTime = 3; element.paused = false; element.dispatchEvent(new Event('playing'));
    callback!(50, { mediaTime: 3.02 }); expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ time: 3.02, state: 'playing' }));
    element.dispatchEvent(new Event('waiting')); expect(player.snapshot().state).toBe('buffering');
    player.dispose(); expect(cancel).toHaveBeenCalled();
  });
});
