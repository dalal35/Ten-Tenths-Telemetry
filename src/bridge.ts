import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import type { Analysis, Axis, Session } from './types';
import {serializeWorkspace} from './workspace';
export const isNative = isTauri();
export interface LocalVideoInfo { path: string; size: number; modifiedMs: number; status: 'ready' | 'missing' }
export interface YouTubeAsset { videoId:string;url:string;path:string;size:number;modifiedMs:number;sha256:string;durationSeconds:number;trackStartSeconds:number;leaseId:string;cached:boolean }
export interface YouTubeDownloadStatus { jobId:string;videoId:string;phase:'preparing'|'downloading'|'merging'|'validating'|'complete'|'cancelled'|'error';downloadedBytes:number|null;totalBytes:number|null;speedBytesPerSecond:number|null;etaSeconds:number|null;error:string|null }
export interface YouTubeCacheEntry { videoId:string;url:string;size:number;lastUsedMs:number;referenced:boolean;inUse:boolean;issue:string|null;automaticEvictionAllowed:boolean }
export interface YouTubeCacheStatus { limitBytes:number;usedBytes:number;entries:YouTubeCacheEntry[] }
export const downloadYouTubeVideo=(url:string,jobId:string)=>invoke<YouTubeAsset>('download_youtube_video',{url,jobId});
export const resolveCachedYouTubeVideo=(videoId:string)=>invoke<YouTubeAsset|null>('resolve_cached_youtube_video',{videoId});
export const getYouTubeDownloadStatus=(jobId:string)=>invoke<YouTubeDownloadStatus|null>('youtube_download_status',{jobId});
export const cancelYouTubeDownload=(jobId:string)=>invoke<void>('cancel_youtube_download',{jobId});
export const releaseYouTubeVideo=(leaseId:string)=>invoke<void>('release_youtube_video',{leaseId});
export const getYouTubeCacheStatus=()=>invoke<YouTubeCacheStatus>('youtube_cache_status');
export const setYouTubeCacheLimit=(limitBytes:number)=>invoke<YouTubeCacheStatus>('set_youtube_cache_limit',{limitBytes});
export const cleanYouTubeCache=()=>invoke<YouTubeCacheStatus>('clean_youtube_cache');
export const removeYouTubeCacheEntry=(videoId:string)=>invoke<YouTubeCacheStatus>('remove_youtube_cache_entry',{videoId});
export async function pickLocalVideo(): Promise<LocalVideoInfo | null> {
  if (!isNative) throw new Error('Open the native app to attach a local video.');
  const selected = await open({ multiple: false, directory: false, filters: [{ name: 'Local video', extensions: ['mp4', 'mov'] }] });
  return typeof selected === 'string' ? authorizeLocalVideo(selected) : null;
}
export async function authorizeLocalVideo(path: string): Promise<LocalVideoInfo> {
  if (!isNative) throw new Error('Open the native app to attach a local video.');
  return invoke<LocalVideoInfo>('authorize_local_video', { path });
}
export type ImportProgress = {index:number;total:number;path:string} & ({status:'reading'}|{status:'ready';session:Session}|{status:'error';error:string});
export async function importPaths(paths: string[], observe?: (progress:ImportProgress)=>void): Promise<Session[]> {
  if (!isNative) throw new Error('Open the desktop app to import XRK files.');
  const results: Session[] = [];
  const errors: string[] = [];
  for (const [index,path] of paths.entries()) {
    const file={index,total:paths.length,path};
    observe?.({...file,status:'reading'});
    let result:Session;
    try { result=await invoke<Session>('import_session', { path }); }
    catch (error) { errors.push(`${path.split(/[\\/]/).pop() || path}: ${String(error)}`);observe?.({...file,status:'error',error:String(error)});continue; }
    results.push(result);
    observe?.({...file,status:'ready',session:result});
  }
  if (errors.length && !results.length) throw new Error(errors.join('\n'));
  if (errors.length) results[0].warnings.push(...errors.map(error=>`Import failed: ${error}`));
  return results;
}
export async function importFiles(observe?: (progress:ImportProgress)=>void): Promise<Session[]> {
  if (!isNative) throw new Error('Open the desktop app to import XRK files.');
  const selected = await open({ multiple: true, directory: false, filters: [{ name: 'AiM telemetry', extensions: ['xrk'] }] });
  return selected ? importPaths(Array.isArray(selected) ? selected : [selected],observe) : [];
}
export async function analyzeSession(sessionId: string, primaryId: string, comparisonId: string | null, axis: Axis, channelIds: string[],formulas:import('./advancedState').Formula[]=[]): Promise<Analysis> {
  return invoke<Analysis>('analyze_session', { sessionId, primaryId, comparisonId, axis, channelIds,formulas });
}
export const analyzeAdvanced=(sessionId:string,primaryId:string,comparisonId:string|null,axis:Axis,request:import('./advancedState').AdvancedConfig,formulas:import('./advancedState').Formula[])=>invoke<import('./types').AdvancedResult>('analyze_advanced',{sessionId,primaryId,comparisonId,axis,request,formulas});
export const validateFormulas=(sessionId:string,formulas:import('./advancedState').Formula[])=>invoke<{id:string;name:string;unit:string}[]>('validate_formulas',{sessionId,formulas});
export async function subscribeFileDrop(callback: (paths: string[]) => void,onPresence?:(active:boolean)=>void): Promise<() => void> {
  if (!isNative) return () => {};
  return getCurrentWebview().onDragDropEvent(event => {
    onPresence?.(event.payload.type==='enter'||event.payload.type==='over');
    if (event.payload.type === 'drop') callback(event.payload.paths);
  });
}
export async function librarySnapshot(){return isNative?invoke<import('./types').LibrarySnapshot>('library_snapshot'):{entries:[],activeSessionId:null,warnings:[]};}
export const loadSession=(sessionId:string)=>invoke<Session>('load_library_session',{sessionId});
export const saveWorkspace=(sessionId:string,workspace:import('./workspace').Workspace)=>invoke<void>('save_workspace',{sessionId,workspace:serializeWorkspace(workspace),expectedContentVersion:workspace.contentVersion});
export const removeSession=(sessionId:string)=>invoke<import('./types').LibrarySnapshot>('remove_library_session',{sessionId});
export const refreshSession=(sessionId:string)=>invoke<Session>('refresh_library_session',{sessionId});
export async function locateSession(sessionId:string){const path=await open({multiple:false,directory:false,filters:[{name:'AiM telemetry',extensions:['xrk']}]});return typeof path==='string'?invoke<Session>('locate_library_session',{sessionId,path}):null;}
export const setCornerBoundaries=(sessionId:string,primaryId:string,boundaries:number[]|null)=>invoke<void>('set_corner_boundaries',{sessionId,primaryId,boundaries});

