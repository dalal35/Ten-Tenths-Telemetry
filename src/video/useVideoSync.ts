import {useCallback,useEffect,useRef,useState} from 'react';
import type {Analysis,Axis,Session} from '../types';
import {createSyncController} from './controller';
import {sessionTimeToCursor,validateSegments,videoToTelemetry,type MappingResult,type VideoSegment} from './model';
import type {VideoPlayer} from './player';

export function projectVideoTime(session:Session,time:number,primaryId:string,analysis:Analysis|null,axis:Axis){
  if(session.merge)return {lapId:null,cursor:null,cornerId:null};
  const lap=session.laps.find(lap=>time>=lap.start&&time<lap.end);
  const cursor=lap&&lap.id===primaryId&&analysis?.primary.lapId===lap.id?sessionTimeToCursor(time,lap,analysis.primary,axis):null;
  const cornerId=cursor===null?null:analysis?.segments.find(segment=>cursor>=segment.start&&cursor<segment.end)?.id??null;
  return {lapId:lap?.id??null,cursor,cornerId};
}
interface Options {
 session:Session|null;contentVersion:string;player:VideoPlayer|null;segments:VideoSegment[];primaryId:string;analysis:Analysis|null;axis:Axis;
 onLap:(lapId:string)=>void;onCursor:(cursor:number|null)=>void;onCorner:(cornerId:string|null)=>void;
}
type Clock={telemetryTime:number|null;result:MappingResult;status:'ready'|'unavailable'|'ambiguous'|'seeking'|'error';error:string|null;sourceId:string|null;contentVersion:string;player:VideoPlayer|null};
const idle:Clock={telemetryTime:null,result:{kind:'unavailable'},status:'unavailable',error:null,sourceId:null,contentVersion:'',player:null};
const inRecordedLap=(session:Session|null,time:number)=>!!session?.laps.some(lap=>time>=lap.start&&time<lap.end);
export function useVideoSync(options:Options){
 const latest=useRef(options);latest.current=options;
 const controllerError=useRef<string|null>(null),requestedTelemetry=useRef<number|null>(null);
 const [clock,setClock]=useState<Clock>(idle);
 const controller=useRef<ReturnType<typeof createSyncController>|null>(null),generation=useRef(0);
 const binding=useRef<{sourceId:string;contentVersion:string;player:VideoPlayer}|null>(null);
 const ownsBinding=()=>{const b=binding.current,o=latest.current;return !!b&&b.sourceId===o.session?.id&&b.contentVersion===o.contentVersion&&b.player===o.player;};
 const published=useRef<{cursor:number|null;corner:string|null}|null>(null),wantedLap=useRef<string|null>(null);
 const gate=useCallback(()=>{
  const {session,player,segments}=latest.current;if(!session||!player)return null;if(session.merge)return 'Video synchronization requires an original source context.';
  const duration=player.snapshot().duration;
  return validateSegments(segments,session.laps,duration!==null?duration:undefined).join(' ')||null;
 },[]);
 const seek=useCallback(async(type:'telemetry'|'video',time:number,segmentId?:string):Promise<MappingResult>=>{
  const sync=controller.current,token=generation.current,error=gate();
  if(sync&&!ownsBinding())return {kind:'unavailable'};
  requestedTelemetry.current=type==='telemetry'?time:null;
  if(!sync){setClock(previous=>({...previous,telemetryTime:type==='telemetry'?time:previous.telemetryTime,result:{kind:'unavailable'},status:error?'error':'unavailable',error,sourceId:latest.current.session?.id??null,contentVersion:latest.current.contentVersion,player:latest.current.player}));return {kind:'unavailable'};}
  controllerError.current=null;
  setClock(previous=>({...previous,telemetryTime:type==='telemetry'?time:previous.telemetryTime,status:error?'error':'seeking',error}));
  // Invalid mappings still use the controller's bounded pause/hold path with no seekable segments.
  const session=latest.current.session;
  const outside=type==='telemetry'? !inRecordedLap(session,time):(()=>{const mapped=videoToTelemetry(latest.current.segments,time);return mapped.kind==='mapped'&&!inRecordedLap(session,mapped.time);})();
  // An invalid controller target follows its bounded pause/hold path without issuing a media seek.
  const result=await(type==='telemetry'?sync.seekTelemetry(outside?NaN:time,segmentId):sync.seekVideo(outside?NaN:time));
  if(token!==generation.current)return {kind:'unavailable'};
  return result;
 },[gate]);
 const seekTelemetry=useCallback((time:number,segmentId?:string)=>seek('telemetry',time,segmentId),[seek]);
 const seekVideo=useCallback((time:number)=>seek('video',time),[seek]);
 useEffect(()=>{
  const token=++generation.current;controllerError.current=null;requestedTelemetry.current=null;wantedLap.current=null;published.current=null;setClock(idle);
  const player=options.player;if(!player||!options.session)return;
  const update=(result:MappingResult)=>{
   if(generation.current!==token||!ownsBinding())return;
   const covered=result.kind==='mapped'&&inRecordedLap(latest.current.session,result.time);
   const accepted:MappingResult=result.kind==='mapped'&&!covered?{kind:'unavailable'}:result;
   const error=gate()??controllerError.current;
   if(covered&&!error||player.snapshot().state==='playing')requestedTelemetry.current=null;
   const telemetryTime=covered&&!error?result.time:requestedTelemetry.current;
   setClock(previous=>{
    const next:Clock={telemetryTime,result:error?{kind:'unavailable'}:accepted,status:error?'error':accepted.kind==='mapped'?'ready':accepted.kind,error,sourceId:options.session!.id,contentVersion:options.contentVersion,player};
    const {player:previousPlayer,...before}=previous,{player:nextPlayer,...after}=next;
    return previousPlayer===nextPlayer&&JSON.stringify(before)===JSON.stringify(after)?previous:next;
   });
  };
  const sync=createSyncController(player,{nowMs:()=>performance.now(),segments:()=>gate()?[]:latest.current.segments,onTime:update,onError:error=>{if(generation.current===token&&ownsBinding()){controllerError.current=error;setClock(previous=>({...previous,status:'error',error}));}}});
  controller.current=sync;binding.current={sourceId:options.session.id,contentVersion:options.contentVersion,player};
  const visibility=()=>sync.setVisible(document.visibilityState!=='hidden');visibility();
  document.addEventListener('visibilitychange',visibility);
  const timer=setInterval(()=>sync.tick(),50);
  // The shared lap selection owns a new binding. A retained paused frame may
  // belong to a lap selected before leaving Video; reconcile before publishing it.
  const lap=options.session.laps.find(lap=>lap.id===options.primaryId);
  const mapped=videoToTelemetry(options.segments,player.snapshot().time);
  if(lap&&(mapped.kind!=='mapped'||mapped.time<lap.start||mapped.time>=lap.end))void seekTelemetry(lap.start);
  else sync.tick();
  return()=>{++generation.current;clearInterval(timer);document.removeEventListener('visibilitychange',visibility);sync.dispose();if(controller.current===sync){controller.current=null;binding.current=null;}};
 },[options.session?.id,options.contentVersion,options.player,gate,seekTelemetry]);
 useEffect(()=>{
  if(!options.player){latest.current.onCorner(null);published.current=null;return;}
  const projection=options.session&&clock.sourceId===options.session.id&&clock.contentVersion===options.contentVersion&&clock.player===options.player&&clock.telemetryTime!==null&&clock.status==='ready'?projectVideoTime(options.session,clock.telemetryTime,options.primaryId,options.analysis,options.axis):{lapId:null,cursor:null,cornerId:null};
  if(projection.lapId&&projection.lapId!==options.primaryId&&wantedLap.current!==projection.lapId){wantedLap.current=projection.lapId;latest.current.onLap(projection.lapId);}
  if(projection.lapId===options.primaryId)wantedLap.current=null;
  if(!published.current||published.current.cursor!==projection.cursor){latest.current.onCursor(projection.cursor);}
  if(!published.current||published.current.corner!==projection.cornerId){latest.current.onCorner(projection.cornerId);}
  published.current={cursor:projection.cursor,corner:projection.cornerId};
 },[clock,options.session,options.contentVersion,options.primaryId,options.analysis,options.axis,options.player]);
 const owned=clock.sourceId===options.session?.id&&clock.contentVersion===options.contentVersion&&clock.player===options.player;
 return {telemetryTime:owned?clock.telemetryTime:null,status:owned?clock.status:'unavailable' as const,error:owned?clock.error:null,seekTelemetry,seekVideo};
}
