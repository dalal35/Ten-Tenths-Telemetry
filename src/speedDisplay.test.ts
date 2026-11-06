import {describe,it,expect} from 'vitest';
import {speedFactor,displaySpeedUnit,displayAdvancedResult,displaySpeedText} from './speedDisplay';
import type {AdvancedResult} from './types';
describe('speed presentation',()=>{
 it('converts verified units without altering other measurements or mph',()=>{
  expect(100*speedFactor(' KM/H ')).toBeCloseTo(62.13711922,8);
  expect(10*speedFactor('m/s')).toBeCloseTo(22.369362921,8);
  for(const unit of ['mph','rpm','g','m/s²','m','unknown'])expect(speedFactor(unit)).toBe(1);
  expect(displaySpeedUnit('mps')).toBe('mph');
  expect(displaySpeedUnit('rpm')).toBe('rpm');
 });
 it('converts result axes, all statistics and bin bounds on copies while preserving synchronization and occupancy',()=>{
  const stats={count:2,duration:3,min:10,max:20,mean:15,median:15,p05:10,p95:20,absoluteP95:null};
  const raw:AdvancedResult={tool:'scatter',xUnit:'km/h',yUnit:'m/s',notes:[],laps:[{lapId:'lap',points:[{x:100,y:10,sourceTime:7,position:42,color:8}],stats,yStats:stats,histogram:[{low:10,high:20,value:3}],events:[],excludedCount:0}]};
  const original=JSON.stringify(raw),shown=displayAdvancedResult(raw),lap=shown.laps[0];
  expect(shown.xUnit).toBe('mph');expect(shown.yUnit).toBe('mph');
  expect(lap.points[0]).toEqual({...raw.laps[0].points[0],x:100*speedFactor('km/h'),y:10*speedFactor('m/s')});
  for(const key of ['min','max','mean','median','p05','p95'] as const){expect(lap.stats[key]).toBe(stats[key]*speedFactor('km/h'));expect(lap.yStats![key]).toBe(stats[key]*speedFactor('m/s'));}
  expect(lap.stats.absoluteP95).toBeNull();expect(lap.stats.duration).toBe(3);expect(lap.stats.count).toBe(2);
  expect(lap.histogram[0]).toEqual({low:10*speedFactor('km/h'),high:20*speedFactor('km/h'),value:3});
  expect(JSON.stringify(raw)).toBe(original);
  expect(displayAdvancedResult(shown)).toEqual(shown);
 });
});

it('coaching text shows speeds in the display unit and leaves accelerations alone',()=>{
 expect(displaySpeedText('minimum 10.0 m/s at 213 m; 2.0 m/s² peak')).toBe('minimum 22.4 mph at 213 m; 2.0 m/s² peak');
});
