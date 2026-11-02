import {describe,it,expect} from 'vitest';
import {restoreWorkspace,compatibleZoom,moveBoundary,displayAnalysis,serializeWorkspace} from './workspace';
import type {Session,Analysis} from './types';
const session:Session={id:'one',source:'a.xrk',name:'a',driver:'',track:'',recordedAt:'',warnings:[],laps:[{id:'a',number:1,start:0,end:10,duration:10,complete:true},{id:'b',number:2,start:10,end:22,duration:12,complete:true}],channels:[{id:'speed',name:'GPS Speed',unit:'km/h',times:[],values:[]},{id:'rpm',name:'RPM',unit:'rpm',times:[],values:[]}]};
describe('workspace recovery',()=>{
  it('restores coach reference and discards it after session content changes',()=>{const saved={contentVersion:'v1',view:'coach',coach:{referenceId:'b'}};expect(restoreWorkspace(session,saved,'v1')).toMatchObject({view:'coach',coach:{referenceId:'b'}});expect(restoreWorkspace(session,saved,'v2')).toMatchObject({view:'telemetry',coach:{referenceId:null}});expect(restoreWorkspace(session,{...saved,coach:{referenceId:'missing'}},'v1').coach?.referenceId).toBeNull();});
  it('discards selections and zoom from another source version',()=>{const w=restoreWorkspace(session,{primary:'b',axis:'time',contentVersion:'old',zoom:{primary:'b',comparison:null,axis:'time',min:1,max:2}},'new');expect(w.primary).toBe('a');expect(w.axis).toBe('distance');expect(compatibleZoom(w)).toBeNull();});
  it('restores valid selections and defaults invalid saved values',()=>{expect(restoreWorkspace(session,{primary:'lost',comparison:'b',channels:['rpm','lost','speed'],axis:'time',layout:'compact'})).toMatchObject({primary:'a',comparison:'b',channels:['rpm','speed'],axis:'time',layout:'compact'});});
  it('restores zoom only for matching laps and axis with finite bounds',()=>{const w=restoreWorkspace(session,null);const zoom={primary:'a',comparison:null,axis:'distance' as const,min:10,max:40};expect(compatibleZoom({...w,zoom})).toEqual({min:10,max:40});expect(compatibleZoom({...w,zoom,axis:'time'})).toBeNull();expect(compatibleZoom({...w,zoom:{...zoom,max:Infinity}})).toBeNull();});
  it('clamps track boundaries to ordered reference meters',()=>{expect(moveBoundary([100,200,300],1,400,400)).toEqual([100,298,300]);expect(moveBoundary([100,200,300],0,-10,400)).toEqual([2,200,300]);});
  it('converts speed channels from SI units to mph',()=>{const a={primary:{series:[{name:'Speed',unit:'m/s',values:[10],x:[1],channelId:'s'}]},comparison:null,segments:[],delta:null} as unknown as Analysis;const shown=displayAnalysis(a);expect(shown.primary.series[0].unit).toBe('mph');expect(shown.primary.series[0].values[0]).toBeCloseTo(22.36936);});
  it('converts speed channels from km/h to mph',()=>{const a={primary:{series:[{name:'GPS Speed',unit:'km/h',values:[100],x:[10],channelId:'s'}]},comparison:null,segments:[],delta:null} as unknown as Analysis;const shown=displayAnalysis(a);expect(shown.primary.series[0].values[0]).toBeCloseTo(62.1371);expect(shown.primary.series[0].unit).toBe('mph');expect(shown.primary.series[0].x).toEqual([10]);expect(a.primary.series[0].values).toEqual([100]);});
  it('leaves non-speed channels unchanged',()=>{const a={primary:{series:[{name:'RPM',unit:'rpm',values:[8000],x:[1],channelId:'r'}]},comparison:null,segments:[],delta:null} as unknown as Analysis;expect(displayAnalysis(a).primary.series[0]).toMatchObject({unit:'rpm',values:[8000]});});
});
describe('mph display boundaries',()=>{
  it('uses declared units for both laps and section means without converting source data twice',()=>{
    const series=[{channelId:'s',name:'GPS Speed',unit:' KM/H ',x:[0,1],values:[0,100]},{channelId:'mph',name:'Wheel speed',unit:'mph',x:[0,1],values:[0,60]},{channelId:'rpm',name:'Engine Speed',unit:'rpm',x:[0,1],values:[0,8000]},{channelId:'unknown',name:'Speed',unit:'',x:[0,1],values:[0,30]},{channelId:'accel',name:'Acceleration',unit:'m/s²',x:[0,1],values:[0,9.8]}];
    const metrics={elapsed:2,entrySpeed:10,minSpeed:5,exitSpeed:null,channels:series.map(s=>({channelId:s.channelId,name:s.name,unit:s.unit,mean:s.values[1]}))};
    const a={primary:{series},comparison:{series},segments:[{primary:metrics,comparison:metrics}],delta:{x:[0,1],values:[0,.2]}} as unknown as Analysis;
    const snapshot=JSON.stringify(a),shown=displayAnalysis(a);
    expect(shown.primary.series[0]).toMatchObject({unit:'mph',values:[0,100*.6213711922]});
    expect(shown.comparison?.series).toEqual(shown.primary.series);
    expect(shown.segments[0].primary.channels[0].mean).toBeCloseTo(62.13711922,8);
    expect(shown.segments[0].comparison?.channels).toEqual(shown.segments[0].primary.channels);
    expect(shown.primary.series.slice(1)).toEqual(series.slice(1));
    expect(shown.segments[0].primary.entrySpeed).toBe(10);
    expect(shown.delta).toEqual(a.delta);
    expect(displayAnalysis(shown)).toEqual(shown);
    expect(JSON.stringify(a)).toBe(snapshot);
  });
});

