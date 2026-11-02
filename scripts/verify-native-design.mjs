// Run against a locally launched debug desktop app. No IPC or media is mocked.
// The selected recording's saved workspace is restored, including video, in finally.
import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const output='test-results/design/native';mkdirSync(output,{recursive:true});
const browser=await chromium.connectOverCDP(process.env.TTT_DESKTOP_CDP??'http://127.0.0.1:9223');
const page=browser.contexts()[0].pages().find(page=>page.url().startsWith('http://127.0.0.1:1420'));
assert(page,'Start the native debug app against the local development server first');
const report={environment:'Windows native Tauri/WebView2; real IPC, XRK parser, uPlot, and local H.264 playback',errors:[],screens:[],profiles:[]};
page.on('pageerror',error=>report.errors.push(error.message));
const invoke=(cmd,args={})=>page.evaluate(({cmd,args})=>window.__TAURI_INTERNALS__.invoke(cmd,args),{cmd,args});
const snapshot=await invoke('library_snapshot'),entry=snapshot.entries.find(entry=>entry.id===snapshot.activeSessionId);
assert(entry?.workspace,'Select an imported recording with a saved workspace before running this audit');
const original=structuredClone(entry.workspace);
const appUrl=new URL('/',page.url()).href,detachedUrl=new URL('/__design-audit-empty',appUrl).href;
await page.route(detachedUrl,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Local design audit</title>'}));
const detach=async(strict=true)=>{
  let drainFailure;
  try{if(await page.locator('.statusbar').count()){
    // Allow pending React effects to enqueue their final save, then await the
    // application's actual queue-completion signal rather than a disk timeout.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await expect(page.locator('.statusbar')).toContainText('Saved on this computer',{timeout:15000});
  }}catch(error){drainFailure=error;}
  await page.goto(detachedUrl,{waitUntil:'domcontentloaded'});
  if(drainFailure&&strict)throw drainFailure;
  return drainFailure;
};
const session=await invoke('load_library_session',{sessionId:entry.id});
const originalPrimary=original.primary,originalComparison=original.comparison;
const views=['Telemetry','Advanced','Video','AI Driving Coach'];
const settle=async()=>{await page.waitForTimeout(350);await page.evaluate(async()=>{for(const a of document.getAnimations().filter(a=>a.animationName==='workspace-out'))await a.finished.catch(()=>{});});};
const choose=async(label)=>{await page.getByRole('button',{name:label,exact:true}).click();await settle();};
async function profile(label,action){
  await page.evaluate(()=>{
    window.designFrames=[];window.designLongTasks=[];window.designSampling=true;
    if(PerformanceObserver.supportedEntryTypes.includes('longtask')){window.designObserver=new PerformanceObserver(list=>window.designLongTasks.push(...list.getEntries().map(entry=>entry.duration)));window.designObserver.observe({type:'longtask'});}
    let last;const frame=t=>{if(last!=null)window.designFrames.push(t-last);last=t;if(window.designSampling)requestAnimationFrame(frame);};requestAnimationFrame(frame);
  });
  await action();
  const result=await page.evaluate(()=>{
    window.designSampling=false;window.designObserver?.disconnect();
    const values=window.designFrames.sort((a,b)=>a-b);
    return {frames:values.length,medianMs:values[Math.floor(values.length*.5)],p95Ms:values[Math.floor(values.length*.95)],maxMs:values.at(-1),over25Ms:values.filter(v=>v>25).length,longTasksMs:window.designLongTasks};
  });
  report.profiles.push({label,...result});return result;
}
try{
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('.workspace-switch').waitFor();
  await choose('Telemetry');await page.locator('.uplot').first().waitFor();
  const initial=await page.evaluate(()=>({primary:document.querySelector('.lap-select[aria-pressed=true] .lap-time')?.textContent}));
  report.recording={laps:session.laps.length,channels:session.channels.length,samples:session.channels.reduce((n,c)=>n+c.values.length,0),primary:originalPrimary,comparison:originalComparison};
  await page.evaluate(()=>document.querySelector('#workspace-native-audit')?.remove());
  for(const label of views){
    await choose(label);
    await page.screenshot({path:`${output}/${label.replaceAll(' ','-')}.png`});report.screens.push(label);
    assert(await page.locator('.workspace-viewport').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${label} must fit its workspace`);
  }
  await choose('Telemetry');
  await profile('idle-real-recording',()=>page.waitForTimeout(1200));
  await profile('rapid-native-navigation',()=>page.evaluate(async()=>{
    const tabs=[...document.querySelectorAll('.workspace-switch button')];
    for(let i=0;i<32;i++){tabs[i%4].click();await new Promise(resolve=>setTimeout(resolve,65));}
  }));
  await settle();await expect(page.locator('.workspace-switch button[aria-pressed=true]')).toHaveText('AI Driving Coach');
  await choose('Telemetry');
  await expect(page.locator('.lap-select[aria-pressed=true] .lap-time')).toHaveText(initial.primary);
  // Window size IPC is intentionally denied by the production capability set.
  // Do not broaden permissions for an audit. Browser suites cover resize/state.
  report.nativeResize='Not performed: core:window:allow-set-size is intentionally absent; browser resize/state suite covers 600x500–2560x1440';
  // A checked-in CC0 solid-color fixture tests real decode without private footage.
  const media=await invoke('authorize_local_video',{path:resolve('src-tauri/tests/fixtures/windows/long.mp4')});
  const lap=session.laps.find(lap=>lap.id===originalPrimary);assert(lap);
  const video={version:1,sessionId:entry.id,contentVersion:entry.contentVersion,source:{type:'local',path:media.path,size:media.size,modifiedMs:media.modifiedMs},segments:[{id:'design-audit',videoStart:0,videoEnd:60,anchorVideoTime:0,anchorTelemetryTime:lap.start,anchorLapId:lap.id,correctionSeconds:0}],selectedSegmentId:'design-audit',preferences:{panelHeight:300,playbackRate:1,pausedVideoTime:0}};
  await detach();
  await invoke('save_workspace',{sessionId:entry.id,workspace:{...original,view:'video',video},expectedContentVersion:entry.contentVersion});
  await page.goto(appUrl,{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled({timeout:15000});
  const mediaInfo=await page.locator('video').evaluate(video=>({width:video.videoWidth,height:video.videoHeight,duration:video.duration,readyState:video.readyState}));
  assert(mediaInfo.width>0&&mediaInfo.duration>1,'Native media must actually decode');
  await page.getByRole('button',{name:'Play',exact:true}).click();
  const before=await page.locator('video').evaluate(video=>video.currentTime);
  await profile('native-video-and-telemetry',async()=>{
    const plot=page.locator('.u-over').first();await plot.scrollIntoViewIfNeeded();const box=await plot.boundingBox();
    for(let i=0;i<36;i++){await page.mouse.move(box.x+20+(box.width-40)*(i%18)/18,box.y+25);await page.waitForTimeout(30);}
  });
  const after=await page.locator('video').evaluate(video=>{const quality=video.getVideoPlaybackQuality();return {time:video.currentTime,paused:video.paused,totalVideoFrames:quality.totalVideoFrames,droppedVideoFrames:quality.droppedVideoFrames};});
  assert(after.time>before+.5&&!after.paused,'Real local video advances while the telemetry cursor is active');
  report.playback={...mediaInfo,elapsedSeconds:after.time-before,simultaneousTelemetry:true,...after};
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.screenshot({path:`${output}/video-playing.png`});
  await page.emulateMedia({reducedMotion:'reduce'});await choose('Telemetry');
  assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.animationName==='workspace-out'&&a.playState==='running').length),0);
  report.reducedMotion=true;
  assert.deepEqual(report.errors,[]);
}finally{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('video').evaluateAll(videos=>videos.forEach(video=>video.pause())).catch(()=>{});
  const drainFailure=await detach(false);
  await invoke('save_workspace',{sessionId:entry.id,workspace:original,expectedContentVersion:entry.contentVersion});
  await page.goto(appUrl,{waitUntil:'domcontentloaded'});await page.locator('.workspace-switch').waitFor();
  await expect(page.locator('.statusbar')).toContainText('Saved on this computer',{timeout:15000});
  const restored=(await invoke('library_snapshot')).entries.find(item=>item.id===entry.id)?.workspace;
  assert.deepEqual(restored,original,'The full original workspace must survive audit injection, native reload, and the final UI save');
  report.workspaceRestored=true;
  if(drainFailure)report.cleanupWarning=String(drainFailure);
  writeFileSync(`${output}/metrics.json`,JSON.stringify(report,null,2));
  await browser.close();
  if(drainFailure)throw drainFailure;
}
console.log(JSON.stringify(report,null,2));
