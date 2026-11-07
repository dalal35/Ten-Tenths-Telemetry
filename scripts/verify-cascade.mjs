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
  console.log('Cascade verification: Vite ready');
  browser=await launchBrowser();
  console.log('Cascade verification: browser launched');
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.setDefaultTimeout(6000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.isTauri=true;window.sidebarCalls=[];window.heldAnalyses=[];
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
        // Holding a response opens the pending window; failing it covers the error path.
        if(window.holdAnalysis)await new Promise(resolve=>window.heldAnalyses.push(resolve));
        if(window.failAnalysis)throw Error('Fixture analysis failure');
        const lapOffset=lapId=>Number(lapId.split('-')[1]);
        const view=lapId=>({lapId,duration:10,length:100,mapping:[{meters:0,time:0},{meters:50,time:5},{meters:100,time:10}],track:[{x:0,y:0,position:0,speed:10},{x:50,y:20,position:50,speed:15},{x:100,y:0,position:100,speed:20}],warnings:[],series:args.channelIds.map(id=>({...channels.find(c=>c.id===id),channelId:id,x:args.axis==='time'?[0,5,10]:[0,50,100],values:id==='rpm'?[1000,3000,2000].map(v=>v+lapOffset(lapId)*100):[10,15,20].map(v=>v+lapOffset(lapId))}))});
        const metrics={elapsed:5,entrySpeed:10,minSpeed:10,exitSpeed:20,channels:[]};
        return {primary:view(args.primaryId),comparison:args.comparisonId?view(args.comparisonId):null,cornerBoundaries:null,alignment:{method:'spatial',coverage:1,notes:[]},segments:[{id:'corner',label:'Corner 1',kind:'corner',start:0,end:50,startMeters:0,endMeters:50,uncertaintyMeters:5,primary:metrics,comparison:args.comparisonId?metrics:null,deltaSeconds:null}],delta:args.comparisonId?{x:args.axis==='time'?[0,5,10]:[0,50,100],values:[0,.1,.2],method:'spatial',uncertaintySeconds:.1}:null,warnings:[]};
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
  const shots='test-results/workspace-cascade';mkdirSync(shots,{recursive:true});
  const views=['Telemetry','Advanced','Video','AI Driving Coach'];
  // Navigation commits inside a view transition: wait for the view, then read the build it started.
  const go=view=>page.evaluate(async view=>{
    const button=[...document.querySelectorAll('.workspace-switch button')].find(b=>b.textContent.includes(view));
    const shell=()=>['.titlebar','.workspace-heading','.explorer-slot'].flatMap(s=>[...document.querySelectorAll(s)]).map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height].join();}).join('|');
    const host=document.querySelector('.workspace-viewport'),want={Telemetry:'telemetry',Advanced:'advanced',Video:'video','AI Driving Coach':'coach'}[view];
    const before=shell();const already=host.dataset.workspace===want;button.click();
    for(let i=0;i<30&&host.dataset.workspace!==want;i++)await new Promise(r=>requestAnimationFrame(r));
    const animations=document.getAnimations();
    const all=already?[]:animations.filter(a=>a.id==='workspace-cascade');
    return {shellStill:before===shell(),dissolves:animations.some(a=>String(a.effect?.pseudoElement).startsWith('::view-transition-old')),draws:animations.filter(a=>a.id==='workspace-cascade-draw').length,pieces:all.map(a=>{const t=a.effect.target,r=t.getBoundingClientRect(),timing=a.effect.getTiming();return {
      name:String(t.className),delay:timing.delay,duration:timing.duration,rises:'transform' in a.effect.getKeyframes()[0],media:t.matches('.plot-row,.analysis-surface')||!!t.querySelector('canvas'),
      inShell:!!t.closest('.titlebar,.sidebar,.workspace-heading,.lap-summary'),top:r.top};})};
  },view);
  const running=()=>page.evaluate(()=>document.getAnimations().filter(a=>String(a.id).startsWith('workspace-cascade')&&a.playState==='running').length);
  const selectedLap=()=>page.locator('.lap-row.selected .lap-number').textContent({timeout:1000});
  const tagCharts=()=>page.evaluate(()=>{window.taggedCharts=[...document.querySelectorAll('.uplot')];return window.taggedCharts.length;});
  const chartsKept=()=>page.evaluate(()=>window.taggedCharts.every(c=>document.contains(c)));
  const settle=()=>page.waitForTimeout(1500);
  const checkBuild=(label,build)=>{
    assert.equal(build.shellStill,true,`${label}: shell stays stationary`);
    assert.ok(build.pieces.length>=2,`${label}: page builds from several pieces (${build.pieces.length})`);
    const delays=build.pieces.map(p=>p.delay).sort((a,b)=>a-b);
    assert.equal(delays[0],0,`${label}: the first piece starts at once`);
    assert.ok(delays.at(-1)+build.pieces[0].duration<=1000,`${label}: build fits its budget (${delays.at(-1)}ms)`);
    for(const piece of build.pieces){
      assert.ok(!(piece.media&&piece.rises),`${label}: charts and video are never transformed (${piece.name})`);
      assert.ok(!piece.inShell,`${label}: shell never animates (${piece.name})`);
    }
  };
  for(const [width,height] of [[1440,900],[600,500]]){
    await page.setViewportSize({width,height});await settle();
    await go('Telemetry');await settle();
    const lap=await selectedLap().catch(()=>null);
    for(const from of views)for(const to of views){
      if(from===to)continue;
      await go(from);await settle();const count=await tagCharts();
      const build=await go(to);checkBuild(`${width}x${height} ${from} -> ${to}`,build);
      assert.ok(build.dissolves,`${from} -> ${to}: the outgoing page dissolves`);
      await settle();
      assert.equal(await running(),0,`${from} -> ${to}: nothing keeps running`);
      assert.ok(await chartsKept(),`${from} -> ${to}: all ${count} charts stay mounted`);
      if(lap)assert.equal(await selectedLap(),lap,`${from} -> ${to}: lap selection survives`);
    }
    console.log(`Cascade verification: ${width}x${height} all 12 workspace pairs passed (lap kept: ${lap!==null})`);
  }
  await page.setViewportSize({width:1440,height:900});await go('Telemetry');await settle();
  // Selection changes data in place: it must never replay the page build.
  {
    await page.locator('.lap-row .lap-select').nth(6).evaluate(el=>el.click());
    assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.id==='workspace-cascade').length),0,'Lap selection does not replay the build');
    await settle();
    assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.id==='workspace-cascade').length),0,'Lap analysis arriving does not replay the build');
    console.log('Cascade verification: lap selection does not replay the build');
  }
  // Input is live from the first frame, on an element that is still mid-build.
  {
    const time=page.locator('.chart-toolbar .axis-switch button',{hasText:'Time'}).first(),distance=page.locator('.chart-toolbar .axis-switch button',{hasText:'Distance'}).first();
    const box=await time.boundingBox();
    await go('Advanced');await settle();
    const started=await go('Telemetry');assert.ok(started.pieces.length>0);
    await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
    await expect(time).toHaveAttribute('aria-pressed','true');
    await settle();await distance.click();await settle();
    console.log('Cascade verification: first click lands during the build');
  }
  // Interruption: the last request wins and no earlier build survives it.
  {
    for(let i=0;i<24;i++){await go(views[i%4]);await page.waitForTimeout(35);}
    const live=await page.evaluate(()=>document.getAnimations().filter(a=>a.id==='workspace-cascade').map(a=>!!a.effect.target.closest('[hidden]')));
    assert.ok(live.every(hidden=>!hidden),'Rapid switching leaves no build on a hidden workspace');
    await expect(page.locator('.workspace-switch button[aria-pressed=true]')).toContainText(views[23%4]);
    await settle();assert.equal(await running(),0,'Rapid switching settles');
    const faint=await page.evaluate(()=>[...document.querySelectorAll('.workspace-viewport .plot-row,.workspace-viewport .coach-heading')].filter(e=>e.offsetParent&&getComputedStyle(e).opacity!=='1').length);
    assert.equal(faint,0,'Nothing is left transparent after interruption');
    console.log('Cascade verification: 24 rapid switches settle cleanly');
  }
  // Pieces leave no residue once the build ends.
  {
    await go('Telemetry');await settle();
    const residue=await page.evaluate(()=>[...document.querySelectorAll('.plot-row,.track-map-frame,.chart-toolbar')].filter(e=>{const c=getComputedStyle(e);return c.transform!=='none'||c.filter!=='none';}).length+document.querySelectorAll('.cascade-glint').length+[...document.querySelectorAll('.uplot canvas')].filter(e=>getComputedStyle(e).clipPath!=='none').length);
    assert.equal(residue,0,'No transform remains once the build ends');
  }
  // Numbers roll, then land on exactly the recorded text, and an interrupted roll restores it.
  {
    const texts=()=>page.evaluate(()=>[...document.querySelectorAll('.stat-metrics dd,.segment-delta,.lap-summary strong.mono')].map(e=>e.textContent));
    await go('Advanced');await settle();const recorded=await texts();
    await go('Telemetry');await settle();
    const started=await go('Advanced');assert.ok(started.draws>0,'Advanced draws its chart');
    await page.waitForTimeout(250);const rolling=await texts();
    assert.notDeepEqual(rolling,recorded,'Numbers are rolling during the build');
    await settle();assert.deepEqual(await texts(),recorded,'Numbers land on the recorded values');
    await go('Telemetry');await page.waitForTimeout(120);await go('Advanced');await page.waitForTimeout(120);await go('Telemetry');await settle();await go('Advanced');await settle();
    assert.deepEqual(await texts(),recorded,'Interrupted rolls restore the recorded values');
    await go('Telemetry');await settle();
    const before=await page.locator('.plot-row').first().boundingBox();
    const drawing=await go('Advanced');await go('Telemetry');assert.ok(drawing.pieces.length>0);
    await page.mouse.move(before.x+before.width/2,before.y+before.height/2);await page.waitForTimeout(60);
    await settle();
    console.log('Cascade verification: numbers land on recorded values, including after interruption');
  }
  // Reduced motion: the state change happens, the build does not.
  {
    await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);
    for(const view of ['Advanced','Video','AI Driving Coach','Telemetry']){const build=await go(view);assert.equal(build.pieces.length+build.draws,0,`Reduced motion: ${view} appears at once`);assert.ok(!build.dissolves,`Reduced motion: ${view} does not dissolve`);}
    await page.emulateMedia({reducedMotion:'no-preference'});await settle();
    console.log('Cascade verification: reduced motion removes the build');
  }
  // Hover lift on section cards, matching the other interactive surfaces.
  {
    const card=page.locator('.segment-card').first();await card.hover();await page.waitForTimeout(400);
    assert.equal(await card.evaluate(e=>getComputedStyle(e).translate),'0px -3px','Section cards lift on hover');
    await page.mouse.move(0,0);await page.waitForTimeout(300);
  }
  // A workspace reveal is not a selection change: selection plates must not fly in from a stale position.
  {
    await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(700);
    const views=['Telemetry','Advanced','Video','AI Driving Coach'];
    const flight=view=>page.evaluate(async view=>{
      const host=document.querySelector('.workspace-viewport'),before=host.dataset.workspace;
      [...document.querySelectorAll('.workspace-switch button')].find(b=>b.textContent.includes(view)).click();
      // The shared chart toolbar changes parent at commit: only motion after the commit is travel.
      for(let i=0;i<30&&host.dataset.workspace===before;i++)await new Promise(r=>requestAnimationFrame(r));
      return new Promise(resolve=>{
      const seen=new Map(),t0=performance.now();
      const tick=()=>{
        for(const plate of document.querySelectorAll('.workspace-viewport :is(.control-selection,.video-view-selection,.selection-plate)')){
          if(plate.closest('[hidden]'))continue;
          const r=plate.getBoundingClientRect();if(!r.width)continue;
          const range=seen.get(plate)??{min:r.y,max:r.y,xmin:r.x,xmax:r.x};
          range.min=Math.min(range.min,r.y);range.max=Math.max(range.max,r.y);range.xmin=Math.min(range.xmin,r.x);range.xmax=Math.max(range.xmax,r.x);seen.set(plate,range);
        }
        performance.now()-t0<500?requestAnimationFrame(tick):resolve([...seen.values()].map(s=>Math.max(s.max-s.min,s.xmax-s.xmin)));
      };
      tick();
      });
    },view);
    for(const from of views)for(const to of views){
      if(from===to)continue;
      await page.evaluate(v=>[...document.querySelectorAll('.workspace-switch button')].find(b=>b.textContent.includes(v)).click(),from);await page.waitForTimeout(700);
      const travel=await flight(to);
      assert.ok(travel.every(px=>px<=20),`${from} -> ${to}: selection plates stay put on reveal (travel ${travel.map(Math.round).join()})`);
      await page.waitForTimeout(150);
    }
    console.log('Cascade verification: selection plates stay put on every reveal');
  }
  // Frozen frames for visual review, both themes, at the review sizes.
  const freeze=at=>page.evaluate(at=>document.getAnimations().filter(a=>String(a.id).startsWith('workspace-cascade')).forEach(a=>{a.pause();a.currentTime=at;}),at);
  const release=()=>page.evaluate(()=>document.getAnimations().filter(a=>String(a.id).startsWith('workspace-cascade')).forEach(a=>a.finish()));
  const toggleTheme=()=>page.locator('.titlebar .header-actions .icon-button').first().click();
  for(const theme of ['dark','light']){
    for(const [width,height] of [[1440,900],[600,500]]){
      await page.setViewportSize({width,height});await settle();
      for(const view of views){
        await go(view===views[0]?views[1]:views[0]);await settle();
        await go(view);
        for(const at of [60,220,480]){await freeze(at);await page.screenshot({path:`${shots}/${theme}-${width}-${view.split(' ')[0]}-${String(at).padStart(3,'0')}.png`});}
        await release();await settle();
        await page.screenshot({path:`${shots}/${theme}-${width}-${view.split(' ')[0]}-settled.png`});
      }
    }
    await page.setViewportSize({width:1440,height:900});if(theme==='dark'){await toggleTheme();await settle();}
  }
  // Frame pacing is reported, not asserted: headless software rendering is not the native app.
  {
    const gaps=await page.evaluate(async()=>{
      const out=[];
      for(const view of ['Advanced','Telemetry','Video','Telemetry']){
        [...document.querySelectorAll('.workspace-switch button')].find(b=>b.textContent.includes(view)).click();
        let last=performance.now();const end=last+600;
        await new Promise(r=>{const t=now=>{out.push(now-last);last=now;now<end?requestAnimationFrame(t):r();};requestAnimationFrame(t);});
      }
      return out.sort((a,b)=>a-b);
    });
    console.log(`Cascade verification: frame gap median ${gaps[gaps.length>>1].toFixed(1)}ms, p95 ${gaps[Math.floor(gaps.length*.95)].toFixed(1)}ms, max ${gaps.at(-1).toFixed(1)}ms (headless)`);
  }
  assert.deepEqual(errors,[],'No page errors');
  console.log('Cascade verification: passed');
} finally {
  await browser?.close();await server?.close();
}
process.exit(0);
