import {createServer} from 'vite';
import {expect} from '@playwright/test';
import {launchBrowser} from './browser.mjs';
import {installWorkspaceFixture} from '../tests/workspace-transition-fixture.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';

// Production React application; native IPC/media are the only simulated boundary.
const views=['Telemetry','Advanced','Video','AI Driving Coach'];
const output='test-results/workspace-transitions';
let server,browser;
try{
 mkdirSync(output,{recursive:true});
 server=await createServer({plugins:[{name:'transition-audit-no-watch',config(config){config.server??={};config.server.watch=null;}}],optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime','motion/react']},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}});
 assert.equal(server.config.server.watch,null,'Transition timing audits must not scan build artifacts');
 await server.listen();browser=await launchBrowser();
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(installWorkspaceFixture);
 await page.goto(`${server.resolvedUrls.local[0]}tests/advanced.html`);
 await page.locator('.uplot').first().waitFor();
 // Deliberate RED on the replaced implementation: its main scroller moves nav.
 await expect(page.locator('.workspace-viewport')).toBeVisible({timeout:1500});
 assert(await page.evaluate(()=>window.auditTransitionSupported),'This engine must support native workspace snapshots for frame verification');
 const click=view=>page.getByRole('button',{name:view,exact:true}).click();
 const settle=async()=>{await page.evaluate(async()=>{await window.auditCurrentTransition?.finished.catch(()=>{});});await page.waitForFunction(()=>!document.getAnimations().some(a=>/^workspace-(in|out)$/.test(a.animationName??'')&&a.playState==='running'));};
 const geometry=()=>page.evaluate(()=>Object.fromEntries(['.titlebar','.explorer-slot','.workspace-heading','.lap-summary','.workspace-switch','.workspace-viewport','.statusbar'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return [selector,[r.x,r.y,r.width,r.height].map(n=>Math.round(n*100)/100)];})));
 const stable=(before,after,label)=>{for(const selector of Object.keys(before))for(let i=0;i<4;i++)assert(Math.abs(before[selector][i]-after[selector][i])<.6,`${label}: ${selector} geometry moved (${before[selector]} → ${after[selector]})`);};
 for(const view of views){await click(view);await settle();if(view==='Advanced')await page.locator('.analysis-surface canvas').waitFor();if(view==='Video')await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();if(view==='AI Driving Coach')await expect(page.locator('.coach-card')).toHaveCount(3);}
 await click('Telemetry');await settle();
 await page.getByRole('button',{name:/^Channels/}).click();await page.getByRole('checkbox',{name:/RPM/}).uncheck();await page.getByRole('button',{name:/^Channels/}).click();
 await expect(page.locator('.plot-row:not([hidden])')).toHaveCount(1);
 await page.evaluate(()=>window.auditPrimaryPlot=document.querySelector('.uplot'));
 const pairs=[];
 for(const [width,height] of [[1440,1000],[600,500]]){
  await page.setViewportSize({width,height});await settle();
  for(const from of views)for(const to of views.filter(v=>v!==from)){
   await click(from);await settle();
   const viewport=page.locator('.workspace-viewport');
   await viewport.evaluate(el=>el.scrollTop=Math.min(110,el.scrollHeight-el.clientHeight));
   const shell=await geometry(),index=await page.evaluate(()=>window.auditTransitions.length);
   await click(to);await expect(page.locator('.workspace-switch button[aria-pressed=true]')).toHaveText(to);
   stable(shell,await geometry(),`${from} → ${to} at ${width}`);
   await settle();stable(shell,await geometry(),`${from} → ${to} settled at ${width}`);
   assert(await page.evaluate(()=>window.auditPrimaryPlot===document.querySelector('.uplot')),'Switching visible context channels retains the primary telemetry plot');
   assert.equal(await page.locator('main').evaluate(el=>el.scrollTop),0,'The stationary shell never scrolls during navigation');
   assert(await viewport.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Workspace content has no horizontal overflow');
   const record=await page.evaluate(i=>window.auditTransitions[i],index);
   assert(record?.committedAt!=null,'Each different workspace commits through one transition controller');
   assert.equal(record.animations.length,1,'There is exactly one outgoing snapshot over live incoming content');
   for(const animation of record.animations){assert(animation.duration>=180&&animation.duration<=280);assert(!animation.keyframes.some(k=>/translate/.test(k.transform??'')),'Workspace snapshots never slide');}
   pairs.push({from,to,width,height});
  }
  await page.screenshot({path:`${output}/settled-${width}x${height}.png`});
 }
 console.log(`PASS: ${pairs.length} ordered workspace/viewport transitions with stationary shell`);
 await page.setViewportSize({width:1440,height:1000});await click('Telemetry');await settle();
 await page.waitForTimeout(190);await page.evaluate(()=>{window.auditPauseTransition=true;window.auditPausedAnimations=[];});
 const beforeFrames=await geometry();await click('AI Driving Coach');
 await page.waitForFunction(()=>window.auditPausedAnimations.length===1);
 const frames=[];
 for(const time of [0,55,110,165,219]){
  const frame=await page.evaluate(time=>{for(const animation of window.auditPausedAnimations)animation.currentTime=time;const viewport=document.querySelector('.workspace-viewport'),r=viewport.getBoundingClientRect();return {time,old:getComputedStyle(document.documentElement,'::view-transition-old(workspace-content)').opacity,incoming:getComputedStyle(viewport).opacity,liveHit:viewport.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),rootName:getComputedStyle(document.documentElement).viewTransitionName,liveTransform:getComputedStyle(document.querySelector('.workspace-body')).transform};},time);
  assert.equal(frame.rootName,'none','No root/shell snapshot participates');assert.equal(frame.liveTransform,'none','Live chart coordinates are never transformed');
  assert.equal(frame.incoming,'1','Incoming content stays fully rendered');assert(frame.liveHit,'Incoming content remains hit-testable throughout the snapshot');
  if(time===110)assert(Number(frame.old)>0&&Number(frame.old)<1);
  stable(beforeFrames,await geometry(),`Frozen transition frame ${time}ms`);
  await page.screenshot({path:`${output}/frame-${String(time).padStart(3,'0')}ms.png`,animations:'allow'});frames.push(frame);
 }
 await page.evaluate(()=>{window.auditPauseTransition=false;for(const animation of window.auditPausedAnimations)animation.finish();});await settle();
 // The controller may never queue older view updates behind a newer intent.
 await page.evaluate(async()=>{const tabs=[...document.querySelectorAll('.workspace-switch button')];for(let i=0;i<24;i++){tabs[i%4].click();await new Promise(resolve=>setTimeout(resolve,12));}tabs[0].click();});
 await expect(page.locator('.workspace-switch button[aria-pressed=true]')).toHaveText('Telemetry');await settle();
 assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>/^workspace-(in|out)$/.test(a.animationName??'')).length),0,'Interrupted transition layers are released');
 await page.waitForTimeout(80);await expect(page.locator('.workspace-switch button[aria-pressed=true]')).toHaveText('Telemetry');
 // Keep shared chart and local Advanced state, while suppressing hidden drawing.
 await click('Advanced');await settle();const canvas=page.locator('.analysis-surface canvas');await canvas.waitFor();
 await canvas.hover({position:{x:150,y:100}});await page.mouse.wheel(0,-180);await page.waitForTimeout(80);
 await page.evaluate(()=>{window.auditCanvas=document.querySelector('.analysis-surface canvas');window.auditZoomLabels=window.auditCanvasLabels.get(window.auditCanvas);});
 await click('Telemetry');await settle();
 const hidden=await page.evaluate(()=>({draws:window.auditCanvasDraws.get(window.auditCanvas),requests:window.auditCalls.filter(c=>c.cmd==='analyze_advanced').length}));
 const over=page.locator('.u-over').first();await over.scrollIntoViewIfNeeded();const rect=await over.boundingBox();
 for(let i=0;i<12;i++)await page.mouse.move(rect.x+rect.width*(.15+i*.05),rect.y+20);
 assert.deepEqual(await page.evaluate(()=>({draws:window.auditCanvasDraws.get(window.auditCanvas),requests:window.auditCalls.filter(c=>c.cmd==='analyze_advanced').length})),hidden,'Hidden Advanced does not draw or compute');
 await click('Advanced');await settle();
 assert(await page.evaluate(()=>window.auditCanvas===document.querySelector('.analysis-surface canvas')),'Advanced canvas remains mounted');
 assert.deepEqual(await page.evaluate(()=>window.auditCanvasLabels.get(window.auditCanvas)),await page.evaluate(()=>window.auditZoomLabels),'Advanced local zoom survives navigation');
 await click('Video');await settle();await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
 await page.evaluate(()=>{window.auditVideo=document.querySelector('video');window.auditVideo.currentTime=7;});await page.getByRole('button',{name:'Play',exact:true}).click();
 await click('Telemetry');await settle();assert(await page.evaluate(()=>window.auditVideo.paused),'Video pauses on workspace departure');
 await click('Video');await settle();assert(await page.evaluate(()=>window.auditVideo===document.querySelector('video')),'Video attachment is retained');assert.equal(await page.evaluate(()=>window.auditVideo.currentTime),7);
 const saved=await page.evaluate(()=>window.auditEntry.workspace);assert.equal(saved.primary,'lap-1');assert.equal(saved.comparison,'lap-2');assert.deepEqual(saved.channels,['speed']);
 // A running local job may complete while hidden; navigation must not cancel it
 // or discard the result/card nodes when returning to Coach.
 await click('AI Driving Coach');await settle();
 const coachBefore=await page.evaluate(()=>{window.auditCoachCard=document.querySelector('.coach-card');window.auditHoldCoach=true;return {analyses:window.auditCalls.filter(c=>c.cmd==='analyze_driving_coach').length,cancels:window.auditCalls.filter(c=>c.cmd==='cancel_driving_coach').length};});
 await page.getByRole('button',{name:'Analyze',exact:true}).click();await expect(page.getByRole('button',{name:'Cancel analysis',exact:true})).toBeVisible();
 await click('Telemetry');await settle();
 assert.equal(await page.evaluate(()=>window.auditCalls.filter(c=>c.cmd==='cancel_driving_coach').length),coachBefore.cancels,'Switching workspaces does not cancel local inference');
 await page.evaluate(()=>{window.auditHoldCoach=false;window.auditCoachResolvers.splice(0).forEach(resolve=>resolve());});
 await click('AI Driving Coach');await settle();await expect(page.locator('.coach-progress')).toContainText('Analysis complete');
 assert.equal(await page.evaluate(()=>window.auditCalls.filter(c=>c.cmd==='analyze_driving_coach').length),coachBefore.analyses+1,'A completed hidden job is reused without another analysis');
 assert(await page.evaluate(()=>window.auditCoachCard===document.querySelector('.coach-card')),'Existing AI recommendation nodes remain mounted');
 await page.waitForTimeout(190);await page.evaluate(()=>{window.auditPauseTransition=true;window.auditPausedAnimations=[];});await click('Telemetry');await page.waitForFunction(()=>window.auditPausedAnimations.length===1);await page.setViewportSize({width:1000,height:700});
 await expect.poll(()=>page.evaluate(()=>document.getAnimations().filter(a=>/^workspace-(in|out)$/.test(a.animationName??'')).length)).toBe(0);await page.evaluate(()=>window.auditPauseTransition=false);
 await page.emulateMedia({reducedMotion:'reduce'});const beforeReduced=await page.evaluate(()=>window.auditTransitions.length);await click('AI Driving Coach');await expect(page.locator('.coach-card')).toHaveCount(3);
 assert.equal(await page.evaluate(()=>window.auditTransitions.length),beforeReduced,'Reduced motion commits without a snapshot animation');
 await page.emulateMedia({reducedMotion:'no-preference'});
 // Pointer and wheel input must release even a deliberately paused snapshot;
 // a timeout would expose listeners that were bound before the viewport mounted.
 for(const input of ['pointerdown','wheel']){
  await click('Telemetry');await settle();await page.locator('.workspace-viewport').evaluate(el=>el.scrollTop=0);
  const density=page.getByTitle('Toggle graph density');const densityBounds=await density.boundingBox();
  const beforeLayout=await density.textContent();
  await click('AI Driving Coach');await settle();
  const bounds=await page.locator('.workspace-viewport').boundingBox();
  const point=input==='pointerdown'?{x:densityBounds.x+densityBounds.width/2,y:densityBounds.y+densityBounds.height/2}:{x:bounds.x+bounds.width-12,y:bounds.y+80};
  await page.mouse.move(point.x,point.y);
  // Park before switching so pointermove cannot conceal a lost first gesture.
  await page.waitForTimeout(190);await page.evaluate(()=>{window.auditPauseTransition=true;window.auditPausedAnimations=[];[...document.querySelectorAll('.workspace-switch button')].find(button=>button.textContent==='Telemetry').click();});await page.waitForFunction(()=>window.auditPausedAnimations.length===1);
  assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>/^workspace-(in|out)$/.test(a.animationName??'')).length),1,`${input} starts from a live paused outgoing snapshot`);
  if(input==='pointerdown'){await page.mouse.down();await page.mouse.up();}else await page.mouse.wheel(0,100);
  await expect.poll(()=>page.evaluate(()=>document.getAnimations().filter(a=>/^workspace-(in|out)$/.test(a.animationName??'')).length),{timeout:1000}).toBe(0);
  await page.evaluate(()=>window.auditPauseTransition=false);await settle();
  if(input==='pointerdown')await expect(density).not.toHaveText(beforeLayout);
  else await expect.poll(()=>page.locator('.workspace-viewport').evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 }
 // Hold the native update boundary so a newer intent can supersede an inspection
 // before it commits. No focus/channel/seek side effect may leak from the old intent.
 await click('AI Driving Coach');await settle();
 const beforeCancel=await page.evaluate(()=>({primary:window.auditEntry.workspace.primary,comparison:window.auditEntry.workspace.comparison,channels:window.auditEntry.workspace.channels,zoom:window.auditEntry.workspace.zoom}));
 await page.waitForTimeout(190);await page.evaluate(()=>{window.auditHoldUpdates=true;window.auditHeldUpdates=[];document.querySelector('.coach-card button').click();[...document.querySelectorAll('.workspace-switch button')].find(button=>button.textContent==='Advanced').click();});
 await page.waitForFunction(()=>window.auditHeldUpdates.length>0);
 await page.evaluate(()=>{window.auditHoldUpdates=false;window.auditHeldUpdates.splice(0).forEach(resolve=>resolve());});await settle();await expect(page.locator('.workspace-switch button[aria-pressed=true]')).toHaveText('Advanced');
 assert.deepEqual(await page.evaluate(()=>({primary:window.auditEntry.workspace.primary,comparison:window.auditEntry.workspace.comparison,channels:window.auditEntry.workspace.channels,zoom:window.auditEntry.workspace.zoom})),beforeCancel,'Superseded inspection leaves no selection/channel/zoom intent');
 await expect(page.locator('.alignment-note')).not.toContainText('Focus:');
 await click('AI Driving Coach');await settle();
 await page.waitForTimeout(190);await page.evaluate(()=>{window.auditHoldUpdates=true;window.auditHeldUpdates=[];const buttons=[...document.querySelectorAll('.coach-card-footer button')];buttons[0].click();buttons[1].click();});
 await page.waitForFunction(()=>window.auditHeldUpdates.length>0);
 await page.evaluate(()=>{window.auditHoldUpdates=false;window.auditHeldUpdates.splice(0).forEach(resolve=>resolve());});await settle();
 await expect(page.locator('.workspace-switch button[aria-pressed=true]')).toHaveText('Video');
 await expect.poll(()=>page.evaluate(()=>document.querySelector('video').currentTime)).toBeCloseTo(12.5,3);
 await expect.poll(()=>page.evaluate(()=>window.auditEntry.workspace.zoom?.min??-1)).toBeGreaterThan(100);
 const coldCoach=await browser.newPage({viewport:{width:1440,height:1000}});coldCoach.on('pageerror',e=>errors.push(e.message));await coldCoach.addInitScript(installWorkspaceFixture,{initialView:'coach'});await coldCoach.goto(`${server.resolvedUrls.local[0]}tests/advanced.html`);
 await expect(coldCoach.locator('.coach-card')).toHaveCount(3);await coldCoach.waitForFunction(()=>window.auditCalls.some(c=>c.cmd==='analyze_session'));
 assert.equal(await coldCoach.evaluate(()=>window.auditPlotConstructs),0,'Opening a saved Coach workspace constructs no hidden telemetry plots');await expect(coldCoach.locator('.uplot')).toHaveCount(0);
 await coldCoach.locator('.lap-select').nth(1).click();await coldCoach.waitForFunction(()=>window.auditCalls.some(c=>c.cmd==='analyze_session'&&c.args.primaryId==='lap-2'));
 assert.equal(await coldCoach.evaluate(()=>window.auditPlotConstructs),0,'Changing lap analysis while initially in Coach constructs no hidden telemetry plots');await expect(coldCoach.locator('.uplot')).toHaveCount(0);
 await coldCoach.getByRole('button',{name:'Telemetry',exact:true}).click();await expect(coldCoach.locator('.uplot')).toHaveCount(2);await expect.poll(()=>coldCoach.evaluate(()=>window.auditPlotConstructs)).toBe(2);await coldCoach.close();
 // Profile independently after warm-up; timing is presentation-only, IPC is mocked.
 const sample=async(run)=>{
  await page.evaluate(()=>{window.auditFrameValues=[];window.auditLongTasks=[];window.auditSampling=true;if(PerformanceObserver.supportedEntryTypes.includes('longtask')){window.auditObserver=new PerformanceObserver(list=>window.auditLongTasks.push(...list.getEntries().map(e=>e.duration)));window.auditObserver.observe({type:'longtask',buffered:false});}let last;const tick=time=>{if(last)window.auditFrameValues.push(time-last);last=time;if(window.auditSampling)requestAnimationFrame(tick);};requestAnimationFrame(tick);});
  await run();return page.evaluate(()=>{window.auditSampling=false;window.auditObserver?.disconnect();const frames=window.auditFrameValues.sort((a,b)=>a-b);return {frames:frames.length,medianMs:frames[Math.floor(frames.length*.5)],p95Ms:frames[Math.floor(frames.length*.95)],maximumMs:frames.at(-1),longTasksMs:window.auditLongTasks};});
 };
 const idle=await sample(()=>page.waitForTimeout(1000));
 const switching=await sample(()=>page.evaluate(async()=>{const tabs=[...document.querySelectorAll('.workspace-switch button')];for(let i=0;i<24;i++){tabs[i%4].click();await new Promise(resolve=>setTimeout(resolve,65));}}));await settle();
 const fallback=await browser.newPage({viewport:{width:600,height:500}});fallback.on('pageerror',e=>errors.push(e.message));await fallback.addInitScript(installWorkspaceFixture,{disableTransitions:true});await fallback.goto(`${server.resolvedUrls.local[0]}tests/advanced.html`);await fallback.locator('.workspace-viewport').waitFor();
 for(const view of views){await fallback.getByRole('button',{name:view,exact:true}).click();await expect(fallback.locator('.workspace-switch button[aria-pressed=true]')).toHaveText(view);}assert.equal(await fallback.evaluate(()=>window.auditTransitions.length),0);await fallback.close();
 assert.deepEqual(errors,[]);
 const results={engine:'Chromium',boundary:'Simulated native IPC and media clock; numerical presentation fixture, not an XRK benchmark',seriesSamples:2001,comparedSeries:4,advancedPointsPerLap:1024,pairs,frames,idle,switching,checks:['stationary shell across all 12 ordered pairs at desktop and minimum size','captured outgoing snapshot frames over interactive incoming content','live chart coordinate space untransformed','rapid interruption releases old transitions','Advanced canvas/zoom retention and zero hidden work','video element/time retained and departure pauses','local inference completes while hidden and its result is retained','first parked click and wheel reach live incoming content during a paused snapshot','superseded inspection leaves no stale intent; latest same-destination inspection wins','initial saved Coach and hidden lap changes construct zero plots','resize interruption','reduced motion','unsupported-engine immediate fallback','selected laps and channels preserved']};
 writeFileSync(`${output}/metrics.json`,JSON.stringify(results,null,2));console.log(JSON.stringify({checks:results.checks,idle,switching},null,2));
}finally{await browser?.close();server?.httpServer?.closeIdleConnections();server?.httpServer?.closeAllConnections();await server?.close();}
