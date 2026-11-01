import {describe,it,expect} from 'vitest';
import type {Session,MergeInfo,LibraryEntry} from './types';
import {videoSourceContext,sourceVideoAnalysis,canSeekVideoLap,lapDisplayNumber,lapSourceLabel,visibleSessionEntries,preferredVisibleSession} from './merging';
import {restoreWorkspace,serializeWorkspace} from './workspace';
import {defaultVideoState} from './video/state';
import {projectVideoTime} from './video/useVideoSync';
const a:Session={id:'source-a',source:'a.xrk',name:'Run A',driver:'',track:'Track',recordedAt:'2026-10-14 12:00:00',channels:[],warnings:[],laps:[{id:'lap-1',number:7,start:0,end:10,duration:10,complete:true}]};
const b:Session={...a,id:'source-b',source:'b.xrk',name:'Run B'};
const qa=JSON.stringify([a.id,'lap-1']),qb=JSON.stringify([b.id,'lap-1']);
const refs=[{sessionId:a.id,contentVersion:'a'.repeat(64)},{sessionId:b.id,contentVersion:'b'.repeat(64)}];
const info:MergeInfo={sources:[{...refs[0],session:a},{...refs[1],session:b}],preview:{sources:refs,day:'2026-10-14',previewVersion:'m'.repeat(64),warnings:[],channels:[],laps:[{...a.laps[0],id:qa,sourceSessionId:a.id,sourceLapId:'lap-1',displayNumber:1},{...b.laps[0],id:qb,sourceSessionId:b.id,sourceLapId:'lap-1',displayNumber:2}]}};
const merged:Session={...a,id:'merge',merge:info,laps:info.preview.laps};
const mappedVideo=(source:Session,version:string)=>({...defaultVideoState(source,version),source:{type:'local' as const,path:`/tmp/${source.id}.mp4`,size:10,modifiedMs:10},segments:[{id:'segment',videoStart:0,videoEnd:10,anchorVideoTime:0,anchorTelemetryTime:0,anchorLapId:'lap-1',correctionSeconds:0}]});
describe('merged source adapters',()=>{
 it('merged_video_source_isolation: overlapping source clocks never select foreign laps',()=>{
  const context=videoSourceContext(merged,qb)!;expect(context.sourceSession.id).toBe(b.id);expect(context.sourcePrimaryId).toBe('lap-1');expect(context.toMergedLapId('lap-1')).toBe(qb);expect(context.toMergedLapId('foreign')).toBeNull();
  expect(projectVideoTime(merged,5,qb,null,'time').lapId).toBeNull();
  const projected=projectVideoTime(context.sourceSession,5,context.sourcePrimaryId,null,'time');expect(context.toMergedLapId(projected.lapId!)).toBe(qb);expect(projected.lapId).not.toBe(qa);
  expect(lapDisplayNumber(merged,qb)).toBe(2);expect(lapSourceLabel(merged,qb)).toContain('b.xrk');expect(videoSourceContext(merged,'missing')).toBeNull();
 });
 it('merged_video_source_switch: an old source player cannot seek a new source lap',()=>{
  expect(canSeekVideoLap(merged,qa,qb)).toBe(false);expect(canSeekVideoLap(merged,qa,qa)).toBe(true);expect(videoSourceContext(merged,qa)!.contentVersion).toBe(refs[0].contentVersion);
  expect(sourceVideoAnalysis(null,videoSourceContext(merged,qb)!,qb)).toBeNull();
 });
 it('merged_workspace_roundtrip: restores independent mappings and rejects aggregate oversize',()=>{
  const videos={[a.id]:mappedVideo(a,refs[0].contentVersion),[b.id]:mappedVideo(b,refs[1].contentVersion)};
  const raw={contentVersion:'merge-version',primary:qa,axis:'time',view:'video',sourceVideos:videos};const restored=restoreWorkspace(merged,raw,'merge-version');
  expect(restored.sourceVideos?.[a.id].state?.source).toEqual(videos[a.id].source);expect(restored.sourceVideos?.[b.id].state?.source).toEqual(videos[b.id].source);expect(restored.video).toBeUndefined();expect(restored.view).toBe('video');
  expect(serializeWorkspace(restored).sourceVideos).toEqual(videos);
  const oversize=restoreWorkspace(merged,{...raw,sourceVideos:{[a.id]:{...videos[a.id],version:999,payload:'x'.repeat(40000)},[b.id]:{...videos[b.id],version:999,payload:'x'.repeat(40000)}}},'merge-version');expect(()=>serializeWorkspace(oversize)).toThrow(/64 KiB/);
 });
 it('merged_video_future_state: keeps unknown schemas opaque and never borrows a different source mapping',()=>{
  const future={sessionId:b.id,contentVersion:refs[1].contentVersion,version:999,payload:'retain'};
  const restored=restoreWorkspace(merged,{contentVersion:'v',primary:qb,sourceVideos:{[b.id]:future}},'v');expect(restored.sourceVideos?.[b.id].futureRaw).toEqual(future);expect(restored.sourceVideos?.[a.id]?.state).toBeNull();expect((serializeWorkspace(restored).sourceVideos as Record<string,unknown>)[b.id]).toEqual(future);
 });
});

