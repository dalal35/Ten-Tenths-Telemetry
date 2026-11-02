import {launchBrowser,browserTestEntries,browserTestNoWatch} from './browser.mjs';
import {expect} from '@playwright/test';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
let server,browser;
try{
 server=await createServer({plugins:[browserTestNoWatch],optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}});await server.listen();
 browser=await launchBrowser();
 const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const w=window;w.isTauri=true;w.seeks=[];w.saves=[];w.pending=[];w.delayAnalysis=false;w.duration=60;w.advancedRequests=[];
  const laps=[0,1,2,3].map(i=>({id:`lap${i+1}`,number:i+1,start:100+i*20,end:120+i*20,duration:20,complete:true}));
  const channels=[{id:'speed',name:'GPS Speed',unit:'km/h',times:[],values:[]},{id:'rpm',name:'RPM',unit:'rpm',times:[],values:[]}];
  w.session={id:'integration',source:'synthetic.xrk',name:'Integration',track:'Synthetic circuit',driver:'Test',recordedAt:'',warnings:[],channels,laps};
  const metrics={elapsed:10,entrySpeed:10,minSpeed:10,exitSpeed:10,channels:[]};
  w.analysis=args=>{const series=args.channelIds.map(id=>({id,channel:channels.find(c=>c.id===id.split('::').pop())})).filter(item=>item.channel).map(({id,channel:c})=>({channelId:id,name:c.name,unit:c.unit,x:args.axis==='time'?[0,5,10,15,20]:[0,50,100,150,200],values:c.id==='rpm'?[3000,4000,5000,6000,7000]:[0,10,20,30,40]}));
   const view=id=>({lapId:id,duration:20,length:200,mapping:w.noMapping?[]:[{time:0,meters:0},{time:20,meters:id===args.comparisonId?100:200}],series:w.comparisonOnly&&id===args.primaryId?series.filter(s=>w.onlyMissing||s.channelId.endsWith('rpm')?false:true):series,track:[0,1,2,3,4].map(i=>({x:[0,1,1,0,0][i],y:[0,0,1,1,0][i],position:args.axis==='time'?i*5:i*50,speed:10})),warnings:[]});
   return {primary:view(args.primaryId),comparison:args.comparisonId?view(args.comparisonId):null,alignment:{method:w.nonSpatial?'estimated':'spatial',referenceLength:200,positionUncertaintyM:1,timingUncertaintyS:.1,coverage:1,notes:[]},segments:[0,1].map(i=>({id:`corner${i}`,label:`Corner ${i+1}`,kind:'corner',start:args.axis==='time'?i*10:i*100,end:args.axis==='time'?(i+1)*10:(i+1)*100,startMeters:i*100,endMeters:(i+1)*100,uncertaintyMeters:1,primary:metrics,comparison:null,deltaSeconds:null})),delta:null,warnings:[]};};
  w.video={version:1,sessionId:'integration',contentVersion:'v1',source:{type:'local',path:'/fixture/video.mp4',size:100,modifiedMs:1},segments:[{id:'first',videoStart:0,videoEnd:40,anchorVideoTime:0,anchorTelemetryTime:100,anchorLapId:'lap1',correctionSeconds:0},{id:'cut',videoStart:40,videoEnd:60,anchorVideoTime:40,anchorTelemetryTime:160,anchorLapId:'lap4',correctionSeconds:0}],selectedSegmentId:'first',preferences:{panelHeight:300,playbackRate:1,pausedVideoTime:0}};
  w.entry={...w.session,contentVersion:'v1',status:'ready',channelCount:2,lapCount:4,lastUsed:0,workspace:{contentVersion:'v1',primary:'lap1',comparison:null,axis:'distance',channels:['speed','rpm'],layout:'comfortable',zoom:null,view:'video',video:w.video}};
  const restoreMode=localStorage.getItem('video-fixture-mode');if(restoreMode==='unattached')w.entry.workspace={...w.entry.workspace,view:'telemetry',video:{...w.video,source:null,segments:[]}};if(restoreMode==='corrupt')w.entry.workspace.video={...w.video,segments:'broken'};if(restoreMode==='future')w.entry.workspace.video={...w.video,version:99};
  w.secondSession={...w.session,id:'second',name:'Second circuit',track:'Second circuit',laps:laps.map(l=>({...l,id:'second-'+l.id,start:l.start+200,end:l.end+200}))};w.secondEntry={...w.entry,...w.secondSession,workspace:{...w.entry.workspace,primary:'second-lap1',video:{...w.video,sessionId:'second',source:{...w.video.source,path:'/fixture/second.mp4'},segments:w.video.segments.map(seg=>({...seg,anchorLapId:'second-'+seg.anchorLapId,anchorTelemetryTime:seg.anchorTelemetryTime+200}))}}};
  if(restoreMode==='merge'){
   w.secondSession={...w.secondSession,laps:w.session.laps.map(l=>({...l}))};w.secondEntry={...w.secondEntry,laps:w.secondSession.laps,workspace:{...w.secondEntry.workspace,primary:'lap1',video:{...w.video,sessionId:'second',source:{...w.video.source,path:'/fixture/second.mp4'}}}};
   const sources=[{sessionId:w.session.id,contentVersion:'v1',session:w.session},{sessionId:w.secondSession.id,contentVersion:'v1',session:w.secondSession}];
   const mergedLaps=sources.flatMap((s,i)=>s.session.laps.map((lap,j)=>({...lap,id:JSON.stringify([s.sessionId,lap.id]),sourceSessionId:s.sessionId,sourceLapId:lap.id,displayNumber:i*4+j+1})));
   const mergedChannels=sources.flatMap(s=>s.session.channels.map(c=>({...c,id:`${s.sessionId}::${c.id}`,sourceSessionId:s.sessionId,sourceChannelId:c.id})));
   const preview={sources:sources.map(({session,...ref})=>ref),day:'2026-10-14',previewVersion:'merge-v1',warnings:[],laps:mergedLaps,channels:mergedChannels};
   w.mergedSession={...w.session,id:'merged-video',laps:mergedLaps,channels:mergedChannels,merge:{sources,preview}};
   w.mergedEntry={...w.entry,...w.mergedSession,mergeSources:preview.sources,contentVersion:'merge-v1',lapCount:8,channelCount:4,workspace:{...w.entry.workspace,contentVersion:'merge-v1',primary:mergedLaps[0].id,channels:['integration::speed','integration::rpm'],video:undefined,sourceVideos:{integration:w.entry.workspace.video,second:w.secondEntry.workspace.video}}};
   w.originalVideos=JSON.stringify([w.entry.workspace.video,w.secondEntry.workspace.video]);
  }
  w.__TAURI_INTERNALS__={convertFileSrc:path=>`https://asset.localhost/${encodeURIComponent(path)}`,invoke:async(cmd,args)=>{
   if(cmd==='start_video_sync'){w.syncArgs=args;return 'sync-job';}
   if(cmd==='video_sync_status'){if(w.failSyncStatus)throw new Error('Status unavailable');return w.syncStatus;}
   if(cmd==='cancel_video_sync'){w.syncCancelled=true;return;}
   if(cmd==='youtube_cache_status')return {limitBytes:10737418240,usedBytes:0,entries:[]};
   if(cmd==='youtube_download_status')return null;
   if(cmd==='resolve_cached_youtube_video')return null;
   if(cmd==='library_snapshot')return {entries:[...(w.mergedEntry?[w.mergedEntry]:[]),w.entry,w.secondEntry],activeSessionId:w.mergedEntry?'merged-video':'integration',warnings:[]};
   if(cmd==='load_library_session')return args.sessionId==='merged-video'?w.mergedSession:args.sessionId==='second'?w.secondSession:w.session;
   if(cmd==='save_workspace'){if(w.holdResetSave&&args.workspace.primary==='lap1'){w.holdResetSave=false;await new Promise(resolve=>w.releaseResetSave=resolve);}w.saves.push(args.workspace);(args.sessionId==='merged-video'?w.mergedEntry:args.sessionId==='second'?w.secondEntry:w.entry).workspace=args.workspace;return;}
   if(cmd==='unmerge_session'){delete w.mergedEntry;delete w.mergedSession;return {entries:[w.entry,w.secondEntry],activeSessionId:'integration',warnings:[]};}
   if(cmd==='authorize_local_video')return {path:args.path,size:100,modifiedMs:1,status:'ready'};
   if(cmd==='analyze_session'){w.analysisStarted=args;if(w.delayAnalysis)return new Promise(resolve=>w.pending.push({args,resolve:()=>resolve(w.analysis(args))}));return w.analysis(args);}
   if(cmd==='plugin:event|listen')return 1;
   if(cmd==='analyze_advanced'){w.advancedRequests.push(args.request);
    if(w.comparisonOnly&&args.request.tool==='scatter')return {tool:'scatter',xUnit:'rpm',yUnit:'rpm',laps:[{lapId:args.comparisonId,points:[{x:4000,y:1,sourceTime:130,position:50,color:null},{x:7000,y:3,sourceTime:135,position:100,color:null}],stats:{count:2,duration:5,min:4000,max:7000,mean:5500,median:5500,p05:4000,p95:7000},histogram:[],events:[],excludedCount:0}],notes:['Primary channel unavailable']};
    const lap=(id,comparison=false)=>({lapId:id,points:[],stats:{count:0,duration:0,min:null,max:null,mean:null,median:null,p05:null,p95:null},histogram:[],events:[{id:comparison?'comparison-shift':'shift1',lapId:id,kind:'shift',evidence:'synthetic',sourceTime:comparison?130:105,endTime:comparison?131:106,position:args.axis==='time'?(comparison?10:5):50,endPosition:null,rpmBefore:5000,rpmAfter:4000,rpmChange:1000,minRpm:4000,duration:1,recoveryTime:1,cornerId:'corner0'}],excludedCount:0});
    return {tool:'shifts',xUnit:'rpm',yUnit:'',laps:[lap(args.primaryId),...(args.comparisonId&&w.comparisonEvent?[lap(args.comparisonId,true)]:[])],notes:[]};
   }
   return null;
  }};
  const times=new WeakMap(),sources=new WeakMap(),rates=new WeakMap();
  Object.defineProperties(HTMLVideoElement.prototype,{videoWidth:{get(){return 1920;}},videoHeight:{get(){return 1080;}}});
  Object.defineProperties(HTMLMediaElement.prototype,{src:{get(){return sources.get(this)??'';},set(v){sources.set(this,v);}},duration:{get(){return w.duration;}},currentTime:{get(){return times.get(this)??0;},set(v){if(w.failSeek)throw new Error('Synthetic seek failure');w.seeks.push(v);const finish=()=>{times.set(this,v);this.dispatchEvent(new Event('timeupdate'));this.dispatchEvent(new Event('seeked'));};if(w.delaySeek)w.finishSeek=finish;else queueMicrotask(finish);}},playbackRate:{get(){return rates.get(this)??1;},set(v){rates.set(this,v);this.dispatchEvent(new Event('ratechange'));}},paused:{get(){return !this.dataset.playing;}}});
  HTMLMediaElement.prototype.load=function(){if(sources.has(this))queueMicrotask(()=>this.dispatchEvent(new Event('loadedmetadata')));};HTMLMediaElement.prototype.play=async function(){this.dataset.playing='1';this.dispatchEvent(new Event('playing'));};HTMLMediaElement.prototype.pause=function(){delete this.dataset.playing;this.dispatchEvent(new Event('pause'));};
  w.advance=t=>{const el=document.querySelector('video');times.set(el,t);el.dispatchEvent(new Event('timeupdate'));};
 });
 await page.goto(`${server.resolvedUrls.local[0]}tests/video-integration.html`);
 await expect(page.getByRole('button',{name:'Video',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
 await page.evaluate(()=>window.syncStatus={phase:'sampling',progress:.4,result:null,error:null});
 await page.getByRole('button',{name:'Estimate sync'}).click();
 await expect(page.getByLabel('Sync analysis progress')).toHaveAttribute('value','0.4');
 await page.evaluate(()=>window.syncStatus={phase:'complete',progress:1,error:null,result:{ambiguous:true,applicable:false,rejectionReason:'Competing peaks',candidates:[{offsetSeconds:12,sign:1,correlation:.8,overlapSeconds:30,peakWidthSeconds:2,consistent:true,windows:[{videoStartSeconds:1,videoEndSeconds:4,correlation:.9}]},{offsetSeconds:32,sign:-1,correlation:.7,overlapSeconds:20,peakWidthSeconds:3,consistent:true,windows:[]}]}});
 await expect(page.getByText(/Competing peaks/)).toBeVisible();
 await expect(page.getByText(/heuristic uncertainty/i).first()).toBeVisible();
 await expect(page.getByText(/12.00 s/)).toContainText('Candidate 1');
 await expect(page.getByText(/uncalibrated candidates/i)).toBeVisible();
 await expect(page.getByText(/Window 1:/)).toBeVisible();
 await expect(page.getByText(/Candidate 2 offset/)).toContainText('0 turning-event windows');
 assert.equal(await page.evaluate(()=>window.saves.at(-1).video.segments.length),2,'candidate must preserve manual segments');
 await page.evaluate(()=>window.syncStatus={phase:'complete',progress:1,error:null,result:{ambiguous:false,applicable:false,rejectionReason:'Calibration required',candidates:[{offsetSeconds:-949,sign:1,correlation:.8,overlapSeconds:11.2,peakWidthSeconds:2,consistent:false,windows:[{videoStartSeconds:1,videoEndSeconds:4,correlation:-.4}]},{offsetSeconds:-1100,sign:1,correlation:.7,overlapSeconds:20,peakWidthSeconds:3,consistent:true,windows:[]},{offsetSeconds:-1150,sign:1,correlation:.6,overlapSeconds:20,peakWidthSeconds:3,consistent:true,windows:[]},{offsetSeconds:-1211.4,sign:-1,correlation:.5,overlapSeconds:20,peakWidthSeconds:3,consistent:true,windows:[]}]}});
 await page.getByRole('button',{name:'Estimate sync'}).click();await expect(page.getByText(/Candidate 4 offset: -1211.40/)).toBeVisible();await expect(page.getByText(/Candidate 1 offset: -949.00/)).toContainText('overlap 11.2 s');await expect(page.getByText(/Window 1:.*-0.40/)).toBeVisible();await expect(page.getByText(/uncalibrated candidates/i)).toBeVisible();await expect(page.getByText('Calibration required')).toBeVisible();

 // Sequence evidence remains read-only, including candidates from another recording.
 await page.evaluate(()=>window.syncStatus={phase:'complete',progress:1,error:null,result:{ambiguous:true,applicable:false,rejectionReason:'Candidate only',candidates:[],sequence:{confidence:'ambiguous',comparisonIncomplete:true,competitorMargin:0,cuts:[{startSeconds:20,endSeconds:20.05}],warnings:['Landmark phase remains unresolved.'],sampledFrames:120,runtimeSeconds:2.5,candidates:[{recordingId:'second',recordingName:'Other XRK',hypothesis:0,markerHypothesis:true,landmarkScore:.2,clip:1,offsetSeconds:-1211.455,score:.76,rmsResidualSeconds:.135,maxResidualSeconds:.32,intervalRmsSeconds:.151,skippedCrossings:1,motion:null,triggerCorrectionSeconds:null,matches:[0,1,2,3].map(i=>({videoSeconds:1252.75+i*27,telemetrySeconds:41.295+i*27,lapNumber:i+2,residualSeconds:0}))}]}}});
 await page.getByRole('button',{name:'Estimate sync'}).click();
 await expect(page.getByText(/Sequence confidence: ambiguous/)).toBeVisible();
 await expect(page.getByText(/Possible edit: 20.00–20.05/)).toBeVisible();
 await page.getByText(/Sequence 1: Other XRK/).click();
 await expect(page.getByText(/residuals measure sequence fit/)).toBeVisible();
 await expect(page.getByText(/XRK-conditioned marker hypothesis/)).toBeVisible();
 await expect(page.getByText(/Lap boundary 3:/)).toContainText('video interval 27.000 s / XRK 27.000 s');
 assert.equal(await page.evaluate(()=>window.saves.at(-1).video.segments.length),2,'lap sequence candidates must preserve manual segments');
 await expect(page.getByRole('button',{name:/Apply.*sync/i})).toHaveCount(0);

 // A full-video request proposes both recordings without changing either manual mapping.
 const mappingsBefore=await page.evaluate(()=>JSON.stringify([window.entry.workspace.video.segments,window.secondEntry.workspace.video.segments]));
 await page.evaluate(()=>{
  const segment=(id,name,a,b)=>({candidateIndex:0,candidateIndices:[0],recordingId:id,recordingName:name,clip:0,videoStartSeconds:a,videoEndSeconds:b,telemetryStartSeconds:100,telemetryEndSeconds:140,offsetSeconds:100-a,matchedLaps:6,markerSupported:true,uniqueIntervalEvidence:3,boundaries:[0,1,2,3,4,5,6].map(i=>({videoSeconds:a+(b-a)*i/6,telemetrySeconds:100+40*i/6,lapNumber:i+1,residualSeconds:0})),status:'provisional',localMargin:2,comparisonIncomplete:true});
  window.syncStatus={phase:'complete',progress:1,error:null,result:{ambiguous:true,applicable:false,rejectionReason:'Proposals only',candidates:[],sequence:{confidence:'Multiple-recording proposals; unvalidated',comparisonIncomplete:true,competitorMargin:2,cuts:[],warnings:[],sampledFrames:200,runtimeSeconds:4,windowCount:3,cacheHit:true,candidates:[],assignment:{segments:[segment('integration','0362',10,150),segment('second','0361',300,500)],unmappedGaps:[{videoStartSeconds:0,videoEndSeconds:10,reason:'Unsupported footage'},{videoStartSeconds:150,videoEndSeconds:300,reason:'Ambiguous or pit footage'},{videoStartSeconds:500,videoEndSeconds:900,reason:'Unsupported footage'}],comparisonIncomplete:true,bestScore:8,competingScore:6,competitorMargin:2}}}};
  window.duration=900;document.querySelector('video').dispatchEvent(new Event('durationchange'));
 });
 await page.getByRole('button',{name:'Analyze entire video'}).click();
 await expect.poll(()=>page.evaluate(()=>window.syncArgs.videoEnd)).toBe(900);
 assert.equal(await page.evaluate(()=>window.syncArgs.videoStart),0);
 await expect(page.getByRole('table',{name:'Global video-to-recording assignment'}).getByRole('row')).toHaveCount(3);
 await expect(page.getByText('0361',{exact:true})).toBeVisible();await expect(page.getByText('0362',{exact:true})).toBeVisible();
 await page.getByText('Unmapped footage · 3 intervals').click();await expect(page.getByText(/150.000–300.000 s: Ambiguous or pit footage/)).toBeVisible();
 assert.equal(await page.evaluate(()=>JSON.stringify([window.entry.workspace.video.segments,window.secondEntry.workspace.video.segments])),mappingsBefore);
 await page.getByRole('button',{name:'Open recording',exact:true}).click();await expect(page.getByRole('heading',{name:'Second circuit',exact:true})).toBeVisible();
 await page.getByRole('button',{name:/Integration Test/}).click();await expect(page.getByRole('heading',{name:'Synthetic circuit',exact:true})).toBeVisible();
 assert.equal(await page.evaluate(()=>JSON.stringify([window.entry.workspace.video.segments,window.secondEntry.workspace.video.segments])),mappingsBefore);
 await page.evaluate(()=>{window.duration=60;document.querySelector('video').dispatchEvent(new Event('durationchange'));});

 // Changing bounds invalidates a completed result and cancels an in-flight job.
 await page.getByLabel('Analysis end · seconds').fill('59');await expect(page.getByText(/Candidate 1 offset/)).toHaveCount(0);
 await page.evaluate(()=>{window.syncStatus={phase:'sampling',progress:.3,result:null,error:null};window.syncCancelled=false;});await page.getByRole('button',{name:'Estimate sync'}).click();await expect(page.getByLabel('Sync analysis progress')).toBeVisible();await page.getByLabel('Analysis start · seconds').fill('1');await expect.poll(()=>page.evaluate(()=>window.syncCancelled)).toBe(true);await expect(page.getByLabel('Sync analysis progress')).toHaveCount(0);await expect(page.getByRole('button',{name:'Estimate sync'})).toBeDisabled();
 await page.evaluate(()=>window.syncStatus={phase:'cancelled',progress:0,result:null,error:null});await expect(page.getByRole('button',{name:'Estimate sync'})).toBeEnabled();
 await page.getByLabel('Analysis start · seconds').fill('0');await page.evaluate(()=>{window.failSyncStatus=true;window.syncCancelled=false;});await page.getByRole('button',{name:'Estimate sync'}).click();await expect(page.getByText('Status unavailable')).toBeVisible();await expect.poll(()=>page.evaluate(()=>window.syncCancelled)).toBe(true);await expect(page.getByRole('button',{name:'Estimate sync'})).toBeDisabled();await page.evaluate(()=>{window.failSyncStatus=false;window.syncStatus={phase:'cancelled',progress:0,result:null,error:null};});await expect(page.getByRole('button',{name:'Estimate sync'})).toBeEnabled();
 await page.evaluate(()=>{window.failSyncStatus=true;});await page.getByRole('button',{name:'Estimate sync'}).click();await expect(page.getByText('Status unavailable')).toBeVisible();await expect(page.getByRole('button',{name:'Estimate sync'})).toBeEnabled({timeout:4000});await page.evaluate(()=>window.failSyncStatus=false);
 await page.getByLabel('Analysis end · seconds').fill('600');await page.getByRole('button',{name:'Estimate sync'}).click();await expect(page.getByText(/valid interval/)).toBeVisible();
 await page.getByLabel('Analysis end · seconds').fill('60');
 await page.evaluate(()=>{window.syncStatus={phase:'sampling',progress:.2,result:null,error:null};window.syncCancelled=false;});
 await page.getByRole('button',{name:'Estimate sync'}).click();await expect(page.getByRole('button',{name:'Cancel analysis'})).toBeVisible();await page.getByRole('button',{name:'Cancel analysis'}).click();await expect.poll(()=>page.evaluate(()=>window.syncCancelled)).toBe(true);await expect(page.getByText('Analysis cancelled')).toBeVisible();await expect(page.getByRole('button',{name:'Estimate sync'})).toBeDisabled();await page.evaluate(()=>window.syncStatus={phase:'cancelled',progress:0,result:null,error:null});await expect(page.getByRole('button',{name:'Estimate sync'})).toBeEnabled();
 await page.evaluate(()=>{window.syncCancelled=false;window.syncStatus={phase:'sampling',progress:.2,result:null,error:null};});
 await page.getByRole('button',{name:'Estimate sync'}).click();await expect(page.getByLabel('Sync analysis progress')).toBeVisible();await page.evaluate(()=>window.holdResetSave=true);await page.getByRole('button',{name:'Correction +0.1 s'}).click();await expect.poll(()=>page.evaluate(()=>window.syncCancelled)).toBe(true);await expect(page.getByLabel('Sync analysis progress')).toHaveCount(0);await expect(page.getByText(/Candidate 1 offset/)).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>!!window.releaseResetSave)).toBe(true);await expect(page.getByRole('button',{name:'Estimate sync'})).toBeDisabled();await page.evaluate(()=>{window.releaseResetSave();window.releaseResetSave=null;});await page.getByRole('button',{name:'Correction −0.1 s'}).click();await expect(page.getByRole('button',{name:'Estimate sync'})).toBeDisabled();await page.evaluate(()=>window.syncStatus={phase:'cancelled',progress:0,result:null,error:null});await expect(page.getByRole('button',{name:'Estimate sync'})).toBeEnabled();
 await page.evaluate(()=>window.syncStatus={phase:'error',progress:0,result:null,error:'Unsupported platform'});await page.getByRole('button',{name:'Estimate sync'}).click();await expect(page.getByText('Unsupported platform')).toBeVisible();


 await expect(page.locator('.readout').first()).not.toContainText('—');
 // An attached source belongs only to Video; Advanced is always its dedicated workspace.
 await page.getByRole('button',{name:'Advanced',exact:true}).click();
 await expect(page.locator('.advanced-workspace')).toBeVisible();
 await expect(page.locator('.video-workspace')).toHaveCount(0);
 await expect(page.locator('video')).not.toBeVisible();
 await expect(page.getByRole('button',{name:'Attach MP4 / MOV',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Video',exact:true}).click();
 await expect(page.locator('.advanced-workspace')).not.toBeVisible();
 await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();

 // A valid segment may extend beyond the half-open recorded laps. Those frames cannot own sync.
 await page.getByRole('button',{name:/Segment 1 0/}).click();
 await page.getByLabel('Telemetry anchor (s)',{exact:true}).fill('160');
 await page.getByRole('button',{name:'Apply segment edits',exact:true}).click();
 await page.evaluate(()=>window.advance(20));
 await expect(page.getByRole('status',{name:'Video sync status'})).toHaveText('unavailable');
 await expect(page.locator('.video-telemetry-time')).toHaveText('Telemetry unavailable');
 await page.evaluate(()=>window.advance(25));
 await expect(page.getByRole('status',{name:'Video sync status'})).toHaveText('unavailable');
 await expect(page.locator('.primary-marker circle')).toHaveCount(0);
 await page.getByRole('button',{name:'Play',exact:true}).click();
 const outOfLapPosition=await page.evaluate(()=>document.querySelector('video').currentTime),outOfLapSeeks=await page.evaluate(()=>window.seeks.length);
 const timeline=page.getByRole('slider',{name:'Video timeline'}),timelineBox=await timeline.boundingBox();
 await timeline.click({position:{x:timelineBox.width*.52,y:timelineBox.height/2}});
 await expect.poll(()=>page.evaluate(()=>document.querySelector('video').paused)).toBe(true);
 assert.equal(await page.evaluate(()=>document.querySelector('video').currentTime),outOfLapPosition,'out-of-lap reverse seek preserves media position');
 assert.equal(await page.evaluate(()=>window.seeks.length),outOfLapSeeks,'out-of-lap reverse seek never moves media');
 await expect(page.getByRole('status',{name:'Video sync status'})).toHaveText('unavailable');
 await page.getByLabel('Telemetry anchor (s)',{exact:true}).fill('100');
 await page.getByLabel('Video anchor (s)',{exact:true}).fill('20');
 await page.getByRole('button',{name:'Apply segment edits',exact:true}).click();
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.evaluate(()=>window.advance(0));
 await expect(page.getByRole('status',{name:'Video sync status'})).toHaveText('unavailable');
 await expect(page.locator('.video-telemetry-time')).toHaveText('Telemetry unavailable');
 await page.evaluate(()=>window.advance(20));
 await expect(page.getByRole('status',{name:'Video sync status'})).toHaveText('ready');
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 await expect(page.locator('.video-telemetry-time')).toContainText('Telemetry 100.');
 await page.getByLabel('Video anchor (s)',{exact:true}).fill('0');
 await page.getByRole('button',{name:'Apply segment edits',exact:true}).click();
 await page.evaluate(()=>{window.session.laps[1].start=125;window.session.laps[1].duration=15;window.advance(22);});
 await expect(page.getByRole('status',{name:'Video sync status'})).toHaveText('unavailable');
 await expect(page.locator('.video-telemetry-time')).toHaveText('Telemetry unavailable');
 await page.evaluate(()=>window.advance(25));
 await expect(page.getByRole('status',{name:'Video sync status'})).toHaveText('ready');
 await expect(page.locator('.video-telemetry-time')).toHaveText('Telemetry 125.00s');
 await page.evaluate(()=>{window.session.laps[1].start=120;window.session.laps[1].duration=20;window.analysisStarted=null;window.holdResetSave=true;window.advance(0);});
 await expect(page.locator('.video-telemetry-time')).toHaveText('Telemetry 100.00s');
 // Finish the preceding lap reset before delaying a new pair of requests.
 // A held native save makes the queued analysis boundary deterministic.
 await expect.poll(()=>page.evaluate(()=>typeof window.releaseResetSave)).toBe('function');
 await expect(page.getByText('Aligning telemetry…',{exact:true})).toBeVisible();
 await page.evaluate(()=>window.releaseResetSave());
 await expect.poll(()=>page.evaluate(()=>window.analysisStarted?.primaryId)).toBe('lap1');
 await expect(page.getByText('Aligning telemetry…',{exact:true})).toBeHidden();
 await page.evaluate(()=>window.retainedVideo=document.querySelector('video'));
 await page.evaluate(()=>{window.delayAnalysis=true;window.advance(22);});
 await expect(page.locator('.lap-row.selected')).toContainText('02');
 await expect(page.getByText('Aligning telemetry…',{exact:true})).toBeVisible();
 assert(await page.evaluate(()=>window.retainedVideo===document.querySelector('video')),'analysis loading retains media element');
 await page.evaluate(()=>window.advance(45));await expect(page.locator('.lap-row.selected')).toContainText('04');
 await expect.poll(()=>page.evaluate(()=>window.pending.length)).toBe(2);
 assert.deepEqual(await page.evaluate(()=>window.pending.map(request=>request.args.primaryId)),['lap2','lap4'],'Only the intended new lap analyses are deferred');
 await page.evaluate(()=>{window.pending[1].resolve();});
 await expect(page.locator('.primary-marker circle')).toHaveCount(1);await expect(page.locator('.map-caption')).toContainText('50.0 m');
 await page.evaluate(()=>{window.pending[0].resolve();});await expect(page.locator('.map-caption')).toContainText('50.0 m');
 assert(await page.evaluate(()=>window.retainedVideo===document.querySelector('video')));
 await page.evaluate(()=>{window.delayAnalysis=false;window.advance(42);});await expect(page.locator('.map-caption')).toContainText('20.0 m');
 const seeks=()=>page.evaluate(()=>window.seeks.length);let before=await seeks();
 // Every graph row can originate shared hover, including RPM after the first graph.
 const rpmOver=page.locator('.u-over').nth(1);await rpmOver.scrollIntoViewIfNeeded();const rpmBox=await rpmOver.boundingBox();await page.mouse.move(rpmBox.x+rpmBox.width*.8,rpmBox.y+40);await expect.poll(async()=>parseFloat(await page.locator('.map-caption').innerText())).toBeCloseTo(160,0);await expect(page.locator('.primary-marker circle')).toHaveCount(1);await expect.poll(async()=>parseFloat(await page.locator('.readout').nth(1).innerText())).toBeCloseTo(6200,-1);assert.equal(await seeks(),before,'later graph hover updates shared GPS without seeking');
 const over=page.locator('.u-over').first();await over.scrollIntoViewIfNeeded();let box=await over.boundingBox();await page.mouse.move(box.x+box.width*.4,box.y+40);await expect(page.locator('.readout').first()).not.toContainText('—');assert.equal(await seeks(),before,'hover does not seek');
 await page.locator('[data-plot]').first().focus();await page.keyboard.press('Enter');await expect.poll(seeks).toBe(before+1);before=await seeks();await page.mouse.click(box.x+box.width*.5,box.y+40);await expect.poll(seeks).toBe(before+1);
 before=await seeks();await page.mouse.move(box.x+box.width*.2,box.y+40);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+40,{steps:8});await page.mouse.up();assert.equal(await seeks(),before,'drag zoom does not seek');
 await page.keyboard.down('Shift');await page.mouse.move(box.x+box.width*.5,box.y+40);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+40,{steps:5});await page.mouse.up();await page.keyboard.up('Shift');assert.equal(await seeks(),before,'pan does not seek');
 await page.getByRole('button',{name:'Reset zoom'}).click();await page.getByRole('button',{name:/Switch to .* theme/}).click();await page.getByRole('button',{name:'Time',exact:true}).click();await expect(page.locator('.axis-label')).toContainText('seconds');assert.equal(await seeks(),before,'reset/theme/axis do not seek');
 await page.evaluate(()=>window.advance(43));await expect(page.locator('.map-caption')).toContainText('3.0 s');assert.equal(await seeks(),before,'programmatic cursor does not seek');
 await page.getByRole('button',{name:'Compare lap 1'}).click();await expect(page.locator('.comparison-line')).toHaveCount(1);assert.equal(await seeks(),before,'comparison does not seek');
 await page.getByRole('button',{name:'Focus Corner 1',exact:true}).focus();await page.keyboard.press('Enter');await expect.poll(seeks).toBe(before+1);await expect(page.getByText(/Focus: Corner 1/)).toBeVisible();
 before=await seeks();await page.getByRole('button',{name:'Reset zoom'}).click();
 await page.locator('.primary-line').click({position:{x:5,y:5},force:true});await expect.poll(seeks).toBe(before+1);
 await page.locator('.lap-select').nth(0).click();await expect.poll(()=>page.evaluate(()=>window.seeks.at(-1))).toBe(0);
 before=await seeks();await page.locator('.lap-select').nth(2).click();await expect(page.getByRole('status',{name:'Video sync status'})).toContainText('unavailable');await expect(page.locator('.video-telemetry-time')).toHaveText('Telemetry 140.00s');assert.equal(await seeks(),before,'uncovered selection preserves video position');await expect(page.locator('.primary-marker circle')).toHaveCount(0);
 await page.locator('.lap-select').nth(0).click();await expect(page.getByRole('status',{name:'Video sync status'})).toContainText('ready');
 // Pending asynchronous seek must leave interactions responsive.
 await page.evaluate(()=>window.delaySeek=true);await page.locator('.u-over').first().scrollIntoViewIfNeeded();box=await page.locator('.u-over').first().boundingBox();await page.mouse.click(box.x+box.width*.5,box.y+40);await expect(page.getByRole('status',{name:'Video sync status'})).toContainText('seeking');
 await page.mouse.move(box.x+box.width*.3,box.y+40);await expect(page.locator('.readout').first()).not.toContainText('—');await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+40,{steps:5});await page.mouse.up();await page.getByRole('button',{name:/Switch to .* theme/}).click();await expect(page.getByRole('status',{name:'Video sync status'})).toContainText('seeking');await page.evaluate(()=>{window.delaySeek=false;window.finishSeek();});await expect(page.getByRole('status',{name:'Video sync status'})).toContainText('ready');
 // Distance without supported time/position mapping must withhold GPS instead of normalized progress.
 await page.evaluate(()=>window.noMapping=true);await page.getByRole('button',{name:'Distance',exact:true}).click();await expect(page.locator('.axis-label')).toContainText('meters');await expect(page.locator('.primary-marker circle')).toHaveCount(0);await expect(page.locator('.map-caption')).toContainText('Click a track section');
 await page.evaluate(()=>window.noMapping=false);await page.getByRole('button',{name:'Time',exact:true}).click();await expect(page.locator('.axis-label')).toContainText('seconds');
 // Advanced event coordinates already use the primary timeline, even with unequal lap maps.
 await page.evaluate(()=>{window.beforeAdvanced=document.querySelector('video');window.advance(2);window.delaySeek=true;});
 await page.locator('.lap-select').nth(1).click();await expect(page.getByRole('status',{name:'Video sync status'})).toContainText('seeking');
 await page.evaluate(()=>{window.oldFinish=window.finishSeek;window.delaySeek=false;});
 await page.getByRole('button',{name:'Advanced',exact:true}).click();
 await expect(page.locator('video')).not.toBeVisible();
 assert(await page.evaluate(()=>window.beforeAdvanced.paused),'Leaving Video pauses disposed player');
 await page.locator('.lap-select').nth(0).click();await page.getByRole('tab',{name:'Shift Analysis',exact:true}).click();await expect(page.locator('.event-table tbody tr')).toHaveCount(1);
 before=await seeks();await page.locator('.event-table tbody tr button').first().click();
 await expect(page.locator('.map-caption')).toContainText('5.0 s');assert.equal(await seeks(),before,'Advanced event inspection never seeks media');
 await page.evaluate(()=>window.oldFinish());await expect(page.locator('.map-caption')).toContainText('5.0 s');
 await page.evaluate(()=>window.comparisonEvent=true);await page.getByRole('button',{name:'Compare lap 2'}).click();await expect(page.locator('.event-table tbody tr')).toHaveCount(2);
 await page.locator('.event-table tbody tr.comparison-stat button').first().click();
 await expect(page.locator('.map-caption')).toContainText(/^10\.0 s into primary lap/);assert.equal(await seeks(),before,'Already-projected comparison time is used exactly once without media seek');
 await expect.poll(()=>page.evaluate(()=>window.saves.at(-1).zoom)).toEqual({min:8,max:12,primary:'lap1',comparison:'lap2',axis:'time'});
 await page.locator('.event-table tbody tr.primary-stat button').first().click();
 const projectedMapEvent=page.locator('.map-event.comparison-event circle');await projectedMapEvent.click();
 await expect(page.locator('.map-caption')).toContainText(/^10\.0 s into primary lap/);
 await page.locator('.event-table tbody tr.primary-stat button').first().click();await projectedMapEvent.focus();await page.keyboard.press('Enter');
 await expect(page.locator('.map-caption')).toContainText(/^10\.0 s into primary lap/);assert.equal(await seeks(),before,'Comparison map inspection never seeks media');

 await page.evaluate(()=>window.nonSpatial=true);await page.getByRole('button',{name:'Distance',exact:true}).click();await expect(page.locator('.event-table tbody tr')).toHaveCount(2);
 const beforeInvalid=await page.locator('.map-caption').innerText();
 const invalidComparison=page.locator('.event-table tbody tr.comparison-stat button').first();
 await expect(invalidComparison).toBeDisabled();assert.equal(await page.locator('.map-caption').innerText(),beforeInvalid);
 await page.evaluate(()=>window.nonSpatial=false);await page.getByRole('button',{name:'Time',exact:true}).click();await page.getByRole('button',{name:'Clear comparison',exact:true}).click();
 await page.getByRole('button',{name:'Video',exact:true}).click();await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
 // Natural video traversal into a cut gap clears corresponding telemetry; later valid footage projects accurately.
 await page.getByRole('button',{name:'Distance',exact:true}).click();await expect(page.locator('.axis-label')).toContainText('meters');await page.getByRole('button',{name:/Segment 1 0/}).click();await page.getByLabel('Segment end (s)',{exact:true}).fill('30');await page.getByRole('button',{name:'Apply segment edits',exact:true}).click();await page.evaluate(()=>window.advance(15));await expect(page.locator('.video-telemetry-time')).toHaveText('Telemetry 115.00s');await page.getByRole('button',{name:'Play',exact:true}).click();await page.evaluate(()=>window.advance(35));await expect(page.getByRole('status',{name:'Video sync status'})).toContainText('unavailable');await expect(page.locator('.video-telemetry-time')).toHaveText('Telemetry unavailable');await expect(page.getByText('Footage unavailable at this telemetry time.',{exact:true})).toBeVisible();await expect(page.locator('.primary-marker circle')).toHaveCount(0);assert.equal(await page.evaluate(()=>document.querySelector('video').paused),false,'natural gap leaves source preview playing');await page.evaluate(()=>window.advance(45));await page.getByRole('button',{name:'Pause',exact:true}).click();await expect(page.locator('.video-telemetry-time')).toHaveText('Telemetry 165.00s');await expect(page.locator('.map-caption')).toContainText('50.0 m');await page.getByLabel('Segment end (s)',{exact:true}).fill('40');await page.getByRole('button',{name:'Apply segment edits',exact:true}).click();await page.locator('.lap-select').nth(0).click();await page.getByRole('button',{name:'Time',exact:true}).click();await expect(page.locator('.axis-label')).toContainText('seconds');
 // Repeated telemetry interval requests a segment choice; no stale selected segment is silently used.
 await page.getByRole('button',{name:/Segment 2 40/}).click();await page.getByLabel('Telemetry anchor (s)',{exact:true}).fill('100');await page.getByRole('button',{name:'Apply segment edits',exact:true}).click();before=await seeks();await page.locator('.lap-select').nth(0).click();await expect(page.getByRole('status',{name:'Video sync status'})).toContainText('ambiguous');await expect(page.locator('.video-telemetry-time')).toHaveText('Telemetry 100.00s');await expect(page.getByText('Repeated footage: choose a segment to seek.',{exact:true})).toBeVisible();assert.equal(await seeks(),before);await page.getByRole('button',{name:'Use segment 2',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.seeks.at(-1))).toBe(40);await expect(page.getByRole('status',{name:'Video sync status'})).toContainText('ready');await page.getByLabel('Telemetry anchor (s)',{exact:true}).fill('160');await page.getByRole('button',{name:'Apply segment edits',exact:true}).click();await page.locator('.lap-select').nth(0).click();
 // Failed seeks remain actionable through later unavailable ticks until a successful retry.
 await page.evaluate(()=>window.failSeek=true);await page.locator('.lap-select').nth(1).click();await expect(page.getByRole('alert').filter({hasText:'Synthetic seek failure'})).toBeVisible();await expect(page.getByRole('status',{name:'Video sync status'})).toContainText('error');await page.waitForTimeout(150);await expect(page.getByRole('status',{name:'Video sync status'})).toContainText('error');await page.evaluate(()=>window.failSeek=false);await page.locator('.lap-select').nth(0).click();await expect(page.getByRole('status',{name:'Video sync status'})).toContainText('ready');
 // Runtime known-duration gate: passive preview may continue; explicit unavailable intents pause without seeking.
 await page.getByRole('button',{name:'Play',exact:true}).click();await expect.poll(()=>page.evaluate(()=>document.querySelector('video').paused)).toBe(false);const positionBeforeInvalid=await page.evaluate(()=>document.querySelector('video').currentTime);before=await seeks();
 await page.evaluate(()=>{window.duration=10;const v=document.querySelector('video');v.dispatchEvent(new Event('durationchange'));});await expect(page.getByRole('status',{name:'Video sync status'})).toContainText('error');await expect(page.getByRole('alert').filter({hasText:'duration'})).toBeVisible();await expect(page.locator('.primary-marker circle')).toHaveCount(0);
 assert.equal(await page.evaluate(()=>document.querySelector('video').paused),false,'passive invalid mapping allows preview');await page.locator('.lap-select').nth(0).click();await expect.poll(()=>page.evaluate(()=>document.querySelector('video').paused)).toBe(true);assert.equal(await page.evaluate(()=>document.querySelector('video').currentTime),positionBeforeInvalid,'invalid explicit lap selection preserves source position');assert.equal(await seeks(),before);await expect(page.getByRole('alert').filter({hasText:'duration'})).toBeVisible();
 await page.getByRole('button',{name:'Play',exact:true}).click();await expect.poll(()=>page.evaluate(()=>document.querySelector('video').paused)).toBe(false);await page.locator('.u-over').first().scrollIntoViewIfNeeded();box=await page.locator('.u-over').first().boundingBox();await page.mouse.click(box.x+box.width*.3,box.y+40);await expect.poll(()=>page.evaluate(()=>document.querySelector('video').paused)).toBe(true);assert.equal(await page.evaluate(()=>document.querySelector('video').currentTime),positionBeforeInvalid,'invalid explicit graph seek preserves source position');assert.equal(await seeks(),before);await page.waitForTimeout(150);await expect(page.getByRole('status',{name:'Video sync status'})).toContainText('error');await expect(page.getByRole('alert').filter({hasText:'duration'})).toBeVisible();
 // Playback changes the readouts, GPS and highlighted corner without changing graph zoom or persisting ticks.
 await page.evaluate(()=>{window.duration=60;document.querySelector('video').dispatchEvent(new Event('durationchange'));});await page.locator('.lap-select').nth(0).click();await expect(page.getByRole('status',{name:'Video sync status'})).toContainText('ready');await page.getByRole('button',{name:'Focus Corner 1',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('status',{name:'Video sync status'})).toContainText('ready');await page.getByRole('button',{name:'Play',exact:true}).click();const savesBeforeTicks=await page.evaluate(()=>window.saves.length),zoomBeforeTicks=await page.evaluate(()=>window.saves.at(-1).zoom);await page.evaluate(()=>window.advance(16));await expect(page.getByRole('button',{name:'Focus Corner 2',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.locator('.map-caption')).toContainText('16.');await expect(page.locator('.readout').nth(1)).toContainText(/62\d\d rpm/);assert.equal(await page.evaluate(()=>window.saves.length),savesBeforeTicks,'playing clock ticks are not persisted');assert.deepEqual(await page.evaluate(()=>window.saves.at(-1).zoom),zoomBeforeTicks,'playback corner highlighting does not zoom');await page.getByRole('button',{name:'Pause',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.saves.at(-1).video.preferences.pausedVideoTime)).toBe(16);assert.equal(await page.evaluate(()=>window.saves.at(-1).video.version),1,'cache/IPC serialize raw video state');await expect(page.getByText(/Focus: Corner 1/)).toBeVisible();await page.getByRole('button',{name:'Telemetry',exact:true}).click();await expect(page.getByRole('button',{name:'Focus Corner 2',exact:true})).toHaveAttribute('aria-pressed','false');await page.getByRole('button',{name:'Video',exact:true}).click();await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
 // Late completion from the disposed session cannot publish against the new session.
 await page.evaluate(()=>{window.duration=60;document.querySelector('video').dispatchEvent(new Event('durationchange'));});await expect(page.getByRole('status',{name:'Video sync status'})).toContainText('ready');await page.evaluate(()=>window.delaySeek=true);await page.locator('.lap-select').nth(1).click();await expect(page.getByRole('status',{name:'Video sync status'})).toContainText('seeking');await page.evaluate(()=>{window.oldFinish=window.finishSeek;window.oldVideo=document.querySelector('video');window.delaySeek=false;});await page.getByRole('button',{name:/Second circuit Test/}).click();await expect(page.getByRole('heading',{name:'Second circuit',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();await expect(page.locator('.map-caption')).toContainText('0.0 m');await page.evaluate(()=>window.oldFinish());await expect(page.locator('.map-caption')).toContainText('0.0 m');assert(await page.evaluate(()=>window.oldVideo!==document.querySelector('video')));await expect(page.locator('.lap-row.selected')).toContainText('01');
 // No attached source: both dedicated tabs still render and share saved analysis mode.
 await page.evaluate(()=>localStorage.setItem('video-fixture-mode','unattached'));await page.reload();
 await page.getByRole('button',{name:'Advanced',exact:true}).click();await expect(page.locator('.advanced-workspace')).toBeVisible();await expect(page.locator('.video-workspace')).toHaveCount(0);
 await page.getByRole('tab',{name:'G-G Traction Circle',exact:true}).click();
 await expect(page.getByLabel('Lateral acceleration · X',{exact:true})).toHaveValue('');await expect(page.getByLabel('Longitudinal acceleration · Y',{exact:true})).toHaveValue('');
 await expect.poll(()=>page.evaluate(()=>window.advancedRequests.at(-1)?.xChannel)).toBe(null);
 await expect.poll(()=>page.evaluate(()=>window.advancedRequests.at(-1)?.yChannel)).toBe(null);
 await page.getByRole('tab',{name:'Histograms',exact:true}).click();
 await page.getByRole('button',{name:'Video',exact:true}).click();await expect(page.getByRole('button',{name:'Attach MP4 / MOV',exact:true})).toBeVisible();await expect(page.locator('.advanced-workspace')).not.toBeVisible();
 await page.getByRole('button',{name:'Advanced',exact:true}).click();await expect(page.getByRole('tab',{name:'Histograms',exact:true})).toHaveAttribute('aria-selected','true');
 // Explicit Video entry repairs corrupt/stale state, while opaque future schemas stay read-only.
 await page.evaluate(()=>localStorage.setItem('video-fixture-mode','corrupt'));await page.reload();await page.getByRole('button',{name:'Video',exact:true}).click();await expect(page.getByRole('button',{name:'Attach MP4 / MOV',exact:true})).toBeVisible();await expect(page.getByText(/Video settings unavailable/)).toBeVisible();await expect.poll(()=>page.evaluate(()=>window.saves.at(-1)?.video?.source)).toBe(null);
 await page.evaluate(()=>localStorage.setItem('video-fixture-mode','future'));await page.reload();await page.getByRole('button',{name:'Video',exact:true}).click();await expect(page.getByText(/Update Ten Tenths Telemetry to edit/)).toBeVisible();await expect(page.getByRole('button',{name:'Attach MP4 / MOV',exact:true})).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>window.saves.at(-1)?.video?.version)).toBe(99);
 // Virtual merging uses original-source video contexts even when logger times overlap.
 await page.evaluate(()=>localStorage.setItem('video-fixture-mode','merge'));await page.reload();
 await expect(page.getByRole('heading',{name:'Merged · Synthetic circuit'})).toBeVisible();await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
 await expect(page.getByText('Video source · synthetic.xrk',{exact:true})).toBeVisible();
 await page.evaluate(()=>{window.syncArgs=null;window.syncStatus={phase:'error',progress:0,result:null,error:'Fixture completed'};});await page.getByRole('button',{name:'Estimate sync'}).click();await expect(page.getByText('Fixture completed')).toBeVisible();assert.equal(await page.evaluate(()=>window.syncArgs.sessionId),'integration');assert.equal(await page.evaluate(()=>window.syncArgs.contentVersion),'v1');assert.equal(await page.evaluate(()=>window.syncArgs.sourceIdentity.path),'/fixture/video.mp4');

 await page.evaluate(()=>window.comparisonEvent=true);await page.getByRole('button',{name:'Compare lap 5',exact:true}).click();await page.getByRole('button',{name:'Advanced',exact:true}).click();await page.getByRole('tab',{name:'Shift Analysis',exact:true}).click();
 await expect(page.locator('.event-table tbody tr')).toHaveCount(2);const foreignEventSeeks=await page.evaluate(()=>window.seeks.length);await page.locator('.event-table tbody tr').nth(1).getByRole('button').first().click();await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.seeks.length),foreignEventSeeks,'A comparison-source event cannot seek the primary source video');
 // Foreign-source map events must retain provenance for mouse and keyboard seeks.
 const marker=page.locator('.map-event.comparison-event circle');await expect(marker).toHaveCount(1);
 await marker.click();await page.waitForTimeout(100);assert.equal(await seeks(),foreignEventSeeks,'A foreign map event click must not seek primary video');
 await marker.focus();await page.keyboard.press('Enter');await page.waitForTimeout(100);assert.equal(await seeks(),foreignEventSeeks,'A foreign map event keyboard activation must not seek primary video');
 // Missing primary channels leave valid comparison plots/statistics correctly identified.
 await page.evaluate(()=>window.comparisonOnly=true);await page.getByRole('tab',{name:'Scatter Plot',exact:true}).click();
 await expect(page.locator('.analysis-statistics .comparison-stat')).toContainText('Comparison · 2 samples');
 await expect(page.locator('.analysis-statistics .primary-stat')).toHaveCount(0);
 const scatter=page.locator('.advanced-workspace canvas');await expect(scatter).toBeVisible();await scatter.scrollIntoViewIfNeeded();const scatterBox=await scatter.boundingBox();
 await page.mouse.move(scatterBox.x+62,scatterBox.y+scatterBox.height-44);await expect(page.locator('.point-inspector')).toContainText('Comparison · X 4,000');
 await page.getByRole('button',{name:'Time',exact:true}).click();
 const rpmRow=page.locator('.plot-row').filter({hasText:'RPM'});await expect(rpmRow).toHaveCount(1);await expect(rpmRow).toContainText('Primary unavailable');
 await page.evaluate(()=>window.onlyMissing=true);await page.getByRole('button',{name:'Distance',exact:true}).click();
 await expect(page.locator('.plot-row')).toHaveCount(2);await expect(page.locator('.plot-row').first()).toContainText('Primary unavailable');
 await page.evaluate(()=>{window.comparisonOnly=false;window.onlyMissing=false;});
 await page.getByRole('button',{name:'Video',exact:true}).click();
 await page.evaluate(()=>{window.delaySeek=true;});await page.locator('.lap-select').nth(1).click();await expect(page.getByRole('status',{name:'Video sync status'})).toHaveText('seeking');
 await page.evaluate(()=>{window.oldFinish=window.finishSeek;window.oldVideo=document.querySelector('video');window.delaySeek=false;});
 await page.locator('.lap-select').nth(4).click();await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
 assert.match(await page.evaluate(()=>document.querySelector('video').src),/second/);await expect(page.locator('.lap-row.selected')).toContainText('05');
 await page.evaluate(()=>window.oldFinish());await page.waitForTimeout(150);await expect(page.locator('.lap-row.selected')).toContainText('05');
 assert(await page.evaluate(()=>window.oldVideo!==document.querySelector('video')),'Changing source disposes the old player');
 await page.getByRole('button',{name:'Play',exact:true}).click();await page.evaluate(()=>window.advance(22));await expect(page.locator('.lap-row.selected')).toContainText('06');
 await page.getByRole('button',{name:'Pause',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.mergedEntry.workspace.sourceVideos.second.preferences.pausedVideoTime)).toBe(22);
 assert.equal(await page.evaluate(()=>JSON.stringify([window.entry.workspace.video,window.secondEntry.workspace.video])),await page.evaluate(()=>window.originalVideos),'Merged video edits leave both original mappings untouched');
 await page.locator('.library-entry.active').getByRole('button',{name:'Session actions',exact:true}).click();await page.getByRole('menuitem',{name:'Unmerge',exact:true}).click();await expect(page.getByRole('heading',{name:'Synthetic circuit',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
 assert.match(await page.evaluate(()=>document.querySelector('video').src),/video.mp4/);assert.equal(await page.evaluate(()=>window.entry.workspace.video.preferences.pausedVideoTime),0);
 assert.deepEqual(errors,[]);console.log('PASS: actual App video hook race/cut reconciliation, retained player, explicit graph/GPS seeks, no hover/zoom/pan/theme/axis/comparison feedback, uncovered hold, pending-seek responsiveness, runtime duration gate, unsupported distance, Advanced event telemetry inspection, ambiguity, semantic saves and stale session callbacks (simulated source readiness/clock; native checks separate)');
}finally{await browser?.close();server?.httpServer?.closeIdleConnections();server?.httpServer?.closeAllConnections();await server?.close();}
