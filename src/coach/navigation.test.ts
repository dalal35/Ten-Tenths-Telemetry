import {describe,it,expect} from 'vitest';
import {inspectionChannels,inspectionLapChannels,inspectionRange} from './navigation';
import type {LapView, Lap,Session} from '../types';
const lap:Lap={id:'lap',number:2,start:100,end:120,duration:20,complete:true};
const view={lapId:'lap',duration:20,mapping:[{time:0,meters:0},{time:10,meters:200},{time:20,meters:400}]} as LapView;
describe('coach evidence navigation',()=>{
 it('adds recorded speed and RPM for inspection even when the driver hid them',()=>{
  const channels=[{id:'gps-speed',name:'GPS Speed'},{id:'rpm',name:'Engine RPM'},{id:'temp',name:'Temperature'}];
  expect(inspectionChannels(['temp'],channels)).toEqual(['temp','gps-speed','rpm']);
  expect(inspectionChannels(['rpm'],channels)).toEqual(['rpm','gps-speed']);
  expect(inspectionChannels([],channels.slice(2))).toEqual([]);
  expect(inspectionChannels([],[{id:'revs',name:'Engine Speed'},{id:'wheel',name:'Wheel Speed'}])).toEqual(['wheel','revs']);
 });
 it('focuses instantaneous gear transitions without inventing a measured duration',()=>{
  expect(inspectionRange({lapId:'lap',startTime:105,endTime:105},lap,view,'time')).toEqual({min:3,max:7,cursor:5});
  expect(inspectionRange({lapId:'lap',startTime:105,endTime:105},lap,view,'distance')).toEqual({min:80,max:120,cursor:100});
 });
 it('maps recording time into the inspected lap frame, not the reference distance',()=>{
  expect(inspectionRange({lapId:'lap',startTime:105,endTime:110},lap,view,'distance')).toEqual({min:80,max:220,cursor:150});
 });
 it('uses lap relative seconds on time charts',()=>{
  expect(inspectionRange({lapId:'lap',startTime:105,endTime:110},lap,view,'time')).toEqual({min:3,max:12,cursor:7.5});
 });
 it('rejects stale lap frames and uncovered intervals',()=>{
  expect(inspectionRange({lapId:'other',startTime:105,endTime:110},lap,view,'distance')).toBeNull();
  expect(inspectionRange({lapId:'lap',startTime:99,endTime:110},lap,view,'distance')).toBeNull();
 });
 it('inspects the finding recording with overlapping source clocks and missing channels',()=>{
  const first={id:'a',name:'A'},second={id:'b',name:'B'};
  const session={channels:[],merge:{preview:{laps:[{...lap,id:'a-lap',sourceSessionId:first.id},{...lap,id:'b-lap',sourceSessionId:second.id}],channels:[{id:'a-speed',name:'GPS Speed',sourceSessionId:'a',sourceChannelId:'gps-speed'},{id:'a-rpm',name:'Engine RPM',sourceSessionId:'a',sourceChannelId:'rpm'},{id:'b-speed',name:'GPS Speed',sourceSessionId:'b',sourceChannelId:'gps-speed'}]}}} as unknown as Session;
  expect(inspectionLapChannels([],session,'b-lap')).toEqual(['b-speed']);
  expect(inspectionLapChannels(['temperature'],session,'a-lap')).toEqual(['temperature','a-speed','a-rpm']);
  expect(inspectionLapChannels([],session,'missing')).toEqual([]);
  expect(inspectionRange({lapId:'b-lap',startTime:105,endTime:110},{...lap,id:'b-lap'},{...view,lapId:'b-lap'},'time')).toEqual({min:3,max:12,cursor:7.5});
  expect(inspectionLapChannels([],{channels:[{id:'gps-speed',name:'GPS Speed'}]} as Session,'lap')).toEqual(['gps-speed']);
 });
});
