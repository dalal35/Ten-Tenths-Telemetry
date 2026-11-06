import type {Analysis,Axis,Session} from '../types';
import {videoInstruments} from './instruments';
import {memo} from 'react';
import {displaySpeedUnit,speedFactor} from '../speedDisplay';

export const VideoInstruments=memo(function VideoInstruments({session,time,analysis,axis}:{session:Session;time:number|null;analysis:Analysis|null;axis:Axis}){
 const r=videoInstruments(session,time,analysis,axis);
 const value=(n:number|null,d=0)=>n===null?'—':n.toFixed(d);
 const unit=(n:number|null,label:string)=>n===null||!label?null:<small>{label}</small>;
 return <div className="video-instruments" aria-label="Synchronized telemetry overlay">
  <div className="video-instrument video-speed"><span>Speed</span><strong>{value(r.speed===null?null:r.speed*speedFactor(r.speedUnit),1)}{unit(r.speed,displaySpeedUnit(r.speedUnit))}</strong></div>
  <div className="video-instrument"><span>Engine RPM</span><strong>{r.rpm===null?'—':Math.round(r.rpm).toLocaleString('en-US')}{unit(r.rpm,'rpm')}</strong></div>
  <div className="video-instrument"><span>Lap {r.lap??'—'} progress</span><strong>{value(r.progress,1)}{unit(r.progress,'%')}</strong><div className="video-lap-progress"><i style={{width:`${r.progress??0}%`}}/></div></div>
  <div className="video-instrument"><span>Track position</span><strong>{value(r.position,1)}{unit(r.position,'m')}</strong></div>
  <div className="video-instrument"><span>{r.deltaMethod==='estimated'?'Estimated delta':<>Delta<span className="video-instrument-long"> to reference</span></>}</span><strong className={r.delta===null?'':r.delta<=0?'video-ahead':'video-behind'}>{r.delta!==null&&r.delta>0?'+':''}{value(r.delta,3)}{unit(r.delta,'s')}</strong></div>
 </div>;
});
