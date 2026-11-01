import {launchBrowser,browserTestEntries} from './browser.mjs';
// Real React acceptance coverage; only the native IPC/media boundary is simulated.
import {expect} from '@playwright/test';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';

let server, browser;
try {
  mkdirSync('.tools', {recursive:true});
  server=await createServer({optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});
  await server.listen();
  console.log('Sidebar verification: Vite ready');
  browser=await launchBrowser();
  console.log('Sidebar verification: browser launched');
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
  const verifyDetails=async()=>{
  console.log('Sidebar verification: checking session details');
  // Editing is cancelable, retryable and persists through native-style reloads.
  const editActive=async()=>{await page.locator('.library-entry.active .row-actions').click();await page.getByRole('menuitem',{name:'Edit details',exact:true}).click();};
  await editActive();
  const details=page.getByRole('dialog',{name:'Edit session details',exact:true});
  await expect(details.getByLabel('Session name')).toBeFocused();
  await expect(details.getByLabel('Recording date')).toHaveValue('2026-10-14');
  await details.getByLabel('Session name').fill('Canceled title');
  await details.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.locator('.library-entry.active .session-button')).not.toContainText('Canceled title');
  await editActive();await details.getByLabel('Session name').fill('Fail save');
  await details.getByRole('button',{name:'Save',exact:true}).click();
  await expect(details.getByRole('alert')).toContainText('Fixture save failure');
  await details.getByLabel('Session name').fill('Edited practice');
  await details.getByLabel('Driver',{exact:true}).fill('Alex');
  await details.getByLabel('Recording date').fill('2026-10-23');
  await details.getByRole('button',{name:'Save',exact:true}).click();
  await expect(details).toHaveCount(0);
  await expect(page.locator('.library-entry.active .session-button')).toContainText('Edited practice');
  await expect(page.locator('.library-entry.active .session-button')).toContainText('Alex');
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('.uplot').first().waitFor();
  await expect(page.locator('.library-entry.active .session-button')).toContainText('Edited practice');
  await editActive();await expect(details.getByLabel('Recording date')).toHaveValue('2026-10-23');
  await page.keyboard.press('Escape');await expect(details).toHaveCount(0);
  };
  await page.goto(server.resolvedUrls.local[0]);
  console.log('Sidebar verification: page loaded');
  await page.locator('.uplot').first().waitFor().catch(async error=>{console.error('Initial render:',errors,await page.locator('body').innerText());throw error;});
  const shell=page.locator('.shell');
  if(process.env.LIBRARY_DETAILS_ONLY){await verifyDetails();assert.deepEqual(errors,[]);console.log('PASS: library details Save/Cancel/error/reload/Escape interactions');}else{
  // First missing-control assertion supplies the deliberate RED on the original UI.
  await expect(page.getByRole('button',{name:'Collapse sidebar',exact:true})).toBeVisible();
  await expect(shell).toHaveAttribute('data-sidebar-state','expanded');
  // Acceptance review regression: dismissed popovers must leave usable keyboard focus.
  const headerActions=page.getByRole('button',{name:'Session explorer actions',exact:true});
  await headerActions.click();await page.setViewportSize({width:1200,height:800});
  await expect(page.getByRole('menu')).toHaveCount(0);await expect(headerActions).toBeFocused();
  await page.getByRole('button',{name:'Sort and group sessions',exact:true}).click();
  await page.setViewportSize({width:600,height:500});
  const drawerOpener=page.getByRole('button',{name:'Open session explorer',exact:true});
  await expect(drawerOpener).toBeFocused();await drawerOpener.click();
  await headerActions.click();await page.getByRole('menuitem',{name:'Merge sessions',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>!!document.activeElement?.closest('#session-explorer'))).toBe(true);
  await page.keyboard.press('Tab');await expect.poll(()=>page.evaluate(()=>!!document.activeElement?.closest('#session-explorer'))).toBe(true);
  const drawerBoxes=page.getByRole('checkbox',{name:/for merging/});
  await drawerBoxes.nth(0).check();await drawerBoxes.nth(1).check();
  await page.getByRole('button',{name:'Merge Sessions',exact:true}).click();
  await expect(page.locator('#session-explorer').getByRole('alert').filter({hasText:'Fixture preview rejection'})).toBeVisible();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.locator('#session-explorer').getByRole('button',{name:'Close session explorer',exact:true}).click();
  await page.setViewportSize({width:1280,height:800});

  await page.getByRole('button',{name:'Sort and group sessions',exact:true}).click();
  await expect(page.getByLabel('Group sessions',{exact:true})).toHaveValue('date');
  const sessionButtons=page.locator('.session-button');
  assert.equal(await sessionButtons.count(),100,'All entries are available in independently scrolling session list');
  const firstTitle=await sessionButtons.first().getAttribute('title');
  assert(firstTitle?.includes('Circuit with a very long name'),'Long names expose full metadata in tooltips');
  assert.match(await page.locator('.session-list').innerText(),/unknown|not recorded/i,'Missing metadata has explicit fallback');
  assert.match(await sessionButtons.first().innerText(),/A very long recording title/,'Default is newest recording first and displays recording name');
  const selected=()=>page.locator('.library-entry.active .session-button');
  const activeTitle=await selected().getAttribute('title');
  const sort=page.getByLabel('Sort sessions',{exact:true});
  const initialSort=await sort.inputValue();
  const options=await sort.locator('option').evaluateAll(nodes=>nodes.map(n=>({value:n.value,label:n.textContent})));
  assert(options.length>=6,'Date, driver and circuit each support two sort directions');
  for(const option of options){await sort.selectOption(option.value);assert.equal(await selected().getAttribute('title'),activeTitle,'Changing order preserves selected session');}
  const group=page.getByLabel('Group sessions',{exact:true});
  for(const value of ['driver','circuit','none','date']){await group.selectOption(value);assert.equal(await selected().getAttribute('title'),activeTitle,'Changing grouping preserves selection');}
  await sort.selectOption(initialSort);
  await page.getByRole('button',{name:'Sort and group sessions',exact:true}).click();
  const firstGroup=page.locator('.session-group-heading').first();
  await firstGroup.click();await expect(firstGroup).toHaveAttribute('aria-expanded','false');
  assert.equal(await sessionButtons.first().isVisible(),false,'Group collapse hides its session rows');
  await firstGroup.click();await expect(firstGroup).toHaveAttribute('aria-expanded','true');
  for(const [name,action] of [['Recording 97','Refresh'],['Recording 98','Locate…']]){
    const actions=page.getByTitle(`Actions for ${name}`,{exact:true});
    await actions.scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await actions.click();
    await expect(page.getByRole('menuitem',{name:action,exact:true})).toBeVisible();await expect(page.getByRole('menuitem',{name:'Remove',exact:true})).toBeVisible();
    if(name==='Recording 98'){
      await page.locator('.session-list').evaluate(el=>{el.scrollTop-=20;});
      await expect(page.getByRole('menu'),'Actual scrolling after opening dismisses the menu').toHaveCount(0);
    }else await page.keyboard.press('Escape');
  }
  // Roving list focus changes selection only when activated.
  await sessionButtons.first().focus();await page.keyboard.press('End');
  assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('session-button')),true);
  await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('sidebar-library')).activeSessionId)).not.toBe('session-0');
  await selected().focus();await page.keyboard.press('Home');await page.keyboard.press('Enter');
  await page.locator('.uplot').first().waitFor();
  // Temporary merging has a clear escape path and does not leak checkboxes into browsing.
  assert.equal(await page.getByRole('checkbox',{name:/for merging/}).count(),0);
  await page.getByRole('button',{name:'Session explorer actions',exact:true}).click();
  await page.getByRole('menuitem',{name:/merge/i}).click();
  const mergeBoxes=page.getByRole('checkbox',{name:/for merging/});
  await mergeBoxes.nth(0).check();await mergeBoxes.nth(1).check();
  await page.getByRole('button',{name:'Merge Sessions',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'Fixture preview rejection'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Merge Sessions',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await mergeBoxes.count(),0,'Cancel exits temporary merge mode');
  await page.getByRole('button',{name:'Compare lap 2',exact:true}).click();
  await page.getByRole('button',{name:'Time',exact:true}).click();
  await page.getByRole('button',{name:/Channels/}).click();
  await page.getByRole('checkbox',{name:/RPM/}).uncheck();
  await page.getByRole('button',{name:/Channels/}).click();
  const over=page.locator('.u-over').first();await over.scrollIntoViewIfNeeded();const box=await over.boundingBox();
  await page.mouse.move(box.x+box.width*.2,box.y+30);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+30,{steps:10});await page.mouse.up();
  const savedWorkspace=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('sidebar-library')).entries.find(e=>e.id===JSON.parse(localStorage.getItem('sidebar-library')).activeSessionId).workspace);
  await expect.poll(async()=>{const zoom=(await savedWorkspace())?.zoom;return !!zoom&&zoom.max>zoom.min&&zoom.max-zoom.min<10;}).toBe(true);
  const baseline=await savedWorkspace();assert(baseline.zoom.max-baseline.zoom.min<10,'Real chart gesture narrows zoom');
  const layoutCheck=async(label)=>{
    // CSS transitions and ResizeObserver delivery follow rendered frames, not
    // wall-clock sleeps. Keep every geometry assertion until the layout settles.
    await expect.poll(()=>page.evaluate(()=>{
      const failures=[];const main=document.querySelector('main');
      if(document.querySelector('.explorer-slot').getAnimations().some(animation=>animation.playState==='running'))failures.push('Sidebar width transition still running');
      if(document.documentElement.scrollWidth>innerWidth+1)failures.push(`document ${document.documentElement.scrollWidth}>${innerWidth}`);
      if(main.scrollWidth>main.clientWidth+1)failures.push(`main ${main.scrollWidth}>${main.clientWidth}`);
      const heading=main.querySelector('.workspace-heading h1');
      if(innerWidth===600&&heading&&heading.getBoundingClientRect().height>2*parseFloat(getComputedStyle(heading).lineHeight)+1)failures.push('Long circuit heading exceeds two lines at minimum window size');
      document.querySelectorAll('.uplot').forEach(plot=>{const host=plot.parentElement;const p=plot.getBoundingClientRect(),h=host.getBoundingClientRect();if(p.width>h.width+2||p.width<h.width-4)failures.push(`plot width ${p.width} / host ${h.width}`);});
      document.querySelectorAll('.analysis-surface canvas').forEach(canvas=>{if(canvas.getBoundingClientRect().width>canvas.parentElement.getBoundingClientRect().width+1)failures.push('advanced canvas overflow');});
      document.querySelectorAll('main button,main select,main input').forEach(control=>{const r=control.getBoundingClientRect();if(r.width&&r.height&&r.top>=0&&r.bottom<=innerHeight&&(r.left<0||r.right>innerWidth+1))failures.push(`clipped control ${control.textContent||control.getAttribute('aria-label')}`);});
      return failures;
    }),{message:label,timeout:6000,intervals:[16,50,100]}).toEqual([]);
  };
  const modeCycle=async()=>{
    // ResizeObserver updates React's mode after the viewport changes. Read the
    // opener only after that source of truth agrees with the rendered shell.
    await expect.poll(()=>page.evaluate(()=>{const shell=document.querySelector('.shell'),slot=document.querySelector('.explorer-slot');const narrow=shell.getBoundingClientRect().width<900;return shell.dataset.narrow===String(narrow)&&slot.dataset.drawer===String(narrow);})).toBe(true);
    const narrow=await page.getByRole('button',{name:'Open session explorer',exact:true}).isVisible();
    if(narrow){
      await expect.poll(()=>page.locator('.explorer-slot').evaluate(el=>({width:Math.round(el.getBoundingClientRect().width),drawer:el.dataset.drawer,narrow:el.closest('.shell')?.dataset.narrow}))).toEqual({width:40,drawer:'true',narrow:'true'});
      const mainWidth=await page.locator('main').evaluate(el=>el.getBoundingClientRect().width);
      await page.getByRole('button',{name:'Open session explorer',exact:true}).click();await expect(page.locator('.lap-list')).toBeVisible();
      assert(Math.abs(await page.locator('main').evaluate(el=>el.getBoundingClientRect().width)-mainWidth)<1,'Drawer overlays without reducing analysis width');
      await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('[role="dialog"]')),true,'Drawer contains reverse keyboard navigation');
      await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Open session explorer',exact:true})).toBeFocused();return;
    }
    if(await shell.getAttribute('data-sidebar-state')==='collapsed')await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();
    if(await shell.getAttribute('data-sidebar-state')==='expanded')await page.getByRole('button',{name:'Hide sessions',exact:true}).click();
    await expect(shell).toHaveAttribute('data-sidebar-state','analysis');await expect(page.locator('.lap-list')).toBeVisible();await layoutCheck('Analysis sidebar');
    await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();await expect(shell).toHaveAttribute('data-sidebar-state','collapsed');
    await layoutCheck('Fully collapsed sidebar');
    await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();
    if(await shell.getAttribute('data-sidebar-state')==='analysis')await page.getByRole('button',{name:'Show sessions',exact:true}).click();
    await expect(shell).toHaveAttribute('data-sidebar-state','expanded');
  };
  for(const view of ['Telemetry','Advanced','Video']){
    await page.getByRole('button',{name:view,exact:true}).click();
    if(view==='Advanced'){
      const canvas=page.locator('.analysis-surface canvas');await canvas.waitFor();await canvas.hover({position:{x:180,y:120}});await page.mouse.wheel(0,-120);await page.waitForTimeout(120);
      await page.evaluate(()=>window.sidebarAdvancedTicks=window.sidebarCanvasTicks.get(document.querySelector('.analysis-surface canvas')));
    }
    if(view==='Video'){
      await page.getByRole('button',{name:'Attach MP4 / MOV',exact:true}).click();
      await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
      await page.getByRole('button',{name:'Play',exact:true}).click();
      await page.evaluate(()=>{document.querySelector('video').currentTime=7;});
      await page.getByRole('button',{name:'Pause',exact:true}).click();
      await page.getByRole('button',{name:'Sync Here',exact:true}).click();
    }
    await page.locator('.uplot').first().waitFor();
    await page.evaluate(()=>{window.sidebarPlot=document.querySelector('.uplot');window.sidebarCanvas=document.querySelector('.analysis-surface canvas');window.sidebarVideo=document.querySelector('video');});
    const calls=await page.evaluate(()=>window.sidebarCalls.filter(c=>c.cmd==='analyze_session'||c.cmd==='analyze_advanced').length);
    for(const [width,height] of [[600,500],[800,600],[1024,640],[1280,800],[1920,1080],[2560,1440],[600,500]]){
      await page.setViewportSize({width,height});await page.waitForTimeout(180);await modeCycle();await page.waitForTimeout(180);
      await layoutCheck(`${view} at ${width}×${height}`);
      assert.equal(await page.evaluate(()=>window.sidebarPlot===document.querySelector('.uplot')),true,'Navigation/resizing must not remount plots');
      if(view==='Advanced'){
        assert.equal(await page.evaluate(()=>window.sidebarCanvas===document.querySelector('.analysis-surface canvas')),true,'Navigation/resizing must not remount advanced canvas');
        assert.deepEqual(await page.evaluate(()=>window.sidebarCanvasTicks.get(window.sidebarCanvas)),await page.evaluate(()=>window.sidebarAdvancedTicks),'Advanced local zoom axis labels survive resize');
      }
      if(view==='Video')assert.equal(await page.evaluate(()=>window.sidebarVideo===document.querySelector('video')),true,'Navigation/resizing must not remount video');
      await expect(page.locator('.workspace-switch button.active')).toHaveText(view);
      const current=await savedWorkspace();for(const key of ['primary','comparison','channels','axis','zoom'])assert.deepEqual(current[key],baseline[key],`${view} resize preserves ${key}`);
      if(view==='Video'){assert.equal(current.video.preferences.pausedVideoTime,7);assert.equal(current.video.segments.length,1,'Video sync mapping survives resize');}
      if(width===2560)await page.screenshot({path:`.tools/sidebar-${view.toLowerCase()}-2560.png`,animations:'disabled'});
    }
    assert.equal(await page.evaluate(()=>window.sidebarCalls.filter(c=>c.cmd==='analyze_session'||c.cmd==='analyze_advanced').length),calls,'Sidebar/resizing does not recompute analysis');
    await page.screenshot({path:`.tools/sidebar-${view.toLowerCase()}-600.png`,animations:'disabled'});
    await page.locator(view==='Advanced'?'.analysis-surface':'.uplot').first().scrollIntoViewIfNeeded();
    await page.screenshot({path:`.tools/sidebar-${view.toLowerCase()}-chart-600.png`,animations:'disabled'});
    await page.setViewportSize({width:1280,height:800});await page.waitForTimeout(180);
    if(view==='Advanced'){
      const ticks=await page.evaluate(()=>window.sidebarCanvasTicks.get(window.sidebarCanvas));
      await page.getByRole('button',{name:'Telemetry',exact:true}).click();
      await expect(page.locator('.analysis-surface')).toBeHidden();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(()=>window.sidebarCanvas.isConnected),true,'Hidden Advanced retains its canvas node');
      const idle=await page.evaluate(()=>({draws:window.sidebarCanvasDraws.get(window.sidebarCanvas),requests:window.sidebarCalls.filter(c=>c.cmd==='analyze_advanced').length}));
      const telemetry=page.locator('.u-over').first();await telemetry.scrollIntoViewIfNeeded();const bounds=await telemetry.boundingBox();
      await page.mouse.move(bounds.x+bounds.width*.2,bounds.y+30);await page.mouse.move(bounds.x+bounds.width*.7,bounds.y+30,{steps:8});
      await expect(page.locator('.readout').first()).not.toContainText('—');
      // Cover the 100ms Advanced request debounce while exercising real cursor events.
      await page.waitForTimeout(180);
      assert.deepEqual(await page.evaluate(()=>({draws:window.sidebarCanvasDraws.get(window.sidebarCanvas),requests:window.sidebarCalls.filter(c=>c.cmd==='analyze_advanced').length})),idle,'Hidden Advanced ignores telemetry cursor movement without redrawing or requesting analysis');
      await page.getByRole('button',{name:'Advanced',exact:true}).click();await expect(page.locator('.analysis-surface')).toBeVisible();
      assert.equal(await page.evaluate(()=>window.sidebarCanvas===document.querySelector('.analysis-surface canvas')),true,'Advanced navigation retains the canvas node');
      await expect.poll(()=>page.evaluate(()=>window.sidebarCanvasTicks.get(window.sidebarCanvas))).toEqual(ticks);
    }
    if(view==='Video'){
      await page.getByRole('button',{name:'Play',exact:true}).click();
      await expect.poll(()=>page.locator('video').evaluate(video=>video.paused)).toBe(false);
      await page.getByRole('button',{name:'Telemetry',exact:true}).click();
      await expect.poll(()=>page.locator('video').evaluate(video=>video.paused)).toBe(true);
      assert.equal(await page.evaluate(()=>window.sidebarVideo===document.querySelector('video')),true,'Leaving Video pauses playback while retaining the video node');
      await page.getByRole('button',{name:'Video',exact:true}).click();await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
      assert.equal(await page.evaluate(()=>window.sidebarVideo===document.querySelector('video')),true,'Returning to Video retains the video node');
    }
  }
  // Sibling list scroll regions must leave lap access at the short-window size.
  await page.setViewportSize({width:1024,height:500});await page.waitForTimeout(180);await modeCycle();
  const geometry=await page.evaluate(()=>{const sessions=document.querySelector('.session-list'),laps=document.querySelector('.lap-list'),s=sessions.getBoundingClientRect(),l=laps.getBoundingClientRect();return {sessionHeight:s.height,lapHeight:l.height,sessionScroll:sessions.scrollHeight>sessions.clientHeight,lapScroll:laps.scrollHeight>laps.clientHeight,lapBottom:l.bottom,height:innerHeight};});
  assert(geometry.sessionScroll&&geometry.lapScroll,'100 sessions and 24 laps scroll independently');assert(geometry.lapHeight>=80&&geometry.lapBottom<=geometry.height,'Lap access remains usable in a short window');
  await page.getByRole('button',{name:'Hide sessions',exact:true}).click();await page.reload({waitUntil:'domcontentloaded'});await page.locator('.uplot').first().waitFor();await expect(shell).toHaveAttribute('data-sidebar-state','analysis');
  await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();await page.reload({waitUntil:'domcontentloaded'});await page.locator('.uplot').first().waitFor();await expect(shell).toHaveAttribute('data-sidebar-state','collapsed');
  await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();if(await shell.getAttribute('data-sidebar-state')==='analysis')await page.getByRole('button',{name:'Show sessions',exact:true}).click();await page.reload({waitUntil:'domcontentloaded'});await page.locator('.uplot').first().waitFor();await expect(shell).toHaveAttribute('data-sidebar-state','expanded');
  await verifyDetails();
  // The same shell must also handle a minimal and an empty library.
  await page.evaluate(()=>{const db=JSON.parse(localStorage.getItem('sidebar-library'));db.entries=db.entries.slice(0,1);db.activeSessionId=db.entries[0].id;localStorage.setItem('sidebar-library',JSON.stringify(db));});
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('.uplot').first().waitFor();assert.equal(await sessionButtons.count(),1);await layoutCheck('Single-entry library');
  await page.evaluate(()=>localStorage.setItem('sidebar-library',JSON.stringify({entries:[],activeSessionId:null,warnings:[]})));
  await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByRole('button',{name:/^Open telemetry/})).toBeVisible();assert.equal(await sessionButtons.count(),0);await layoutCheck('Empty library');
  await page.setViewportSize({width:600,height:500});await page.waitForTimeout(180);await layoutCheck('Empty library at minimum size');
  await page.getByRole('button',{name:'Open session explorer',exact:true}).click();await expect(page.getByText('Your sessions stay on this computer.')).toBeVisible();await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);
  console.log('PASS: 100-entry session explorer organization/keyboard/merge-error exit; three persisted modes; live 600×500–2560×1440 Telemetry/Advanced/Video resizing with mounted plot/canvas/player identity and lap/channel/zoom/tab/video mapping preservation (simulated native IPC and media clock)');
  }
}finally{await browser?.close();await server?.close();}