export const previewMergeSessions=(sessionIds:string[])=>invoke<import('./types').MergePreview>('preview_merge_sessions',{sessionIds});
export const mergeSessions=(sessionIds:string[],previewVersion:string,acknowledgeWarnings:boolean)=>invoke<Session>('merge_sessions',{sessionIds,previewVersion,acknowledgeWarnings});
export const unmergeSession=(sessionId:string)=>invoke<import('./types').LibrarySnapshot>('unmerge_session',{sessionId});
export const analyzeCoach=(sessionId:string,referenceId:string|null,jobId:string,regenerate=false,modelTermsAccepted=false,targetLapSeconds:number|null=null)=>invoke<import('./coach/types').CoachResult>('analyze_driving_coach',{sessionId,referenceId,jobId,regenerate,modelTermsAccepted,targetLapSeconds});
export const coachModelTerms=()=>invoke<{version:string;terms:string;policy:string}>('driving_coach_model_terms');
export const cancelCoach=(jobId:string)=>invoke<void>('cancel_driving_coach',{jobId});
export const coachStatus=()=>invoke<import('./coach/types').CoachStatus>('driving_coach_status');

export const updateLibraryDetails=(sessionId:string,name:string,driver:string,recordedAt:string)=>invoke<import('./types').LibraryEntry>('update_library_details',{sessionId,name,driver,recordedAt});
