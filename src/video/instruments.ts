import type {Analysis,Axis,Session} from '../types';
import {interpolate} from '../telemetry';
import {sessionTimeToCursor} from './model';

// Presentation only: use the same projection and gap handling as the plots.
export function videoInstruments(session:Session,time:number|null,analysis:Analysis|null,axis:Axis){
 const lap=time===null?undefined:session.laps.find(lap=>time>=lap.start&&time<lap.end);
 const view=lap&&analysis?.primary.lapId===lap.id?analysis.primary:null;
 const cursor=lap&&view&&time!==null?sessionTimeToCursor(time,lap,view,axis):null;
 const series=view?.series??[];
 const speed=series.find(s=>/^(gps )?speed$/i.test(s.name.trim()));
 const rpm=series.find(s=>s.unit.toLowerCase()==='rpm');
 const read=(s:typeof speed)=>s&&cursor!==null?interpolate(s.x,s.values,cursor,s.gaps):null;
 const elapsed=lap&&time!==null?time-lap.start:null;
 const position=lap&&view&&time!==null?sessionTimeToCursor(time,lap,view,'distance'):null;
 return {lap:lap?.number??null,progress:elapsed!==null&&lap&&lap.duration>0?Math.min(100,100*elapsed/lap.duration):null,
  speed:read(speed),speedUnit:speed?.unit??'',rpm:read(rpm),position,
  delta:cursor!==null&&analysis?.delta?interpolate(analysis.delta.x,analysis.delta.values,cursor):null,
  deltaMethod:view?analysis?.delta?.method:null};
}