describe('video workspace persistence',()=>{
  const video={version:1,sessionId:session.id,contentVersion:'v1',source:null,segments:[],selectedSegmentId:null,preferences:{panelHeight:400,playbackRate:1,pausedVideoTime:0}};
  it('restores supported video view and saves persistent video JSON',()=>{const w=restoreWorkspace(session,{contentVersion:'v1',video,view:'video'},'v1');expect(w.view).toBe('video');expect(w.video?.state).toEqual(video);expect(serializeWorkspace(w).video).toEqual(video);});
  it('retains telemetry usability with warnings for corrupt or future video',()=>{const w=restoreWorkspace(session,{contentVersion:'v1',primary:'b',video:{...video,version:2},view:'video'},'v1');expect(w.primary).toBe('b');expect(w.view).toBe('telemetry');expect(w.video?.warnings.length).toBeGreaterThan(0);expect(serializeWorkspace(w).video).toEqual({...video,version:2});});
  it('discards video when telemetry content version changes',()=>{const w=restoreWorkspace(session,{contentVersion:'v1',video,view:'video'},'v2');expect(w.video?.state??null).toBeNull();expect(w.video?.warnings.length).toBeGreaterThan(0);expect(serializeWorkspace(w).video).toBeUndefined();});
  it('preserves future advanced and video raw values through ordinary saves',()=>{const advanced={version:2,custom:{preserve:true}},futureVideo={...video,version:2};const w=restoreWorkspace(session,{contentVersion:'v1',advanced,video:futureVideo},'v1');expect(serializeWorkspace(w)).toMatchObject({advanced,video:futureVideo});});
  it('enforces the combined 64 KiB workspace limit without truncating video',()=>{const w=restoreWorkspace(session,{contentVersion:'v1',advanced:{version:2,opaque:'x'.repeat(65500)},video},'v1');expect(()=>serializeWorkspace(w)).toThrow(/limit|large/i);});
});
