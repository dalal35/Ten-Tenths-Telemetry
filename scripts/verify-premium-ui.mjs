// Local-only App acceptance with production Rust telemetry analysis. Never uploads XRKs.
// PREMIUM_INSPECT_EXE points to a diagnostic which reads JSON on stdin and returns
// a parsed session or production telemetry::analyze result on stdout.
import {launchBrowser,browserTestEntries,browserTestNoWatch} from './browser.mjs';
import {createServer} from 'vite';
import {execFileSync} from 'node:child_process';
import {copyFileSync,mkdirSync,readdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';

const output=resolve(process.env.PREMIUM_OUTPUT_DIR||'.tools/premium-ui');
mkdirSync(output,{recursive:true});
function prepareDiagnostic(){
 const dir=join(output,'diagnostic'),target=resolve(process.env.CARGO_TARGET_DIR||join(dir,'target')),tmp=join(dir,'tmp');mkdirSync(join(dir,'src'),{recursive:true});mkdirSync(tmp,{recursive:true});
 const path=file=>JSON.stringify(resolve('src-tauri/src',file).replaceAll('\\','/'));
 writeFileSync(join(dir,'Cargo.toml'),`[package]\nname = "ttt-premium-inspect"\nversion = "0.1.0"\nedition = "2021"\n[dependencies]\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\nsha2 = "0.10.9"\nlibxrk = { git = "https://github.com/m3rlin45/libxrk", rev = "4e44d38debc9445b8e5446c9b7a241f5730ac920", default-features = false }\n`);
 writeFileSync(join(dir,'src/main.rs'),`#[path=${path('telemetry/mod.rs')}] mod telemetry;\n#[path=${path('merging.rs')}] mod merging;\nuse std::io::{self,Read};\nfn main()->Result<(),String>{let mut s=String::new();io::stdin().read_to_string(&mut s).map_err(|e|e.to_string())?;let q:serde_json::Value=serde_json::from_str(&s).map_err(|e|e.to_string())?;let session=telemetry::parse_session(std::path::Path::new(q["path"].as_str().ok_or("missing path")?))?;let output=if q["mode"]=="session"{serde_json::to_value(session)}else{let channels=q["channels"].as_array().ok_or("missing channels")?.iter().map(|c|c.as_str().unwrap_or_default().to_string()).collect::<Vec<_>>();serde_json::to_value(telemetry::analyze(&session,q["primary"].as_str().ok_or("missing primary")?,q["comparison"].as_str(),q["axis"].as_str().ok_or("missing axis")?,&channels)?)}.map_err(|e|e.to_string())?;println!("{}",output);Ok(())}\n`);
 copyFileSync('src-tauri/Cargo.lock',join(dir,'Cargo.lock'));
 execFileSync('cargo',['build','--offline','--manifest-path',join(dir,'Cargo.toml')],{stdio:'inherit',env:{...process.env,CARGO_TARGET_DIR:target,TEMP:tmp,TMP:tmp}});
 return join(target,'debug',`ttt-premium-inspect${process.platform==='win32'?'.exe':''}`);
}
const executable=process.env.PREMIUM_INSPECT_EXE||(process.env.PREMIUM_PREPARE==='1'?prepareDiagnostic():null);
assert(executable,'Set PREMIUM_INSPECT_EXE to the local diagnostic, or set PREMIUM_PREPARE=1 to build it in PREMIUM_OUTPUT_DIR.');
let recording=process.env.PREMIUM_XRK || resolve('data',readdirSync('data').find(name=>name.toLowerCase().endsWith('0361.xrk'))||'');
const call=request=>JSON.parse(execFileSync(executable,[],{input:JSON.stringify({...request,path:recording}),encoding:'utf8',maxBuffer:128*1024*1024}));
let session=call({mode:'session'});
let laps=session.laps.filter(lap=>lap.complete).sort((a,b)=>a.duration-b.duration);
assert(laps.length>1,'Real recording needs at least two complete laps.');
let channels=session.channels.filter(c=>/gps.*speed|rpm|engine.*(speed|revs)/i.test(c.name)).map(c=>c.id);
assert(channels.length>0,'Real recording needs a speed or RPM channel.');
const makeEntry=()=>{const workspace={contentVersion:'local-visual-validation',primary:laps[0].id,comparison:laps[1].id,axis:'distance',channels,layout:'comfortable',zoom:null,view:'telemetry'};return {id:session.id,contentVersion:workspace.contentVersion,source:session.source,name:session.name,driver:session.driver,track:session.track,recordedAt:session.recordedAt,lapCount:session.laps.length,channelCount:session.channels.length,status:'ready',workspace,lastUsed:1};};
let entry=makeEntry();
const bootstrap=`window.isTauri=true;window.premiumCalls=[];window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,invoke:async(cmd,args={})=>{
 window.premiumCalls.push({cmd,args});if(cmd.startsWith('plugin:event'))return 1;
 const data=await (await fetch('/__premium_session')).json(), initial={entries:[data.entry],activeSessionId:data.entry.id,warnings:[]};
 const read=()=>JSON.parse(localStorage.getItem('premium-test-library')||JSON.stringify(initial));
 if(cmd==='library_snapshot')return read();if(cmd==='load_library_session')return data.session;
 if(cmd==='save_workspace'){const db=read();db.entries[0].workspace=args.workspace;localStorage.setItem('premium-test-library',JSON.stringify(db));return;}
 if(cmd==='analyze_session'){const response=await fetch('/__premium_analysis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});if(!response.ok)throw Error(await response.text());return response.json();}
 if(cmd==='validate_formulas')return [];throw Error('Unexpected validation IPC: '+cmd);
}};`;
const baseline=process.env.PREMIUM_BASELINE==='1';
const originals=new Map();
if(baseline){for(const name of execFileSync('git',['diff','--name-only','HEAD','--','src'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean)){try{originals.set(resolve(name).replaceAll('\\','/'),execFileSync('git',['show',`HEAD:${name}`],{encoding:'utf8'}));}catch{}}}
const adapter={name:'real-telemetry-acceptance',enforce:'pre',load(id){return originals.get(id.replaceAll('\\','/'));},transformIndexHtml(){return [{tag:'script',children:bootstrap,injectTo:'head-prepend'}];},configureServer(server){server.middlewares.use('/__premium_session',(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({session,entry}));});server.middlewares.use('/__premium_analysis',async(req,res)=>{
  try{let body='';for await(const chunk of req)body+=chunk;const args=JSON.parse(body);const result=call({mode:'analysis',primary:args.primaryId,comparison:args.comparisonId,axis:args.axis,channels:args.channelIds});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));}
  catch(error){res.statusCode=500;res.end(String(error));}
});}};
let server,browser;
try{
 const live=process.env.PREMIUM_SERVE==='1';
 server=await createServer({plugins:[...(!live?[browserTestNoWatch]:[]),adapter],optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,...(live?{watch:{ignored:['**/src-tauri/**','**/target/**','**/.tools/**','**/node_modules/**']}}:{})}});await server.listen();
 if(live){console.log(`LIVE: ${server.resolvedUrls.local[0]}`);await new Promise(resolve=>process.once('SIGINT',resolve));}
 else {
 browser=await launchBrowser();
 for(const [label,viewport] of [['desktop',{width:1440,height:920}],['medium',{width:1024,height:768}],['compact',{width:600,height:500}]]){
  const page=await browser.newPage({viewport,reducedMotion:'reduce'}),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0]);
  await page.locator('.uplot').first().waitFor({state:'visible'});await page.locator('.track .primary-line').waitFor({state:'attached'});
  assert((await page.locator('.track .primary-line').getAttribute('d')).length>30,'Measured GPS trace should have a path.');
  assert(await page.locator('.uplot').count()>=2,'Measured channels and delta should render.');
  await page.screenshot({path:resolve(output,`${baseline?'before-':''}${label}.png`),animations:'disabled'});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal page overflow.');
  assert(await page.locator('.workspace-viewport').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'No horizontal workspace overflow.');
  if(!baseline){
   await page.locator('.track-section').scrollIntoViewIfNeeded();
   assert(await page.evaluate(()=>['.app','.shell','main'].every(selector=>document.querySelector(selector).scrollTop===0)),'Inspecting offscreen content must scroll only the workspace, keeping session chrome fixed.');
   await page.locator('.workspace-viewport').evaluate(el=>{el.scrollTop=0;});
  }
  if(label==='desktop'){
   const firstPlot=page.locator('.uplot').first();
   const over=page.locator('.u-over').first(),box=await over.boundingBox();await page.mouse.move(box.x+box.width*.45,box.y+box.height*.5);
   await page.waitForFunction(()=>document.querySelector('.readout')?.textContent?.match(/\d/));
   assert(await page.locator('.primary-marker circle').count(),'Chart cursor should synchronize the measured GPS marker.');
   await page.screenshot({path:resolve(output,`${baseline?'before-':''}desktop-cursor.png`),animations:'disabled'});
   if(!baseline){
    assert.match(await page.locator('.speed-instrument strong').innerText(),/\d/,'GPS instrument should display a measured speed.');
    assert.match(await page.locator('.delta-instrument strong').innerText(),/\d/,'Delta instrument should display a measured value.');
    const graph=page.locator('[data-plot]').first(),slider=page.getByRole('slider',{name:'Lap position'});await graph.evaluate(el=>window.initialGraph=el);await slider.evaluate(el=>window.fullLapSpan=Number(el.max)-Number(el.min));
    await graph.focus();await page.keyboard.press('Home');const start=Number(await slider.inputValue());await page.keyboard.press('ArrowLeft');assert.equal(Number(await slider.inputValue()),start,'Left arrow clamps at range start.');
    await page.keyboard.press('ArrowRight');assert(Number(await slider.inputValue())>start,'Right arrow advances the synchronized cursor.');
    await page.keyboard.press('End');const end=Number(await slider.inputValue());await page.keyboard.press('ArrowRight');assert.equal(Number(await slider.inputValue()),end,'Right arrow clamps at range end.');
    assert(end>start,'Home and End cover the measured lap range.');assert(await graph.evaluate(el=>el===window.initialGraph),'Cursor motion must not recreate uPlot.');
   }
   const section=page.locator('.track-segment').first();await section.click();assert.equal(await page.locator('.segment-card.selected').count(),1,'Map focus should select the section row.');
   if(!baseline){const slider=page.getByRole('slider',{name:'Lap position'});const min=Number(await slider.getAttribute('min')),max=Number(await slider.getAttribute('max'));assert(max>min,'Selected section supplies a usable position range.');assert(max-min<await page.evaluate(()=>window.fullLapSpan),'Selected section range is narrower than the complete lap.');assert(Number(await slider.inputValue())>=min&&Number(await slider.inputValue())<=max,'Focused position stays in selected section.');assert.match(await slider.getAttribute('aria-valuetext'),/ in /,'Slider announces the selected section.');}
   if(laps.length>2){await page.getByRole('button',{name:`Compare lap ${laps[2].number}`,exact:true}).click();await page.waitForFunction(()=>window.premiumCalls.filter(call=>call.cmd==='analyze_session').length>=2);}
   const time=page.getByRole('button',{name:'Time',exact:true});if(await time.count()){await time.click();await page.waitForFunction(()=>window.premiumCalls.some(call=>call.cmd==='analyze_session'&&call.args.axis==='time'));}
   await page.waitForTimeout(500);await firstPlot.evaluate(element=>window.premiumPlot=element);
   const telemetry=page.getByRole('button',{name:'Telemetry',exact:true}),video=page.getByRole('button',{name:'Video',exact:true});
   await video.click();await telemetry.click();assert(await firstPlot.evaluate(element=>element===window.premiumPlot),'Workspace navigation must preserve the mounted plot.');
  }
  assert.deepEqual(errors,[],'Browser must not raise page errors.');await page.close();
 }
 const second=readdirSync('data').find(name=>name.toLowerCase().endsWith('0362.xrk'));
 if(second&&!baseline){recording=resolve('data',second);session=call({mode:'session'});laps=session.laps.filter(lap=>lap.complete).sort((a,b)=>a.duration-b.duration);channels=session.channels.filter(c=>/gps.*speed|rpm|engine.*(speed|revs)/i.test(c.name)).map(c=>c.id);entry=makeEntry();
  const page=await browser.newPage({viewport:{width:1440,height:920},reducedMotion:'reduce'});await page.goto(server.resolvedUrls.local[0]);await page.locator('.uplot').first().waitFor({state:'visible'});const box=await page.locator('.u-over').first().boundingBox();await page.mouse.move(box.x+box.width*.4,box.y+box.height*.5);await page.waitForFunction(()=>document.querySelector('.primary-marker circle'));await page.locator('.track-segment').first().click();assert.equal(await page.locator('.segment-card.selected').count(),1);
  assert(laps.length>2,'0362 needs a third complete lap for reference selection.');const name=`Compare lap ${laps[2].number}`;await page.getByRole('button',{name,exact:true}).click();await page.waitForFunction(()=>window.premiumCalls.filter(call=>call.cmd==='analyze_session').length>=2);assert.equal(await page.getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'true','0362 reference selection should be applied.');await page.locator('.uplot').first().waitFor({state:'visible'});
  await page.screenshot({path:resolve(output,'0362-desktop.png'),animations:'disabled'});await page.close();
 }
 if(!baseline){const page=await browser.newPage({viewport:{width:900,height:700},reducedMotion:'reduce'});await page.goto(`${server.resolvedUrls.local[0]}tests/premium-chart.html`);const graph=page.getByLabel('Speed graph cursor');await graph.focus();await page.keyboard.press('ArrowRight');assert(Number(await page.locator('output').textContent())>0);await page.keyboard.press('End');assert.equal(Number(await page.locator('output').textContent()),100);assert.equal(await page.locator('.primary-reading [data-primary-value]').first().textContent(),'30.0');assert.equal(await page.locator('.comparison-reading [data-comparison-value]').first().textContent(),'31.0');assert.equal(await page.locator('.plot-delta [data-primary-value]').textContent(),'+0.500');await page.keyboard.press('Home');assert.equal(await page.locator('.plot-delta [data-primary-value]').textContent(),'0.000');for(let i=0;i<5;i++)await page.keyboard.press('Shift+ArrowRight');assert.equal(await page.locator('.plot-delta [data-primary-value]').textContent(),'-0.250');await page.getByRole('button',{name:'Toggle unavailable delta'}).click();assert.equal(await page.locator('.plot-delta').count(),0,'Unavailable delta must not be represented as zero.');await page.close();}
 console.log(`PASS: real-XRK App UI at 1440×920, 1024×768 and 600×500; production GPS, analysis and synchronized cursor. Screenshots: ${output}`);
 }
}finally{await browser?.close();await server?.close();}
