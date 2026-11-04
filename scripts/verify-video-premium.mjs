// Real private XRK diagnostics + genuine Chromium codec-fixture playback.
// IPC is simulated. This does not validate WebView2, native dialogs or onboard media.
import {launchBrowser,browserTestEntries,browserTestNoWatch} from './browser.mjs';
import {expect} from '@playwright/test';
import {createServer,preview} from 'vite';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const fixture=process.env.VIDEO_UI_DATA;
assert(fixture,'Set VIDEO_UI_DATA to cached coach_check JSON from a local recording.');
const data=JSON.parse(readFileSync(fixture,'utf8'));
const prefix=process.env.VIDEO_SCREENSHOT_PREFIX||'.tools/video-ui/after';
mkdirSync(resolve(prefix,'..'),{recursive:true});
let server,browser;
try{
 if(process.env.VIDEO_PRODUCTION==='1')server=await preview({configLoader:'runner',preview:{host:'127.0.0.1',port:0,strictPort:false}});
 else {server=await createServer({configLoader:'runner',plugins:[browserTestNoWatch],optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:process.env.VIDEO_INSPECT?'5186':0,strictPort:false,hmr:false}});await server.listen();}
 browser=await launchBrowser();
 const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const media=readFileSync(new URL('../src-tauri/tests/fixtures/windows/long.mp4',import.meta.url));
 await page.route('**/src-tauri/tests/fixtures/windows/long.mp4',route=>{
  const range=route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
  const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),media.length-1):media.length-1;
  return route.fulfill({status:range?206:200,contentType:'video/mp4',headers:{'Accept-Ranges':'bytes','Content-Length':String(end-start+1),...(range?{'Content-Range':`bytes ${start}-${end}/${media.length}`}:{})},body:media.subarray(start,end+1)});
 });
 const bootstrap=d=>{
  const lap=d.session.laps.find(l=>l.id===d.report.referenceLapId)??d.session.laps[0];
  const video={version:1,sessionId:d.session.id,contentVersion:'version',source:{type:'local',path:'/codec-fixture.mp4',size:20112,modifiedMs:1},segments:[{id:'manual',videoStart:0,videoEnd:60,anchorVideoTime:0,anchorTelemetryTime:lap.start,anchorLapId:lap.id,correctionSeconds:0}],selectedSegmentId:'manual',preferences:{panelHeight:400,playbackRate:1,pausedVideoTime:1}};
  const entry={...d.session,contentVersion:'version',status:'ready',channelCount:d.session.channels.length,lapCount:d.session.laps.length,lastUsed:0,workspace:{contentVersion:'version',primary:lap.id,comparison:null,axis:'distance',channels:d.session.channels.filter(c=>/speed|rpm/i.test(c.name)).map(c=>c.id),layout:'comfortable',zoom:null,view:'video',video}};
  window.isTauri=true;window.__videoSaves=[];window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,convertFileSrc:()=>'/src-tauri/tests/fixtures/windows/long.mp4',invoke:async(cmd,args={})=>{
   if(cmd.startsWith('plugin:event'))return 1;
   if(cmd==='library_snapshot')return {entries:[entry],activeSessionId:entry.id,warnings:[]};
   if(cmd==='load_library_session')return d.session;
   if(cmd==='save_workspace'){entry.workspace=args.workspace;window.__videoSaves.push(args.workspace);return;}
   if(cmd==='authorize_local_video')return {path:args.path,size:20112,modifiedMs:1,status:'ready'};
   if(cmd==='youtube_cache_status')return {limitBytes:10737418240,usedBytes:0,entries:[]};
   if(cmd==='analyze_session'){
    const result=structuredClone(d.analyses[`${args.primaryId}:${args.axis}`]);
    result.comparison=args.comparisonId?structuredClone(d.analyses[`${args.comparisonId}:${args.axis}`].primary):null;
    for(const view of [result.primary,result.comparison].filter(Boolean))view.series=view.series.filter(s=>args.channelIds.includes(s.channelId));
    return result;
   }
   if(cmd==='plugin:dialog|open')return null;
   throw Error(`Unexpected video IPC ${cmd}`);
  }};
 };
 await page.addInitScript(bootstrap,data);
 if(process.env.VIDEO_INSPECT)writeFileSync('.tools/video-ui/inspect.html',readFileSync('index.html','utf8').replace('<head>',`<head><script>(${bootstrap.toString()})(${JSON.stringify(data).replaceAll('<','\\u003c')})</script>`));
 await page.goto(server.resolvedUrls.local[0]);
 const play=page.getByRole('button',{name:'Play',exact:true});
 await expect(play).toBeEnabled();
 await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
 await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:`${prefix}-desktop.png`,animations:'disabled'});
 if(!process.env.VIDEO_BASELINE){
  const node=await page.locator('video').elementHandle();
  await page.getByRole('button',{name:'Focus video',exact:true}).click();
  assert(await node.evaluate(el=>el===document.querySelector('video')),'focus retains media node');
  await page.getByRole('button',{name:'Focus video',exact:true}).press('Escape');
  await expect(page.getByRole('button',{name:'Show analysis',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Focus video',exact:true}).click();
  await page.getByRole('button',{name:'Show analysis',exact:true}).click();
  await play.click();await page.waitForFunction(()=>document.querySelector('video').currentTime>1.1);
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  const time=await page.locator('video').evaluate(el=>el.currentTime);assert(time>1);
  await page.getByRole('button',{name:'Telemetry',exact:true}).click();
  await page.getByRole('button',{name:'Video',exact:true}).click();
  assert(await node.evaluate(el=>el===document.querySelector('video')),'navigation retains media node');
  assert(Math.abs(await page.locator('video').evaluate(el=>el.currentTime)-time)<.15,'navigation retains position');
  await page.getByRole('button',{name:'Hide telemetry overlay',exact:true}).click();
  await page.getByRole('button',{name:'Show telemetry overlay',exact:true}).click();
  assert(await node.evaluate(el=>el===document.querySelector('video')),'overlay retains media node');
  await page.getByRole('button',{name:'Show native video controls',exact:true}).click();
  await expect(page.locator('video')).toHaveAttribute('controls','');
  await page.getByRole('button',{name:'Hide native video controls',exact:true}).click();
  const workspace=page.getByRole('region',{name:'Video synchronization',exact:true});
  await workspace.focus();await workspace.press('k');await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeEnabled();
  await workspace.press('k');await expect(play).toBeEnabled();
  const slider=page.getByRole('slider',{name:'Video timeline'});
  if(process.env.VIDEO_DEBUG)console.log('before range',await page.evaluate(()=>{const v=document.querySelector('video');return {time:v.currentTime,duration:v.duration,seeking:v.seeking,paused:v.paused,status:document.querySelector('[aria-label="Video sync status"]').textContent,range:[...Array(v.seekable.length)].map((_,i)=>[v.seekable.start(i),v.seekable.end(i)]),saved:window.__videoSaves.at(-1)?.video};}));
  await slider.focus();await slider.press('ArrowRight');await expect(play).toBeEnabled();
  if(process.env.VIDEO_DEBUG)console.log('after range',await page.evaluate(()=>{const v=document.querySelector('video');return {time:v.currentTime,duration:v.duration,seeking:v.seeking,paused:v.paused,status:document.querySelector('[aria-label="Video sync status"]').textContent,errors:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent)};}));
  await expect(page.getByRole('status',{name:'Video sync status',exact:true})).toHaveText('ready');
  const separator=page.getByRole('separator',{name:'Resize video panel'});
  await separator.focus();await separator.press('Home');await expect(separator).toHaveAttribute('aria-valuenow','240');
  await separator.press('ArrowDown');await expect(separator).toHaveAttribute('aria-valuenow','260');
  assert(await node.evaluate(el=>el===document.querySelector('video')),'resizing retains media node');
  await expect.poll(()=>page.evaluate(()=>window.__videoSaves.at(-1)?.video.preferences.panelHeight)).toBe(260);
  await page.evaluate(()=>document.querySelector('.workspace-viewport').scrollTop=110);
  await page.screenshot({path:`${prefix}-studio.png`,animations:'disabled'});
  await page.getByRole('button',{name:'Focus video',exact:true}).click();
  await page.screenshot({path:`${prefix}-focus.png`,animations:'disabled'});
  await page.getByRole('button',{name:'Show analysis',exact:true}).click();
 }
 await page.setViewportSize({width:600,height:500});
 await page.screenshot({path:`${prefix}-compact.png`,animations:'disabled'});
 if(!process.env.VIDEO_BASELINE){await page.locator('.video-controls').scrollIntoViewIfNeeded();await page.screenshot({path:`${prefix}-compact-controls.png`,animations:'disabled'});}
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
 await page.evaluate(()=>document.documentElement.dataset.theme='light');
 await page.screenshot({path:`${prefix}-compact-light.png`,animations:'disabled'});
 await page.setViewportSize({width:1600,height:1100});
 await page.screenshot({path:`${prefix}-light.png`,animations:'disabled'});
 await page.emulateMedia({reducedMotion:'reduce'});
 if(!process.env.VIDEO_BASELINE){await page.getByRole('button',{name:'Focus video',exact:true}).click();await page.getByRole('button',{name:'Show analysis',exact:true}).click();}
 if(!process.env.VIDEO_BASELINE){
  await page.getByRole('button',{name:'Focus video',exact:true}).click();
  // Deliberate media error event verifies focus-mode feedback, not codec support.
  await page.locator('video').evaluate(video=>video.dispatchEvent(new Event('error')));
  await expect(page.getByRole('alert').filter({hasText:'Local video playback failed'})).toBeVisible();
  await expect(page.locator('.video-instrument').nth(1).locator('strong')).toHaveText('—');
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({recording:fixture,playback:'genuine Chromium H.264 codec fixture; simulated IPC',screenshots:prefix,errors}));
 if(process.env.VIDEO_INSPECT){console.log(server.resolvedUrls.local[0]);await new Promise(()=>{});}
}finally{await browser?.close();await server?.close();}
