import {describe,expect,it} from 'vitest';
import {displayDriver,displaySessionName,displayTrack,distinctRecordingLabels,lapName,recordingLabel} from './sessionNames';

describe('displayDriver',()=>{
 it.each([
  ['yash dalal','Yash Dalal'],
  ['  YASH   DALAL ','Yash Dalal'],
  ["o'brien-smith","O'Brien-Smith"],
  ['McLaren Driver','McLaren Driver'],
  ['de la Cruz','de la Cruz'],
  ['','' ],
  ['李雷','李雷'],
 ])('%s becomes %s',(raw,clean)=>expect(displayDriver(raw)).toBe(clean));
});

describe('displayTrack',()=>{
 it.each([
  ['PURDUE GP IN','Purdue Grand Prix'],
  ['purdue gp','Purdue Grand Prix'],
  ['Purdue GP IN','Purdue Grand Prix'],
  ['ROAD ATLANTA GA','Road Atlanta'],
  ['CIRCUIT OF THE AMERICAS','Circuit of the Americas'],
  ['NJMP LIGHTNING','NJMP Lightning'],
  ['IN','In'],
  ['Silverstone','Silverstone'],
  ['','' ],
 ])('%s becomes %s',(raw,clean)=>expect(displayTrack(raw)).toBe(clean));
});

describe('displaySessionName',()=>{
 it.each([
  ['Warm-up','Warm-up'],
  ['warm-up','Warm-Up'],
  ['QUALIFYING 2','Qualifying 2'],
  ['','' ],
 ])('%s becomes %s',(raw,clean)=>expect(displaySessionName(raw)).toBe(clean));
});

describe('recordingLabel',()=>{
 const recording={driver:'yash dalal',track:'PURDUE GP IN',name:'Warm-up',source:'C:\\data\\yash dalal_59_PURDUE GP IN_Warm-up_a_0362.xrk'};
 it('names a recording from its metadata',()=>expect(recordingLabel(recording)).toBe('Yash Dalal · Purdue Grand Prix · Warm-up'));
 it('does not repeat a session name that is just the track',()=>expect(recordingLabel({...recording,name:'Purdue Grand Prix'})).toBe('Yash Dalal · Purdue Grand Prix'));
 it('falls back to a readable file name when there is no metadata',()=>expect(recordingLabel({driver:'',track:'',name:'',source:'/laps/test_session_01.xrk'})).toBe('test session 01'));
 it('reports a missing source when nothing is known',()=>expect(recordingLabel({driver:'',track:'',name:'',source:''})).toBe('Source unavailable'));
});

it('keeps recordings with the same details apart by their file ending',()=>{
 const take=(id:string,source:string)=>({id,driver:'yash dalal',track:'PURDUE GP IN',name:'Warm-up',source});
 const labels=distinctRecordingLabels([take('a','C:/laps/yash dalal_a_0361.xrk'),take('b','C:/laps/yash dalal_a_0362.xrk'),{...take('c','C:/laps/other.xrk'),name:'Race'}]);
 expect(labels.get('a')).toBe('Purdue Grand Prix · 0361');
 expect(labels.get('b')).toBe('Purdue Grand Prix · 0362');
 expect(labels.get('c')).toBe('Purdue Grand Prix');
});

it('names laps without padding',()=>{
 expect(lapName(1)).toBe('Lap 1');
 expect(lapName(12)).toBe('Lap 12');
});
