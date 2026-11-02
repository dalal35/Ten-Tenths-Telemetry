import {launchBrowser,browserTestEntries,browserTestNoWatch} from './browser.mjs';
import {expect} from '@playwright/test';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
let server,browser;
try {
  server=await createServer({plugins:[browserTestNoWatch],optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}});await server.listen();
  browser=await launchBrowser();
  const page=await browser.newPage({viewport:{width:1360,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Simulated Tauri picker/authorization and media clock; native decode is checked separately.
  await page.addInitScript(()=>{
    const w=window;w.youtubeAsset={videoId:'M7lc1UVf-VE',url:'https://www.youtube.com/watch?v=M7lc1UVf-VE',path:'/cache/M7lc1UVf-VE.mp4',size:1200,modifiedMs:2,sha256:'a'.repeat(64),durationSeconds:60,trackStartSeconds:0,leaseId:'lease-1',cached:false};
    w.youtubeStatus={jobId:'',videoId:'M7lc1UVf-VE',phase:'downloading',downloadedBytes:40,totalBytes:100,speedBytesPerSecond:10,etaSeconds:6,error:null};w.youtubeCalls=[];w.holdYoutubeDownload=false;w.youtubeCacheError=false;
    w.isTauri=true;window.__TAURI_INTERNALS__={convertFileSrc:path=>`https://asset.localhost/${encodeURIComponent(path)}`,
      invoke:async(cmd,args)=>{w.youtubeCalls.push([cmd,args]);if(cmd==='start_video_sync')return w.holdSyncStart?new Promise(resolve=>w.finishSyncStart=()=>resolve('fixture-sync')):'fixture-sync';if(cmd==='video_sync_status')return new Promise(resolve=>w.finishSync=()=>resolve({phase:'complete',progress:1,error:null,result:{ambiguous:false,applicable:true,rejectionReason:null,candidates:[{offsetSeconds:19,sign:1,correlation:.9,overlapSeconds:30,peakWidthSeconds:1,windows:[],consistent:true}]}}));if(cmd==='cancel_video_sync'){w.cancelledSync=(w.cancelledSync??0)+1;return;}if(cmd==='plugin:dialog|open')return window.fixturePick??null;if(cmd==='authorize_local_video')return {path:args.path,size:window.fixtureSize??100,modifiedMs:1,status:'ready'};
        if(cmd==='youtube_cache_status'){if(w.youtubeCacheError)throw new Error('Cache index unavailable');return {limitBytes:10737418240,usedBytes:1200,entries:[]};}if(cmd==='youtube_download_status')return {...w.youtubeStatus,jobId:args.jobId};
        if(cmd==='download_youtube_video')return w.holdYoutubeDownload?new Promise(resolve=>{w.finishYoutubeDownload=()=>resolve(w.youtubeAsset);}):w.youtubeAsset;
        if(cmd==='cancel_youtube_download'||cmd==='release_youtube_video')return;
        if(cmd==='resolve_cached_youtube_video')return w.resolvedYoutubeAsset??null;
        if(cmd==='set_youtube_cache_limit'||cmd==='clean_youtube_cache'||cmd==='remove_youtube_cache_entry')return {limitBytes:10737418240,usedBytes:1200,entries:[]};return null;}};
    const times=new WeakMap(),rates=new WeakMap(),sources=new WeakMap();
    Object.defineProperties(HTMLVideoElement.prototype,{videoWidth:{get(){return 1920;}},videoHeight:{get(){return 1080;}}});
    Object.defineProperties(HTMLMediaElement.prototype,{
      src:{get(){return sources.get(this)??'';},set(value){sources.set(this,value);}},duration:{get(){return window.fixtureUnknown?NaN:60;}},currentTime:{get(){return times.get(this)??0;},set(value){times.set(this,value);this.dispatchEvent(new Event('timeupdate'));queueMicrotask(()=>this.dispatchEvent(new Event('seeked')));}},
      playbackRate:{get(){return rates.get(this)??1;},set(value){rates.set(this,value);this.dispatchEvent(new Event('ratechange'));}},
      paused:{get(){return !this.dataset.playing;}}});
    HTMLMediaElement.prototype.load=function(){if(sources.has(this))queueMicrotask(()=>this.dispatchEvent(new Event('loadedmetadata')));};
    HTMLMediaElement.prototype.play=async function(){this.dataset.playing='1';this.dispatchEvent(new Event('playing'));};
    HTMLMediaElement.prototype.pause=function(){delete this.dataset.playing;this.dispatchEvent(new Event('pause'));};
  });
  await page.goto(`${server.resolvedUrls.local[0]}tests/video.html`,{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('region',{name:'Video synchronization'})).toBeVisible();
  const state=()=>page.evaluate(()=>window.fixtureState);
  const pick=async(path='/fixture/onboard.mp4')=>{await page.evaluate(path=>window.fixturePick=path,path);};
  await page.getByRole('button',{name:'Attach MP4 / MOV',exact:true}).click();assert.equal((await state()).source,null,'cancel must not attach');
  await page.evaluate(()=>window.fixtureRestore());await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
  await expect.poll(()=>page.evaluate(()=>window.fixturePlayer?.snapshot().time)).toBe(12);
  assert.equal((await state()).preferences.playbackRate,1.5,'restore preserves saved rate during readiness');
  await expect.poll(()=>page.evaluate(()=>window.fixturePlayer?.snapshot().rate)).toBe(1.5);
  await page.evaluate(()=>window.fixtureReset());
  await pick();await page.getByRole('button',{name:'Attach MP4 / MOV',exact:true}).click();await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
  // Late native completions cannot survive source, content, or session revisions.
  for(const change of ['source','content','session']){
    await page.evaluate(()=>{window.finishSync=null;});
    await page.getByRole('button',{name:'Estimate sync'}).click();await expect.poll(()=>page.evaluate(()=>!!window.finishSync)).toBe(true);
    const before=await page.evaluate(()=>window.cancelledSync??0);
    await page.evaluate(change=>{const current=window.fixtureState;if(change==='source')window.fixtureSetState({...current,source:{...current.source,path:'/fixture/changed.mp4'}});else if(change==='content')window.fixtureSetState({...current,contentVersion:current.contentVersion+'-new'});else window.fixtureSwitchSession({...window.fixtureSession,id:'changed-session'});},change);
    await expect.poll(()=>page.evaluate(()=>window.cancelledSync??0)).toBe(before+1);await page.evaluate(()=>window.finishSync());await expect(page.getByText(/Candidate 1 offset/)).toHaveCount(0);
    await page.evaluate(()=>{window.fixtureSwitchSession({...window.fixtureSession,id:'video-fixture'});window.fixtureRestore();});await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
  }
  await page.evaluate(()=>{window.holdSyncStart=true;window.finishSyncStart=null;});
  await page.getByRole('button',{name:'Estimate sync'}).click();await expect.poll(()=>page.evaluate(()=>!!window.finishSyncStart)).toBe(true);
  const cancellationsBeforeUnmount=await page.evaluate(()=>window.cancelledSync??0);await page.evaluate(()=>window.fixtureShowVideo(false));await page.evaluate(()=>window.finishSyncStart());await expect.poll(()=>page.evaluate(()=>window.cancelledSync??0)).toBe(cancellationsBeforeUnmount+1);
  await page.evaluate(()=>{window.holdSyncStart=false;window.fixtureShowVideo(true);});await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
  await page.evaluate(()=>{document.querySelector('video').currentTime=10;});
  await page.getByLabel('Anchor lap',{exact:true}).selectOption('lap2');
  await page.evaluate(()=>window.fixtureRerender());await expect(page.getByLabel('Anchor lap',{exact:true})).toHaveValue('lap2');
  await page.getByRole('button',{name:'Sync Here',exact:true}).click();
  let saved=await state();assert.equal(saved.segments.length,1);assert.deepEqual([saved.segments[0].videoStart,saved.segments[0].videoEnd,saved.segments[0].anchorVideoTime,saved.segments[0].anchorTelemetryTime,saved.segments[0].anchorLapId],[0,60,10,120,'lap2']);
  await expect(page.getByText('Lap 1 · partial coverage',{exact:true})).toBeVisible();await expect(page.getByText('Lap 2 · full coverage',{exact:true})).toBeVisible();await expect(page.getByText('Lap 4 · partial coverage',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/Predicted lap 2 crossing/})).toBeVisible();
  await page.screenshot({path:'.tools/video-workspace-dark.png',animations:'disabled'});await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:'.tools/video-workspace-light.png',animations:'disabled'});await page.evaluate(()=>document.documentElement.removeAttribute('data-theme'));
  const beforeCoveredAdd=await state();await page.getByRole('button',{name:'Add segment here'}).click();await expect(page.getByRole('alert')).toContainText('Trim the existing segment first');assert.deepEqual((await state()).segments,beforeCoveredAdd.segments);
  await page.getByLabel('Segment end (s)').fill('30');await page.getByRole('button',{name:'Apply segment edits'}).click();
  await page.evaluate(()=>{document.querySelector('video').currentTime=35;});await page.getByLabel('Anchor lap',{exact:true}).selectOption('lap2');await page.getByRole('button',{name:'Add segment here'}).click();
  saved=await state();assert.equal(saved.segments.length,2);assert.deepEqual(saved.segments.map(s=>[s.videoStart,s.videoEnd]),[[0,30],[30,60]],'add uses remaining interval without trimming previous segment');
  await expect(page.getByLabel('Video anchor (s)')).toHaveValue('35');await page.getByLabel('Segment start (s)').fill('20');await page.getByRole('button',{name:'Apply segment edits'}).click();await expect(page.getByRole('alert')).toContainText('overlap');assert.deepEqual((await state()).segments,saved.segments,'invalid edits retain valid mappings');
  await page.getByLabel('Segment start (s)').fill('30');await page.getByRole('button',{name:'Apply segment edits'}).click();
  const markers=await page.locator('[data-marker-segment]').evaluateAll(nodes=>nodes.map(n=>[n.dataset.markerSegment,Number(n.dataset.videoTime)]));
  await page.getByRole('button',{name:'Correction +0.1 s',exact:true}).click();
  const corrected=await page.locator('[data-marker-segment]').evaluateAll(nodes=>nodes.map(n=>[n.dataset.markerSegment,Number(n.dataset.videoTime)]));
  const first=saved.segments[0].id,second=saved.segments[1].id;
  assert.deepEqual(corrected.filter(([id])=>id===first),markers.filter(([id])=>id===first),'nudge leaves other markers fixed');
  assert(Math.abs(corrected.find(([id])=>id===second)[1]-markers.find(([id])=>id===second)[1]+.1)<1e-9,'positive correction moves predicted crossing earlier');
  await page.evaluate(()=>window.fixtureTelemetry(120));await expect(page.getByText('Repeated footage: choose a segment to seek.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Use segment 2',exact:true}).click();assert.equal((await state()).selectedSegmentId,second);
  const slider=page.getByRole('slider',{name:'Video timeline'});await slider.focus();await page.keyboard.press('ArrowRight');await expect.poll(()=>page.evaluate(()=>window.fixtureSeeks?.length??0)).toBeGreaterThan(0);await expect.poll(async()=>(await state()).preferences.pausedVideoTime).toBe(await page.evaluate(()=>window.fixtureSeeks.at(-1)));
  const separator=page.getByRole('separator',{name:'Resize video panel'});await separator.focus();await page.keyboard.press('ArrowDown');assert.equal((await state()).preferences.panelHeight,420);
  const viewport=page.locator('.video-viewport');let box=await viewport.boundingBox();assert(box.width>=200&&box.height>=200);assert(Math.abs(box.width/box.height-16/9)<.02,'player preserves 16:9 aspect');
  await page.getByRole('button',{name:'Play',exact:true}).click();const saves=await page.evaluate(()=>window.fixtureSaves);await page.evaluate(()=>{document.querySelector('video').currentTime=36;});assert.equal(await page.evaluate(()=>window.fixtureSaves),saves,'playing ticks do not persist');await page.getByRole('button',{name:'Pause',exact:true}).click();await expect.poll(async()=>(await state()).preferences.pausedVideoTime).toBe(36);
  await page.getByLabel('Playback speed').selectOption('1.5');await expect.poll(async()=>(await state()).preferences.playbackRate).toBe(1.5);
  await page.evaluate(()=>window.scrollTo(0,document.querySelector('.video-graphs').offsetTop+200));box=await viewport.boundingBox();assert(box.y>=0&&box.y<400,'player remains visible while graph region scrolls');await expect(page.getByText('GPS inspector remains visible',{exact:true})).toBeInViewport();
  await page.evaluate(()=>document.documentElement.dataset.theme='light');await expect(page.getByRole('region',{name:'Video synchronization'})).toBeVisible();assert.equal(await viewport.evaluate(n=>getComputedStyle(n).aspectRatio),'16 / 9');await page.evaluate(()=>document.documentElement.removeAttribute('data-theme'));await page.evaluate(()=>window.scrollTo(0,0));
  await page.getByRole('button',{name:'Remove selected segment'}).click();assert.equal((await state()).segments.length,1);await expect(page.getByText('Lap 3 · no coverage',{exact:true})).toBeVisible();
  saved=await state();await page.evaluate(()=>window.fixtureAvailability('missing'));await expect(page.getByRole('strong').filter({hasText:'Footage unavailable'})).toBeVisible();await expect.poll(()=>page.evaluate(()=>window.fixturePlayer===null)).toBe(true);await pick('/fixture/moved.mp4');await page.getByRole('button',{name:'Locate',exact:true}).click();await expect(page.getByRole('button',{name:'Confirm mappings still apply'})).toBeVisible();assert.deepEqual((await state()).segments,saved.segments);await page.getByRole('button',{name:'Confirm mappings still apply'}).click();assert.deepEqual((await state()).segments,saved.segments);assert.equal((await state()).source.path,'/fixture/moved.mp4');await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
  await page.evaluate(()=>window.fixtureAvailability('ready'));await pick('/fixture/replaced.mov');await page.getByRole('button',{name:'Replace footage',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual((await state()).segments,saved.segments,'cancel replacement preserves mappings');await page.getByRole('button',{name:'Replace footage',exact:true}).click();await page.getByRole('button',{name:'Replace and clear segments',exact:true}).click();assert.equal((await state()).segments.length,0);assert.equal((await state()).source.path,'/fixture/replaced.mov');
  await page.evaluate(()=>window.fixtureAvailability('changed'));await expect.poll(()=>page.evaluate(()=>window.fixturePlayer===null)).toBe(true);await expect(page.getByText('The file metadata changed. Confirm that the existing mappings still apply.',{exact:true})).toBeVisible();await pick('/fixture/replaced.mov');await page.getByRole('button',{name:'Locate',exact:true}).click();await page.getByRole('button',{name:'Confirm mappings still apply'}).click();await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
  // Reuse the same component across sessions; stale lap IDs must not make Sync Here a silent no-op.
  await page.evaluate(()=>{window.fixtureAvailability('ready');window.fixtureSwitchSession({...window.fixtureSession,id:'second-session',laps:[
    {id:'second-lap1',number:1,start:300,end:320,duration:20,complete:true},
    {id:'second-lap2',number:2,start:320,end:340,duration:20,complete:true}
  ]});});
  await pick();await page.getByRole('button',{name:'Attach MP4 / MOV',exact:true}).click();await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
  await page.evaluate(()=>{document.querySelector('video').currentTime=7;});
  await page.getByRole('button',{name:'Sync Here',exact:true}).click();
  saved=await state();assert.equal(saved.segments.length,1,'session switch must leave Sync Here usable');
  assert.deepEqual([saved.segments[0].anchorVideoTime,saved.segments[0].anchorTelemetryTime,saved.segments[0].anchorLapId],[7,300,'second-lap1']);
  await expect(page.getByLabel('Anchor lap',{exact:true})).toHaveValue('second-lap1');
  await page.getByLabel('Anchor lap',{exact:true}).selectOption('second-lap2');await page.evaluate(()=>window.fixtureRerender());
  await expect(page.getByLabel('Anchor lap',{exact:true})).toHaveValue('second-lap2');
  await page.getByRole('button',{name:'Sync Here',exact:true}).click();assert.equal((await state()).segments[0].anchorTelemetryTime,320,'same-session rerender preserves deliberate anchor');
  await page.evaluate(()=>window.fixtureLaps(window.fixtureSession.laps.slice(0,1)));
  await page.getByRole('button',{name:'Sync Here',exact:true}).click();
  assert.equal((await state()).segments[0].anchorTelemetryTime,300,'removed anchor lap falls back to an available lap');
  await page.evaluate(()=>{window.fixtureAvailability('ready');window.fixtureUnknown=true;window.fixtureReset();});await pick();await page.getByRole('button',{name:'Attach MP4 / MOV',exact:true}).click();await expect(page.getByText('Waiting for a known video duration before creating segments.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Sync Here',exact:true})).toBeDisabled();
  await page.evaluate(()=>{const video=document.querySelector('video');video.dispatchEvent(new Event('error'));});await expect(page.getByRole('alert')).toContainText(/codec|playback failed/i);
  await page.evaluate(()=>{window.fixtureUnknown=false;window.fixtureRestore();window.holdYoutubeDownload=true;window.youtubeStatus={...window.youtubeStatus,phase:'downloading'};});await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
  await page.getByLabel('YouTube URL').fill('https://youtu.be/M7lc1UVf-VE');await page.getByRole('button',{name:'Download YouTube',exact:true}).click();
  await expect(page.getByText(/Downloading/)).toBeVisible({timeout:3000});await expect(page.getByText(/MiB\/s.*left/)).toBeVisible();await expect(page.getByRole('progressbar',{name:'YouTube download progress'})).toBeVisible();
  await page.getByRole('button',{name:'Cancel download',exact:true}).click();await expect(page.getByText('Download cancelled',{exact:true})).toBeVisible();
  await page.evaluate(()=>window.finishYoutubeDownload());await expect.poll(async()=>(await state()).source.path).toBe('/fixture/restore.mp4');
  assert(await page.evaluate(()=>window.youtubeCalls.some(([cmd])=>cmd==='cancel_youtube_download')),'cancel forwards to native worker');
  await page.evaluate(()=>{window.holdYoutubeDownload=false;window.youtubeStatus.phase='preparing';});
  await page.getByRole('button',{name:'Download YouTube',exact:true}).click();await expect(page.getByRole('button',{name:'Replace and clear segments',exact:true})).toBeVisible();assert.equal((await state()).source.path,'/fixture/restore.mp4','existing footage remains until successful confirmation');await page.getByRole('button',{name:'Replace and clear segments',exact:true}).click();await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
  const downloaded=await state();assert.deepEqual(downloaded.source,{type:'youtube',url:'https://www.youtube.com/watch?v=M7lc1UVf-VE',videoId:'M7lc1UVf-VE',cache:{sha256:'a'.repeat(64),size:1200,durationSeconds:60,trackStartSeconds:0}});
  assert((await page.locator('video').evaluate(video=>video.src)).includes(encodeURIComponent('/cache/M7lc1UVf-VE.mp4')),'native YouTube uses authorized cached local playback');
  const segment={id:'saved-anchor',videoStart:0,videoEnd:50,anchorVideoTime:0,anchorTelemetryTime:300,anchorLapId:'second-lap1',correctionSeconds:.25};
  await page.evaluate(({asset,segment})=>{window.resolvedYoutubeAsset=asset;window.fixtureYouTube({type:'youtube',url:asset.url,videoId:asset.videoId,cache:{sha256:asset.sha256,size:asset.size,durationSeconds:asset.durationSeconds,trackStartSeconds:asset.trackStartSeconds}},[segment]);}, {asset:await page.evaluate(()=>window.youtubeAsset),segment});
  await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
  await expect.poll(()=>state().then(value=>value.segments[0]?.id)).toBe('saved-anchor');assert.equal((await state()).segments[0].id,'saved-anchor');
  assert(await page.locator('video').evaluate(video=>video.src).then(src=>src.includes(encodeURIComponent('/cache/M7lc1UVf-VE.mp4'))));
  const downloadsBefore=await page.evaluate(()=>window.youtubeCalls.filter(([cmd])=>cmd==='download_youtube_video').length);
  await page.getByLabel('YouTube URL').fill('https://youtu.be/M7lc1UVf-VE');await page.getByRole('button',{name:'Download YouTube',exact:true}).click();await expect.poll(()=>state().then(value=>value.source.cache.sha256)).toBe('a'.repeat(64));
  assert.deepEqual((await state()).segments,[segment],'reattaching the same YouTube ID with identical media retains manual alignment');
  assert.equal(await page.evaluate(()=>window.youtubeCalls.filter(([cmd])=>cmd==='download_youtube_video').length),downloadsBefore+1);
  const changed={...(await state()).source,cache:{...(await state()).source.cache,sha256:'b'.repeat(64)}};
  await page.evaluate(({source,segment})=>{window.resolvedYoutubeAsset=window.youtubeAsset;window.fixtureYouTube(source,[segment]);},{source:changed,segment});
  await expect(page.getByRole('button',{name:'Confirm mappings still apply'})).toBeVisible();assert.equal((await state()).source.cache.sha256,'b'.repeat(64));assert.deepEqual((await state()).segments,[segment]);
  await page.getByRole('button',{name:'Confirm mappings still apply'}).click();await expect.poll(()=>state().then(value=>value.source.cache.sha256)).toBe('a'.repeat(64));assert.deepEqual((await state()).segments,[segment]);
  await page.evaluate(()=>{window.resolvedYoutubeAsset=null;window.youtubeCacheError=true;window.fixtureAvailability('missing');});await page.waitForTimeout(20);await page.evaluate(()=>window.fixtureAvailability('ready'));
  await expect(page.getByRole('button',{name:'Download saved URL',exact:true})).toBeVisible();await page.getByRole('button',{name:'Refresh cache status',exact:true}).click();await expect(page.getByText(/Cache status unavailable: Cache index unavailable/)).toBeVisible();await expect(page.getByRole('button',{name:'Remove cached YouTube copy',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Remove cached YouTube copy',exact:true}).click();await expect(page.getByRole('button',{name:'Download saved URL',exact:true})).toBeVisible();
  await page.evaluate(()=>{window.holdYoutubeDownload=true;window.youtubeStatus.phase='downloading';});
  await page.getByRole('button',{name:'Download saved URL',exact:true}).click();await expect(page.getByText(/Downloading/)).toBeVisible();
  await page.getByRole('button',{name:'Correction +0.1 s',exact:true}).click();
  await page.getByLabel('Segment start (s)').fill('1');await page.getByLabel('Video anchor (s)').fill('1');await page.getByLabel('Segment end (s)').fill('49');await page.getByLabel('Correction (s)').fill('0.35');await page.getByRole('button',{name:'Apply segment edits'}).click();
  await page.getByRole('separator',{name:'Resize video panel'}).focus();await page.keyboard.press('ArrowDown');
  await page.evaluate(()=>window.finishYoutubeDownload());await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
  const recovered=await state();assert.equal(recovered.source.cache.sha256,'a'.repeat(64));assert.equal(recovered.segments[0].correctionSeconds,.35);assert.equal(recovered.segments[0].videoStart,1);assert.equal(recovered.segments[0].videoEnd,49);assert.equal(recovered.segments[0].anchorVideoTime,1);assert.equal(recovered.preferences.panelHeight,420,'same-media cache recovery preserves edits made while its download was pending');
  await page.evaluate(()=>{window.holdYoutubeDownload=false;window.youtubeStatus.phase='preparing';});
  const releasesBeforeReset=await page.evaluate(()=>window.youtubeCalls.filter(([cmd])=>cmd==='release_youtube_video').length);
  await page.evaluate(()=>{window.releaseBlocked=true;window.fixtureReset();});await expect.poll(()=>page.evaluate(()=>window.releaseBarrier!==null)).toBe(true);
  assert.equal(await page.evaluate(()=>window.youtubeCalls.filter(([cmd])=>cmd==='release_youtube_video').length),releasesBeforeReset,'an attached cache lease stays held while the durable workspace save is pending');
  await page.evaluate(()=>{window.releaseBlocked=false;window.releaseBarrier();});await expect.poll(()=>page.evaluate(()=>window.youtubeCalls.filter(([cmd])=>cmd==='release_youtube_video').length)).toBeGreaterThan(releasesBeforeReset);
  await page.evaluate(()=>{window.holdYoutubeDownload=true;window.youtubeStatus.phase='downloading';});await page.getByRole('button',{name:'Download YouTube',exact:true}).click();await expect(page.getByRole('button',{name:'Cancel download',exact:true})).toBeVisible();
  await page.evaluate(()=>window.fixtureYouTube({type:'youtube',url:'https://www.youtube.com/watch?v=abcdefghijk',videoId:'abcdefghijk'}));await expect.poll(()=>state().then(value=>value.source?.videoId)).toBe('abcdefghijk');await page.evaluate(()=>window.finishYoutubeDownload());
  await expect.poll(()=>state().then(value=>value.source?.videoId)).toBe('abcdefghijk');await expect(page.getByRole('button',{name:'Download YouTube',exact:true})).toBeEnabled();
  assert(await page.evaluate(()=>window.youtubeCalls.filter(([cmd])=>cmd==='cancel_youtube_download').length>=2),'source changes cancel the active native job');await expect.poll(()=>page.evaluate(()=>window.youtubeCalls.filter(([cmd])=>cmd==='release_youtube_video').length)).toBeGreaterThan(3);
  assert.deepEqual(errors,[]);console.log('PASS: local source cancel/replace/Locate, YouTube download progress/cancel/retry/cache identity/local playback/lease release, lap anchors, trim/add/validation/correction/removal, coverage, ambiguity, keyboard timeline/resize, semantic preferences, sticky dark/light player and readiness/errors (simulated clock; native playback checked separately)');
} finally {await browser?.close();await server?.close();}
