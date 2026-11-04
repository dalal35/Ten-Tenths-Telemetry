import {describe,it,expect} from 'vitest';
import type {Analysis,Session} from '../types';
import {videoInstruments} from './instruments';

const session={laps:[{id:'lap',number:3,start:100,end:120,duration:20}]} as Session;
const analysis={primary:{lapId:'lap',duration:20,mapping:[{time:0,meters:0},{time:20,meters:200}],series:[
 {name:'GPS Speed',unit:'mph',x:[0,100,200],values:[20,40,30]},
 {name:'RPM',unit:'rpm',x:[0,100,200],values:[3000,5000,4000],gaps:[[120,180]]},
]},delta:{x:[0,200],values:[0,-1],method:'spatial'}} as Analysis;
describe('video telemetry instruments',()=>{
 it('reads measured series at the existing time-to-distance projection with original units',()=>{
  expect(videoInstruments(session,110,analysis,'distance')).toMatchObject({lap:3,speed:40,speedUnit:'mph',rpm:5000,position:100,delta:-.5,deltaMethod:'spatial',progress:50});
 });
 it('does not bridge channel gaps or invent absent channels',()=>{
  expect(videoInstruments(session,115,analysis,'distance').rpm).toBeNull();
  expect(videoInstruments(session,110,{...analysis,primary:{...analysis.primary,series:[]}},'distance').speed).toBeNull();
 });
 it('rejects stale lap analysis and times outside half-open recorded laps',()=>{
  expect(videoInstruments(session,110,{...analysis,primary:{...analysis.primary,lapId:'stale'}},'distance').speed).toBeNull();
  expect(videoInstruments(session,120,analysis,'distance')).toMatchObject({lap:null,speed:null,position:null,delta:null});
  expect(videoInstruments(session,null,analysis,'distance').speed).toBeNull();
 });
 it('uses time-axis series without labeling time as meters',()=>{
  const timed={...analysis,primary:{...analysis.primary,series:[{channelId:'speed',name:'Speed',unit:'km/h',x:[0,20],values:[0,60]}]}};
  expect(videoInstruments(session,110,timed,'time')).toMatchObject({speed:30,speedUnit:'km/h',position:100});
 });
 it('never displays position from a rejected projection',()=>{
  const invalid={...analysis,primary:{...analysis.primary,mapping:[{time:0,meters:0},{time:20,meters:200},{time:10,meters:100}]}};
  expect(videoInstruments(session,110,invalid,'distance')).toMatchObject({speed:null,position:null,delta:null});
  expect(videoInstruments(session,115,{...analysis,primary:{...analysis.primary,duration:5}},'time').position).toBeNull();
 });
});
