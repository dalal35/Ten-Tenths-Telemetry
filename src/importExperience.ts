import type {ImportProgress} from './bridge';
import type {LibraryEntry} from './types';
import {preferredVisibleSession} from './merging';

// Receipts outlive import results: never hold decoded channels or sample arrays here.
export interface ImportRow {
 index:number;path:string;file:string;status:'reading'|'added'|'existing'|'reconnected'|'error';
 sessionId?:string;name?:string;track?:string;laps?:number;channels?:number;warnings?:string[];error?:string;
}
export interface ImportReceipt {phase:'choosing'|'reading'|'complete';total:number;rows:ImportRow[];error?:string}
export function importedRecordingTarget(entries:LibraryEntry[],id:string):LibraryEntry|undefined {
 if(!entries.some(entry=>entry.id===id&&entry.status==='ready'))return undefined;
 return preferredVisibleSession(entries,id);
}
export function importRow(event:ImportProgress,known:Map<string,Pick<LibraryEntry,'status'>>):ImportRow {
 const base={index:event.index,path:event.path,file:event.path.split(/[\\/]/).pop()||event.path};
 if(event.status==='reading')return {...base,status:'reading'};
 if(event.status==='error')return {...base,status:'error',error:event.error};
 const s=event.session,previous=known.get(s.id);
 return {...base,status:previous?(previous.status==='ready'?'existing':'reconnected'):'added',sessionId:s.id,name:s.name||s.track||base.file,track:s.track,laps:s.laps.length,channels:s.channels.length,warnings:s.warnings.filter(w=>!w.startsWith('Import failed: '))};
}
