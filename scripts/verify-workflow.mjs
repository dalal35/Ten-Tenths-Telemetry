import {launchBrowser,browserTestEntries,browserTestNoWatch} from './browser.mjs';
// Browser exercises of the React workflow. IPC is simulated; native persistence is tested separately.
import {createServer} from 'vite';
import assert from 'node:assert/strict';
// Measure shipped React behavior; development error stacks retain initial props.
process.env.NODE_ENV='production';
let server,browser;
try{
 server=await createServer({plugins:[browserTestNoWatch],cacheDir:'node_modules/.vite-workflow',optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}});await server.listen();
 browser=await launchBrowser();
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 // Exercise queued-save/analysis ordering even when React effects run slowly.
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'platform',{value:localStorage.getItem('test-platform')||'Win32',configurable:true});
  window.isTauri=true;
  const laps=[{id:'a',number:1,duration:10,start:0,end:10,complete:true},{id:'b',number:2,duration:12,start:10,end:22,complete:true}];
  const channels=[{id:'speed',name:'GPS Speed',unit:'m/s',times:[0,10],values:[10,20]},{id:'rpm',name:'RPM',unit:'rpm',times:[0,10],values:[1000,2000]}];
  const sessions=['one','two'].map(id=>({id,name:id,track:`Track ${id}`,driver:'Test',source:`/tmp/${id}.xrk`,recordedAt:'2026-10-14 12:00:00',warnings:[],laps,channels}));
  const initial={entries:sessions.map(s=>({...s,lapCount:2,channelCount:2,status:'ready',contentVersion:'v1',workspace:null,lastUsed:1})),activeSessionId:'one',warnings:[]};
  const read=()=>JSON.parse(localStorage.getItem('test-library')||JSON.stringify(initial));
  const write=v=>localStorage.setItem('test-library',JSON.stringify(v));
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,invoke:async(cmd,args={})=>{
   const db=read();if(cmd.startsWith('plugin:event'))return 1;
   if(cmd==='plugin:dialog|open'){window.openCalls=(window.openCalls??0)+1;return null;}
   if(cmd==='library_snapshot')return db;
   if(cmd==='load_library_session'){if(args.sessionId===db.virtualSession?.id)return db.virtualSession;if(args.sessionId==='two')await new Promise(r=>setTimeout(r,80));db.activeSessionId=args.sessionId;write(db);const entry=db.entries.find(e=>e.id===args.sessionId);const loaded=structuredClone(sessions.find(s=>s.id===args.sessionId)??{...sessions[0],id:entry.id,name:entry.name,track:entry.track,source:entry.source});(window.decodedSamples??=[]).push(new WeakRef(loaded.channels[0].values));return loaded;}
   const preview=()=>{const sourceIds=new Set(args.sessionIds.flatMap(id=>db.entries.find(e=>e.id===id)?.mergeSources?.map(r=>r.sessionId)??[id]));const selected=sessions.filter(s=>sourceIds.has(s.id));const refs=selected.map(s=>({sessionId:s.id,contentVersion:db.entries.find(e=>e.id===s.id).contentVersion}));return {sources:refs,day:'2026-10-14',previewVersion:refs.map(r=>r.contentVersion).join('-'),warnings:['Conflicting track metadata.','Source timestamps overlap; both recordings are retained.'],laps:selected.flatMap((s,i)=>s.laps.map((lap,j)=>({...lap,id:JSON.stringify([s.id,lap.id]),sourceSessionId:s.id,sourceLapId:lap.id,displayNumber:i*2+j+1}))),channels:selected.flatMap(s=>s.channels.map(c=>({...c,id:`${s.id}::${c.id}`,sourceSessionId:s.id,sourceChannelId:c.id,times:[],values:[]})))};};
   if(cmd==='preview_merge_sessions'){if(window.rejectMergePreview)throw Error('Source recording is unavailable; locate the original file.');return preview();}
   if(cmd==='merge_sessions'){
    window.mergeCalls=(window.mergeCalls??0)+1;await new Promise(r=>setTimeout(r,100));const p=preview();if(args.previewVersion!==p.previewVersion||!args.acknowledgeWarnings)throw Error('Stale or unacknowledged preview');
    const merged={id:'merged-test',name:'Merged recordings',driver:'Test',track:'Track one',recordedAt:p.day,source:'Virtual merge',laps:p.laps,channels:p.channels,warnings:p.warnings,merge:{preview:p,sources:p.sources.map(r=>({...r,session:{...sessions.find(s=>s.id===r.sessionId),channels:[]}}))}};
    const workspace={...db.entries.find(e=>e.id==='one').workspace,contentVersion:'merged-v1',primary:JSON.stringify(['one','a']),comparison:null,channels:['one::speed','one::rpm'],sourceVideos:{}};
    db.virtualSession=merged;db.entries.unshift({...merged,mergeSources:p.sources,contentVersion:'merged-v1',status:'ready',lapCount:4,channelCount:4,workspace,lastUsed:2});db.activeSessionId=merged.id;write(db);return merged;
   }
   if(cmd==='unmerge_session'){await new Promise(r=>setTimeout(r,100));db.entries=db.entries.filter(e=>e.id!==args.sessionId);delete db.virtualSession;db.activeSessionId='one';write(db);return db;}
   if(cmd==='refresh_library_session'){await new Promise(r=>{window.finishRefresh=r;});const current=read();const entry=current.entries.find(e=>e.id===args.sessionId);entry.contentVersion='v2';entry.workspace=null;write(current);return sessions.find(s=>s.id===args.sessionId);}
   if(cmd==='save_workspace'){await new Promise(r=>setTimeout(r,30));if(db.entries.find(e=>e.id===args.sessionId).contentVersion!==args.expectedContentVersion)throw Error('Stale source version');db.entries.find(e=>e.id===args.sessionId).workspace=args.workspace;db.activeSessionId=args.sessionId;write(db);return;}
   if(cmd==='remove_library_session'){db.entries=db.entries.filter(e=>e.id!==args.sessionId);write(db);return db;}
   if(cmd==='set_corner_boundaries'){await new Promise(r=>setTimeout(r,args.boundaries?.[0]===55?80:args.boundaries?.[0]===70?200:10));localStorage.setItem('test-corners',JSON.stringify(args.boundaries));return;}
   if(cmd==='analyze_session'){await new Promise(r=>setTimeout(r,args.sessionId==='one'?100:10));const bounds=JSON.parse(localStorage.getItem('test-corners')||'null');const middle=bounds?.[0]??50;const position=m=>args.axis==='time'?m/10:m;const metrics={elapsed:5,entrySpeed:10,minSpeed:10,exitSpeed:10,channels:[]};const view={lapId:args.primaryId,duration:10,length:100,mapping:[{meters:0,time:0},{meters:50,time:5},{meters:100,time:10}],track:[{x:0,y:0,position:position(0),speed:10},{x:50,y:20,position:position(50),speed:10},{x:100,y:0,position:position(100),speed:10}],warnings:[],series:args.channelIds.map(id=>({...channels.find(c=>c.id===id.split('::').pop()),channelId:id,x:[0,position(100)],values:[10,20]}))};return {primary:view,comparison:null,cornerBoundaries:bounds,alignment:{method:'spatial',coverage:1,notes:[]},segments:[{id:'first',label:'Corner 1',kind:'corner',start:0,end:position(middle),startMeters:0,endMeters:middle,uncertaintyMeters:5,primary:metrics,comparison:null,deltaSeconds:null},{id:'second',label:'Straight 1',kind:'straight',start:position(middle),end:position(100),startMeters:middle,endMeters:100,uncertaintyMeters:5,primary:metrics,comparison:null,deltaSeconds:null}],delta:null,warnings:[]};}
   throw Error(`Unexpected test IPC ${cmd}`);
  }};
 });
 await page.goto(server.resolvedUrls.local[0]);await page.getByRole('heading',{name:'Track one'}).waitFor();
 assert.equal(await page.locator('.import-button kbd').innerText(),'Ctrl O','Windows import hint uses the working Control shortcut');
 await page.getByRole('button',{name:'Collapse sidebar',exact:true}).waitFor({timeout:2000});
 assert.equal(await page.locator('.library-entry.active .session-track').innerText(),'One','Explorer displays the actual session name');
 await page.locator('.segment-card').first().click();
 await page.locator('.segment-speeds').first().waitFor();assert.match(await page.locator('.segment-speeds').first().innerText(),/22\.4/,'Selected section evidence converts 10 m/s to 22.4 mph');
 await page.getByLabel('Track options and data notes',{exact:true}).click();
 await page.getByRole('button',{name:'Edit boundaries',exact:true}).click();
 const handle=page.getByRole('slider',{name:'Section boundary 1'});await handle.click();await page.waitForTimeout(150);assert.equal(await handle.evaluate(el=>document.activeElement===el),true,'Clicking a boundary enables keyboard adjustment');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test-corners')||'null')?.[0]===60);await page.waitForTimeout(150);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('test-corners'))[0]),60,'Rapid boundary commits retain the latest edit');assert.equal(await handle.evaluate(el=>document.activeElement===el),true,'Saving a boundary preserves keyboard focus');
 await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test-corners'))[0]===65);
 await page.keyboard.press('ArrowRight');await page.waitForTimeout(120);await page.keyboard.press('ArrowRight');await page.waitForTimeout(400);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('test-corners'))[0]),75,'Older analysis cannot reset a newer boundary draft');
 await page.getByRole('button',{name:'Done editing',exact:true}).click();
 await page.getByRole('button',{name:'Time',exact:true}).click();await page.getByLabel('Chart options',{exact:true}).click();await page.getByRole('button',{name:'Compact',exact:true}).click();
 await page.getByRole('button',{name:/Two Test/}).click();await page.getByRole('heading',{name:'Track two'}).waitFor();await page.locator('.statusbar').getByText('Saved on this computer').waitFor({state:'attached'});
 await page.locator('.plot-label').filter({hasText:'mph'}).waitFor();assert.equal(await page.locator('.plot-label').filter({hasText:'mph'}).count(),1,'Another session displays mph');
 await page.getByRole('button',{name:/One Test/}).click();await page.getByRole('heading',{name:'Track one'}).waitFor();await page.locator('.statusbar').getByText('Saved on this computer').waitFor({state:'attached'});
 await page.locator('.plot-label').filter({hasText:'mph'}).waitFor();assert.equal(await page.locator('.plot-label').filter({hasText:'mph'}).count(),1,'Switching retains mph');assert.equal(await page.locator('.segmented[aria-label="Horizontal axis"] button.active').innerText(),'Time','Switching restores axis');
 await page.reload();await page.getByRole('heading',{name:'Track one'}).waitFor();await page.locator('.plot-label').filter({hasText:'mph'}).waitFor();assert.equal(await page.locator('.plot-label').filter({hasText:'mph'}).count(),1,'Reload retains mph');assert.equal(await page.locator('.segmented[aria-label="Horizontal axis"] button.active').innerText(),'Time');await page.getByLabel('Chart options',{exact:true}).click();assert.equal(await page.getByRole('button',{name:'Comfortable',exact:true}).count(),1,'Reload restores graph density');
 await page.locator('.library-entry').filter({hasText:/^One/}).getByRole('button',{name:'Session actions',exact:true}).click();
 await page.getByRole('menuitem',{name:'Refresh',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('main').inert);
 assert.equal(await page.locator('main').getAttribute('inert'),'','Workspace is frozen during explicit refresh');
 await page.evaluate(()=>window.finishRefresh());
 await page.waitForFunction(()=>!document.querySelector('main').inert&&document.querySelector('.segmented[aria-label="Horizontal axis"] button.active')?.textContent==='Distance');
 await page.locator('.plot-label').filter({hasText:'mph'}).waitFor();assert.equal(await page.locator('.plot-label').filter({hasText:'mph'}).count(),1,'Changed source retains mph');
 // Merge UI exercises real React selection, lifecycle queues and persisted restoration.
 await page.waitForFunction(()=>{const e=JSON.parse(localStorage.getItem('test-library')).entries.find(e=>e.id==='one');return e.workspace?.contentVersion==='v2'&&e.workspace?.zoom?.primary==='a'&&e.workspace.zoom.axis==='distance';});
 const originals=await page.evaluate(()=>JSON.parse(localStorage.getItem('test-library')).entries.map(e=>({id:e.id,workspace:e.workspace})));
 // Existing restoreAdvanced supplies an empty toolViews default on reopening.
 const normalizeOriginals=entries=>entries.map(original=>{if(original.workspace?.advanced?.config)original.workspace.advanced.config.toolViews??={};return original;});
 await page.getByRole('button',{name:'Session explorer actions',exact:true}).click();await page.getByRole('menuitem',{name:'Merge sessions',exact:true}).click();
 await page.getByRole('checkbox',{name:'Select one for merging'}).check();
 assert.equal(await page.getByRole('button',{name:'Merge Sessions',exact:true}).isDisabled(),true);
 await page.getByRole('checkbox',{name:'Select two for merging'}).check();
 await page.evaluate(()=>window.rejectMergePreview=true);await page.getByRole('button',{name:'Merge Sessions',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'unavailable'}).waitFor();await page.evaluate(()=>window.rejectMergePreview=false);
 await page.getByRole('button',{name:'Merge Sessions',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Merge sessions'});await dialog.waitFor();assert.match(await dialog.innerText(),/2026-10-14/);assert.match(await dialog.innerText(),/4 laps/);assert.match(await dialog.innerText(),/overlap/);await page.screenshot({path:'.tools/session-merge-preview.png'});
 assert.equal(await dialog.getByRole('button',{name:'Confirm merge',exact:true}).isDisabled(),true);
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.locator('.library-entry').count(),2);
 await page.getByRole('button',{name:'Session explorer actions',exact:true}).click();await page.getByRole('menuitem',{name:'Merge sessions',exact:true}).click();
 await page.getByRole('checkbox',{name:'Select one for merging'}).check();await page.getByRole('checkbox',{name:'Select two for merging'}).check();
 await page.getByRole('button',{name:'Merge Sessions',exact:true}).click();await dialog.getByRole('checkbox',{name:'I have reviewed these warnings'}).check();
 await dialog.getByRole('button',{name:'Confirm merge',exact:true}).evaluate(el=>{el.click();el.click();});
 await page.getByRole('heading',{name:'Merged · Track one'}).waitFor();await page.screenshot({path:'.tools/session-merge-workspace.png'});assert.equal(await page.locator('.library-entry').count(),1,'Merged recordings appear as one combined session');assert.equal(await page.locator('.lap-row').count(),4);assert(await page.locator('.session-region').evaluate(el=>el.getBoundingClientRect().height<240),'Small session libraries do not reserve empty navigation space');assert.equal(await page.evaluate(()=>window.mergeCalls),1);
 await page.getByRole('button',{name:'Compare lap 3',exact:true}).click();await page.waitForTimeout(200);
 assert.doesNotMatch(await page.locator('.lap-list').innerText(),/one\.xrk|two\.xrk/,'Lap rows omit source filenames');
 await page.reload();await page.getByRole('heading',{name:'Merged · Track one'}).waitFor();await page.locator('.statusbar').getByText('Saved on this computer').waitFor({state:'attached'});
 await page.getByRole('button',{name:'Session explorer actions',exact:true}).click();await page.getByRole('menuitem',{name:'Merge sessions',exact:true}).click();
 assert.equal(await page.getByRole('checkbox',{name:'Select Merged recordings for merging'}).count(),1,'Existing merged sessions can be selected for another merge');
 assert.equal(await page.getByRole('checkbox',{name:'Select one for merging'}).count(),0,'Original recordings are contained in the combined session');
 assert.equal(await page.getByRole('checkbox',{name:'Select two for merging'}).count(),0);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Time',exact:true}).click();await page.locator('.library-entry.active').getByRole('button',{name:'Session actions',exact:true}).click();await page.getByRole('menuitem',{name:'Unmerge',exact:true}).click();
 await page.getByRole('heading',{name:'Track one',exact:true}).waitFor();await page.waitForTimeout(250);assert.equal(await page.locator('.library-entry').count(),2);
 assert.deepEqual(normalizeOriginals(await page.evaluate(()=>JSON.parse(localStorage.getItem('test-library')).entries.map(e=>({id:e.id,workspace:e.workspace})))),normalizeOriginals(originals),'Unmerge preserves original workspaces through existing default normalization, including queued saves');
 await page.locator('.library-entry').filter({hasText:/^Two/}).getByRole('button',{name:'Session actions',exact:true}).click();await page.getByRole('menuitem',{name:'Remove',exact:true}).click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test-library')).entries.length===1);assert.equal(await page.locator('.library-entry').count(),1);
 await page.keyboard.press('Control+o');await page.waitForFunction(()=>window.openCalls===1);
 await page.evaluate(()=>localStorage.setItem('test-platform','MacIntel'));await page.reload();await page.getByRole('heading',{name:'Track one'}).waitFor();
 assert.equal(await page.locator('.import-button kbd').innerText(),'⌘ O','macOS keeps the Command shortcut hint');
 await page.keyboard.press('Meta+o');await page.waitForFunction(()=>window.openCalls===1);
 // Fresh IPC results must not leave every visited recording's sample arrays alive.
 await page.addInitScript(()=>{const db=JSON.parse(localStorage.getItem('test-library')),template=db.entries[0];for(let i=0;i<8;i++)db.entries.push({...template,id:`memory-${i}`,name:`memory-${i}`,track:`Track memory-${i}`,source:`/tmp/memory-${i}.xrk`});localStorage.setItem('test-library',JSON.stringify(db));});
 await page.reload();await page.getByRole('heading',{name:'Track one'}).waitFor();
 for(let i=0;i<8;i++){
  await page.getByRole('button',{name:new RegExp(`^Memory-${i} Test`)}).click();
  await page.getByRole('heading',{name:`Track memory-${i}`,exact:true}).waitFor();
  await page.locator('.plot-label').filter({hasText:'mph'}).waitFor();
  await page.locator('.statusbar').getByText('Saved on this computer').waitFor({state:'attached'});
 }
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await cdp.send('HeapProfiler.collectGarbage');
 const retained=await page.evaluate(()=>window.decodedSamples.flatMap((reference,index)=>reference.deref()?[index]:[]));
 assert(retained.includes(8)&&retained.length<=2,`Only the current React render and its previous render may retain decoded samples; found indices ${retained}`);
 assert.deepEqual(errors,[]);console.log('PASS: React IPC workflow — per-session switching, queued saves, workspace reload, safe library remove and bounded sample retention');
}finally{await browser?.close();await server?.close();}