describe('combined library session display',()=>{
 const entry=(id:string,extra:Partial<LibraryEntry>={}):LibraryEntry=>({id,contentVersion:'v1',source:`${id}.xrk`,name:id,driver:'',track:'',recordedAt:'',lapCount:1,channelCount:0,status:'ready',workspace:null,lastUsed:0,...extra});
 const combined=(id:string,sourceIds:string[],extra:Partial<LibraryEntry>={})=>entry(id,{mergeSources:sourceIds.map(sessionId=>({sessionId,contentVersion:'v1'})),...extra});
 const ids=(entries:LibraryEntry[])=>visibleSessionEntries(entries).map(e=>e.id);
 it('replaces constituent rows with one combined session and restores them after unmerge',()=>{
  const originals=[entry('a'),entry('b')],merge=combined('merge-100-ab',['a','b']);
  expect(ids([...originals,merge])).toEqual([merge.id]);
  expect(ids(originals)).toEqual(['a','b']);
  expect(preferredVisibleSession([...originals,merge],'a')).toBe(merge);
  expect(preferredVisibleSession(originals,merge.id)).toBe(originals[0]);
 });
 it('hides contained older merges but retains partial overlaps',()=>{
  const ab=combined('merge-100-ab',['a','b']),abc=combined('merge-200-abc',['a','b','c']),cd=combined('merge-300-cd',['c','d']);
  const entries=['a','b','c','d'].map(id=>entry(id)).concat(ab,abc,cd);
  expect(ids(entries)).toEqual([abc.id,cd.id]);
  expect(preferredVisibleSession(entries,ab.id)).toBe(abc);
  expect(preferredVisibleSession(entries,cd.id)).toBe(cd);
 });
 it('chooses equal merges by creation time then ID, independent of last use and input order',()=>{
  const old=combined('merge-9-zz',['a','b'],{lastUsed:999}),newer=combined('merge-10-aa',['b','a']),tie=combined('merge-10-zz',['a','b']);
  for(const entries of [[old,newer,tie],[tie,newer,old]])expect(ids(entries)).toEqual([tie.id]);
  expect(ids([combined('merged-a',['a','b']),combined('merged-z',['a','b'])])).toEqual(['merged-z']);
 });
 it('keeps missing and modified originals reachable for repair',()=>{
  const missing=entry('a',{status:'missing'}),modified=entry('b',{status:'modified'}),merge=combined('merge-100-ab',['a','b'],{status:'missing'});
  expect(ids([missing,modified,merge])).toEqual(['a','b',merge.id]);
  expect(ids([entry('a'),entry('b'),merge])).toEqual(['a','b',merge.id]);
  expect(ids([missing,modified,{...merge,status:'ready'}])).toEqual(['a','b',merge.id]);
  expect(preferredVisibleSession([missing,modified,merge],'a')).toBeUndefined();
 });
 it('never hides a refreshed recording or merge behind stale source versions',()=>{
  const refreshed=entry('a',{contentVersion:'v2'}),b=entry('b'),old=combined('merge-100-ab',['a','b']);
  const current=combined('merge-200-abc',['a','b','c'],{mergeSources:[{sessionId:'a',contentVersion:'v2'},{sessionId:'b',contentVersion:'v1'},{sessionId:'c',contentVersion:'v1'}]});
  expect(ids([refreshed,b,old])).toEqual(['a',old.id]);
  expect(ids([old,current])).toEqual([old.id,current.id]);
  expect(preferredVisibleSession([refreshed,b,old],refreshed.id)).toBe(refreshed);
 });
 it('returns the existing objects without changing persisted entries or workspaces',()=>{
  const originals=[entry('a'),entry('b')],merge=combined('merge-100-ab',['a','b']);
  const entries=Object.freeze([...originals,merge].map(entry=>Object.freeze(entry))),before=JSON.stringify(entries);
  expect(visibleSessionEntries(entries)).toEqual([merge]);
  expect(visibleSessionEntries(entries)[0]).toBe(merge);
  expect(JSON.stringify(entries)).toBe(before);
 });
});
