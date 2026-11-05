// Local visual audit: cached native diagnostic data, simulated IPC, Chromium.
import {createServer} from 'vite';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import {launchBrowser,browserTestEntries,browserTestNoWatch} from '../../scripts/browser.mjs';
import {initFixture,settleCursor,fixed} from './fixture.mjs';

const phase=process.argv[2];
if(!['before','after'].includes(phase))throw Error('Usage: node tools/ember/unification.mjs before|after [--resume] [--only=substring]');
const filterArg=process.argv.find(a=>a.startsWith('--only=')),filter=filterArg?.slice('--only='.length),quick=process.argv.includes('--quick'),preview=!!filter||quick;
const refresh=process.argv.find(a=>a.startsWith('--refresh='))?.slice('--refresh='.length).split(',');
if(refresh&&(phase!=='after'||preview||!refresh.every(w=>['telemetry','advanced','video','coach','library','onboarding'].includes(w))))throw Error('--refresh requires after and valid workspace names');
if(filterArg&&!filter)throw Error('--only requires a nonempty substring');
if(phase==='before'&&preview)throw Error('Filtered runs cannot replace the frozen baseline');
const output=`docs/ember/screenshots/unification/${preview?'preview':phase}`,dir='.tools/ember-unification',file=`${dir}/${preview?'preview':phase}.json`;
const sourceHash=createHash('sha256').update(execFileSync('git',['rev-parse','HEAD'])).update(execFileSync('git',['diff','--binary','HEAD','--','src'])).digest('hex');
mkdirSync(dir,{recursive:true});mkdirSync(output,{recursive:true});
let report={phase,sourceHash,simulatedIPC:true,source:'native 0361/0362 diagnostic caches, simulated IPC',method:'Chromium development build, DPR 1, reduced motion, disabled screenshot animations; axe checks HTML only, not canvas. Geometry in CSS pixels. Visible text font sizes exclude hidden/offscreen content; potential clipping is a candidate list, not a confirmed defect.',captures:[],checks:[],errors:[]};
if(phase==='before'&&existsSync(file)){
 if(!process.argv.includes('--resume'))throw Error('Baseline exists. Refusing to overwrite; use --resume only against identical sources.');
 report=JSON.parse(readFileSync(file,'utf8'));if(report.sourceHash!==sourceHash)throw Error('Baseline sources changed; refusing to resume.');
}
if(refresh){report=JSON.parse(readFileSync(file,'utf8'));report.sourceHash=sourceHash;report.captures=report.captures.filter(c=>!refresh.includes(c.workspace));report.errors=report.errors.filter(c=>!refresh.some(w=>c.key.includes(`-${w}-`)));report.refreshes=[...(report.refreshes||[]),{workspaces:refresh,sourceHash}];}
const save=()=>writeFileSync(file,JSON.stringify(report,null,2)+'\n');
const cases=[];
for(const recording of ['0361','0362'])for(const workspace of ['telemetry','advanced','video','coach','library','onboarding'])for(const [width,height] of [[1440,900],[600,500]])for(const theme of ['dark','light']){const c={recording,workspace,width,height,theme};if((!quick||(recording==='0361'&&theme==='dark'&&['telemetry','advanced','video','coach'].includes(workspace)))&&(!filter||`${recording}-${workspace}-${width}x${height}-${theme}`.includes(filter)))cases.push(c);}
if(refresh){const selected=cases.filter(c=>refresh.includes(c.workspace));cases.splice(0,cases.length,...selected);}
if(!cases.length)throw Error(`No capture case matched --only=${filter}`);
const dataFor=recording=>{
 const data=JSON.parse(readFileSync(`.tools/advanced-ui/${recording}.json`,'utf8'));
 const coach=JSON.parse(readFileSync(`.tools/coach-ui/${recording}.json`,'utf8'));
 if(!data.session.source.includes(recording)||!data.analysis.delta||!data.analysis.comparison)throw Error(`Invalid ${recording} diagnostic fixture`);
 return {data,coach,fixed:{...fixed,primary:data.analysis.primary.lapId,comparison:data.analysis.comparison.lapId}};
};
async function openPage(browser,url,c,fixture){
 const context=await browser.newContext({viewport:{width:c.width,height:c.height},deviceScaleFactor:1,reducedMotion:'reduce'});
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(initFixture,{...fixture,theme:c.theme});
 if(c.workspace==='onboarding')await page.addInitScript(()=>{const invoke=window.__TAURI_INTERNALS__.invoke;window.__TAURI_INTERNALS__.invoke=async(cmd,args)=>cmd==='library_snapshot'?{entries:[],activeSessionId:null,warnings:[]}:invoke(cmd,args);});
 await page.goto(url);if(c.workspace==='onboarding')await page.locator('.launch-workspace').waitFor();else await settleCursor(page);
 const names={advanced:'Advanced',video:'Video',coach:'AI Driving Coach'};
 if(names[c.workspace])await page.getByRole('button',{name:names[c.workspace],exact:true}).click();
 if(c.workspace==='library'){
  if(c.width===600)await page.getByRole('button',{name:'Open session explorer'}).click();
  await page.getByRole('button',{name:'Session actions',exact:true}).click();await page.getByRole('menuitem',{name:'Edit details',exact:true}).click();
 }
 await page.mouse.move(0,0);await page.waitForTimeout(350);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));return {page,context,errors};
}
async function measure(page){return page.evaluate(()=>{
 const rect=e=>{if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};};
 const visible=e=>{if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0&&r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight&&!e.closest('[hidden]');};
 const selectors={titlebar:'.titlebar',brand:'.titlebar .ttt-brand',tabs:'.titlebar .workspace-switch',activeTab:'.titlebar .workspace-switch button.active',headerActions:'.header-actions',themeButton:'.header-actions .icon-button',importButton:'.titlebar .import-button',sidebar:'.explorer-slot',heading:'.workspace-heading',summary:'.lap-summary',viewport:'.workspace-viewport',toolbar:'.chart-toolbar',workspace:'.chart-workspace',inspector:'.inspector',advanced:'.advanced-workspace',video:'.video-premium',coach:'.coach-focus',dialog:'dialog[open],.session-details',onboarding:'.launch-workspace'};
 const regions=Object.fromEntries(Object.entries(selectors).map(([k,s])=>{const e=[...document.querySelectorAll(s)].find(visible);return [k,rect(e)];}));
 const style=e=>{const s=getComputedStyle(e);return {fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight,color:s.color,background:s.backgroundColor,borderColor:s.borderColor,borderRadius:s.borderRadius,boxShadow:s.boxShadow,padding:s.padding};};
 const controls=Object.fromEntries(['.titlebar .workspace-switch button.active','.titlebar .workspace-switch button:not(.active)','.titlebar .import-button','.titlebar .icon-button','.channel-control>button','.axis-switch button.active'].map(s=>{const e=[...document.querySelectorAll(s)].find(visible);return [s,e?{rect:rect(e),...style(e)}:null];}));
 const text=[...document.querySelectorAll('body *')].filter(visible).flatMap(e=>{const t=[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).filter(Boolean).join(' ');if(!t||e.closest('[aria-hidden=true]')||getComputedStyle(e).clipPath==='inset(50%)')return [];let a=e;while(a){const s=getComputedStyle(a),b=a.getBoundingClientRect();if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)===0)return [];if(a!==e&&/hidden|clip|auto|scroll/.test(s.overflow)&& (b.right<=e.getBoundingClientRect().left||b.bottom<=e.getBoundingClientRect().top||b.left>=e.getBoundingClientRect().right||b.top>=e.getBoundingClientRect().bottom))return [];a=a.parentElement;}return [{tag:e.tagName.toLowerCase(),class:typeof e.className==='string'?e.className:'',size:parseFloat(getComputedStyle(e).fontSize),length:t.length}];});
 const small=text.filter(t=>t.size<11);const clipping=[...document.querySelectorAll('button,input,select,textarea,[role=button]')].filter(visible).flatMap(e=>{const b=e.getBoundingClientRect();if(b.left<-.5||b.right>innerWidth+.5||b.top<-.5||b.bottom>innerHeight+.5)return [{tag:e.tagName,class:e.className,box:rect(e)}];return [];});
 return {regions,controls,text:{count:text.length,minimum:text.length?Math.min(...text.map(t=>t.size)):null,below11:small.slice(0,100),below12Count:text.filter(t=>t.size<12).length},overflow:{document:document.documentElement.scrollWidth>innerWidth,body:document.body.scrollWidth>innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth},clippingCandidates:clipping,canvasFonts:window.__emberCanvasFonts};
});}
const axeSummary=result=>({violations:result.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),incomplete:result.incomplete.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length}))});
function acceptance(captures,errors,partial){
 const failures=[];for(const c of captures){if(c.metrics.overflow.document||c.metrics.overflow.body)failures.push({key:c.key,criterion:'horizontal overflow'});for(const error of c.errors)failures.push({key:c.key,criterion:'page error',error});for(const v of c.axe.violations.filter(v=>['serious','critical'].includes(v.impact)))failures.push({key:c.key,criterion:'axe',id:v.id,impact:v.impact,nodes:v.nodes.length});}
 for(const error of errors)failures.push({key:error.key,criterion:'capture error',error:error.error});
 const shellRegions=['titlebar','brand','tabs','headerActions','importButton'];
 const sharedControls=['.titlebar .workspace-switch button.active','.titlebar .workspace-switch button:not(.active)','.titlebar .import-button','.titlebar .icon-button'];
 const styleFields=['fontFamily','fontSize','fontWeight','lineHeight','color','background','borderColor','borderRadius','boxShadow','padding'];
 let groups=0;
 for(const recording of ['0361','0362'])for(const [width,height] of [[1440,900],[600,500]])for(const theme of ['dark','light']){
  const group=['telemetry','advanced','video','coach'].map(workspace=>captures.find(c=>c.recording===recording&&c.width===width&&c.height===height&&c.theme===theme&&c.workspace===workspace));
  if(group.some(c=>!c))continue;groups++;const reference=group[0];
  for(const actual of group.slice(1)){
   for(const region of shellRegions){const a=reference.metrics.regions[region],b=actual.metrics.regions[region];if(!a||!b){failures.push({key:actual.key,criterion:'shell geometry',region,reason:'missing visible region'});continue;}for(const field of ['x','y','width','height'])if(Math.abs(a[field]-b[field])>1)failures.push({key:actual.key,criterion:'shell geometry',region,field,reference:a[field],actual:b[field]});}
   for(const selector of sharedControls){const a=reference.metrics.controls[selector],b=actual.metrics.controls[selector];if(!a||!b){failures.push({key:actual.key,criterion:'shared control',selector,reason:'missing visible control'});continue;}for(const field of styleFields)if(a[field]!==b[field])failures.push({key:actual.key,criterion:'shared control',selector,field,reference:a[field],actual:b[field]});if(Math.abs(a.rect.height-b.rect.height)>1)failures.push({key:actual.key,criterion:'shared control',selector,field:'height',reference:a.rect.height,actual:b.rect.height});}
  }
 }
 return {status:failures.length?'fail':partial||groups<8?'partial':'pass',groupsCompared:groups,expectedGroups:8,criteria:'Zero serious/critical axe violations, page errors, capture errors and document/body horizontal overflow; common shell regions within 1 CSS px; common controls use identical computed style fields and height. Filtered preview is never a complete pass. Other accessibility, clipping, contrast and native behavior require separate checks.',failures};
}
let server,browser;
try{
 server=await createServer({configLoader:'runner',plugins:[browserTestNoWatch],optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}});await server.listen();browser=await launchBrowser();
 let currentRecording,fixture;
 for(const c of cases){
  const key=`${c.recording}-${c.workspace}-${c.width}x${c.height}-${c.theme}`;
  if(report.captures.some(x=>x.key===key))continue;
  if(currentRecording!==c.recording){fixture=dataFor(c.recording);currentRecording=c.recording;}
  let context;
  try{
   const opened=await openPage(browser,server.resolvedUrls.local[0],c,fixture);({context}=opened);const {page,errors}=opened;
   const screenshot=`${output}/${key}.png`;if(phase==='before'&&existsSync(screenshot))throw Error(`Baseline screenshot exists: ${screenshot}`);
   await page.screenshot({path:screenshot,animations:'disabled',caret:'hide'});
   const metrics=await measure(page),axe=axeSummary(await new AxeBuilder({page}).analyze());
   report.captures.push({key,...c,screenshot,metrics,axe,errors});save();console.log(`${key}: overflow=${metrics.overflow.document||metrics.overflow.body}, axe=${axe.violations.length}, errors=${errors.length}`);
  }catch(e){report.errors.push({key,error:String(e)});save();console.error(`${key}: ${e}`);}finally{await context?.close();}
 }
 if(phase==='after'&&!preview&&!refresh){
  const c={recording:'0361',workspace:'telemetry',width:1440,height:900,theme:'dark'};const {page,context,errors}=await openPage(browser,server.resolvedUrls.local[0],c,dataFor('0361'));
  await page.evaluate(()=>{window.__unificationCanvases=[...document.querySelectorAll('.uplot canvas')];window.__longTasks=[];try{new PerformanceObserver(list=>window.__longTasks.push(...list.getEntries().map(e=>({duration:e.duration,startTime:e.startTime})))).observe({type:'longtask',buffered:true});}catch{window.__longTasks=null;}});
  const times=[];for(let i=0;i<6;i++)for(const name of ['Advanced','Video','AI Driving Coach','Telemetry']){const start=Date.now();await page.getByRole('button',{name,exact:true}).click();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));times.push({name,ms:Date.now()-start});}
  const metrics=await page.evaluate(()=>({canvasCount:window.__unificationCanvases.length,canvasesConnected:window.__unificationCanvases.every(e=>e.isConnected),longTasks:window.__longTasks,videoElements:document.querySelectorAll('video').length}));
  const sorted=times.map(t=>t.ms).sort((a,b)=>a-b);report.checks.push({navigation:{times,median:(sorted[11]+sorted[12])/2,p95:sorted[Math.ceil(sorted.length*.95)-1],...metrics,method:'24 sequential Playwright clicks including two animation frames, instrumented dev Chromium; wall-clock automation overhead included. Empty video fixture does not prove attached player lifetime.'},errors});save();await context.close();
 }
}finally{if(phase==='after')report.acceptance=acceptance(report.captures,report.errors,preview);save();await browser?.close();await server?.close();}
if(report.errors.length||(phase==='after'&&report.acceptance.failures.length))process.exitCode=1;
