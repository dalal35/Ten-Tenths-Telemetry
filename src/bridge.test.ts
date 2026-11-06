import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {Session} from './types';

const native = vi.hoisted(() => ({invoke: vi.fn(), open: vi.fn(), onDragDropEvent: vi.fn()}));
vi.mock('@tauri-apps/api/core', () => ({isTauri: () => true, invoke: native.invoke}));
vi.mock('@tauri-apps/api/webview', () => ({getCurrentWebview: () => ({onDragDropEvent: native.onDragDropEvent})}));
vi.mock('@tauri-apps/plugin-dialog', () => ({open: native.open}));
import {cancelYouTubeDownload,cleanYouTubeCache,downloadYouTubeVideo,getYouTubeDownloadStatus,getYouTubeCacheStatus,importFiles, importPaths, locateSession, pickLocalVideo, releaseYouTubeVideo, removeYouTubeCacheEntry, resolveCachedYouTubeVideo,setYouTubeCacheLimit,subscribeFileDrop} from './bridge';

const paths = [
  'C:\\Telemetry café\\走行 [final].xrk',
  '\\\\?\\C:\\Telemetry\\' + 'recording\\'.repeat(30) + '走行.xrk',
  '\\\\?\\UNC\\server\\laps\\走行.xrk',
];
const session = (source: string): Session => ({id: source, source, name: 'Recording', track: '', driver: '', recordedAt: '', warnings: [], laps: [], channels: []});
beforeEach(() => vi.resetAllMocks());

