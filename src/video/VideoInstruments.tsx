import type {Analysis,Axis,Session} from '../types';
import {videoInstruments} from './instruments';
import {memo} from 'react';
import {displaySpeedUnit,speedFactor} from '../speedDisplay';

export const VideoInstruments=memo(function VideoInstruments({session,time,analysis,axis}:{session:Session;time:number|null;analysis:Analysis|null;axis:Axis}){
 const r=videoInstruments(session,time,analysis,axis);
 const value=(n:number|null,d=0)=>n===null?'—':n.toFixed(d);
 return <div className="video-instruments" aria-label="Synchronized telemetry overlay">
  <div className="video-instrument video-speed"><span>Speed <small>{displaySpeedUnit(r.speedUnit)||'unavailable'}</small></span><strong>{value(r.speed===null?null:r.speed*speedFactor(r.speedUnit),1)}</strong></div>
  <div className="video-instrument"><span>Engine <small>rpm</small></span><strong>{value(r.rpm)}</strong></div>
  <div className="video-instrument"><span>Lap {r.lap??'—'} <small>elapsed</small></span><strong>{value(r.progress,1)}<small>%</small></strong><div className="video-lap-progress"><i style={{width:`${r.progress??0}%`}}/></div></div>
  <div className="video-instrument"><span>Track position <small>m</small></span><strong>{value(r.position,1)}</strong></div>
  <div className="video-instrument"><span>{r.deltaMethod==='estimated'?'Estimated delta':'Delta to reference'} <small>s</small></span><strong className={r.delta===null?'':r.delta<=0?'video-ahead':'video-behind'}>{r.delta!==null&&r.delta>0?'+':''}{value(r.delta,3)}</strong></div>
 </div>;
});
