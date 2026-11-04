// Local-only screenshots and interaction checks using real-recording diagnostics.
// IPC and desktop dialogs are simulated; this is not native Tauri verification.
import {launchBrowser} from './browser.mjs';
import {preview} from 'vite';
import {readFileSync,mkdirSync} from 'node:fs';
import {expect} from '@playwright/test';
import assert from 'node:assert/strict';

const recordings=['0361','0362'].map(id=>JSON.parse(readFileSync(`.tools/coach-ui/${id}.json`,'utf8')));
const output='.tools/library-ui';mkdirSync(output,{recursive:true});
// Baseline screenshots were captured from the pre-change production build.
// This verifier always uses the current dist; it must never overwrite them.
let server,browser;
try {
 server=await preview({configLoader:'runner',preview:{host:'127.0.0.1',port:0,strictPort:false}});
 browser=await launchBrowser();
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(data=>{
  window.isTauri=true;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  const entry=d=>({...d.session,contentVersion:d.session.id,status:'ready',channelCount:d.session.channels.length,lapCount:d.session.laps.length,lastUsed:0,workspace:null});
  const read=()=>JSON.parse(localStorage.getItem('library-premium-fixture')||'{"entries":[],"activeSessionId":null,"warnings":[]}');
  const write=db=>localStorage.setItem('library-premium-fixture',JSON.stringify(db));
  window.__pickedPaths=null;window.__importLog=[];window.__loadLog=[];
  const callbacks={},listeners={};let nextCallback=0;
  window.__emitDrag=(name,paths=[])=>listeners[`tauri://drag-${name}`]?.({payload:{paths,position:{x:20,y:20}}});
  window.__dragReady=()=>!!listeners['tauri://drag-leave'];
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:callback=>{const id=++nextCallback;callbacks[id]=callback;return id;},invoke:async(cmd,args={})=>{
   const db=read();
   if(cmd==='plugin:event|listen'){listeners[args.event]=callbacks[args.handler];return args.handler;}
   if(cmd==='plugin:event|unlisten'){if(listeners[args.event]===callbacks[args.eventId])delete listeners[args.event];return;}
   if(cmd==='plugin:dialog|open')return window.__pickedPaths;
   if(cmd==='library_snapshot')return db;
   if(cmd==='import_session'){
    window.__importLog.push(args.path);
    await new Promise(resolve=>setTimeout(resolve,300));
    if(args.path.includes('bad'))throw Error('Unreadable XRK');
    const d=data.find(item=>args.path.includes(item.session.source.slice(-8,-4)));
    if(!d)throw Error('Unknown local fixture');
    const existing=db.entries.find(e=>e.id===d.session.id);
    if(!existing)db.entries.push(entry(d));else existing.status='ready';
    db.activeSessionId=d.session.id;write(db);return structuredClone(d.session);
   }
   if(cmd==='load_library_session'){window.__loadLog.push(args.sessionId);db.activeSessionId=args.sessionId;write(db);return structuredClone(data.find(d=>d.session.id===args.sessionId).session);}
   if(cmd==='remove_library_session'){db.entries=db.entries.filter(e=>e.id!==args.sessionId);if(db.activeSessionId===args.sessionId)db.activeSessionId=db.entries[0]?.id??null;write(db);return db;}
   if(cmd==='preview_merge_sessions'){
    const selected=data.filter(d=>args.sessionIds.includes(d.session.id));
    return {sources:selected.map(d=>({sessionId:d.session.id,contentVersion:d.session.id})),day:'2026-10-07',laps:selected.flatMap(d=>d.session.laps),channels:[],warnings:['Review source timing.'],previewVersion:'fixture'};
   }
   if(cmd==='save_workspace'){const found=db.entries.find(e=>e.id===args.sessionId);if(found)found.workspace=args.workspace;db.activeSessionId=args.sessionId;write(db);return;}
   if(cmd==='analyze_session'){
    const d=data.find(d=>d.session.id===args.sessionId),result=structuredClone(d.analyses[`${args.primaryId}:${args.axis}`]);
    result.comparison=args.comparisonId?structuredClone(d.analyses[`${args.comparisonId}:${args.axis}`].primary):null;
    for(const view of [result.primary,result.comparison].filter(Boolean))view.series=view.series.filter(s=>args.channelIds.includes(s.channelId));
    return result;
   }
   throw Error(`Unexpected IPC ${cmd}`);
  }};
  window.__seedLibrary=()=>{const entries=data.map(entry);write({entries,activeSessionId:entries[0].id,warnings:[]});};
 },recordings);
 await page.goto(server.resolvedUrls.local[0]);
 await expect(page.locator('.launch-workspace')).toBeVisible();await page.evaluate(()=>document.fonts.ready);
 await page.waitForTimeout(1100);
 const fonts=await page.evaluate(()=>({body:getComputedStyle(document.body).fontFamily,launch:getComputedStyle(document.querySelector('.launch-import-button')).fontFamily,header:getComputedStyle(document.querySelector('.titlebar .import-button')).fontFamily}));
 console.log('Computed fonts:',JSON.stringify(fonts));
 const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
 const documentNode=await cdp.send('DOM.getDocument');
 for(const selector of ['.launch-import-button','.titlebar .import-button']){
  const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:documentNode.root.nodeId,selector});
  const {fonts:rendered}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});
  console.log('Rendered font',selector,JSON.stringify(rendered));
 }
 await page.screenshot({path:`${output}/after-first-run.png`,animations:'disabled'});
 await page.setViewportSize({width:600,height:500});await page.screenshot({path:`${output}/after-first-run-compact.png`,animations:'disabled'});
 await page.getByRole('button',{name:'Switch to light theme'}).click();
 await page.screenshot({path:`${output}/after-first-run-light-compact.png`,animations:'disabled'});
 await page.setViewportSize({width:1600,height:1000});
 await page.screenshot({path:`${output}/after-first-run-light.png`,animations:'disabled'});
 await page.getByRole('button',{name:'Switch to dark theme'}).click();
 {
  await page.evaluate(()=>{const transfer=new DataTransfer();transfer.setData('text/plain','not a recording');document.querySelector('.app').dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer:transfer}));});
  await expect(page.locator('.drop-overlay')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>window.__dragReady())).toBe(true);
  await page.evaluate(()=>window.__emitDrag('enter',['C:\\laps\\0361.xrk']));
  await expect(page.locator('.drop-overlay')).toBeVisible();
  await page.evaluate(()=>window.__emitDrag('over'));
  await expect(page.locator('.drop-overlay')).toBeVisible();
  await page.evaluate(()=>window.__emitDrag('leave'));
  await expect(page.locator('.drop-overlay')).toHaveCount(0);
  // Cancelled selection is a no-op; the next batch exercises partial failure.
  await page.getByRole('button',{name:/Import telemetry/}).click();
  await expect(page.getByRole('region',{name:'Telemetry import'})).toHaveCount(0);
  await page.evaluate(()=>{window.__pickedPaths=['C:\\laps\\0361.xrk','C:\\laps\\0362.xrk','C:\\laps\\bad.xrk','C:\\laps\\0361.xrk'];});
  await page.getByRole('button',{name:/Import telemetry/}).click();
  const receipt=page.getByRole('region',{name:'Telemetry import'});
  await expect(receipt.getByRole('progressbar',{name:'Files processed'})).toBeVisible();
  await expect(receipt.getByText('Reading XRK')).toBeVisible();
  await page.screenshot({path:`${output}/after-import-progress.png`,animations:'disabled'});
  await expect(receipt.getByText('Import complete with issues')).toBeVisible();
  assert.deepEqual(await page.evaluate(()=>window.__importLog),['C:\\laps\\0361.xrk','C:\\laps\\0362.xrk','C:\\laps\\bad.xrk','C:\\laps\\0361.xrk']);
  await expect(receipt.locator('[data-status="added"]')).toHaveCount(2);
  await expect(receipt.locator('[data-status="existing"]')).toHaveCount(1);
  await expect(receipt.locator('[data-status="error"]')).toHaveCount(1);
  await expect(receipt).toContainText('Unreadable XRK');
  await page.screenshot({path:`${output}/after-import-results.png`,animations:'disabled'});
  await receipt.getByRole('button',{name:'Done'}).click();
  await expect(receipt).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Import telemetry/})).toBeFocused();
  await page.evaluate(()=>{window.__pickedPaths=['C:\\laps\\0361.xrk'];});
  await page.getByRole('button',{name:/Import telemetry/}).click();
  await expect(receipt.getByText('Already in library')).toBeVisible();
  await expect(receipt).toContainText('Saved workspace preserved');
  await page.evaluate(()=>{window.__pickedPaths=null;});
  await receipt.getByRole('button',{name:'Import more'}).focus();
  await receipt.getByRole('button',{name:'Import more'}).click();
  await expect(receipt).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Import telemetry/})).toBeFocused();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('library-premium-fixture')).entries.length),2);
  await page.evaluate(id=>{const db=JSON.parse(localStorage.getItem('library-premium-fixture'));db.entries.find(e=>e.id===id).status='missing';localStorage.setItem('library-premium-fixture',JSON.stringify(db));},recordings[0].session.id);
  await page.reload();
  await page.evaluate(()=>{window.__pickedPaths=['C:\\laps\\0361.xrk'];});
  await page.getByRole('button',{name:/Import telemetry/}).click();
  await expect(receipt.getByText('Source reconnected')).toBeVisible();
  await expect(receipt.locator('[data-status="reconnected"]')).toHaveCount(1);
  await receipt.getByRole('button',{name:'Done'}).click();
  await page.evaluate(()=>{window.__pickedPaths=['C:\\laps\\bad.xrk'];});
  await page.keyboard.press('Control+o');
  await expect(receipt.getByRole('heading',{name:'Import needs attention'})).toBeVisible();
  await expect(receipt.locator('[data-status="error"]')).toHaveCount(1);
  await page.screenshot({path:`${output}/after-import-error.png`,animations:'disabled'});
  await receipt.getByRole('button',{name:'Done'}).click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('library-premium-fixture')).entries.length),2);
  const second=page.locator('.session-button[title*="0362.xrk"]');
  await second.click();
  await expect(second).toHaveAttribute('aria-current','true');
  await page.getByRole('button',{name:'Time',exact:true}).click();
  await page.getByRole('button',{name:'Compare lap 2',exact:true}).click();
  await expect.poll(()=>page.evaluate(id=>JSON.parse(localStorage.getItem('library-premium-fixture')).entries.find(e=>e.id===id)?.workspace?.axis,recordings[1].session.id)).toBe('time');
  const saved=await page.evaluate(id=>JSON.parse(localStorage.getItem('library-premium-fixture')).entries.find(e=>e.id===id).workspace,recordings[1].session.id);
  assert(saved.primary&&saved.comparison,'primary and comparison selection are saved');
  await page.reload();
  await expect(second).toHaveAttribute('aria-current','true');
  await expect(page.getByRole('button',{name:'Compare lap 2',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.segmented[aria-label="Horizontal axis"] button.active')).toHaveText('Time');
  await page.setViewportSize({width:600,height:500});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{window.__pickedPaths=['C:\\laps\\0361.xrk'];});
  await page.getByRole('button',{name:/Import telemetry/}).click();
  await expect(receipt.getByText('Already in library')).toBeVisible();
  await page.screenshot({path:`${output}/after-import-compact.png`,animations:'disabled'});
  const rawReceipt=page.locator('.import-receipt');
  await page.getByRole('button',{name:'Open session explorer'}).click();
  await expect(rawReceipt).toHaveAttribute('inert','');
  await expect(rawReceipt).toHaveAttribute('aria-hidden','true');
  await expect(receipt).toHaveCount(0);
  await page.getByRole('button',{name:'Session explorer actions'}).click();
  await page.getByRole('menuitem',{name:'Merge sessions'}).click();
  const boxes=page.getByRole('checkbox',{name:/for merging/});
  await boxes.nth(0).check();await boxes.nth(1).check();
  await page.getByRole('button',{name:'Merge Sessions',exact:true}).click();
  const merge=page.getByRole('dialog',{name:'Merge sessions'});
  await expect(merge).toBeVisible();
  await expect(merge).toBeFocused();
  const heading=merge.getByRole('heading',{name:'Merge sessions'});
  await expect(heading).toBeVisible();
  const titleBox=await heading.boundingBox(),dialogBox=await merge.boundingBox();
  assert(titleBox&&dialogBox&&titleBox.y>=dialogBox.y&&titleBox.y+titleBox.height<=dialogBox.y+dialogBox.height,'merge title starts fully inside the visible compact dialog');
  await expect(rawReceipt).toHaveAttribute('inert','');
  await expect(rawReceipt).toHaveAttribute('aria-hidden','true');
  await page.screenshot({path:`${output}/after-merge-compact.png`,animations:'disabled'});
  await page.keyboard.press('Shift+Tab');
  await expect(merge.getByRole('button',{name:'Cancel'})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(merge.getByRole('checkbox',{name:'I have reviewed these warnings'})).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(merge.getByRole('button',{name:'Cancel'})).toBeFocused();
  await merge.getByRole('button',{name:'Cancel'}).click();
  await page.locator('.library-entry').filter({has:page.locator('.session-button[title*="0361.xrk"]')}).getByRole('button',{name:'Session actions'}).click();
  await page.getByRole('menuitem',{name:'Remove',exact:true}).click();
  await expect(page.locator('.session-button[title*="0361.xrk"]')).toHaveCount(0);
  await page.getByRole('dialog',{name:'Session explorer'}).getByRole('button',{name:'Close session explorer'}).click();
  await expect(rawReceipt).not.toHaveAttribute('inert','');
  await expect(rawReceipt).not.toHaveAttribute('aria-hidden','true');
  await expect(receipt.getByText(/Recording unavailable/)).toBeVisible();
  const unavailable=receipt.getByRole('button',{name:'Open Warm-up'});
  await expect(unavailable).toBeDisabled();
  const beforeUnavailable=await page.evaluate(()=>({active:JSON.parse(localStorage.getItem('library-premium-fixture')).activeSessionId,loads:window.__loadLog.length}));
  await unavailable.evaluate(button=>button.click());
  assert.deepEqual(await page.evaluate(()=>({active:JSON.parse(localStorage.getItem('library-premium-fixture')).activeSessionId,loads:window.__loadLog.length})),beforeUnavailable,'removed receipt target cannot open a fallback recording');
  await receipt.getByRole('button',{name:'Done'}).focus();await page.keyboard.press('Escape');
  await expect(receipt).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Import telemetry/})).toBeFocused();
  await page.getByRole('button',{name:'Switch to light theme'}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'compact light layout avoids horizontal document overflow');
  await page.screenshot({path:`${output}/after-light-compact.png`,animations:'disabled'});
  await page.getByRole('button',{name:'Switch to dark theme'}).click();
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.setViewportSize({width:1600,height:1000});
 }
 await page.evaluate(()=>window.__seedLibrary());await page.reload();
 await page.locator('.workspace-heading').waitFor();await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:`${output}/after-library.png`,animations:'disabled'});
 await expect.poll(()=>page.evaluate(()=>window.__dragReady())).toBe(true);
 await page.evaluate(()=>window.__emitDrag('enter',['C:\\laps\\0362.xrk']));
 await expect(page.locator('.drop-overlay')).toBeVisible();
 await page.evaluate(()=>window.__emitDrag('drop',['C:\\laps\\0362.xrk']));
 await expect(page.locator('.drop-overlay')).toHaveCount(0);
 await expect(page.getByRole('region',{name:'Telemetry import'}).getByText('Already in library')).toBeVisible();
 await page.getByRole('region',{name:'Telemetry import'}).getByRole('button',{name:'Done'}).click();
 await page.locator('.library-entry.active').getByRole('button',{name:'Session actions'}).click();
 await page.getByRole('menuitem',{name:'Edit details'}).click();
 await expect(page.getByRole('dialog',{name:'Edit session details'})).toBeVisible();
 await page.screenshot({path:`${output}/after-details.png`,animations:'disabled'});
 await page.getByRole('dialog',{name:'Edit session details'}).getByRole('button',{name:'Cancel'}).click();
 await page.setViewportSize({width:600,height:500});await page.screenshot({path:`${output}/after-library-compact.png`,animations:'disabled'});
 assert.deepEqual(errors,[]);
 console.log('PASS: First-run, import, session restoration and responsive checks with real-recording diagnostics; IPC simulated.');
} finally {await browser?.close();await server?.close();}
