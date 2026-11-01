import type {Analysis,LibraryEntry,Session} from './types';

const recordingKeys=(entry:LibraryEntry)=>new Set((entry.mergeSources??[{sessionId:entry.id,contentVersion:entry.contentVersion}]).map(source=>JSON.stringify([source.sessionId,source.contentVersion])));
const containsRecordings=(container:Set<string>,recordings:Set<string>)=>[...recordings].every(key=>container.has(key));
function newestMergeFirst(a:LibraryEntry,b:LibraryEntry):number {
  const created=(entry:LibraryEntry)=>Number(entry.id.match(/^merge-(\d+)-/)?.[1]??0);
  return created(b)-created(a)||(a.id<b.id?1:a.id>b.id?-1:0);
}
/** Display combined recordings once, retaining original entries for repair and unmerge. */
export function visibleSessionEntries(entries:readonly LibraryEntry[]):LibraryEntry[] {
  const keys=new Map(entries.map(entry=>[entry.id,recordingKeys(entry)]));
  const merges=entries.filter(entry=>entry.status==='ready'&&entry.mergeSources?.length);
  return entries.filter(entry=>{
    if(!entry.mergeSources&&entry.status!=='ready')return true;
    const sources=keys.get(entry.id)!;
    return !merges.some(merge=>{
      if(merge.id===entry.id)return false;
      const covering=keys.get(merge.id)!;
      if(!containsRecordings(covering,sources))return false;
      return !entry.mergeSources||covering.size>sources.size||newestMergeFirst(merge,entry)<0;
    });
  });
}
/** Resolve a hidden original/older merge to its combined session on restore or import. */
export function preferredVisibleSession(entries:readonly LibraryEntry[],activeId:string|null):LibraryEntry|undefined {
  const visible=visibleSessionEntries(entries).filter(entry=>entry.status==='ready');
  const active=entries.find(entry=>entry.id===activeId),current=visible.find(entry=>entry.id===activeId);
  if(current)return current;
  if(active){
    const sources=recordingKeys(active);
    const covering=visible.filter(entry=>entry.mergeSources&&containsRecordings(recordingKeys(entry),sources));
    covering.sort((a,b)=>recordingKeys(b).size-recordingKeys(a).size||newestMergeFirst(a,b));
    if(covering.length)return covering[0];
  }
  return visible[0];
}
export interface VideoSourceContext {
  sourceSession:Session;sourcePrimaryId:string;contentVersion:string;
  toMergedLapId:(id:string)=>string|null;
}
/** Video observes only one original recording, never a virtual collection's clock. */
export function videoSourceContext(session:Session,primaryId:string):VideoSourceContext|null {
  if(!session.merge){
    if(!session.laps.some(l=>l.id===primaryId))return null;
    return {sourceSession:session,sourcePrimaryId:primaryId,contentVersion:'',toMergedLapId:id=>session.laps.some(l=>l.id===id)?id:null};
  }
  const lap=session.merge.preview.laps.find(l=>l.id===primaryId);
  const source=session.merge.sources.find(s=>s.sessionId===lap?.sourceSessionId);
  if(!lap||!source||!source.session.laps.some(l=>l.id===lap.sourceLapId))return null;
  const laps=session.merge.preview.laps.filter(l=>l.sourceSessionId===source.sessionId);
  return {sourceSession:source.session,sourcePrimaryId:lap.sourceLapId,contentVersion:source.contentVersion,toMergedLapId:id=>laps.find(l=>l.sourceLapId===id)?.id??null};
}
export function sourceVideoAnalysis(analysis:Analysis|null,context:VideoSourceContext,primaryId:string):Analysis|null {
  return analysis?.primary.lapId===primaryId?{...analysis,primary:{...analysis.primary,lapId:context.sourcePrimaryId},comparison:null}:null;
}
export function canSeekVideoLap(session:Session,fromId:string,toId:string):boolean {
  const from=videoSourceContext(session,fromId),to=videoSourceContext(session,toId);
  return !!from&&!!to&&from.sourceSession.id===to.sourceSession.id;
}
export const lapDisplayNumber=(session:Session,id:string)=>session.merge?.preview.laps.find(l=>l.id===id)?.displayNumber??session.laps.find(l=>l.id===id)?.number??0;
export function lapBoundaryLabel(session:Session,id:string):string {
  const context=videoSourceContext(session,id);
  if(!context)return '';
  const laps=context.sourceSession.laps;
  const lap=laps.find(l=>l.id===context.sourcePrimaryId);
  if(!lap||lap.complete)return '';
  return lap.id===laps[0]?.id?'OUT LAP':'IN LAP';
}
export function lapSourceLabel(session:Session,id:string):string {
  const context=videoSourceContext(session,id);if(!session.merge||!context)return '';
  const lap=context.sourceSession.laps.find(l=>l.id===context.sourcePrimaryId);
  return `${context.sourceSession.source.split(/[\\/]/).pop()||context.sourceSession.name} · original lap ${lap?.number??'—'}`;
}
export function channelSourceLabel(session:Session,id:string):string {
  const channel=session.merge?.preview.channels.find(c=>c.id===id);
  const source=session.merge?.sources.find(s=>s.sessionId===channel?.sourceSessionId);
  return source?.session.source.split(/[\\/]/).pop()??'';
}
