import {useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {convertFileSrc} from '@tauri-apps/api/core';
import {authorizeLocalVideo,pickLocalVideo,isNative,downloadYouTubeVideo,getYouTubeDownloadStatus,cancelYouTubeDownload,resolveCachedYouTubeVideo,releaseYouTubeVideo,getYouTubeCacheStatus,setYouTubeCacheLimit,cleanYouTubeCache,removeYouTubeCacheEntry,startVideoSync,videoSyncStatus,cancelVideoSync} from '../bridge';
import type {YouTubeAsset,YouTubeCacheStatus,YouTubeDownloadStatus,VideoSyncStatus} from '../bridge';
import type {Session} from '../types';
import {lapCoverage,lapMarkers,parseYouTubeUrl,telemetryToVideo,validateSegments} from './model';
import type {VideoSegment,VideoSource,VideoStateV1} from './model';
import {assessVideoReference,chooseVideoReference} from './state';
import {createHtmlPlayer} from './htmlPlayer';
import {createYouTubePlayer} from './youtubePlayer';
import type {PlayerSnapshot,VideoPlayer} from './player';
import {SegmentEditor} from './SegmentEditor';
import {VideoTimeline} from './VideoTimeline';

export interface VideoWorkspaceProps {
  session:Session;
  state:VideoStateV1;
  availability:'ready'|'missing'|'changed'|'error';
  telemetryTime:number|null;
  onChange:(next:VideoStateV1)=>void;
  onPlayer:(player:VideoPlayer|null)=>void;
  onSeekTelemetry:(time:number,segmentId?:string)=>void;
  onSeekVideo:(time:number)=>void;
  beforeRelease?:()=>Promise<void>;
  saveReady?:boolean;
  onSelectRecording?:(recordingId:string)=>void;
  children?:ReactNode;
  active?:boolean;
}
const idle:PlayerSnapshot={time:0,duration:null,rate:1,state:'loading',observedAtMs:0,seeking:false};
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
const clampHeight=(height:number)=>Math.max(240,Math.min(900,height));

export function VideoWorkspace(props:VideoWorkspaceProps) {
  const {session,state,availability,telemetryTime,onChange,onSeekTelemetry,onSeekVideo,active=true}=props;
  const [opened,setOpened]=useState(active);
  useEffect(()=>{if(active)setOpened(true);},[active]);
  const latest=useRef(props);latest.current=props;
  const releaseLease=(leaseId:string)=>{void (async()=>{try{await latest.current.beforeRelease?.();}finally{await releaseYouTubeVideo(leaseId);}})().catch(()=>{});};
  const sticky=useRef<HTMLDivElement>(null);
  const host=useRef<HTMLDivElement>(null),video=useRef<HTMLVideoElement>(null),player=useRef<VideoPlayer|null>(null);
  const [sample,setSample]=useState<PlayerSnapshot>(idle);
  useEffect(()=>{
    const panel=sticky.current,main=panel?.closest<HTMLElement>('.workspace-viewport')??panel?.closest<HTMLElement>('main');if(!panel||!main||!active)return;
    const update=()=>main.style.setProperty('--video-scroll-offset',getComputedStyle(panel).position==='sticky'?`${Math.ceil(panel.getBoundingClientRect().height)+8}px`:'0px');
    const observer=new ResizeObserver(update);observer.observe(panel);observer.observe(main);update();
    return()=>{observer.disconnect();main.style.removeProperty('--video-scroll-offset');};
  },[active]);

  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[url,setUrl]=useState('');
  const [pending,setPending]=useState<{source:VideoSource;preserve:boolean}|null>(null);
  const [pendingAsset,setPendingAsset]=useState<YouTubeAsset|null>(null),[downloadStatus,setDownloadStatus]=useState<YouTubeDownloadStatus|null>(null),[cacheStatus,setCacheStatus]=useState<YouTubeCacheStatus|null>(null),[cacheLimit,setCacheLimit]=useState(''),[cacheMissing,setCacheMissing]=useState(false),[cacheError,setCacheError]=useState('');
  const [playerGeneration,setPlayerGeneration]=useState(0);
  const pendingAssetRef=useRef<YouTubeAsset|null>(null);
  const activeJob=useRef<string|null>(null),readyAsset=useRef<{key:string;asset:YouTubeAsset}|null>(null);
  const holdPendingAsset=(asset:YouTubeAsset|null)=>{const previous=pendingAssetRef.current;if(previous&&previous.leaseId!==asset?.leaseId)void releaseYouTubeVideo(previous.leaseId);pendingAssetRef.current=asset;setPendingAsset(asset);};
  const refreshCacheStatus=async()=>{try{const status=await getYouTubeCacheStatus();setCacheStatus(status);setCacheLimit(String(status.limitBytes));setCacheError('');}catch(error){setCacheError(message(error));}};
  const [referenceStatus,setReferenceStatus]=useState<'ready'|'missing'|'changed'>('ready');
  const [acceptedKey,setAcceptedKey]=useState<string|null>(null);
  const [anchorLapId,setAnchorLapId]=useState(session.laps[0]?.id??'');
  const [height,setHeight]=useState(clampHeight(state.preferences.panelHeight));
  const sourceKey=JSON.stringify(state.source);
  const syncKey=JSON.stringify([session.id,state.sessionId,state.contentVersion,state.source,state.segments]);
  const syncRef=useRef<{key:string;job:string|null;cancelled:boolean}|null>(null);
  const [syncStatus,setSyncStatus]=useState<VideoSyncStatus|null>(null);
  const [syncBusy,setSyncBusy]=useState(false);
  const syncStatusKey=useRef(syncKey);
  const visibleSyncStatus=syncStatusKey.current===syncKey?syncStatus:null;
  const [syncStart,setSyncStart]=useState('0'),[syncEnd,setSyncEnd]=useState('');
  const stopSync=()=>{const run=syncRef.current;if(!run||run.cancelled)return;run.cancelled=true;if(run.job)void cancelVideoSync(run.job).catch(()=>{});};
  useEffect(()=>{setSyncStatus(null);return()=>stopSync();},[syncKey]);
  useEffect(()=>()=>{stopSync();syncRef.current=null;},[]);
  const startSync=async(entire=false)=>{
    const start=entire?0:Number(syncStart),end=entire?(knownDuration??NaN):Number(syncEnd),source=state.source;
    if(!source||!isNative||!props.saveReady||(!entire&&(!syncStart.trim()||!syncEnd.trim()))||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end-start>14400||knownDuration===null||end>knownDuration){setSyncStatus({phase:'error',progress:0,result:null,error:'Choose a valid interval within the footage, up to four hours, after the workspace is saved.'});return;}
    if(syncRef.current)return;
    if(entire){setSyncStart('0');setSyncEnd(String(end));}
    setSyncBusy(true);
    const run={key:syncKey,job:null as string|null,cancelled:false};syncRef.current=run;syncStatusKey.current=syncKey;
    setSyncStatus({phase:'preparing',progress:0,result:null,error:null});
    const current=()=>!run.cancelled&&syncRef.current===run&&JSON.stringify([latest.current.session.id,latest.current.state.sessionId,latest.current.state.contentVersion,latest.current.state.source,latest.current.state.segments])===run.key;
    try{
      const job=await startVideoSync(session.id,state.contentVersion,source,start,end);run.job=job;
      if(!current())void cancelVideoSync(job).catch(()=>{});
      let statusFailures=0;
      while(syncRef.current===run){
        try{
          const status=await videoSyncStatus(job);statusFailures=0;
          if(current())setSyncStatus(status);
          if(['complete','error','cancelled'].includes(status.phase)){syncRef.current=null;setSyncBusy(false);return;}
        }catch(error){if(current()){stopSync();setSyncStatus({phase:'error',progress:0,result:null,error:message(error)});}if(++statusFailures>=3||message(error).includes('Unknown video sync job')){syncRef.current=null;setSyncBusy(false);return;}}
        await new Promise(resolve=>window.setTimeout(resolve,400));
      }
    }catch(error){if(current())setSyncStatus({phase:'error',progress:0,result:null,error:message(error)});if(syncRef.current===run){syncRef.current=null;setSyncBusy(false);}}
  };
  const effectiveAvailability=acceptedKey===sourceKey?'ready':availability;
  const currentAvailability=effectiveAvailability==='ready'?referenceStatus:effectiveAvailability;
  const usable=!!state.source&&currentAvailability==='ready';
  const nativeYouTube=state.source?.type==='youtube'&&isNative&&!state.source.cache;
  const needsYouTubeDownload=!!(nativeYouTube||cacheMissing);
  const selected=state.segments.find(segment=>segment.id===state.selectedSegmentId);
  const paused=sample.state==='paused'||sample.state==='ended';
  const knownDuration=sample.duration!==null&&Number.isFinite(sample.duration)&&sample.duration>0?sample.duration:null;
  useEffect(()=>{if(knownDuration!==null){stopSync();setSyncStatus(null);setSyncEnd(String(Math.min(knownDuration,14400)));}},[knownDuration]);
  const coverage=lapCoverage(state.segments,session.laps);
  const reverse=telemetryTime===null?{kind:'unavailable' as const}:telemetryToVideo(state.segments,telemetryTime);
  useEffect(()=>{
    setAnchorLapId(current=>session.laps.some(lap=>lap.id===current)?current:session.laps[0]?.id??'');
  },[session.id,session.laps]);
  useEffect(()=>setAcceptedKey(null),[availability]);
  useEffect(()=>setHeight(clampHeight(state.preferences.panelHeight)),[state.preferences.panelHeight]);
  useEffect(()=>{if(pendingAssetRef.current)holdPendingAsset(null);setReferenceStatus('ready');setPending(null);setError('');setCacheMissing(false);},[sourceKey]);
  useEffect(()=>()=>{const asset=pendingAssetRef.current;if(asset){pendingAssetRef.current=null;void releaseYouTubeVideo(asset.leaseId);}},[]);
  useEffect(()=>{if(!isNative)return;let active=true;void getYouTubeCacheStatus().then(status=>{if(active){setCacheStatus(status);setCacheLimit(String(status.limitBytes));setCacheError('');}}).catch(error=>{if(active)setCacheError(message(error));});return()=>{active=false;};},[]);
  useEffect(()=>()=>{const job=activeJob.current;if(job){activeJob.current=null;void cancelYouTubeDownload(job);setBusy(false);setDownloadStatus(previous=>previous?.jobId===job?{...previous,phase:'cancelled'}:previous);}},[session.id,sourceKey]);

  useEffect(()=>{
    let active=true,restored=false,ownedLease:string|null=null;
    const releaseOwnedLease=()=>{if(!ownedLease)return;const lease=ownedLease;ownedLease=null;releaseLease(lease);};
    let adapter:VideoPlayer|null=null,unsubscribe:(()=>void)|undefined;
    setSample(idle);
    latest.current.onPlayer(null);
    if(!opened||!state.source||effectiveAvailability!=='ready'||referenceStatus!=='ready'||nativeYouTube)return;
    const source=state.source;
    const initialize=async()=>{
      try {
        if(source.type==='local'){
          const info=await authorizeLocalVideo(source.path);
          if(!active)return;
          const assessment=assessVideoReference(source,info.status==='ready'?info:null);
          if(!assessment.canPlay){setReferenceStatus(assessment.status);if(info.status==='ready')setPending({source:{type:'local',path:info.path,size:info.size,modifiedMs:info.modifiedMs},preserve:true});return;}
          adapter=createHtmlPlayer(video.current!,convertFileSrc(source.path));
        }else if(isNative){
          const downloaded=readyAsset.current?.key===sourceKey?readyAsset.current.asset:await resolveCachedYouTubeVideo(source.videoId);
          if(!active){if(downloaded)void releaseYouTubeVideo(downloaded.leaseId);return;}
          if(!downloaded){setCacheMissing(true);setError('Cached footage is missing. Download this video again to restore playback.');return;}
          ownedLease=downloaded.leaseId;
          const expected=source.cache;
          const changed=expected&&(expected.sha256!==downloaded.sha256||expected.size!==downloaded.size||expected.durationSeconds!==downloaded.durationSeconds||expected.trackStartSeconds!==downloaded.trackStartSeconds);
          if(changed||(!expected&&state.segments.length)){
            const updated:VideoSource={...source,cache:{sha256:downloaded.sha256,size:downloaded.size,durationSeconds:downloaded.durationSeconds,trackStartSeconds:downloaded.trackStartSeconds}};
            setPending({source:updated,preserve:true});holdPendingAsset(downloaded);ownedLease=null;return;
          }
          if(!expected){const updated:VideoSource={...source,cache:{sha256:downloaded.sha256,size:downloaded.size,durationSeconds:downloaded.durationSeconds,trackStartSeconds:downloaded.trackStartSeconds}};onChange({...state,source:updated});releaseLease(downloaded.leaseId);ownedLease=null;return;}
          adapter=createHtmlPlayer(video.current!,convertFileSrc(downloaded.path));
        }else adapter=createYouTubePlayer(host.current!,source.videoId);
        if(!active){adapter?.dispose();releaseOwnedLease();return;}
        player.current=adapter;
        setSample(adapter.snapshot());
        let previousState=adapter.snapshot().state,previousRate=adapter.snapshot().rate,previousSeeking=false;
        unsubscribe=adapter.subscribe(next=>{
          if(!active)return;
          setSample(next);
          // Native controls may pause/rate-change outside our common controls. Save semantic transitions only.
          if(!restored){previousState=next.state;previousRate=next.rate;previousSeeking=next.seeking;return;}
          const current=latest.current.state;
          const savePause=(next.state==='paused'||next.state==='ended')&&(next.state!==previousState||previousSeeking&&!next.seeking)&&!next.seeking;
          const saveRate=next.rate!==previousRate&&next.state!=='loading'&&next.state!=='error';
          previousState=next.state;previousRate=next.rate;previousSeeking=next.seeking;
          if(savePause||saveRate)latest.current.onChange({...current,preferences:{...current.preferences,
            ...(savePause?{pausedVideoTime:next.time}:{}),...(saveRate?{playbackRate:next.rate}:{})}});
        });
        await adapter.ready;
        if(!active)return;
        await adapter.pause();
        const preferences=latest.current.state.preferences;
        if(adapter.supportedRates().includes(preferences.playbackRate))await adapter.setRate(preferences.playbackRate);
        if(preferences.pausedVideoTime>0)await adapter.seek(Math.min(preferences.pausedVideoTime,adapter.snapshot().duration??preferences.pausedVideoTime),new AbortController().signal);
        if(!active)return;
        restored=true;setSample(adapter.snapshot());latest.current.onPlayer(adapter);
      }catch(error){if(active){releaseOwnedLease();adapter?.dispose();if(player.current===adapter)player.current=null;setError(message(error));}}
    };
    void initialize();
    return()=>{active=false;unsubscribe?.();adapter?.dispose();if(player.current===adapter)player.current=null;latest.current.onPlayer(null);if(ownedLease){const lease=ownedLease;releaseOwnedLease();if(readyAsset.current?.asset.leaseId===lease)readyAsset.current=null;}};
  },[sourceKey,effectiveAvailability,referenceStatus,nativeYouTube,session.id,opened,playerGeneration]);
  useEffect(()=>{if(!active&&player.current)void player.current.pause().catch(error=>setError(message(error)));},[active]);

  const change=(next:VideoStateV1)=>{setError('');onChange(next);};
  const commitSource=(source:VideoSource,preserve:boolean)=>{
    const current=latest.current.state;
    const chosen=chooseVideoReference(current.source,source,true);
    if(!chosen)return;
    const held=pendingAssetRef.current;
    if(held&&chosen.type==='youtube'&&chosen.cache?.sha256===held.sha256)readyAsset.current={key:JSON.stringify(chosen),asset:held};
    else if(held)void releaseYouTubeVideo(held.leaseId);
    pendingAssetRef.current=null;setPendingAsset(null);
    setAcceptedKey(JSON.stringify(chosen));setReferenceStatus('ready');setPending(null);setError('');
    setCacheMissing(false);if(JSON.stringify(current.source)===JSON.stringify(chosen))setPlayerGeneration(value=>value+1);
    onChange({...current,source:chosen,segments:preserve?current.segments:[],selectedSegmentId:preserve?current.selectedSegmentId:null,
      preferences:preserve?current.preferences:{...current.preferences,pausedVideoTime:0}});
  };
  const choose=async(preserve:boolean)=>{
    setBusy(true);setError('');
    const sessionId=session.id,originalSourceKey=sourceKey;
    try {
      const info=await pickLocalVideo();if(!info||latest.current.session.id!==sessionId||JSON.stringify(latest.current.state.source)!==originalSourceKey)return;
      if(info.status!=='ready')throw new Error('Footage unavailable. Choose an existing MP4 or MOV file.');
      const source:VideoSource={type:'local',path:info.path,size:info.size,modifiedMs:info.modifiedMs};
      if(state.source){holdPendingAsset(null);setPending({source,preserve});}else commitSource(source,false);
    }catch(error){setError(message(error));}finally{setBusy(false);}
  };
  const attachYouTube=async(source:Extract<VideoSource,{type:'youtube'}>)=>{
    if(!isNative){if(state.source)setPending({source,preserve:false});else commitSource(source,false);return;}
    const sessionId=session.id,originalSourceKey=sourceKey,jobId=crypto.randomUUID();
    activeJob.current=jobId;setBusy(true);setError('');setDownloadStatus({jobId,videoId:source.videoId,phase:'preparing',downloadedBytes:0,totalBytes:null,speedBytesPerSecond:null,etaSeconds:null,error:null});
    const poll=window.setInterval(()=>{void getYouTubeDownloadStatus(jobId).then(status=>{if(status&&activeJob.current===jobId)setDownloadStatus(status);}).catch(()=>{});},400);
    try{
      const asset=await downloadYouTubeVideo(source.url,jobId);
      if(activeJob.current!==jobId||latest.current.session.id!==sessionId||JSON.stringify(latest.current.state.source)!==originalSourceKey){void releaseYouTubeVideo(asset.leaseId);return;}
      const attached:VideoSource={...source,cache:{sha256:asset.sha256,size:asset.size,durationSeconds:asset.durationSeconds,trackStartSeconds:asset.trackStartSeconds}};
      const current=latest.current.state;
      const sameYoutube=current.source?.type==='youtube'&&current.source.videoId===source.videoId;
      const savedCache=current.source?.type==='youtube'?current.source.cache:undefined;
      const sameCache=sameYoutube&&!!savedCache&&savedCache.sha256===asset.sha256&&savedCache.size===asset.size&&savedCache.durationSeconds===asset.durationSeconds&&savedCache.trackStartSeconds===asset.trackStartSeconds;
      if(sameCache||sameYoutube&&!current.segments.length){readyAsset.current={key:JSON.stringify(attached),asset};commitSource(attached,true);}
      else if(sameYoutube&&current.segments.length){setPending({source:attached,preserve:true});holdPendingAsset(asset);}
      else if(current.source){setPending({source:attached,preserve:false});holdPendingAsset(asset);}
      else{readyAsset.current={key:JSON.stringify(attached),asset};commitSource(attached,false);}
      setDownloadStatus({jobId,videoId:asset.videoId,phase:'complete',downloadedBytes:asset.size,totalBytes:asset.size,speedBytesPerSecond:null,etaSeconds:0,error:null});
      void refreshCacheStatus();
    }catch(error){
      if(activeJob.current===jobId){const detail=message(error);setError(detail);setDownloadStatus(previous=>previous?.jobId===jobId?{...previous,phase:'error',error:detail}:previous);}
    }finally{window.clearInterval(poll);if(activeJob.current===jobId){activeJob.current=null;setBusy(false);}}
  };
  const cancelDownload=()=>{const job=downloadStatus?.jobId??activeJob.current;if(!job)return;activeJob.current=null;setBusy(false);setDownloadStatus(previous=>previous?{...previous,phase:'cancelled'}:previous);void cancelYouTubeDownload(job).catch(error=>setError(message(error)));};
  const refreshCache=async()=>{try{setCacheStatus(await getYouTubeCacheStatus());}catch(error){setError(message(error));}};
  const operation=async(run:(player:VideoPlayer)=>Promise<void>)=>{
    const adapter=player.current;if(!adapter)return;
    setBusy(true);setError('');
    try {await run(adapter);if(player.current!==adapter)return;const next=adapter.snapshot();setSample(next);
    }catch(error){if(player.current===adapter)setError(message(error));}finally{setBusy(false);}
  };
  const saveSegments=(segments:VideoSegment[],selectedSegmentId:string|null=state.selectedSegmentId)=>{
    const errors=validateSegments(segments,session.laps,knownDuration??undefined);
    if(segments.length>100)errors.push('At most 100 segments can be saved.');
    if(errors.length){setError(errors.join(' '));return;}
    change({...state,segments,selectedSegmentId:segments.some(segment=>segment.id===selectedSegmentId)?selectedSegmentId:null});
  };
  const anchor=(adding:boolean)=>{
    const lap=session.laps.find(lap=>lap.id===anchorLapId);
    if(!lap||!knownDuration||!paused)return;
    const time=player.current?.snapshot().time??sample.time;
    if(time>=knownDuration){setError('Choose a frame before the end of the footage.');return;}
    if(!state.segments.length){const segment:VideoSegment={id:crypto.randomUUID(),videoStart:0,videoEnd:knownDuration,anchorVideoTime:time,anchorTelemetryTime:lap.start,anchorLapId:lap.id,correctionSeconds:0};saveSegments([segment],segment.id);return;}
    if(adding){
      if(state.segments.some(segment=>time>=segment.videoStart&&time<segment.videoEnd)){setError('Trim the existing segment first, then pause inside an unmapped interval to add a cut.');return;}
      const start=Math.max(0,...state.segments.filter(segment=>segment.videoEnd<=time).map(segment=>segment.videoEnd));
      const end=Math.min(knownDuration,...state.segments.filter(segment=>segment.videoStart>time).map(segment=>segment.videoStart));
      const segment:VideoSegment={id:crypto.randomUUID(),videoStart:start,videoEnd:end,anchorVideoTime:time,anchorTelemetryTime:lap.start,anchorLapId:lap.id,correctionSeconds:0};saveSegments([...state.segments,segment],segment.id);
    }else{
      const segment=selected&&time>=selected.videoStart&&time<selected.videoEnd?selected:state.segments.find(segment=>time>=segment.videoStart&&time<segment.videoEnd);
      if(!segment){setError('This frame is in an unmapped gap. Use Add segment here.');return;}
      saveSegments(state.segments.map(item=>item.id===segment.id?{...item,anchorVideoTime:time,anchorTelemetryTime:lap.start,anchorLapId:lap.id,correctionSeconds:0}:item),segment.id);
    }
  };
  const resize=(value:number,save:boolean)=>{
    const panelHeight=clampHeight(value);setHeight(panelHeight);
    if(save){const current=latest.current.state;latest.current.onChange({...current,preferences:{...current.preferences,panelHeight}});}
  };
  return <section className={active?"workspace-stage video-workspace":"workspace-stage"} aria-label={active?"Video synchronization":undefined}>
    <div className="video-surfaces" hidden={!active} style={{display:active?'contents':'none'}}>
    <div ref={sticky} className="video-sticky-player">
      <div className="video-section-title"><div><span className="eyebrow">ONBOARD FOOTAGE</span><h2>Video synchronization</h2></div><span className="video-status" role="status">{!state.source?'No footage':nativeYouTube?'Download required':usable?sample.state:'Footage unavailable'}</span></div>
      {state.source&&<p className="video-source-name">{state.source.type==='local'?state.source.path:state.source.url}</p>}
      {!usable||needsYouTubeDownload?<div className="video-placeholder">
        <strong>{state.source?.type==='youtube'&&isNative?'Download footage for desktop playback':state.source?'Footage unavailable':'Bring your onboard footage alongside telemetry'}</strong>
        <p>{nativeYouTube?'Download this YouTube video to play an authorized local copy.':currentAvailability==='missing'?'The saved file is missing. Locate it to preserve your segments.':currentAvailability==='changed'?'The file metadata changed. Confirm that the existing mappings still apply.':currentAvailability==='error'?'The video reference could not be checked. Locate the file or replace the footage.':'Attach a local MP4 / MOV or paste a YouTube link. Files stay on your computer.'}</p>
      </div>:<div className="video-player-space" style={{height}}><div className="video-viewport">
        {state.source?.type==='local'||isNative&&state.source?.type==='youtube'?<video ref={video} controls playsInline preload="metadata"/>:<div ref={host} className="video-youtube-host"/>}
      </div></div>}
      <div className="video-controls">
        <button disabled={!usable||!player.current||busy||nativeYouTube} onClick={()=>void operation(adapter=>sample.state==='playing'||sample.state==='buffering'?adapter.pause():adapter.play())}>{sample.state==='playing'||sample.state==='buffering'?'Pause':'Play'}</button>
        <span className="mono">Video {sample.time.toFixed(2)}s {knownDuration?`/ ${knownDuration.toFixed(2)}s`:''}</span>
        <label>Playback speed<select disabled={!usable||!player.current||busy||nativeYouTube} value={sample.rate} onChange={event=>{const rate=Number(event.target.value);void operation(adapter=>adapter.setRate(rate));}}>{(player.current?.supportedRates()??[1]).map(rate=><option key={rate} value={rate}>{rate}×</option>)}</select></label>
        <span className="video-telemetry-time">Telemetry <span className="mono">{telemetryTime===null?'unavailable':`${telemetryTime.toFixed(2)}s`}</span></span>
      </div>
      {state.source?.type==='youtube'&&<p className="video-note">{isNative?'Playing the cached copy. The original YouTube URL and verified media identity are saved.':'YouTube synchronization uses approximate asynchronous timing. Native YouTube controls remain available in the player.'}</p>}
      {state.source?.type==='local'&&<p className="video-note">Timing follows media timestamps and manual alignment; frame accuracy is not guaranteed.</p>}
      <div role="separator" tabIndex={0} aria-label="Resize video panel" aria-orientation="horizontal" aria-valuenow={height} aria-valuemin={240} aria-valuemax={900}
        className="video-resize" onKeyDown={event=>{if(['ArrowUp','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();resize(event.key==='Home'?240:event.key==='End'?900:height+(event.key==='ArrowDown'?20:-20),true);}}}
        onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);event.currentTarget.dataset.startY=String(event.clientY);event.currentTarget.dataset.startHeight=String(height);}}
        onPointerMove={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))resize(Number(event.currentTarget.dataset.startHeight)+event.clientY-Number(event.currentTarget.dataset.startY),false);}}
        onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId)){event.currentTarget.releasePointerCapture(event.pointerId);resize(height,true);}}}><span/></div>
    </div>
    <div className="video-source-controls">
      <button disabled={busy} onClick={()=>void choose(false)}>{state.source?'Replace footage':'Attach MP4 / MOV'}</button>
      {state.source&&currentAvailability!=='ready'&&<button disabled={busy} onClick={()=>void choose(true)}>Locate</button>}
      <form onSubmit={event=>{event.preventDefault();const source=parseYouTubeUrl(url);if(!source){setError('Enter a valid YouTube watch, share or short video URL.');return;}void attachYouTube(source);}}>
        <label>YouTube URL<input type="url" value={url} placeholder="https://www.youtube.com/watch?v=…" onChange={event=>setUrl(event.target.value)}/></label><button type="submit" disabled={busy}>{isNative?'Download YouTube':'Attach YouTube'}</button>
      </form>
      {needsYouTubeDownload&&state.source?.type==='youtube'&&<button disabled={busy} onClick={()=>void attachYouTube(state.source as Extract<VideoSource,{type:'youtube'}>)}>Download saved URL</button>}
      {isNative&&state.source?.type==='youtube'&&<button disabled={busy||!!player.current&&!cacheMissing} onClick={()=>void removeYouTubeCacheEntry((state.source as Extract<VideoSource,{type:'youtube'}>).videoId).then(status=>{setCacheStatus(status);setCacheError('');setCacheMissing(true);}).catch(error=>setCacheError(message(error)))}>Remove cached YouTube copy</button>}
      {downloadStatus&&['preparing','downloading','merging','validating'].includes(downloadStatus.phase)&&<button onClick={cancelDownload}>Cancel download</button>}
    </div>
    {downloadStatus&&<div className="video-download-status" role="status"><span>{downloadStatus.phase==='complete'?'Download ready':downloadStatus.phase==='error'?downloadStatus.error:downloadStatus.phase==='cancelled'?'Download cancelled':`${downloadStatus.phase[0].toUpperCase()}${downloadStatus.phase.slice(1)}${downloadStatus.downloadedBytes===null?'':` · ${(downloadStatus.downloadedBytes/1048576).toFixed(1)} MiB`}${downloadStatus.totalBytes?` / ${(downloadStatus.totalBytes/1048576).toFixed(1)} MiB`:''}${downloadStatus.speedBytesPerSecond?` · ${(downloadStatus.speedBytesPerSecond/1048576).toFixed(1)} MiB/s`:''}${downloadStatus.etaSeconds===null?'':` · ${Math.ceil(downloadStatus.etaSeconds)}s left`}`}</span>{['preparing','downloading','merging','validating'].includes(downloadStatus.phase)&&<progress aria-label="YouTube download progress" max={downloadStatus.totalBytes??undefined} value={downloadStatus.totalBytes?downloadStatus.downloadedBytes??0:undefined}/>}</div>}
    {pending&&<div className="video-confirm" role="group" aria-label={pending.preserve?'Confirm relocated footage':'Confirm replacement'}>
      <p>{pending.preserve?pending.source.type==='youtube'?'The cached media identity differs or was not recorded. Confirm that the existing sync mappings still apply to this downloaded copy.':'File metadata cannot prove footage identity. Confirm that these segments still apply to the located file.':'Replacing footage clears all existing segments. The telemetry session stays available.'}</p>
      <div className="video-actions"><button className="video-primary" onClick={()=>commitSource(pending.source,pending.preserve)}>{pending.preserve?'Confirm mappings still apply':'Replace and clear segments'}</button><button onClick={()=>{holdPendingAsset(null);setPending(null);}}>Cancel</button></div>
    </div>}
    {(error||sample.error)&&<p role="alert" className="video-error">{error||sample.error} {state.source?.type==='local'?'If this file cannot decode, try a supported H.264 MP4 / MOV export.':''}</p>}
    <section className="video-anchor-controls" aria-label="Automatic sync estimate">
      <h3>Automatic sync estimate</h3>
      <p>Analyze up to four hours. Lap sequences are compared across imported recordings and separated at possible edits. Estimates do not change your manual segments.</p>
      {!isNative&&<p>Automatic analysis is available in the desktop app.</p>}
      {isNative&&!props.saveReady&&<p>Waiting for the workspace to save before analysis.</p>}
      <div className="video-actions"><label>Analysis start · seconds<input type="number" min="0" step="any" value={syncStart} onChange={event=>{stopSync();setSyncStatus(null);setSyncStart(event.target.value);}}/></label><label>Analysis end · seconds<input type="number" min="0" step="any" value={syncEnd} onChange={event=>{stopSync();setSyncStatus(null);setSyncEnd(event.target.value);}}/></label>
        <button disabled={!isNative||!usable||needsYouTubeDownload||!knownDuration||!props.saveReady||syncBusy} onClick={()=>void startSync()}>Estimate sync</button><button disabled={!isNative||!usable||needsYouTubeDownload||!knownDuration||!props.saveReady||syncBusy} onClick={()=>void startSync(true)}>Analyze entire video</button>
        {syncRef.current&&<button onClick={()=>{stopSync();setSyncStatus({phase:'cancelled',progress:0,result:null,error:null});}}>Cancel analysis</button>}</div>
      {visibleSyncStatus&&<div role="status"><p>{visibleSyncStatus.phase==='error'?visibleSyncStatus.error:visibleSyncStatus.phase==='cancelled'?'Analysis cancelled':visibleSyncStatus.phase==='complete'?'Analysis complete':`Analysis ${visibleSyncStatus.phase}`}</p>{['preparing','sampling','matching'].includes(visibleSyncStatus.phase)&&<progress aria-label="Sync analysis progress" max={1} value={visibleSyncStatus.progress}/>}</div>}
      {visibleSyncStatus?.result&&<div><p>{visibleSyncStatus.result.ambiguous?'This match is unresolved. ':''}{visibleSyncStatus.result.rejectionReason??'Automatic application requires calibrated reliability and verified continuity.'}</p>
        <p>These are uncalibrated candidates; ranking and peak width do not establish accuracy. Check every candidate against known footage and telemetry.</p>
        {visibleSyncStatus.result.sequence&&<div>
          <p>Sequence confidence: {visibleSyncStatus.result.sequence.confidence}. Scores describe relative evidence, not a calibrated probability. {visibleSyncStatus.result.sequence.competitorMargin===null?'':`Global schedule evidence gap: ${visibleSyncStatus.result.sequence.competitorMargin.toFixed(2)}. `}{visibleSyncStatus.result.sequence.comparisonIncomplete?'Search and recording comparison are incomplete. ':''}{visibleSyncStatus.result.sequence.sampledFrames} sampled frames · {visibleSyncStatus.result.sequence.runtimeSeconds.toFixed(1)} s analysis.</p>
          {visibleSyncStatus.result.sequence.assignment&&<div>
            <h4>Proposed recording intervals</h4>
            <p>Disjoint recordings can coexist. Occurrence proposals require at least six observed intervals; shorter fits stay unresolved. Bounds cover observed crossings only and remain unvalidated.</p>
            <div className="event-table-scroll" role="region" aria-label="Recording interval table" tabIndex={0}><table className="event-table"><caption>Global video-to-recording assignment</caption><thead><tr><th>Recording</th><th>Video interval · s</th><th>XRK interval · s</th><th>Offset · s</th><th>Evidence</th><th>Status</th><th>Inspect</th></tr></thead><tbody>
              {visibleSyncStatus.result.sequence.assignment.segments.filter(segment=>['selected','provisional','rejectedAmbiguous'].includes(segment.status)).map((segment,i)=><tr key={i}>
                <td>{segment.recordingName}</td><td>{segment.videoStartSeconds.toFixed(3)}–{segment.videoEndSeconds.toFixed(3)}</td><td>{segment.telemetryStartSeconds.toFixed(3)}–{segment.telemetryEndSeconds.toFixed(3)}</td><td>{segment.offsetSeconds.toFixed(3)}</td><td>{segment.boundaries.length} crossings · {segment.matchedLaps} laps</td>
                <td>{segment.status==='rejectedAmbiguous'?'Unmapped: ambiguous':segment.status==='provisional'?'Provisional: comparison incomplete':'Proposed: unvalidated'}</td>
                <td><button onClick={()=>onSeekVideo(segment.videoStartSeconds)}>View footage</button>{props.onSelectRecording&&segment.recordingId!==session.id&&<button onClick={()=>props.onSelectRecording?.(segment.recordingId)}>Open recording</button>}</td>
              </tr>)}
            </tbody></table></div>
            <details><summary>Unmapped footage · {visibleSyncStatus.result.sequence.assignment.unmappedGaps.length} intervals</summary>{visibleSyncStatus.result.sequence.assignment.unmappedGaps.map((gap,i)=><p key={i}>{gap.videoStartSeconds.toFixed(3)}–{gap.videoEndSeconds.toFixed(3)} s: {gap.reason}</p>)}</details>
          </div>}
          {visibleSyncStatus.result.sequence.cuts.map((cut,i)=><p key={i}>Possible edit: {cut.startSeconds.toFixed(2)}–{cut.endSeconds.toFixed(2)} s. Clip alignments are independent.</p>)}
          {visibleSyncStatus.result.sequence.warnings.map((warning,i)=><p key={i}>{warning}</p>)}
          {visibleSyncStatus.result.sequence.candidates.slice(0,64).map((candidate,index)=><details key={index}>
            <summary>Sequence {index+1}: {candidate.recordingName} · clip {candidate.clip+1} · {candidate.matches.length-1} intervals · landmark mapping {candidate.offsetSeconds.toFixed(3)} s</summary>
            <p>{candidate.markerHypothesis?'XRK-conditioned marker hypothesis. ':'Repeated scene hypothesis. '}Checker-pattern evidence {(candidate.landmarkScore??0).toFixed(2)} (unverified finish marking). Relative fit {candidate.score.toFixed(2)}; interval RMS {candidate.intervalRmsSeconds.toFixed(3)} s; boundary residual RMS {candidate.rmsResidualSeconds.toFixed(3)} s, maximum {candidate.maxResidualSeconds.toFixed(3)} s; {candidate.skippedCrossings} missing visual crossings. These residuals measure sequence fit, not absolute synchronization error.</p>
            <p>{candidate.triggerCorrectionSeconds===null?'No supported local motion correction.':`Local motion displacement ${candidate.triggerCorrectionSeconds.toFixed(3)} s; the full landmark/trigger phase remains unresolved.`}{candidate.motion?` Motion correlation ${candidate.motion.correlation.toFixed(2)}, overlap ${candidate.motion.overlapSeconds.toFixed(1)} s.`:''}</p>
            {candidate.matches.map((match,i)=><p key={i}>Lap boundary {match.lapNumber}: video {match.videoSeconds.toFixed(3)} s → XRK {match.telemetrySeconds.toFixed(3)} s; residual {match.residualSeconds.toFixed(3)} s{i>0?`; video interval ${(match.videoSeconds-candidate.matches[i-1].videoSeconds).toFixed(3)} s / XRK ${(match.telemetrySeconds-candidate.matches[i-1].telemetrySeconds).toFixed(3)} s`:''}.</p>)}
          </details>)}
        </div>}
        {visibleSyncStatus.result.candidates.map((candidate,index)=><div key={index}><p>Candidate {index+1} offset: {candidate.offsetSeconds.toFixed(2)} s (telemetry = video + offset). Heuristic uncertainty: peak width {candidate.peakWidthSeconds.toFixed(2)} s; correlation {candidate.correlation.toFixed(2)}, overlap {candidate.overlapSeconds.toFixed(1)} s, sign {candidate.sign}, {candidate.consistent?'consistent':'inconsistent'}, {candidate.windows.length} turning-event windows.</p>{candidate.windows.map((window,i)=><p key={i}>Window {i+1}: {window.videoStartSeconds.toFixed(2)}–{window.videoEndSeconds.toFixed(2)} s, correlation {window.correlation.toFixed(2)}</p>)}</div>)}
      </div>}
    </section>
    <div className="video-anchor-controls">
      <p>Pause on the start/finish crossing, choose the matching recorded lap, then sync.</p>
      <div className="video-actions"><label>Anchor lap<select aria-label="Anchor lap" value={anchorLapId} onChange={event=>setAnchorLapId(event.target.value)}>{session.laps.map(lap=><option key={lap.id} value={lap.id}>Lap {lap.number} · start {lap.start.toFixed(2)}s</option>)}</select></label>
        <button className="video-primary" disabled={!usable||!paused||!knownDuration||busy||nativeYouTube} onClick={()=>anchor(false)}>Sync Here</button>
        <button disabled={!usable||!paused||!knownDuration||!state.segments.length||busy||nativeYouTube} onClick={()=>anchor(true)}>Add segment here</button>
      </div>
      {!knownDuration&&state.source&&usable&&!nativeYouTube&&<p className="video-note">Waiting for a known video duration before creating segments.</p>}
      {!!state.segments.length&&<p className="video-note">The first segment spans the known footage. Edit the bounds below for cuts and unmapped gaps.</p>}
    </div>
    <VideoTimeline segments={state.segments} markers={lapMarkers(state.segments,session.laps)} duration={knownDuration} time={sample.time} onSeekVideo={onSeekVideo}/>
    {reverse.kind==='ambiguous'&&<div className="video-confirm"><p>Repeated footage: choose a segment to seek.</p><div className="video-actions">{reverse.segmentIds.map(id=><button key={id} onClick={()=>{change({...state,selectedSegmentId:id});onSeekTelemetry(telemetryTime!,id);}}>Use segment {state.segments.findIndex(segment=>segment.id===id)+1}</button>)}</div></div>}
    {state.segments.length>0&&reverse.kind==='unavailable'&&<p className="video-note">Footage unavailable at this telemetry time.</p>}
    <div className="video-coverage" aria-label="Recorded lap coverage">{session.laps.map(lap=><span key={lap.id} data-coverage={coverage[lap.id]}>Lap {lap.number} · {coverage[lap.id]==='none'?'no':coverage[lap.id]} coverage</span>)}</div>
    <SegmentEditor segments={state.segments} laps={session.laps} duration={knownDuration} selectedSegmentId={state.selectedSegmentId} onSelect={id=>change({...state,selectedSegmentId:id})} onChange={segments=>saveSegments(segments)}/>
    {isNative&&<section className="video-cache-controls" aria-label="Video cache"><div className="video-section-title"><h3>Downloaded video cache</h3>{cacheStatus&&<small>{(cacheStatus.usedBytes/1073741824).toFixed(2)} / {(cacheStatus.limitBytes/1073741824).toFixed(2)} GiB</small>}</div>{cacheError&&<p role="alert" className="video-error">Cache status unavailable: {cacheError}</p>}<label>Cache limit · GiB<input aria-label="Video cache limit in GiB" type="number" min="1" max="1000" step="1" value={cacheLimit?String(Number(cacheLimit)/1073741824):''} onChange={event=>setCacheLimit(event.target.value?String(Number(event.target.value)*1073741824):'')}/></label><div className="video-actions"><button disabled={!cacheLimit||Number(cacheLimit)<1073741824||Number(cacheLimit)>1000*1073741824||busy} onClick={()=>void setYouTubeCacheLimit(Number(cacheLimit)).then(status=>{setCacheStatus(status);setCacheError('');}).catch(error=>setCacheError(message(error)))}>Save cache limit</button><button disabled={busy} onClick={()=>void cleanYouTubeCache().then(status=>{setCacheStatus(status);setCacheError('');}).catch(error=>setCacheError(message(error)))}>Clean unused cache</button><button disabled={busy} onClick={()=>void refreshCacheStatus()}>Refresh cache status</button></div>{cacheStatus?.entries.map(entry=><div className="video-cache-entry" key={entry.videoId}><span>{entry.url} · {(entry.size/1048576).toFixed(1)} MiB{entry.referenced?' · referenced':''}{entry.inUse?' · in use':''}{entry.issue?` · ${entry.issue}`:''}{entry.automaticEvictionAllowed===false?' · excluded from automatic cleanup':''}</span><button disabled={entry.inUse||busy} onClick={()=>{if(entry.automaticEvictionAllowed===false&&!window.confirm(`This cache entry is excluded from automatic cleanup${entry.issue?`: ${entry.issue}`:''}. Remove it explicitly?`))return;void removeYouTubeCacheEntry(entry.videoId).then(status=>{setCacheStatus(status);setCacheError('');}).catch(error=>setCacheError(message(error)));}}>Remove cached copy</button></div>)}</section>}
    </div>
    {props.children&&<div className={active?"video-graphs":"workspace-graphs"}>{props.children}</div>}
  </section>;
}
