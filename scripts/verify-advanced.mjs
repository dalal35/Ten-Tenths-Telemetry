import {launchBrowser,browserTestEntries,browserTestNoWatch} from './browser.mjs';
// Actual App, IPC simulation backed by read-only real-XRK Rust diagnostic outputs.
import {expect} from '@playwright/test';
import {createServer} from 'vite';
import {readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const fixture=readdirSync('data').filter(n=>n.toLowerCase().endsWith('.xrk')).sort()[0];
assert(fixture,'Place real XRK fixtures in data/ before running advanced checks.');
const data=JSON.parse(process.env.ADVANCED_FIXTURE_JSON?readFileSync(process.env.ADVANCED_FIXTURE_JSON,'utf8'):execFileSync('cargo',['run','--offline','--manifest-path','src-tauri/Cargo.toml','--example','advanced_check','--',`data/${fixture}`],{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','inherit']}));
let server,browser;
try {
 server=await createServer({plugins:[browserTestNoWatch],optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});await server.listen();
 browser=await launchBrowser();
 const page=await browser.newPage({viewport:{width:1600,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(d=>{
  window.isTauri=true;window.__advancedCalls=[];window.__validationPending=[];window.__analysisPending=[];
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  d.snapshot.entries.push({...structuredClone(d.snapshot.entries[0]),id:'race-session-b',name:'Race session B',track:'Race session B'});
  const read=()=>JSON.parse(localStorage.getItem('advanced-library')||JSON.stringify(d.snapshot));
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,invoke:async(cmd,args={})=>{
   window.__advancedCalls.push({cmd,args});
   if(cmd.startsWith('plugin:event'))return 1;
   if(cmd==='library_snapshot')return read();
   if(cmd==='load_library_session'){const session=args.sessionId==='race-session-b'?{...d.session,id:'race-session-b',name:'Race session B',track:'Race session B'}:d.session;return localStorage.getItem('advanced-empty-session')==='true'?{...session,channels:[],laps:[]}:session;}
   if(cmd==='save_workspace'){const db=read();db.entries.find(e=>e.id===args.sessionId).workspace=args.workspace;localStorage.setItem('advanced-library',JSON.stringify(db));return;}
   if(cmd==='validate_formulas'){if(window.__holdValidation)await new Promise(resolve=>window.__validationPending.push(resolve));if(!Array.isArray(args.formulas)||!args.sessionId)throw Error('Invalid validate_formulas arguments');if(args.formulas.some(f=>f.expression.includes('missing')))throw Error('Unknown channel missing');return args.formulas.map(f=>({id:f.id,name:f.name,unit:'rpm'}));}
   if(cmd==='analyze_session'){const a=structuredClone(d.analysis);for(const v of [a.primary,a.comparison].filter(Boolean))v.series=v.series.filter(s=>args.channelIds.includes(s.channelId));return a;}
   if(cmd==='analyze_advanced'){if(window.__holdAnalysis)await new Promise(resolve=>window.__analysisPending.push(resolve));if(!args.request||!Array.isArray(args.formulas)||!args.sessionId||!args.primaryId)throw Error('Invalid analyze_advanced arguments');const a=structuredClone(d.variants[args.request.tool]||d.variants.scatter);if(window.__emptyAdvanced){for(const l of a.laps){l.points=[];l.histogram=[];l.events=[];}a.notes=['No supported samples: synthetic missing-data boundary'];}if(args.request.tool==='scatter'&&args.request.xChannel===d.ids.speed){[a.xUnit,a.yUnit]=[a.yUnit,a.xUnit];for(const lap of a.laps){lap.points=lap.points.map(p=>({...p,x:p.y,y:p.x}));[lap.stats,lap.yStats]=[lap.yStats,lap.stats];}}for(const l of a.laps)l.events=l.events.filter(e=>!args.request.excludedIds?.includes(e.id));return a;}
   throw Error(`Unexpected advanced IPC ${cmd}`);
  }};
 },data);
 await page.goto(`${server.resolvedUrls.local[0]}tests/advanced.html`);
 await page.getByRole('heading',{name:data.session.track}).waitFor();
 // Keep assertions strict: controls are the actual application contract.
 await page.getByRole('button',{name:'Advanced',exact:true}).click();
 await page.getByRole('tab',{name:'Scatter Plot',exact:true}).click();
 await page.waitForFunction(()=>window.__advancedCalls.some(c=>c.cmd==='analyze_advanced'&&c.args.request.tool==='scatter'));
 const canvas=page.locator('.advanced-workspace canvas:not(.analysis-cursor-layer)');await canvas.waitFor();const points=data.variants.scatter.laps.flatMap(l=>l.points);const xs=points.map(p=>p.x),ys=points.map(p=>p.y);const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);const point=points[Math.floor(points.length/3)];const box=await canvas.boundingBox();await canvas.click({position:{x:62+(point.x-minX)/(maxX-minX)*(box.width-80),y:box.height-44-(point.y-minY)/(maxY-minY)*(box.height-62)}});await page.locator('.point-inspector').waitFor();await page.waitForFunction(()=>window.advancedPlotCursors().some(p=>p.left>0));
 // Speed controls display mph, while IPC keeps original channel units.
 const speed=data.session.channels.find(c=>c.id===data.ids.speed);
 assert(speed,'Real fixture must contain the speed channel');
 const speedFactor=({'km/h':.6213711922,kph:.6213711922,kmh:.6213711922,'m/s':2.2369362921,mps:2.2369362921,mph:1})[speed.unit.trim().toLowerCase()];
 assert(speedFactor,'Real speed channel must declare a supported speed unit');
 const close=(actual,expected)=>Math.abs(actual-expected)<1e-7;
 assert.match(await page.getByLabel('X channel',{exact:true}).locator(`option[value="${speed.id}"]`).innerText(),/mph/);
 await page.getByLabel('X channel',{exact:true}).selectOption(speed.id);
 await page.waitForFunction(id=>window.__advancedCalls.some(c=>c.cmd==='analyze_advanced'&&c.args.request.xChannel===id),speed.id);
 const speedMin=data.variants.scatter.laps[0].yStats.min*speedFactor;
 const shownMin=speedMin.toLocaleString(undefined,{maximumFractionDigits:2});
 await page.waitForFunction(expected=>Array.from(document.querySelectorAll('.analysis-statistics .primary-stat dt')).some(dt=>dt.textContent==='Min'&&dt.nextElementSibling?.textContent?.includes(expected)),shownMin);
 assert.match(await page.locator('.analysis-statistics').innerText(),/mph/);
 await page.getByLabel('Value filter channel').selectOption(speed.id);
 await page.getByLabel('Filter min',{exact:true}).fill('40');
 await page.getByLabel('Filter max',{exact:true}).fill('90');
 await page.waitForFunction(({id,factor})=>window.__advancedCalls.some(c=>c.cmd==='analyze_advanced'&&c.args.request.valueFilter?.channel===id&&Math.abs(c.args.request.valueFilter.min-40/factor)<1e-7&&Math.abs(c.args.request.valueFilter.max-90/factor)<1e-7),{id:speed.id,factor:speedFactor});
 assert(close(Number(await page.getByLabel('Filter min',{exact:true}).inputValue()),40));
 await page.getByLabel('Value filter channel').selectOption('');
 await page.locator('.axis-options summary').click();
 await page.getByLabel('X max',{exact:true}).fill('120');
 await page.getByLabel('X min',{exact:true}).fill('20');
 await page.waitForFunction(factor=>{const r=JSON.parse(localStorage.getItem('advanced-library')||'{}').entries?.[0]?.workspace?.advanced?.config?.xRange;return r&&Math.abs(r[0]-20/factor)<1e-7&&Math.abs(r[1]-120/factor)<1e-7;},speedFactor);
 assert(close(Number(await page.getByLabel('X min',{exact:true}).inputValue()),20));
 await page.getByRole('button',{name:'Automatic ranges',exact:true}).click();
 await page.getByLabel('X channel',{exact:true}).selectOption(data.ids.rpm);
 await page.getByLabel('Value filter channel').selectOption(data.ids.rpm);await page.getByLabel('Filter min').fill('8200');
 await page.waitForFunction(()=>window.__advancedCalls.some(c=>c.cmd==='analyze_advanced'&&c.args.request.valueFilter?.min===8200));
 await page.getByLabel('Value filter channel').selectOption('');
 await page.getByRole('tab',{name:'Histograms',exact:true}).click();
 await page.getByLabel('Distribution channel',{exact:true}).selectOption(speed.id);
 await page.getByLabel('Bin width',{exact:true}).fill('5');
 await page.waitForFunction(({id,factor})=>window.__advancedCalls.some(c=>c.cmd==='analyze_advanced'&&c.args.request.histChannel===id&&Math.abs(c.args.request.binWidth-5/factor)<1e-7),{id:speed.id,factor:speedFactor});
 assert(close(Number(await page.getByLabel('Bin width',{exact:true}).inputValue()),5));
 await page.getByLabel('Bin width',{exact:true}).fill('');
 await page.getByLabel('Distribution channel',{exact:true}).selectOption(data.ids.rpm);
 await page.getByLabel('Bin count').fill('42');await page.getByLabel('Weighting',{exact:true}).selectOption('samples');await page.getByLabel('Distribution display').selectOption('count');
 await page.waitForFunction(()=>window.__advancedCalls.some(c=>c.cmd==='analyze_advanced'&&c.args.request.bins===42&&c.args.request.weighting==='samples'&&!c.args.request.percentage));
 await page.getByRole('tab',{name:'Shift Analysis',exact:true}).click();
 const event=page.locator('.event-table tbody tr').first();await event.waitFor();await event.locator('td button').first().click();await page.waitForFunction(()=>window.advancedPlotCursors().some(p=>p.left>0));
 const selectedCaption=await page.locator('.map-caption').innerText();
 assert(!/Infinity|NaN/.test(selectedCaption),'Selected shift must have a finite map cursor');
 for(const tool of ['RPM Bogging','Shift Analysis']){
  await page.getByRole('tab',{name:tool,exact:true}).click();await page.waitForTimeout(200);
  assert.equal(await page.locator('.map-caption').innerText(),selectedCaption,'Event-tool plot rebuild must preserve the shared finite cursor');
  const cursors=await page.evaluate(()=>window.advancedPlotCursors());
  assert(cursors.length>0&&cursors.every(p=>Number.isFinite(p.position)&&p.left>=0),'Rebuilt plots retain finite synchronized cursors');
  assert((await page.locator('.readout').first().innerText()).match(/\d/),'Rebuilt plots retain numerical readouts');
 }

 await event.getByRole('button',{name:/Exclude event/}).click();
 await page.waitForFunction(()=>window.__advancedCalls.some(c=>c.cmd==='analyze_advanced'&&c.args.request.excludedIds.length===1));
 await page.getByRole('tab',{name:'Custom Math Channels',exact:true}).click();
 await page.getByLabel('Formula name').fill('Invalid');await page.getByLabel('Formula expression').fill('[missing]');await page.getByRole('button',{name:'Validate and save',exact:true}).click();await page.getByRole('alert').filter({hasText:'Unknown channel missing'}).waitFor();
 await page.getByLabel('Formula name').fill('Browser RPM');await page.getByLabel('Formula expression').fill(`[${data.ids.rpm}] * 2`);await page.getByRole('button',{name:'Validate and save',exact:true}).click();
 await page.getByRole('button',{name:'Edit Browser RPM',exact:true}).waitFor();
 // Validated math metadata is offered to existing selectors and passed unchanged to analysis.
 const mathId=await page.evaluate(()=>JSON.parse(localStorage.getItem('advanced-library')).entries[0].workspace.advanced.formulas.find(f=>f.name==='Browser RPM').id);
 await page.getByRole('tab',{name:'Scatter Plot',exact:true}).click();
 await expect(page.getByLabel('X channel',{exact:true}).locator(`option[value="${mathId}"]`)).toHaveCount(1);
 await page.getByLabel('X channel',{exact:true}).selectOption(mathId);
 await page.waitForFunction(id=>window.__advancedCalls.some(c=>c.cmd==='analyze_advanced'&&c.args.request.xChannel===id&&c.args.formulas.some(f=>f.id===id)),mathId);
 await page.getByRole('tab',{name:'Custom Math Channels',exact:true}).click();

 await page.getByRole('button',{name:'Duplicate Browser RPM',exact:true}).click();await page.getByRole('button',{name:'Validate and save',exact:true}).click();await page.getByRole('button',{name:'Delete Browser RPM copy',exact:true}).click();
 await page.getByRole('button',{name:'Edit Browser RPM',exact:true}).click();await page.getByLabel('Formula name').fill('Browser RPM edited');await page.getByRole('button',{name:'Validate and save',exact:true}).click();await page.getByRole('button',{name:'Edit Browser RPM edited',exact:true}).waitFor();
 await page.getByLabel('Manage presets').click();await page.getByLabel('Preset name',{exact:true}).fill('Browser preset');await page.getByRole('button',{name:'Save new preset',exact:true}).click();await page.getByRole('button',{name:'Use as default',exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('advanced-library')||'{}').entries?.[0]?.workspace?.advanced?.formulas?.some(f=>f.name==='Browser RPM edited'));
 await page.waitForTimeout(500);await page.reload();await page.getByRole('button',{name:'Advanced',exact:true}).click();await page.getByRole('tab',{name:'Custom Math Channels',exact:true}).click();await page.getByRole('button',{name:'Edit Browser RPM edited',exact:true}).waitFor();assert.match(await page.getByLabel('Analysis preset').locator('option:checked').innerText(),/Browser preset/);
 // Responsive canvas sizes are temporary; saved resize preference and zoom survive resizing.
 await page.getByRole('tab',{name:'Scatter Plot',exact:true}).click();
 await page.getByLabel('X channel',{exact:true}).selectOption(data.ids.rpm);
 await page.getByRole('separator',{name:'Resize analysis panel'}).focus();await page.keyboard.press('ArrowDown');
 await page.waitForTimeout(250);
 const savedHeight=await page.evaluate(()=>JSON.parse(localStorage.getItem('advanced-library')).entries[0].workspace.advanced.config.panelHeight);
 await canvas.scrollIntoViewIfNeeded();await canvas.hover({position:{x:100,y:100}});await page.mouse.wheel(0,-120);await expect(page.getByRole('button',{name:'Reset view',exact:true})).toBeVisible();
 const stableCaption=await page.locator('.map-caption').innerText();
 for(const viewport of [{width:600,height:500},{width:1600,height:1000},{width:2560,height:1440}]){
  await page.setViewportSize(viewport);await page.waitForTimeout(250);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`No page overflow at ${viewport.width}x${viewport.height}`);
  const bounds=await canvas.boundingBox();assert(bounds.width>240&&bounds.height>=240&&bounds.height<=viewport.height,`Useful constrained canvas at ${viewport.width}x${viewport.height}`);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('advanced-library')).entries[0].workspace.advanced.config.panelHeight),savedHeight,'Viewport clamp does not overwrite saved preference');
  assert.equal(await page.locator('.map-caption').innerText(),stableCaption,'Resize keeps shared cursor');
  await expect(page.getByRole('button',{name:'Reset view',exact:true})).toBeVisible();
  await page.screenshot({path:`.tools/advanced-workspace-${viewport.width}x${viewport.height}.png`,fullPage:true});
  await page.getByRole('tab',{name:'Shift Analysis',exact:true}).click();await expect(page.locator('.event-table-scroll')).toBeVisible();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Event table overflow stays local');
  await page.getByRole('tab',{name:'Custom Math Channels',exact:true}).click();await expect(page.getByLabel('Formula expression')).toBeVisible();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Formula editor stays inside viewport');
  await page.getByRole('tab',{name:'Scatter Plot',exact:true}).click();await canvas.waitFor();
 }
 await page.setViewportSize({width:1600,height:1100});await page.getByRole('tab',{name:'Custom Math Channels',exact:true}).click();
 // Missing result data clears existing event evidence and presents useful empty diagnostics.
 await page.evaluate(()=>window.__emptyAdvanced=true);await page.getByRole('tab',{name:'Shift Analysis',exact:true}).click();
 await expect(page.locator('.empty-events')).toContainText('No supported');await expect(page.locator('.event-table tbody tr')).toHaveCount(0);
 await page.getByRole('tab',{name:'Scatter Plot',exact:true}).click();await expect(page.locator('.surface-empty')).toContainText('No supported samples');
 await page.evaluate(()=>window.__emptyAdvanced=false);await page.getByRole('tab',{name:'G-G Traction Circle',exact:true}).click();
 await page.waitForFunction(()=>window.__advancedCalls.some(c=>c.cmd==='analyze_advanced'&&c.args.request.tool==='traction'));
 await page.getByRole('tab',{name:'Custom Math Channels',exact:true}).click();
 // A delayed save must merge into the latest tool/preset state.
 await page.getByLabel('Formula name').fill('Delayed RPM');await page.getByLabel('Formula expression').fill(`[${data.ids.rpm}]`);
 await page.evaluate(()=>window.__holdValidation=true);await page.getByRole('button',{name:'Validate and save',exact:true}).click();
 await page.waitForFunction(()=>window.__validationPending.length===1);
 await page.getByRole('tab',{name:'Histograms',exact:true}).click();await page.getByLabel('Bin count').fill('57');
 await page.evaluate(()=>{window.__holdValidation=false;window.__validationPending.splice(0).forEach(resolve=>resolve());});
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('advanced-library')).entries[0].workspace.advanced.formulas.some(f=>f.name==='Delayed RPM'));
 assert.equal(await page.getByRole('tab',{name:'Histograms',exact:true}).getAttribute('aria-selected'),'true','Delayed formula save must preserve selected tool');
 assert.equal(await page.getByLabel('Bin count').inputValue(),'57','Delayed formula save must preserve current controls');
 // Delete validation must also preserve subsequent controls.
 await page.getByRole('tab',{name:'Custom Math Channels',exact:true}).click();await page.evaluate(()=>window.__holdValidation=true);
 await page.getByRole('button',{name:'Delete Delayed RPM',exact:true}).click();await page.waitForFunction(()=>window.__validationPending.length===1);
 await page.getByRole('tab',{name:'Histograms',exact:true}).click();await page.getByLabel('Bin count').fill('61');
 await page.evaluate(()=>{window.__holdValidation=false;window.__validationPending.splice(0).forEach(resolve=>resolve());});
 await page.waitForFunction(()=>!JSON.parse(localStorage.getItem('advanced-library')).entries[0].workspace.advanced.formulas.some(f=>f.name==='Delayed RPM'));
 assert.equal(await page.getByLabel('Bin count').inputValue(),'61');
 // A validation started in A cannot write A's formulas into newly selected B.
 await page.getByRole('tab',{name:'Custom Math Channels',exact:true}).click();await page.getByLabel('Formula name').fill('Session A only');await page.getByLabel('Formula expression').fill(`[${data.ids.rpm}]`);
 await page.evaluate(()=>window.__holdValidation=true);await page.getByRole('button',{name:'Validate and save',exact:true}).click();await page.waitForFunction(()=>window.__validationPending.length===1);
 await page.locator('.session-button').filter({hasText:'Race session B'}).click();await page.getByRole('heading',{name:'Race session B',exact:true}).waitFor();
 await page.evaluate(()=>{window.__holdValidation=false;window.__validationPending.splice(0).forEach(resolve=>resolve());});await page.waitForTimeout(250);
 await page.getByRole('button',{name:'Advanced',exact:true}).click();await page.getByRole('tab',{name:'Custom Math Channels',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Edit Session A only',exact:true}).count(),0);
 assert.ok(!await page.evaluate(()=>JSON.parse(localStorage.getItem('advanced-library')).entries.find(e=>e.id==='race-session-b').workspace?.advanced?.formulas?.some(f=>f.name==='Session A only')));
 // The old Advanced instance must not leak event markers after unmount.
 await page.evaluate(()=>window.__holdAnalysis=true);await page.getByRole('tab',{name:'Shift Analysis',exact:true}).click();await page.waitForFunction(()=>window.__analysisPending.length===1);
 await page.getByRole('button',{name:'Telemetry',exact:true}).click();await page.getByRole('button',{name:'Advanced',exact:true}).click();await page.getByRole('tab',{name:'Custom Math Channels',exact:true}).click();
 await page.evaluate(()=>{window.__holdAnalysis=false;window.__analysisPending.splice(0).forEach(resolve=>resolve());});await page.waitForTimeout(250);
 assert.equal(await page.locator('.map-event').count(),0,'Unmounted analysis must not leak event markers');
 // An actual session without channels or laps never invokes analysis with a missing primary.
 await page.evaluate(()=>localStorage.setItem('advanced-empty-session','true'));await page.reload();
 await page.getByRole('button',{name:'Advanced',exact:true}).click();
 await expect(page.getByText('Choose a lap to explore its telemetry.',{exact:true})).toBeVisible();
 await expect(page.locator('.advanced-workspace canvas')).toHaveCount(0);
 await expect(page.locator('.event-table tbody tr')).toHaveCount(0);
 assert.equal(await page.evaluate(()=>window.__advancedCalls.filter(c=>c.cmd==='analyze_advanced'||c.cmd==='analyze_session').length),0,'Empty session must not request analysis without a selected lap');
 assert.deepEqual(errors,[]);console.log('PASS: actual App real-output-backed advanced navigation, shared scatter/event cursor, mph statistics and inverse speed controls, filters, histogram, event exclusion, formula CRUD/validation, preset restart, delayed save/delete merge, cross-session validation isolation, unmount event isolation, empty session with no channels/laps');
} finally {await browser?.close();server?.httpServer?.closeIdleConnections();server?.httpServer?.closeAllConnections();await server?.close();}
