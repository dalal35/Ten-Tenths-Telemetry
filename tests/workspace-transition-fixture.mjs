// Test-only IPC/media boundary. No recording or native model is modified.
export function installWorkspaceFixture({disableTransitions=false,initialView='telemetry'}={}){
 const w=window;w.isTauri=true;w.auditCalls=[];w.auditTransitions=[];w.auditCoachResolvers=[];w.auditHeldUpdates=[];w.auditSeeks=[];w.auditPlotConstructs=0;
 const seenPlots=new WeakSet();new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes){if(node.nodeType!==1)continue;const plots=[...(node.matches('.uplot')?[node]:[]),...node.querySelectorAll('.uplot')];for(const plot of plots)if(!seenPlots.has(plot)){seenPlots.add(plot);w.auditPlotConstructs++;}}}).observe(document,{childList:true,subtree:true});
 const nativeTransition=document.startViewTransition?.bind(document);
 w.auditTransitionSupported=!!nativeTransition;
 if(disableTransitions)Object.defineProperty(document,'startViewTransition',{value:undefined,configurable:true});
 else if(nativeTransition)document.startViewTransition=update=>{
  const record={startedAt:performance.now(),committedAt:null,readyAt:null,finishedAt:null,skips:0,animations:[]};
  w.auditTransitions.push(record);
  const transition=nativeTransition(async()=>{if(w.auditHoldUpdates)await new Promise(resolve=>w.auditHeldUpdates.push(resolve));await update();record.committedAt=performance.now();});
  const skip=transition.skipTransition.bind(transition);transition.skipTransition=()=>{record.skips++;skip();};
  w.auditCurrentTransition=transition;
  transition.ready.then(()=>{
   record.readyAt=performance.now();
   const animations=document.getAnimations().filter(a=>/^workspace-(in|out)$/.test(a.animationName??''));
   record.animations=animations.map(a=>({name:a.animationName,duration:a.effect.getTiming().duration,keyframes:a.effect.getKeyframes()}));
   if(w.auditPauseTransition){w.auditPausedAnimations=animations;for(const animation of animations){animation.pause();animation.currentTime=0;}}
  }).catch(()=>{});
  transition.finished.then(()=>{record.finishedAt=performance.now();}).catch(()=>{});
  return transition;
 };
 w.auditCanvasDraws=new WeakMap();w.auditCanvasLabels=new WeakMap();
 const clear=CanvasRenderingContext2D.prototype.clearRect,text=CanvasRenderingContext2D.prototype.fillText;
 CanvasRenderingContext2D.prototype.clearRect=function(...args){w.auditCanvasDraws.set(this.canvas,(w.auditCanvasDraws.get(this.canvas)??0)+1);w.auditCanvasLabels.set(this.canvas,[]);return clear.apply(this,args);};
 CanvasRenderingContext2D.prototype.fillText=function(...args){w.auditCanvasLabels.get(this.canvas)?.push(String(args[0]));return text.apply(this,args);};
 const laps=Array.from({length:24},(_,i)=>({id:`lap-${i+1}`,number:i+1,start:i*60,end:(i+1)*60,duration:60,complete:true}));
 const channels=[{id:'speed',name:'GPS Speed',unit:'m/s',times:[],values:[]},{id:'rpm',name:'RPM',unit:'rpm',times:[],values:[]}];
 const session={id:'transition-fixture',name:'Transition verification',track:'Engineering circuit',driver:'Test driver',recordedAt:'2026-10-25',source:'/fixture/transition.xrk',warnings:[],laps,channels};
 const video={version:1,sessionId:session.id,contentVersion:'v1',source:{type:'local',path:'/fixture/transition.mp4',size:100,modifiedMs:1},segments:[{id:'all',videoStart:0,videoEnd:60,anchorVideoTime:0,anchorTelemetryTime:0,anchorLapId:'lap-1',correctionSeconds:0}],selectedSegmentId:'all',preferences:{panelHeight:300,playbackRate:1,pausedVideoTime:0}};
 const entry={...session,status:'ready',contentVersion:'v1',lapCount:24,channelCount:2,lastUsed:0,workspace:{contentVersion:'v1',primary:'lap-1',comparison:'lap-2',axis:'distance',channels:['speed','rpm'],layout:'comfortable',zoom:null,view:initialView,video}};
 const evidence=[{id:'recorded-speed',metric:'minimumSpeed',unit:'m/s',lapValue:20,referenceValue:21,channelIds:['speed']}];
 const report={analysisVersion:'fixture',sessionId:session.id,referenceLapId:'lap-1',bestLapId:'lap-1',bestLapSeconds:60,theoreticalBestSeconds:59.6,theoreticalImprovementSeconds:.4,validLapCount:24,primaryOpportunityIds:['experiment-0','experiment-1','experiment-2'],excludedLaps:[],consistency:{medianSeconds:60,medianAbsoluteDeviationSeconds:0,rangeSeconds:0,sampleCount:24},sectionAssessments:[],segments:[],laps:[],opportunities:Array.from({length:3},(_,i)=>({id:`experiment-${i}`,lapId:'lap-1',referenceLapId:'lap-2',sectionId:`section-${i}`,label:`Corner ${i+1}`,kind:`momentum-${i}`,startTime:i*10,endTime:i*10+5,startMeters:i*160,endMeters:i*160+80,observedLossSeconds:null,estimatedGainSeconds:null,fasterExampleCount:1,confidence:'low',status:'suspected',priorityScore:3-i,evidence,observation:'Controlled presentation fixture: inspect the recorded speed and RPM relationship.',action:`Controlled experiment ${i+1}: keep entry conditions repeatable and compare the full section.`,uncertainty:'UI fixture; no real time-saving claim.'})),totalObservedOpportunitySeconds:null,opportunityLapId:null,notes:['Controlled browser presentation data, not a detector result.']};
 w.auditEntry=entry;w.auditSession=session;
 w.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
 w.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,convertFileSrc:path=>`https://asset.localhost/${encodeURIComponent(path)}`,invoke:async(cmd,args={})=>{
  w.auditCalls.push({cmd,args});
  if(cmd.startsWith('plugin:event'))return 1;
  if(cmd==='library_snapshot')return {entries:[entry],activeSessionId:session.id,warnings:[]};
  if(cmd==='load_library_session')return session;
  if(cmd==='save_workspace'){entry.workspace=args.workspace;return;}
  if(cmd==='authorize_local_video')return {path:args.path,size:100,modifiedMs:1,status:'ready'};
  if(cmd==='validate_formulas')return [];
  if(cmd==='driving_coach_model_terms')return {version:'fixture',terms:'Fixture terms',policy:'Fixture policy'};
  if(cmd==='driving_coach_status')return {jobId:null,phase:'Idle'};
  if(cmd==='cancel_driving_coach')return;
  if(cmd==='analyze_driving_coach'){if(w.auditHoldCoach)await new Promise(resolve=>w.auditCoachResolvers.push(resolve));return {report,explanations:[],mode:'deterministic',modelVersion:'fixture',notice:'Presentation fixture',cached:true,elapsedMs:0,inferenceMetrics:null};}
  if(cmd==='analyze_session'){
   const view=lapId=>({lapId,duration:60,length:1000,mapping:[{meters:0,time:0},{meters:500,time:30},{meters:1000,time:60}],track:Array.from({length:160},(_,i)=>({x:100*Math.cos(i/159*Math.PI*2),y:60*Math.sin(i/159*Math.PI*2),position:args.axis==='time'?i/159*60:i/159*1000,speed:20})),warnings:[],series:args.channelIds.map(id=>({channelId:id,name:channels.find(c=>c.id===id)?.name??id,unit:id==='rpm'?'rpm':'m/s',x:Array.from({length:2001},(_,i)=>i/2000*(args.axis==='time'?60:1000)),values:Array.from({length:2001},(_,i)=>id==='rpm'?8000+2000*Math.sin(i/67):22+6*Math.sin(i/137))}))});
   const metrics={elapsed:10,entrySpeed:20,minSpeed:18,exitSpeed:25,channels:[]};
   return {primary:view(args.primaryId),comparison:args.comparisonId?view(args.comparisonId):null,cornerBoundaries:null,alignment:{method:'spatial',coverage:1,notes:[]},segments:Array.from({length:6},(_,i)=>({id:`section-${i}`,label:`Corner ${i+1}`,kind:'corner',start:i*160,end:(i+1)*160,startMeters:i*160,endMeters:(i+1)*160,uncertaintyMeters:4,primary:metrics,comparison:args.comparisonId?metrics:null,deltaSeconds:0})),delta:null,warnings:[]};
  }
  if(cmd==='analyze_advanced'){
   const stats={count:1024,duration:60,min:-1,max:1,mean:0,median:0,p05:-.9,p95:.9,absoluteP95:.9};
   return {tool:args.request.tool,xUnit:'g',yUnit:'g',notes:[],laps:[args.primaryId,...(args.comparisonId?[args.comparisonId]:[])].map(lapId=>({lapId,points:Array.from({length:1024},(_,i)=>({sourceTime:i/1023*60,position:i/1023*1000,x:Math.sin(i/45),y:.7*Math.cos(i/37),color:null})),stats,yStats:stats,histogram:[],events:[],excludedCount:0}))};
  }
  throw Error(`Unexpected transition fixture IPC: ${cmd}`);
 }};
 const times=new WeakMap(),rates=new WeakMap(),sources=new WeakMap();
 Object.defineProperties(HTMLVideoElement.prototype,{videoWidth:{get(){return 1920;}},videoHeight:{get(){return 1080;}}});
 Object.defineProperties(HTMLMediaElement.prototype,{src:{get(){return sources.get(this)??'';},set(value){sources.set(this,value);}},duration:{get(){return 60;}},currentTime:{get(){return times.get(this)??0;},set(value){w.auditSeeks.push(value);times.set(this,value);this.dispatchEvent(new Event('timeupdate'));queueMicrotask(()=>this.dispatchEvent(new Event('seeked')));}},playbackRate:{get(){return rates.get(this)??1;},set(value){rates.set(this,value);this.dispatchEvent(new Event('ratechange'));}},paused:{get(){return !this.dataset.playing;}}});
 HTMLMediaElement.prototype.load=function(){if(sources.has(this))queueMicrotask(()=>this.dispatchEvent(new Event('loadedmetadata')));};
 HTMLMediaElement.prototype.play=async function(){this.dataset.playing='1';this.dispatchEvent(new Event('playing'));};
 HTMLMediaElement.prototype.pause=function(){delete this.dataset.playing;this.dispatchEvent(new Event('pause'));};
}
