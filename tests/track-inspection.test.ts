import {describe,it,expect} from 'vitest';
import {prepareTrackInspection,readTrackInspection} from '../src/trackInspection';
import type {Analysis} from '../src/types';

const analysis={primary:{track:[{x:0,y:0,position:0,speed:10},{x:1,y:1,position:10,speed:20},{x:2,y:2,position:20,speed:30,breakBefore:true},{x:3,y:3,position:30,speed:null}],series:[{channelId:'rpm',name:'Engine RPM',unit:'rpm',x:[0,10,20],values:[1000,2000,3000],gaps:[[10,20]]}]},delta:{x:[0,10,20],values:[0,-.1,.2]}} as Analysis;
describe('measured track inspection',()=>{
  it('presents measured speed in mph and preserves a real zero delta',()=>{
    const sample=readTrackInspection(prepareTrackInspection(analysis),0);
    expect(sample.speed).toBeCloseTo(22.369362921);
    expect(sample.rpm).toBe(1000);
    expect(sample.delta).toBe(0);
  });
  it('keeps GPS breaks, channel gaps and absent cursor values unavailable',()=>{
    const data=prepareTrackInspection(analysis);
    const gap=readTrackInspection(data,15);
    expect(gap.speed).toBeNull();expect(gap.rpm).toBeNull();expect(gap.delta).toBeCloseTo(.05);
    expect(readTrackInspection(data,null)).toEqual({speed:null,rpm:null,delta:null});
    expect(readTrackInspection(data,30).speed).toBeNull();
  });
  it('does not substitute an unrelated engine-speed unit or extrapolate samples',()=>{
    const data=prepareTrackInspection({...analysis,primary:{...analysis.primary,series:[{channelId:'unknown',name:'Engine speed',unit:'unknown',x:[0,20],values:[1,2]}]}});
    expect(readTrackInspection(data,10).rpm).toBeNull();
    expect(readTrackInspection(data,40)).toEqual({speed:null,rpm:null,delta:null});
  });
});
