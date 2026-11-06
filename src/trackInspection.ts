import type {Analysis,Series} from './types';
import {interpolate} from './telemetry';
import {speedFactor} from './speedDisplay';

// Prepare once per analysis. High-frequency cursor updates only binary-search samples.
export function prepareTrackInspection(analysis:Analysis){
  const points=analysis.primary.track;
  const speed:Series={channelId:'gps-track-speed',name:'GPS speed',unit:'m/s',
    x:points.map(p=>p.position),values:points.map(p=>p.speed??NaN),
    gaps:points.flatMap((p,i)=>i>0&&p.breakBefore?[[points[i-1].position,p.position] as [number,number]]:[])};
  const rpm=analysis.primary.series.find(s=>s.unit.trim().toLowerCase()==='rpm'&&/rpm|engine/i.test(s.name));
  return {speed,rpm,delta:analysis.delta};
}
export function readTrackInspection(data:ReturnType<typeof prepareTrackInspection>,cursor:number|null){
  const sample=(series:Pick<Series,'x'|'values'|'gaps'>|null|undefined)=>cursor==null||!series?null:interpolate(series.x,series.values,cursor,series.gaps);
  const speed=sample(data.speed);
  return {speed:speed==null?null:speed*speedFactor('m/s'),rpm:sample(data.rpm),delta:sample(data.delta)};
}