describe('Windows native file boundary', () => {
  it('uses the frozen native YouTube cache command contracts', async () => {
    const asset={videoId:'abcdefghijk',url:'https://www.youtube.com/watch?v=abcdefghijk',path:'/cache/video.mp4',size:1234,modifiedMs:5,sha256:'a'.repeat(64),durationSeconds:60,trackStartSeconds:0,leaseId:'lease',cached:false};
    const status={jobId:'job',videoId:'abcdefghijk',phase:'downloading',downloadedBytes:12,totalBytes:24,speedBytesPerSecond:3,etaSeconds:4,error:null};
    const cache={limitBytes:100,usedBytes:10,entries:[]};
    native.invoke.mockImplementation(async command=>command==='download_youtube_video'||command==='resolve_cached_youtube_video'?asset:command==='youtube_download_status'?status:['cancel_youtube_download','release_youtube_video'].includes(command)?undefined:cache);
    expect(await downloadYouTubeVideo(asset.url,'job')).toEqual(asset);
    expect(await resolveCachedYouTubeVideo(asset.videoId)).toEqual(asset);
    expect(await getYouTubeDownloadStatus('job')).toEqual(status);
    expect(await cancelYouTubeDownload('job')).toBeUndefined();
    expect(await releaseYouTubeVideo('lease')).toBeUndefined();
    expect(await getYouTubeCacheStatus()).toEqual(cache);
    expect(await setYouTubeCacheLimit(200)).toEqual(cache);
    expect(await cleanYouTubeCache()).toEqual(cache);
    expect(await removeYouTubeCacheEntry(asset.videoId)).toEqual(cache);
    expect(native.invoke.mock.calls).toEqual([
      ['download_youtube_video',{url:asset.url,jobId:'job'}],['resolve_cached_youtube_video',{videoId:asset.videoId}],['youtube_download_status',{jobId:'job'}],
      ['cancel_youtube_download',{jobId:'job'}],['release_youtube_video',{leaseId:'lease'}],['youtube_cache_status'],['set_youtube_cache_limit',{limitBytes:200}],
      ['clean_youtube_cache'],['remove_youtube_cache_entry',{videoId:asset.videoId}],
    ]);
  });
  it('imports every selected Windows path verbatim, including a long canonical path', async () => {
    expect(paths[1].length).toBeGreaterThan(260);
    native.open.mockResolvedValue(paths);
    native.invoke.mockImplementation(async (_command, args) => session(args.path));
    expect((await importFiles()).map(value => value.source)).toEqual(paths);
    expect(native.open).toHaveBeenCalledWith({multiple: true, directory: false, filters: [{name: 'AiM telemetry', extensions: ['xrk']}]});
    expect(native.invoke.mock.calls).toEqual(paths.map(path => ['import_session', {path}]));
  });
  it('treats cancelled import, Locate and video dialogs as no changes', async () => {
    native.open.mockResolvedValue(null);
    expect(await importFiles()).toEqual([]);
    expect(await locateSession('saved-session')).toBeNull();
    expect(await pickLocalVideo()).toBeNull();
    expect(native.invoke).not.toHaveBeenCalled();
  });
  it('passes a single selected file and missing-session replacement through intact', async () => {
    native.open.mockResolvedValue(paths[0]);
    native.invoke.mockResolvedValue(session(paths[0]));
    expect(await importFiles()).toEqual([session(paths[0])]);
    await locateSession('saved-session');
    expect(native.invoke).toHaveBeenLastCalledWith('locate_library_session', {sessionId: 'saved-session', path: paths[0]});
  });
  it('authorizes the selected local video without rewriting its Windows path', async () => {
    const path = '\\\\?\\UNC\\server\\laps\\走行 café [final].mov';
    const info = {path, size: 123, modifiedMs: 456, status: 'ready'};
    native.open.mockResolvedValue(path); native.invoke.mockResolvedValue(info);
    expect(await pickLocalVideo()).toEqual(info);
    expect(native.open).toHaveBeenCalledWith({multiple: false, directory: false, filters: [{name: 'Local video', extensions: ['mp4', 'mov']}]});
    expect(native.invoke).toHaveBeenCalledWith('authorize_local_video', {path});
  });
  it('retains successful imports and reports failures without stopping the queue', async () => {
    native.invoke.mockImplementation(async (_command, args) => {
      if (args.path === paths[1]) throw new Error('Unreadable XRK');
      return session(args.path);
    });
    const results = await importPaths(paths);
    expect(results.map(value => value.source)).toEqual([paths[0], paths[2]]);
    expect(results[0].warnings).toEqual(['Import failed: 走行.xrk: Error: Unreadable XRK']);
    expect(native.invoke).toHaveBeenCalledTimes(3);
  });
  it('reports a wholly failed import instead of returning an empty successful result', async () => {
    native.invoke.mockRejectedValue(new Error('Unreadable XRK'));
    await expect(importPaths(paths)).rejects.toThrow('Unreadable XRK');
    expect(native.invoke).toHaveBeenCalledTimes(3);
  });
  it('observes sequential per-file completion without changing partial-success results', async () => {
    const events: unknown[] = [];
    native.invoke.mockImplementation(async (_command, args) => {
      if(args.path===paths[1]) throw new Error('Unreadable XRK');
      return session(args.path);
    });
    const results=await importPaths(paths,event=>events.push(event));
    expect(events).toEqual([
      {index:0,total:3,path:paths[0],status:'reading'},
      {index:0,total:3,path:paths[0],status:'ready',session:results[0]},
      {index:1,total:3,path:paths[1],status:'reading'},
      {index:1,total:3,path:paths[1],status:'error',error:'Error: Unreadable XRK'},
      {index:2,total:3,path:paths[2],status:'reading'},
      {index:2,total:3,path:paths[2],status:'ready',session:results[1]},
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].warnings).toEqual(['Import failed: 走行.xrk: Error: Unreadable XRK']);
  });
  it('does not report progress when the file picker is cancelled', async()=>{
    native.open.mockResolvedValue(null);
    const observe=vi.fn();
    expect(await importFiles(observe)).toEqual([]);
    expect(observe).not.toHaveBeenCalled();
  });
  it('forwards actual drop payloads intact and returns the native unsubscribe function', async () => {
    const unsubscribe = vi.fn();
    native.onDragDropEvent.mockResolvedValue(unsubscribe);
    const callback = vi.fn();
    expect(await subscribeFileDrop(callback)).toBe(unsubscribe);
    const listener = native.onDragDropEvent.mock.calls[0][0];
    for (const type of ['enter', 'over', 'leave']) listener({payload: {type, paths}});
    expect(callback).not.toHaveBeenCalled();
    listener({payload: {type: 'drop', paths}});
    expect(callback).toHaveBeenCalledExactlyOnceWith(paths);
  });
  it('reports native drag presence without passing hover paths to the importer', async()=>{
    native.onDragDropEvent.mockResolvedValue(()=>{});
    const drop=vi.fn(),hover=vi.fn();
    await subscribeFileDrop(drop,hover);
    const listener=native.onDragDropEvent.mock.calls[0][0];
    for(const type of ['enter','over','leave','drop'])listener({payload:{type,paths}});
    expect(hover.mock.calls).toEqual([[true],[true],[false],[false]]);
    expect(drop).toHaveBeenCalledExactlyOnceWith(paths);
  });
});
