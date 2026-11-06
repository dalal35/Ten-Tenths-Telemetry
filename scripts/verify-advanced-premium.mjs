// Local acceptance against real XRK diagnostics. Recordings and captures stay local.
// Reuse ADVANCED_BACKEND_EXE, or explicitly prepare once with ADVANCED_PREPARE=1
// and ADVANCED_TARGET_DIR=<directory with sufficient free space>. No app build.
import {launchBrowser,browserTestEntries,browserTestNoWatch} from './browser.mjs';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {copyFileSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {extname,join,resolve,sep} from 'node:path';
import assert from 'node:assert/strict';

const output=resolve(process.env.ADVANCED_OUTPUT_DIR||'.tools/advanced-ui');mkdirSync(output,{recursive:true});
function prepareDiagnostic(){
 assert(process.env.ADVANCED_TARGET_DIR,'Set ADVANCED_TARGET_DIR to a directory with sufficient free space before preparing the diagnostic.');
 const crate=resolve('.tools/advanced-ui/diagnostic'),target=resolve(process.env.ADVANCED_TARGET_DIR),tmp=join(target,'tmp');
 mkdirSync(join(crate,'src'),{recursive:true});mkdirSync(tmp,{recursive:true});
 const rustPath=file=>JSON.stringify(resolve('src-tauri/src',file).replaceAll('\\','/'));
 const source=readFileSync('scripts/diagnostics/advanced-inspect.rs','utf8').replace('"__TELEMETRY_PATH__"',rustPath('telemetry/mod.rs')).replace('"__MERGING_PATH__"',rustPath('merging.rs'));
 writeFileSync(join(crate,'src/main.rs'),source);
 writeFileSync(join(crate,'Cargo.toml'),`[package]\nname = "ttt-advanced-inspect"\nversion = "0.1.0"\nedition = "2021"\n[dependencies]\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\nsha2 = "0.10.9"\nlibxrk = { git = "https://github.com/m3rlin45/libxrk", rev = "4e44d38debc9445b8e5446c9b7a241f5730ac920", default-features = false }\n[profile.dev]\ndebug = 0\nincremental = false\n`);
 copyFileSync('src-tauri/Cargo.lock',join(crate,'Cargo.lock'));
 execFileSync('cargo',['build','--offline','--manifest-path',join(crate,'Cargo.toml')],{stdio:'inherit',env:{...process.env,CARGO_TARGET_DIR:target,TEMP:tmp,TMP:tmp}});
 return join(target,'debug',`ttt-advanced-inspect${process.platform==='win32'?'.exe':''}`);
}
const backend=process.env.ADVANCED_BACKEND_EXE||(process.env.ADVANCED_PREPARE==='1'?prepareDiagnostic():null);
assert(backend,'Set ADVANCED_BACKEND_EXE, or explicitly set ADVANCED_PREPARE=1 and ADVANCED_TARGET_DIR.');
const recording=process.env.ADVANCED_XRK||resolve('data',readdirSync('data').find(n=>n.toLowerCase().endsWith('0361.xrk')));
const session=JSON.parse(execFileSync(backend,[],{input:JSON.stringify({mode:'session',path:recording}),encoding:'utf8',maxBuffer:128*1024*1024}));
const laps=session.laps.filter(l=>l.complete).sort((a,b)=>a.duration-b.duration);assert(laps.length>1,'Recording needs two complete laps');
const rpm=session.channels.find(c=>/rpm|engine.*(speed|revs)/i.test(c.name));assert(rpm,'Recording needs an RPM channel');
const channels=session.channels.filter(c=>/gps.*speed|rpm|engine.*(speed|revs)/i.test(c.name)).map(c=>c.id);
const workspace={contentVersion:'local-advanced-validation',primary:laps[0].id,comparison:laps[1].id,axis:'distance',channels,layout:'comfortable',zoom:null,view:'telemetry'};
const entry={id:session.id,contentVersion:workspace.contentVersion,source:session.source,name:session.name,driver:session.driver,track:session.track,recordedAt:session.recordedAt,lapCount:session.laps.length,channelCount:session.channels.length,status:'ready',workspace,lastUsed:1};
const data={session,snapshot:{entries:[entry],activeSessionId:entry.id,warnings:[]},ids:{rpm:rpm.id}};
const bootstrap=`window.isTauri=true;window.advancedCalls=[];window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,invoke:async(cmd,args={})=>{
 window.advancedCalls.push({cmd,args});if(cmd.startsWith('plugin:event'))return 1;
 const d=await (await fetch('/__advanced_fixture')).json();if(new URLSearchParams(location.search).has('advanced'))d.snapshot.entries[0].workspace.view='advanced';const read=()=>JSON.parse(localStorage.getItem('premium-advanced-library')||JSON.stringify(d.snapshot));
 if(cmd==='library_snapshot')return read();if(cmd==='load_library_session')return d.session;
 if(cmd==='save_workspace'){const db=read();db.entries.find(e=>e.id===args.sessionId).workspace=args.workspace;localStorage.setItem('premium-advanced-library',JSON.stringify(db));return;}
 if(['validate_formulas','analyze_session','analyze_advanced'].includes(cmd)){const response=await fetch('/__advanced_invoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cmd,args})});if(!response.ok)throw Error(await response.text());return response.json();}
 throw Error('Unexpected validation IPC: '+cmd);
}};`;
const invoke=async(req,res)=>{try{let body='';for await(const chunk of req)body+=chunk;const {cmd,args}=JSON.parse(body);const request={path:recording,mode:cmd==='validate_formulas'?'validate':cmd==='analyze_session'?'analysis':'advanced',primary:args.primaryId,comparison:args.comparisonId,axis:args.axis,channels:args.channelIds,request:args.request,formulas:args.formulas||[]};const value=execFileSync(backend,[],{input:JSON.stringify(request),encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']});res.setHeader('Content-Type','application/json');res.end(value);}catch(error){res.statusCode=500;res.end(String(error.stderr||error.message));}};
const fixture=(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
const adapter={name:'advanced-real-output',transformIndexHtml(){return [{tag:'script',children:bootstrap,injectTo:'head-prepend'}];},configureServer(server){server.middlewares.use('/__advanced_fixture',fixture);server.middlewares.use('/__advanced_invoke',invoke);}};
let server,browser;
try {
 const live=process.env.ADVANCED_SERVE==='1';
 let url;
 if(process.env.ADVANCED_PRODUCTION==='1') {const root=resolve('dist');const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};const http=createHttpServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/__advanced_fixture')return fixture(req,res);if(pathname==='/__advanced_invoke')return void invoke(req,res);try{const file=resolve(root,`.${pathname==='/'?'/index.html':pathname}`);if(file!==root&&!file.startsWith(root+sep))throw Error('Invalid path');let contents=readFileSync(file);res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');if(extname(file)==='.html')contents=Buffer.from(contents.toString().replace('<head>','<head><script>'+bootstrap+'</script>'));res.end(contents);}catch{res.statusCode=404;res.end('Not found');}});await new Promise(ok=>http.listen(0,'127.0.0.1',ok));server={close:()=>new Promise(ok=>http.close(ok))};url=`http://127.0.0.1:${http.address().port}/`;}
 else {server=await createServer({plugins:[...(!live?[browserTestNoWatch]:[]),adapter],optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,...(live?{watch:{ignored:['**/src-tauri/**','**/target/**','**/.tools/**','**/node_modules/**']}}:{})}});await server.listen();url=server.resolvedUrls.local[0];}
 if(live){console.log(`LIVE: ${url}`);await new Promise(resolve=>process.once('SIGINT',resolve));}
 else {
  browser=await launchBrowser();
  const page=await browser.newPage({viewport:{width:1440,height:920},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);if(laps.length>2){const compare=page.getByRole('button',{name:`Compare lap ${laps[2].number}`,exact:true});await compare.click();assert.equal(await compare.getAttribute('aria-pressed'),'true');}await page.getByRole('button',{name:'Advanced',exact:true}).click();
  await page.getByRole('tab',{name:'Scatter Plot',exact:true}).click();await page.locator('.analysis-statistics').waitFor();
  const prefix=recording.toLowerCase().includes('0362.xrk')?'0362':'0361';
  for(const [name,tool] of [['G-G Traction Circle','traction'],['Scatter Plot','scatter'],['Histograms','histogram'],['Shift Analysis','shifts'],['RPM Bogging','bog']]) {
   const reply=page.waitForResponse(r=>r.url().endsWith('/__advanced_invoke')&&r.request().postDataJSON()?.cmd==='analyze_advanced'&&r.request().postDataJSON()?.args.request.tool===tool&&r.ok());await page.getByRole('tab',{name,exact:true}).click();await reply;await page.locator('.analysis-statistics').waitFor();assert.equal(await page.locator('.analysis-statistics section').count(),2,'Both selected laps must be shown');
   await page.locator(tool==='shifts'||tool==='bog'?'.event-table-scroll':'.analysis-surface').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(output,`${prefix}-${tool}-workbench.png`),animations:'disabled'});
   if(tool==='traction'){await page.locator('.traction-calibration summary').click();const calls=await page.evaluate(()=>window.advancedCalls.filter(c=>c.cmd==='analyze_advanced').length);await page.getByLabel('Reference spacing · g').fill('1');await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>window.advancedCalls.filter(c=>c.cmd==='analyze_advanced').length),calls,'Reference grid must not recalculate analysis');await page.getByLabel('Reverse lateral').check();await page.waitForFunction(count=>window.advancedCalls.filter(c=>c.cmd==='analyze_advanced').length>count,calls);}
  }
  await page.getByRole('tab',{name:'Custom Math Channels',exact:true}).click();
  await page.getByLabel('Search channels').fill(rpm.name);assert(await page.locator('.formula-picker button').count()>0,'Channel search finds the RPM sensor');await page.getByLabel('Search channels').fill('');await page.locator('.workspace-viewport').evaluate(el=>el.scrollTop=0);await page.screenshot({path:resolve(output,`${prefix}-formulas-desktop-top.png`),animations:'disabled'});
  await page.getByLabel('Formula name').fill('Validation RPM');await page.getByLabel('Formula expression').fill(`[${data.ids.rpm}] * 2`);await page.getByRole('button',{name:'Validate and save',exact:true}).click();await page.getByRole('button',{name:'Edit Validation RPM',exact:true}).waitFor();
  await page.getByLabel('Manage presets').click();await page.getByLabel('Preset name',{exact:true}).fill('Validation preset');await page.getByRole('button',{name:'Save new preset',exact:true}).click();
  await page.waitForFunction(()=>{const a=JSON.parse(localStorage.getItem('premium-advanced-library')||'{}').entries?.[0]?.workspace?.advanced;return a?.formulas?.some(f=>f.name==='Validation RPM')&&a?.presets?.some(p=>p.name==='Validation preset')&&a.lastPreset===a.presets.find(p=>p.name==='Validation preset').id;});
  await page.reload();await page.getByRole('button',{name:'Advanced',exact:true}).click();await page.getByRole('tab',{name:'Custom Math Channels',exact:true}).click();await page.getByRole('button',{name:'Edit Validation RPM',exact:true}).waitFor();assert.match(await page.getByLabel('Analysis preset').locator('option:checked').innerText(),/Validation preset/);
  await page.getByRole('tab',{name:'Scatter Plot',exact:true}).click();await page.locator('.analysis-surface canvas:not(.analysis-cursor-layer)').waitFor();await page.locator('.analysis-statistics').waitFor();
  const canvas=page.locator('.analysis-surface canvas:not(.analysis-cursor-layer)');await canvas.evaluate(el=>window.testCanvas=el);await canvas.scrollIntoViewIfNeeded();await canvas.hover({position:{x:100,y:100}});await page.mouse.wheel(0,-120);await page.getByRole('button',{name:'Reset view',exact:true}).waitFor();
  await canvas.focus();await page.keyboard.press('ArrowRight');await page.locator('.point-inspector').waitFor();await page.waitForTimeout(600);
  await page.evaluate(()=>{window.cloudDraws=0;const original=CanvasRenderingContext2D.prototype.clearRect;CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas===window.testCanvas)window.cloudDraws++;return original.apply(this,args);};});
  await page.keyboard.press('Enter');await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.cloudDraws),0,'Cursor synchronization must not repaint the point cloud');await page.keyboard.press('+');await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Home');
  await page.getByRole('button',{name:'Hide setup'}).click();assert(await canvas.evaluate(el=>el===window.testCanvas),'Setup toggle retains chart');await page.getByRole('button',{name:'Show setup'}).click();
  await page.getByRole('button',{name:'Telemetry',exact:true}).click();await page.getByRole('button',{name:'Advanced',exact:true}).click();assert(await canvas.evaluate(el=>el===window.testCanvas),'Workspace navigation retains chart');
  const beforeView=await page.evaluate(()=>window.advancedCalls.filter(c=>c.cmd==='analyze_advanced').length);await page.locator('.axis-options summary').click();await page.getByLabel('X scale',{exact:true}).selectOption('log');await page.getByLabel('X scale',{exact:true}).selectOption('linear');await page.getByLabel('X max',{exact:true}).fill('120');await page.getByLabel('X min',{exact:true}).fill('20');await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>window.advancedCalls.filter(c=>c.cmd==='analyze_advanced').length),beforeView,'Local axis presentation must not recalculate analysis');await page.getByRole('button',{name:'Automatic ranges',exact:true}).click();
  const calls=await page.evaluate(()=>window.advancedCalls.filter(c=>c.cmd==='analyze_advanced').length);await page.getByRole('separator',{name:'Resize analysis panel'}).focus();await page.keyboard.press('ArrowDown');await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>window.advancedCalls.filter(c=>c.cmd==='analyze_advanced').length),calls,'Panel resize should not recalculate analysis');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('premium-advanced-library')).entries[0].workspace.advanced.config.panelHeight===420);const height=await page.evaluate(()=>JSON.parse(localStorage.getItem('premium-advanced-library')).entries[0].workspace.advanced.config.panelHeight);
  for(const [label,viewport] of [['desktop',{width:1440,height:920}],['medium',{width:1024,height:768}],['compact',{width:600,height:500}]]) {await page.setViewportSize(viewport);await page.waitForTimeout(250);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert(await canvas.evaluate(el=>el===window.testCanvas),'Viewport resize retains chart');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('premium-advanced-library')).entries[0].workspace.advanced.config.panelHeight),height);await page.locator('.workspace-viewport').evaluate(el=>el.scrollTop=0);await page.screenshot({path:resolve(output,`${prefix}-${label}.png`),animations:'disabled'});}
  assert.equal(await page.evaluate(()=>window.advancedCalls.filter(c=>c.cmd==='analyze_advanced').length),calls,'Viewport resizing should not recalculate analysis');await page.getByRole('button',{name:'Reset view',exact:true}).waitFor();
  await page.setViewportSize({width:1440,height:920});await page.getByRole('button',{name:'Switch to light theme'}).click();await page.locator('.workspace-viewport').evaluate(el=>el.scrollTop=0);await page.screenshot({path:resolve(output,`${prefix}-light.png`),animations:'disabled'});
  assert.deepEqual(errors,[]);await page.close();console.log(`PASS: real XRK analysis tools, formulas and preset persistence, plot zoom and resize: ${output}`);
 }
} finally {await browser?.close();await server?.close();}
