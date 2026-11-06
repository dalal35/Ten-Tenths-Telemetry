import {launchBrowser,browserTestEntries,browserTestNoWatch} from './browser.mjs';
// Real React acceptance coverage; only the native IPC/media boundary is simulated.
import {expect} from '@playwright/test';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';

let server, browser;
try {
  mkdirSync('.tools', {recursive:true});
  server=await createServer({configLoader:'runner',plugins:[browserTestNoWatch],optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}});
  await server.listen();
  console.log('Motion verification: Vite ready');
  browser=await launchBrowser();
  console.log('Motion verification: browser launched');
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.setDefaultTimeout(6000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.isTauri=true;window.sidebarCalls=[];
    // Capture the rendered advanced axis labels to verify its local zoom, too.
    window.sidebarCanvasTicks=new WeakMap();
    window.sidebarCanvasDraws=new WeakMap();
    const clear=CanvasRenderingContext2D.prototype.clearRect,text=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.clearRect=function(...args){window.sidebarCanvasTicks.set(this.canvas,[]);window.sidebarCanvasDraws.set(this.canvas,(window.sidebarCanvasDraws.get(this.canvas)??0)+1);return clear.apply(this,args);};
    CanvasRenderingContext2D.prototype.fillText=function(...args){window.sidebarCanvasTicks.get(this.canvas)?.push(String(args[0]));return text.apply(this,args);};
    const laps=Array.from({length:24},(_,i)=>({id:`lap-${i+1}`,number:i+1,duration:10+i,start:i*10,end:i*10+10+i,complete:i!==23}));
    const channels=[{id:'speed',name:'GPS Speed',unit:'m/s',times:[0,5,10],values:[10,15,20]},{id:'rpm',name:'RPM',unit:'rpm',times:[0,5,10],values:[1000,3000,2000]}];
    const sessions=Array.from({length:100},(_,i)=>({id:`session-${i}`,name:i===0?'A very long recording title '.repeat(10):`Recording ${i}`,track:i===99?'':i===0?'Circuit with a very long name '.repeat(8):`Circuit ${i.toString().padStart(3,'0')}`,driver:i===99?'':i%2?'alice':'Bob',source:`/fixture/${i}.xrk`,recordedAt:i===99?'invalid date':`2026-10-${String(14-Math.floor(i/20)).padStart(2,'0')} 12:${String(59-i%20).padStart(2,'0')}:00`,warnings:[],laps,channels}));
    const initial={entries:sessions.map((s,i)=>({...s,lapCount:24,channelCount:2,status:i===97?'modified':i===98?'missing':'ready',contentVersion:'v1',workspace:null,lastUsed:1})),activeSessionId:'session-0',warnings:[]};
    const read=()=>JSON.parse(localStorage.getItem('sidebar-library')||JSON.stringify(initial));
    const write=db=>localStorage.setItem('sidebar-library',JSON.stringify(db));
    window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
    window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,convertFileSrc:path=>`https://asset.localhost/${encodeURIComponent(path)}`,invoke:async(cmd,args={})=>{
      window.sidebarCalls.push({cmd,args});const db=read();
      if(cmd.startsWith('plugin:event'))return 1;
      if(cmd==='library_snapshot')return db;
      if(cmd==='load_library_session'){db.activeSessionId=args.sessionId;write(db);return {...sessions.find(s=>s.id===args.sessionId),...db.entries.find(e=>e.id===args.sessionId)};}
      if(cmd==='update_library_details'){if(args.name==='Fail save')throw Error('Fixture save failure');const entry=db.entries.find(e=>e.id===args.sessionId);Object.assign(entry,{name:args.name.trim(),driver:args.driver.trim(),recordedAt:args.recordedAt});write(db);return entry;}
      if(cmd==='save_workspace'){db.entries.find(e=>e.id===args.sessionId).workspace=args.workspace;write(db);return;}
      if(cmd==='plugin:dialog|open')return '/fixture/onboard.mp4';
      if(cmd==='authorize_local_video')return {path:args.path,size:100,modifiedMs:1,status:'ready'};
      if(cmd==='validate_formulas')return [];
      if(cmd==='preview_merge_sessions')throw Error('Fixture preview rejection: retry remains available');
      if(cmd==='analyze_advanced'){
        const stats={count:3,duration:10,min:0,max:20,mean:10,median:10,p05:0,p95:20,absoluteP95:20};
        return {tool:args.request.tool,xUnit:'rpm',yUnit:'m/s',notes:[],laps:[args.primaryId,...(args.comparisonId?[args.comparisonId]:[])].map(lapId=>({lapId,points:[0,5,10].map((v,i)=>({sourceTime:v,position:v*10,x:1000+i*1000,y:10+i*5,color:null})),stats,yStats:stats,histogram:[{low:0,high:10,value:3}],events:[],excludedCount:0}))};
      }
      if(cmd==='analyze_session'){
        const view=lapId=>({lapId,duration:10,length:100,mapping:[{meters:0,time:0},{meters:50,time:5},{meters:100,time:10}],track:[{x:0,y:0,position:0,speed:10},{x:50,y:20,position:50,speed:15},{x:100,y:0,position:100,speed:20}],warnings:[],series:args.channelIds.map(id=>({...channels.find(c=>c.id===id),channelId:id,x:args.axis==='time'?[0,5,10]:[0,50,100],values:id==='rpm'?[1000,3000,2000]:[10,15,20]}))});
        const metrics={elapsed:5,entrySpeed:10,minSpeed:10,exitSpeed:20,channels:[]};
        return {primary:view(args.primaryId),comparison:args.comparisonId?view(args.comparisonId):null,cornerBoundaries:null,alignment:{method:'spatial',coverage:1,notes:[]},segments:[{id:'corner',label:'Corner 1',kind:'corner',start:0,end:50,startMeters:0,endMeters:50,uncertaintyMeters:5,primary:metrics,comparison:args.comparisonId?metrics:null,deltaSeconds:null}],delta:null,warnings:[]};
      }
      throw Error(`Unexpected sidebar IPC: ${cmd}`);
    }};
    const times=new WeakMap(),rates=new WeakMap(),sources=new WeakMap();
    Object.defineProperties(HTMLVideoElement.prototype,{videoWidth:{get(){return 1920;}},videoHeight:{get(){return 1080;}}});
    Object.defineProperties(HTMLMediaElement.prototype,{
      src:{get(){return sources.get(this)??'';},set(value){sources.set(this,value);}},duration:{get(){return 600;}},currentTime:{get(){return times.get(this)??0;},set(value){times.set(this,value);this.dispatchEvent(new Event('timeupdate'));queueMicrotask(()=>this.dispatchEvent(new Event('seeked')));}},playbackRate:{get(){return rates.get(this)??1;},set(value){rates.set(this,value);this.dispatchEvent(new Event('ratechange'));}},paused:{get(){return !this.dataset.playing;}}
    });
    HTMLMediaElement.prototype.load=function(){if(sources.has(this))queueMicrotask(()=>this.dispatchEvent(new Event('loadedmetadata')));};
    HTMLMediaElement.prototype.play=async function(){this.dataset.playing='1';this.dispatchEvent(new Event('playing'));};
    HTMLMediaElement.prototype.pause=function(){delete this.dataset.playing;this.dispatchEvent(new Event('pause'));};
  });
  await page.goto(server.resolvedUrls.local[0]);
  await page.locator('.uplot').first().waitFor().catch(async error=>{console.error('Initial render:',errors,await page.locator('body').innerText());throw error;});
  console.log('Motion verification: page loaded');
  // Selection glides on one persistent glass plate; charts keep their DOM nodes.
  const sample=(selector,ms=700)=>page.evaluate(({selector,ms})=>new Promise(resolve=>{
    const out=[],t0=performance.now();
    const tick=()=>{const element=document.querySelector(selector),rect=element?.getBoundingClientRect();out.push({t:performance.now()-t0,x:rect?.x,y:rect?.y,count:document.querySelectorAll(selector).length});if(performance.now()-t0<ms)requestAnimationFrame(tick);else resolve(out);};
    tick();
  }),{selector,ms});
  // Dispatch inside the page: Playwright's own click pauses frames and would hide the glide.
  const press=locator=>locator.evaluate(el=>el.click());
  const glide=async(label,selector,axis,act)=>{
    const run=sample(selector);await page.waitForTimeout(40);await act();const frames=await run;
    const values=frames.map(f=>f[axis]).filter(v=>v!==undefined),start=values[0],end=values.at(-1);
    assert.ok(Math.abs(end-start)>8,`${label}: plate moved (${start}→${end})`);
    const between=values.filter(v=>Math.abs(v-start)>1&&Math.abs(v-end)>1);
    assert.ok(between.length>=2,`${label}: plate glides through intermediate positions (${between.length} frames)`);
    const direction=Math.sign(end-start),monotone=values.every((v,i)=>i===0||(v-values[i-1])*direction>=-.75);
    assert.ok(monotone,`${label}: no overshoot or bounce`);
    assert.ok(frames.every(f=>f.count<=2),`${label}: at most one plate plus its outgoing twin`);
    assert.equal(frames.at(-1).count,1,`${label}: a single plate remains`);
    console.log(`Motion verification: ${label} glided ${Math.round(Math.abs(end-start))}px through ${between.length} frames`);
  };
  await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(200);
  // A lap, reference or axis change re-requests the analysis and App clears it, so the plots remount by design today.
  // What this check protects: rows keep their DOM through selection, and the chart survives workspace navigation.
  const tagChart=()=>page.evaluate(()=>{window.chartNode=document.querySelector('.uplot');});
  const sameChart=()=>page.evaluate(()=>window.chartNode===document.querySelector('.uplot')&&document.contains(window.chartNode));
  await page.evaluate(()=>{window.rowNodes=[...document.querySelectorAll('.lap-row')];});
  const sameRows=()=>page.evaluate(()=>window.rowNodes.every((row,i)=>row===document.querySelectorAll('.lap-row')[i]));
  const rows=page.locator('.lap-row'),laps=page.locator('.lap-row .lap-select');
  const target=await laps.nth(5).evaluate(el=>el.closest('.lap-row').querySelector('.lap-number').textContent);
  await glide('Lap selection','.lap-row .selection-plate.primary','y',()=>press(laps.nth(5)));
  await expect(page.locator('.lap-row.selected .lap-number')).toHaveText(target);
  await page.waitForTimeout(450);
  const geometry=await page.evaluate(()=>{const plate=document.querySelector('.lap-row .selection-plate.primary').getBoundingClientRect(),row=document.querySelector('.lap-row.selected').getBoundingClientRect();return {plate:plate.y,row:row.y,plateHeight:plate.height,rowHeight:row.height};});
  assert.ok(Math.abs(geometry.plate-(geometry.row-1))<=1.5&&Math.abs(geometry.plateHeight-(geometry.rowHeight+2))<=2,`Lap plate settles on the selected row ${JSON.stringify(geometry)}`);
  assert.ok(await sameRows(),'Lap selection keeps every lap row mounted');
  await rows.nth(8).hover();await page.locator('.lap-row').nth(8).locator('.compare-toggle').click();
  await expect(page.locator('.lap-row.compared .reference-mark')).toHaveCount(1);
  await glide('Reference badge','.reference-mark','y',()=>press(page.locator('.lap-row').nth(10).locator('.compare-toggle')));
  await expect(page.locator('.lap-row.compared .reference-mark')).toHaveCount(1);
  assert.ok(await sameRows(),'Reference change keeps every lap row mounted');
  await glide('Workspace tab','.workspace-selection','x',()=>press(page.locator('.workspace-switch button',{hasText:'Advanced'})));
  await expect(page.locator('.workspace-switch button[aria-pressed=true]')).toContainText('Advanced');
  await glide('Tool tab','.advanced-nav .control-selection','x',()=>press(page.locator('.tool-tabs button').nth(2)));
  await page.locator('.workspace-switch button',{hasText:'Telemetry'}).click();await page.waitForTimeout(600);await tagChart();
  await page.locator('.workspace-switch button',{hasText:'Advanced'}).click();await page.waitForTimeout(300);await page.locator('.workspace-switch button',{hasText:'Telemetry'}).click();await page.waitForTimeout(450);
  assert.ok(await sameChart(),'Telemetry → Advanced → Telemetry keeps the chart mounted');
  await glide('Axis switch','.chart-toolbar .axis-switch .control-selection','x',()=>press(page.locator('.chart-toolbar .axis-switch button',{hasText:'Time'})));
  // Hover lifts a standalone control by one pixel; tabs never move under their plate.
  const channels=page.locator('.channel-control>button');await channels.hover();await page.waitForTimeout(400);
  assert.equal(await channels.evaluate(el=>getComputedStyle(el).translate),'0px -1px','Hover lifts standalone controls');
  await page.locator('.workspace-switch button',{hasText:'Advanced'}).hover();await page.waitForTimeout(300);
  assert.equal(await page.locator('.workspace-switch button',{hasText:'Advanced'}).evaluate(el=>getComputedStyle(el).translate),'none','Tabs stay still on hover');
  // Reduced motion removes the glide but not the state change.
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);
  {
    const run=sample('.lap-row .selection-plate.primary',500);await page.waitForTimeout(40);await press(laps.nth(2));const frames=await run,ys=frames.map(f=>f.y);
    const between=ys.filter(v=>Math.abs(v-ys[0])>1&&Math.abs(v-ys.at(-1))>1);
    assert.ok(between.length<=1,`Reduced motion jumps straight to the selection (${between.length} intermediate frames)`);
    await expect(page.locator('.lap-row.selected')).toBeVisible();
  }
  await page.emulateMedia({reducedMotion:'no-preference'});
  assert.deepEqual(errors,[]);
  console.log('PASS: spring selection plates (laps, reference badge, workspace, tool and axis tabs) glide without overshoot, keep one plate, keep rows and the chart mounted through selection and navigation, lift standalone controls and leave tabs still (simulated native IPC)');
}finally{await browser?.close();await server?.close();}
