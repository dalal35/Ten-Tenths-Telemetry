import {describe,expect,it} from 'vitest';
import {importRow,importedRecordingTarget} from './importExperience';
import type {LibraryEntry,Session} from './types';
const session:Session={id:'one',name:'Morning run',source:'C:\\laps\\0361.xrk',track:'Purdue GP',driver:'Driver',recordedAt:'2026-10-14',laps:[],channels:[],warnings:['No GPS','Import failed: other.xrk']};
const ready={index:0,total:2,path:session.source,status:'ready' as const,session};
const entry={id:'one',status:'ready'} as LibraryEntry;
describe('import receipt',()=>{
 it('copies only summary metadata and original parser warnings',()=>{
  const row=importRow(ready,new Map());
  expect(row).toEqual({index:0,path:session.source,file:'0361.xrk',status:'added',sessionId:'one',name:'Morning run',track:'Purdue GP',laps:0,channels:0,warnings:['No GPS']});
  expect(row).not.toHaveProperty('session');
 });
 it('distinguishes an existing entry from a reconnected unavailable source',()=>{
  expect(importRow(ready,new Map([['one',entry]])).status).toBe('existing');
  expect(importRow(ready,new Map([['one',{...entry,status:'missing'}]])).status).toBe('reconnected');
  expect(importRow(ready,new Map([['one',{...entry,status:'modified'}]])).status).toBe('reconnected');
 });
 it('retains per-file errors and reading identities without fake metrics',()=>{
  expect(importRow({index:1,total:2,path:'\\\\server\\laps\\bad.xrk',status:'error',error:'Unreadable'},new Map())).toEqual({index:1,path:'\\\\server\\laps\\bad.xrk',file:'bad.xrk',status:'error',error:'Unreadable'});
  expect(importRow({index:0,total:2,path:session.source,status:'reading'},new Map()).status).toBe('reading');
 });
 it('never resolves a removed or unavailable receipt target to another recording',()=>{
  const a={...entry,contentVersion:'v1'},b={...a,id:'two'};
  expect(importedRecordingTarget([b],'one')).toBeUndefined();
  expect(importedRecordingTarget([{...a,status:'missing'},b],'one')).toBeUndefined();
  expect(importedRecordingTarget([a,b],'one')).toBe(a);
  const merged={...a,id:'merge-123-ab',mergeSources:[{sessionId:a.id,contentVersion:'v1'},{sessionId:b.id,contentVersion:'v1'}]};
  expect(importedRecordingTarget([a,b,merged],'one')).toBe(merged);
 });
});
