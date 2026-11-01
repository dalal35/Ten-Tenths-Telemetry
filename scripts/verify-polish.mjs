// Render the production entry point with read-only, native-derived XRK results.
// This measures browser presentation, not native inference or video decoding.
import {createServer} from 'vite';
import {launchBrowser} from './browser.mjs';
import {expect} from '@playwright/test';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';

assert(process.env.COACH_UI_DATA,'Set COACH_UI_DATA to coach_check JSON from a real XRK recording.');
const data=JSON.parse(readFileSync(process.env.COACH_UI_DATA,'utf8'));
let server,browser;
try{
 server=await createServer({optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime','motion/react']},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});
 await server.listen();browser=await launchBrowser();
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(d=>{
  const primary=d.report.referenceLapId,channels=d.analyses[`${primary}:distance`].primary.series.map(s=>s.channelId);
  const entry={...d.session,contentVersion:'polish',lapCount:d.session.laps.length,channelCount:d.session.channels.length,status:'ready',workspace:{contentVersion:'polish',primary,comparison:null,view:'telemetry',axis:'distance',channels},lastUsed:0};
  window.isTauri=true;window.polishCalls=[];
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,invoke:async(cmd,args={})=>{
   window.polishCalls.push(cmd);
   if(cmd.startsWith('plugin:event'))return 1;
   if(cmd==='library_snapshot')return {entries:[entry],activeSessionId:d.session.id,warnings:[]};
   if(cmd==='load_library_session')return d.session;
   if(cmd==='save_workspace'){entry.workspace=args.workspace;return;}
   if(cmd==='analyze_session'){
    const result=structuredClone(d.analyses[`${args.primaryId}:${args.axis}`]);
    result.comparison=args.comparisonId?structuredClone(d.analyses[`${args.comparisonId}:${args.axis}`].primary):null;
    for(const view of [result.primary,result.comparison].filter(Boolean))view.series=view.series.filter(s=>args.channelIds.includes(s.channelId));
    return result;
   }
   if(cmd==='driving_coach_model_terms')return {version:'polish',terms:'Fixture terms',policy:'Fixture policy'};
   if(cmd==='analyze_driving_coach')return {report:d.report,explanations:[],mode:'deterministic',modelVersion:'polish',notice:'Recorded telemetry evidence',cached:true,elapsedMs:0,targetLapSeconds:null,inferenceMetrics:null};
   if(cmd==='cancel_driving_coach')return;
   if(cmd==='driving_coach_status')return {jobId:null,phase:'Idle'};
   if(cmd==='validate_formulas')return [];
   if(cmd==='analyze_advanced')throw Error('Advanced computation is outside this presentation replay.');
   throw Error(`Unexpected polish IPC: ${cmd}`);
  }};
 },data);
 await page.goto(server.resolvedUrls.local[0]);await page.locator('.uplot').first().waitFor();
 await page.evaluate(()=>window.initialPolishPlot=document.querySelector('.uplot'));
 for(const view of ['AI Driving Coach','Video','Advanced','Telemetry']){
  await page.getByRole('button',{name:view,exact:true}).click();
  assert(await page.evaluate(()=>window.initialPolishPlot===document.querySelector('.uplot')),'Workspace navigation must retain the mounted telemetry plots');
 }
 mkdirSync('test-results/polish',{recursive:true});
 const views=['Telemetry','Advanced','Video','AI Driving Coach'];
 for(const [width,height] of [[1600,1000],[1024,640],[600,500]]){
  await page.setViewportSize({width,height});
  for(const view of views){
   await page.getByRole('button',{name:view,exact:true}).click();
   if(view==='AI Driving Coach')await page.locator('.coach-overview').waitFor();
   await expect.poll(()=>page.locator('main').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
   await page.screenshot({path:`test-results/polish/${view.split(' ')[0].toLowerCase()}-${width}x${height}.png`,animations:'disabled'});
  }
 }
 await page.getByRole('button',{name:'Telemetry',exact:true}).click();
 await page.setViewportSize({width:1600,height:1000});await page.locator('.uplot').first().waitFor();
 // Scroll memory must survive navigation and must not animate scroll restoration.
 const scroll=await page.locator('.workspace-viewport').evaluate(el=>{el.scrollTop=170;return el.scrollTop;});
 await expect.poll(()=>page.locator('.workspace-viewport').evaluate(el=>el.scrollTop)).toBe(scroll);
 await page.getByRole('button',{name:'AI Driving Coach',exact:true}).click();
 await page.getByRole('button',{name:'Telemetry',exact:true}).click();
 await expect.poll(()=>page.locator('.workspace-viewport').evaluate(el=>el.scrollTop)).toBe(scroll);
 await page.locator('.workspace-viewport').evaluate(el=>el.scrollTop=0);
 // Collect frame intervals while interrupting transitions faster than their duration.
 await page.evaluate(()=>{
  window.polishFrames=[];window.polishLongTasks=[];window.polishRecording=true;
  if(PerformanceObserver.supportedEntryTypes.includes('longtask')){
   window.polishObserver=new PerformanceObserver(list=>window.polishLongTasks.push(...list.getEntries().map(e=>e.duration)));
   window.polishObserver.observe({type:'longtask',buffered:false});
  }
  let previous;const tick=time=>{if(previous)window.polishFrames.push(time-previous);previous=time;if(window.polishRecording)requestAnimationFrame(tick);};requestAnimationFrame(tick);
 });
 for(let i=0;i<18;i++){
  await page.getByRole('button',{name:i%2?'Telemetry':'AI Driving Coach',exact:true}).click();
  await page.waitForTimeout(70);
 }
 const frameSummary=await page.evaluate(()=>{
  window.polishRecording=false;window.polishObserver?.disconnect();
  const frames=window.polishFrames.sort((a,b)=>a-b),percentile=p=>frames[Math.min(frames.length-1,Math.floor(frames.length*p))];
  return {frames:frames.length,medianMs:percentile(.5),p95Ms:percentile(.95),maxMs:frames.at(-1),over25Ms:frames.filter(v=>v>25).length,longTasksMs:window.polishLongTasks};
 });
 await page.getByRole('button',{name:'Telemetry',exact:true}).click();
 const over=page.locator('.u-over').first();await over.scrollIntoViewIfNeeded();const rect=await over.boundingBox();
 const calls=await page.evaluate(()=>window.polishCalls.filter(c=>c==='analyze_session').length);
 await page.evaluate(()=>window.polishPlot=document.querySelector('.uplot'));
 for(let i=0;i<60;i++)await page.mouse.move(rect.x+rect.width*(i/60),rect.y+20);
 assert.equal(await page.evaluate(()=>window.polishCalls.filter(c=>c==='analyze_session').length),calls,'Cursor inspection must not request new analysis');
 assert(await page.evaluate(()=>window.polishPlot===document.querySelector('.uplot')),'Cursor inspection must not reconstruct plots');
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.getByRole('button',{name:'AI Driving Coach',exact:true}).click();
 await expect(page.locator('.coach-overview')).toBeVisible();
 await expect.poll(()=>page.locator('.chart-workspace').evaluate(el=>el.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
 await page.screenshot({path:'test-results/polish/reduced-motion.png',animations:'disabled'});
 await page.setViewportSize({width:600,height:500});await page.getByRole('button',{name:'Open session explorer',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Session explorer',exact:true})).toBeVisible();
 await page.keyboard.press('Shift+Tab');assert(await page.evaluate(()=>!!document.activeElement?.closest('[role=dialog]')));
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Open session explorer',exact:true})).toBeFocused();
 assert.deepEqual(errors,[]);
 const analysis=data.analyses[`${data.report.referenceLapId}:distance`];
 const report={fixture:{laps:data.session.laps.length,channels:data.session.channels.length,renderedSeries:analysis.primary.series.map(s=>({channel:s.name,samples:s.x.length}))},viewport:[1600,1000],frameSummary,checks:['minimum-window overflow','all four workspace surfaces','workspace scroll restoration','rapid interrupted navigation','chart cursor no IPC or reconstruction','reduced motion','drawer focus trap and Escape'],limitations:['Recorded XRK analysis replay; native IPC mocked','Advanced error state exercised; numerical Advanced rendering covered by verify-sidebar','No simultaneous native inference or real video decoding','Headless Chromium rAF timing is not a GPU presentation guarantee; WebKit/WebView2 not measured']};
 writeFileSync('test-results/polish/metrics.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser?.close();await server?.close();}
