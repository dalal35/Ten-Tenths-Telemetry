import {createServer} from 'vite';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import pixelmatch from 'pixelmatch';
import {PNG} from 'pngjs';
import {launchBrowser,browserTestEntries,browserTestNoWatch} from '../../scripts/browser.mjs';
import {initFixture,fixed,settleCursor} from './fixture.mjs';

// Real 0361 diagnostic data via the existing simulated IPC fixture.
const baseline=process.argv.includes('--baseline');
const performance=process.argv.includes('--performance');
const phase=baseline?'baseline':'final';
const data=JSON.parse(readFileSync(process.env.EMBER_ADVANCED_FIXTURE||'.tools/advanced-ui/0361.json','utf8'));
const coach=JSON.parse(readFileSync(process.env.EMBER_COACH_FIXTURE||'.tools/coach-ui/0361.json','utf8'));
if(data.analysis.primary.lapId!==fixed.primary||data.analysis.comparison.lapId!==fixed.comparison||!data.analysis.delta||!data.session.source.includes('0361'))throw Error('Expected native 0361 diagnostic fixture');
const output='docs/ember/screenshots/glass',reportDir='.tools/ember-glass';
mkdirSync(output,{recursive:true});mkdirSync(reportDir,{recursive:true});
const changed=execFileSync('git',['diff','--name-only','--diff-filter=M','2b760e8','--','src'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
const baselineSources=Object.fromEntries(changed.map(path=>[path,execFileSync('git',['show',`2b760e8:${path}`],{encoding:'utf8'})]));
const baselinePlugin={name:'ember-glass-baseline',enforce:'pre',transform(code,id){const path=id.replaceAll('\\','/').split('?')[0];const key=Object.keys(baselineSources).find(p=>path.endsWith('/'+p));if(key)return {code:baselineSources[key],map:null};}};
async function openServer(original=false){const server=await createServer({configLoader:'runner',plugins:[...(original?[baselinePlugin]:[]),browserTestNoWatch],optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}});await server.listen();return server;}
async function pageAt(browser,url,{width=1440,height=900,theme='dark',workspace='telemetry'}={}){
 const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce'});
 const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(initFixture,{data,coach,fixed,theme});
 if(workspace==='onboarding')await page.addInitScript(()=>{const invoke=window.__TAURI_INTERNALS__.invoke;window.__TAURI_INTERNALS__.invoke=async(cmd,args)=>cmd==='library_snapshot'?{entries:[],activeSessionId:null,warnings:[]}:invoke(cmd,args);});
 await page.goto(url);
 if(workspace!=='onboarding')await settleCursor(page);else await page.locator('.launch-workspace').waitFor();
 if(workspace==='advanced')await page.getByRole('button',{name:'Advanced',exact:true}).click();
 if(workspace==='coach')await page.getByRole('button',{name:'AI Driving Coach',exact:true}).click();
 if(workspace==='video')await page.getByRole('button',{name:'Video',exact:true}).click();
 if(workspace==='library'){await page.getByRole('button',{name:'Session actions',exact:true}).click();await page.getByRole('menuitem',{name:'Edit details',exact:true}).click();}
 await page.waitForTimeout(400);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 return {context,page,errors};
}
async function performanceRun(browser,server,variant){
 const {page,context}=await pageAt(browser,server.resolvedUrls.local[0]);
 const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
 const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 const before=await metrics();await page.evaluate(()=>{window.__glassCanvas=[...document.querySelectorAll('.uplot canvas')];window.__emberCommits=[];window.__glassFrames=[];window.__glassTracking=true;const f=t=>{if(!window.__glassTracking)return;window.__glassFrames.push(t);requestAnimationFrame(f);};requestAnimationFrame(f);});
 const b=await page.locator('.u-over').first().boundingBox(),start=Date.now();for(let i=0;i<60;i++)await page.mouse.move(b.x+b.width*(.1+.8*i/59),b.y+b.height*.5);const moveDurationMs=Date.now()-start;await page.waitForTimeout(100);
 const frame=await page.evaluate(()=>{window.__glassTracking=false;const t=window.__glassFrames,intervals=t.slice(1).map((v,i)=>v-t[i]);return {count:t.length,averageFrameMs:intervals.length?intervals.reduce((a,b)=>a+b,0)/intervals.length:null,maxFrameMs:intervals.length?Math.max(...intervals):null,sameCanvas:window.__glassCanvas.every((c,i)=>c===document.querySelectorAll('.uplot canvas')[i]),reactCommits:window.__emberCommits.length,plotsUpdates:window.__emberCommits.reduce((n,c)=>n+(c.Plots||0),0)};});
 const after=await metrics();await context.close();return {variant,pointerMoves:60,moveDurationMs,scriptDurationMs:(after.ScriptDuration-before.ScriptDuration)*1000,taskDurationMs:(after.TaskDuration-before.TaskDuration)*1000,...frame};
}
if(performance){
 const results=[];
 for(const variant of ['baseline','final']){let server,browser;try{server=await openServer(variant==='baseline');browser=await launchBrowser();results.push(await performanceRun(browser,server,variant));}finally{await browser?.close();await server?.close();}}
 const report={method:'Instrumented development Chromium, one run per variant, 60 identical sequential Playwright pointer moves at 1440×900 with reduced motion; baseline is Git 2b760e8 served through an in-memory Vite transform. Includes automation and dev-hook overhead; not native GPU/video performance.',results};writeFileSync(`${reportDir}/performance.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));process.exit(0);
}
const cases=[];
for(const workspace of ['telemetry','advanced','coach','video','library','onboarding'])for(const theme of ['dark','light'])cases.push({workspace,theme,width:1440,height:900});
for(const [width,height] of [[1672,941],[600,500]])for(const theme of ['dark','light'])cases.push({workspace:'telemetry',theme,width,height});
if(process.argv.includes('--effects'))cases.length=0;
if(process.argv.includes('--video')){const videoCases=cases.filter(c=>c.workspace==='video');cases.splice(0,cases.length,...videoCases);}
const prior=!baseline&&existsSync(`${reportDir}/baseline.json`)?JSON.parse(readFileSync(`${reportDir}/baseline.json`,'utf8')):null;
const report={phase,commit:'2b760e8',simulatedIPC:true,source:'cached native 0361 diagnostics',captures:[],checks:[],failures:[]};let server,browser;
try{
 server=await openServer(baseline);browser=await launchBrowser();
 for(const c of cases){
  const {page,context,errors}=await pageAt(browser,server.resolvedUrls.local[0],c);
  const file=`${output}/${phase}-${c.workspace}-${c.width}x${c.height}-${c.theme}.png`;await page.screenshot({path:file,animations:'disabled',caret:'hide'});
  const geometry=await page.evaluate(()=>{
   const rect=el=>{if(!el)return null;const b=el.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};};
   const find=selector=>rect(document.querySelector(selector));
   const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;};
   const protectedNodes=[...document.querySelectorAll('.uplot canvas,.analysis-surface canvas,video,iframe')].filter(visible);
   return {overflow:document.documentElement.scrollWidth>innerWidth||document.body.scrollWidth>innerWidth,regions:{titlebar:find('.titlebar'),sidebar:find('.sidebar'),heading:find('.workspace-heading'),summary:find('.lap-summary'),viewport:find('.workspace-viewport'),charts:find('.chart-workspace'),inspector:find('.inspector'),plots:[...document.querySelectorAll('.plot-row')].filter(e=>!e.hidden&&visible(e)).map(rect),dialog:find('dialog[open],.session-details,.merge-dialog'),video:find('video')},protected:protectedNodes.map(el=>{const own=getComputedStyle(el),ancestors=[];for(let n=el.parentElement;n&&n!==document.body;n=n.parentElement){const s=getComputedStyle(n);if(s.filter!=='none'||s.backdropFilter!=='none')ancestors.push({tag:n.tagName,class:n.className,filter:s.filter,backdropFilter:s.backdropFilter});}return {tag:el.tagName,filter:own.filter,backdropFilter:own.backdropFilter,ancestors};})};
  });
  let axe=[];if(c.width===1440)axe=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length}));
  let contrast=null;if(c.workspace==='telemetry'&&c.width===1440)contrast=await page.evaluate(()=>{
   const rgba=s=>{const m=s.match(/[\d.]+/g);return m?[Number(m[0]),Number(m[1]),Number(m[2]),m[3]===undefined?1:Number(m[3])]:[0,0,0,0];};
   const blend=(top,bottom)=>{const a=top[3]+bottom[3]*(1-top[3]);return a?[(top[0]*top[3]+bottom[0]*bottom[3]*(1-top[3]))/a,(top[1]*top[3]+bottom[1]*bottom[3]*(1-top[3]))/a,(top[2]*top[3]+bottom[2]*bottom[3]*(1-top[3]))/a,a]:[0,0,0,0];};
   const background=e=>{let color=[0,0,0,0];for(let n=e;n;n=n.parentElement)color=blend(color,rgba(getComputedStyle(n).backgroundColor));return blend(color,[0,0,0,1]);};
   const lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
   const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
   const plot=document.querySelector('.plot-row');const tokens=getComputedStyle(plot);const resolve=value=>{const el=document.createElement('span');el.style.color=value;plot.append(el);const color=rgba(getComputedStyle(el).color);el.remove();return color;};
   const pairs=[['title','.workspace-heading h1'],['metadata','.workspace-heading p'],['plot title','.plot-title'],['plot value','.primary-reading'],['lap number','.lap-number'],['section','.segment-identity b']].flatMap(([name,selector])=>{const e=document.querySelector(selector);if(!e)return [];const bg=background(e),fg=blend(rgba(getComputedStyle(e).color),bg);return [{name,ratio:ratio(fg,bg),minimum:4.5}];});
   if(plot){const bg=background(plot);for(const name of ['--trace-primary','--trace-comparison','--delta-trace'])pairs.push({name,ratio:ratio(resolve(tokens.getPropertyValue(name)),bg),minimum:3});}
   return {pairs,method:'Foreground composited over ancestor background colors; gradients and backdrop sampling are not modeled.'};
  });
  const before=prior?.captures.find(p=>p.workspace===c.workspace&&p.width===c.width&&p.height===c.height&&p.theme===c.theme);
  const axeRegressions=axe.filter(v=>v.nodes>(before?.axe.find(x=>x.id===v.id)?.nodes??0));
  const differences=[];
  if(before){const compare=(path,a,b)=>{if(Array.isArray(a)&&Array.isArray(b)){if(a.length!==b.length)differences.push(`${path}: count ${a.length} to ${b.length}`);a.forEach((v,i)=>compare(`${path}[${i}]`,v,b[i]));}else if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const k of ['x','y','width','height'])if(typeof a[k]==='number'&&Math.abs(a[k]-b[k])>1)differences.push(`${path}.${k}: ${a[k]} to ${b[k]}`);}else if((a==null)!==(b==null))differences.push(`${path}: region appeared/disappeared`);};for(const key of Object.keys(before.geometry.regions))compare(key,before.geometry.regions[key],geometry.regions[key]);}
  const capture={...c,file,geometry,axe,axeRegressions,contrast,differences,errors};report.captures.push(capture);
  if(!baseline&&(errors.length||geometry.overflow||axeRegressions.length||differences.length||contrast?.pairs.some(p=>p.ratio<p.minimum)||geometry.protected.some(p=>p.filter!=='none'||p.backdropFilter!=='none'||p.ancestors.length)))report.failures.push(`${c.workspace} ${c.width}x${c.height} ${c.theme}: ${JSON.stringify({errors,overflow:geometry.overflow,axeRegressions,differences,protected:geometry.protected.filter(p=>p.filter!=='none'||p.backdropFilter!=='none'||p.ancestors.length)})}`);
  console.log(JSON.stringify({capture:file,errors,overflow:geometry.overflow,axe,protected:geometry.protected.length}));await context.close();
 }
 if(!baseline&&cases.some(c=>c.workspace==='telemetry'&&c.width===1672)){
  const beforeFile=`${output}/baseline-telemetry-1672x941-dark.png`,afterFile=`${output}/final-telemetry-1672x941-dark.png`;
  if(existsSync(beforeFile)&&existsSync(afterFile)){const before=PNG.sync.read(readFileSync(beforeFile)),after=PNG.sync.read(readFileSync(afterFile)),comparison=new PNG({width:before.width+after.width,height:Math.max(before.height,after.height),fill:true});PNG.bitblt(before,comparison,0,0,before.width,before.height,0,0);PNG.bitblt(after,comparison,0,0,after.width,after.height,before.width,0);writeFileSync(`${output}/telemetry-comparison-1672x941-dark.png`,PNG.sync.write(comparison));}
 }
 if(!baseline&&!process.argv.includes('--video')){
  const {page,context,errors}=await pageAt(browser,server.resolvedUrls.local[0]);
  await page.evaluate(()=>{window.__glassNodes=[...document.querySelectorAll('.uplot canvas')];});
  await page.locator('[data-plot]').first().focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');
  const cursorIdentity=await page.evaluate(()=>window.__glassNodes.length>0&&window.__glassNodes.every(e=>e.isConnected));
  await page.getByRole('button',{name:'Switch to light theme'}).click();
  const themeIdentity=await page.evaluate(()=>window.__glassNodes.every(e=>e.isConnected));
  await page.getByRole('button',{name:'Switch to dark theme'}).click();
  const channel=page.locator('.channel-control>button');await channel.click();const channelMenu=await page.locator('.channel-menu').isVisible();await page.screenshot({path:`${output}/final-telemetry-channel-menu-1440x900-dark.png`,animations:'disabled',caret:'hide'});
  const menuAxe=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations.map(v=>({id:v.id,nodes:v.nodes.length}));await channel.click();
  const chartOptions=page.getByLabel('Chart options',{exact:true});await chartOptions.click();const chartControls=await page.getByRole('button',{name:'Compact',exact:true}).isVisible()&&await page.getByRole('button',{name:'↔ Reset zoom',exact:true}).isVisible();await page.screenshot({path:`${output}/final-telemetry-chart-options-1440x900-dark.png`,animations:'disabled',caret:'hide'});await page.getByRole('button',{name:'Compact',exact:true}).focus();await page.keyboard.press('Escape');const chartEscape=await chartOptions.evaluate(e=>document.activeElement===e&&!e.closest('details').open);
  const trackOptions=page.getByLabel('Track options and data notes',{exact:true});await trackOptions.click();const trackControls=await page.getByRole('button',{name:'Edit boundaries',exact:true}).isVisible();await page.getByRole('button',{name:'Edit boundaries',exact:true}).focus();await page.keyboard.press('Escape');const trackEscape=await trackOptions.evaluate(e=>document.activeElement===e&&!e.closest('details').open);
  const probe=async()=>page.evaluate(()=>{const e=document.querySelector('.titlebar .workspace-switch button.active'),s=getComputedStyle(e),root=document.documentElement;return {refraction:root.dataset.glassRefraction??null,supportsSvg:CSS.supports('backdrop-filter','url(#ember-glass-refraction)'),backdropFilter:s.backdropFilter,filter:s.filter,focusVisible:!!document.querySelector(':focus-visible')};});
  const normal=await probe();
  // Force capability states only in this diagnostic. A static checkerboard directly behind
  // the real selected navigation control makes sub-pixel refraction visibly measurable.
  await page.addStyleTag({content:'.app.premium .titlebar { background:repeating-conic-gradient(#eee 0 25%,#222 0 50%) 0 0 / 40px 40px !important; }'});
  const active=page.locator('.titlebar .workspace-switch button.active');
  const saved=await page.evaluate(()=>({refraction:document.documentElement.dataset.glassRefraction,quality:document.documentElement.dataset.glassQuality}));
  await page.evaluate(()=>{document.documentElement.dataset.glassRefraction='supported';document.documentElement.dataset.glassQuality='full';});await page.waitForTimeout(120);const supportedProbe=await probe();const supportedImage=PNG.sync.read(await active.screenshot({animations:'disabled'}));
  await page.evaluate(()=>{document.documentElement.dataset.glassRefraction='fallback';});await page.waitForTimeout(120);const fallbackProbe=await probe();const fallbackImage=PNG.sync.read(await active.screenshot({animations:'disabled'}));
  const differentPixels=pixelmatch(supportedImage.data,fallbackImage.data,null,supportedImage.width,supportedImage.height,{threshold:0.001});
  await page.addStyleTag({content:'.app.premium .titlebar .workspace-switch button.active { --glass-control-blur:0px!important; background:transparent!important; }'});
  await page.evaluate(()=>{document.documentElement.dataset.glassRefraction='supported';});await page.waitForTimeout(120);const rawSupported=PNG.sync.read(await active.screenshot({animations:'disabled'}));
  await page.evaluate(()=>{document.documentElement.dataset.glassRefraction='fallback';});await page.waitForTimeout(120);const rawFallback=PNG.sync.read(await active.screenshot({animations:'disabled'}));
  const rawDifferentPixels=pixelmatch(rawSupported.data,rawFallback.data,null,rawSupported.width,rawSupported.height,{threshold:0.001});
  const refractionPixels={differentPixels,rawDifferentPixels,totalPixels:supportedImage.width*supportedImage.height,supportedFilter:supportedProbe.backdropFilter,fallbackFilter:fallbackProbe.backdropFilter,method:'40px checkerboard behind the same real selected workspace button, supported versus fallback; raw repeat additionally disables blur and control background only in the test to reveal displacement.'};
  await page.evaluate(()=>{document.documentElement.dataset.glassRefraction='fallback';document.documentElement.dataset.glassQuality='static';});const lowCostStatic=await probe();
  await page.evaluate(saved=>{document.documentElement.dataset.glassRefraction=saved.refraction;document.documentElement.dataset.glassQuality=saved.quality;},saved);
  await page.emulateMedia({forcedColors:'active'});const forced=await probe();await page.emulateMedia({forcedColors:'none'});
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});const reduced=await probe();reduced.matched=await page.evaluate(()=>matchMedia('(prefers-reduced-transparency: reduce)').matches);await cdp.send('Emulation.setEmulatedMedia',{features:[]});await cdp.detach();
  await page.getByRole('button',{name:'Advanced',exact:true}).click();await page.getByRole('button',{name:'Video',exact:true}).click();const videoNodes=await page.locator('video').count();await page.getByRole('button',{name:'Telemetry',exact:true}).click();
  const navigationIdentity=await page.evaluate(()=>window.__glassNodes.every(e=>e.isConnected));
  await page.setViewportSize({width:600,height:500});await page.setViewportSize({width:1440,height:900});const resizeIdentity=await page.evaluate(()=>window.__glassNodes.every(e=>e.isConnected));
  const checks={cursorIdentity,themeIdentity,navigationIdentity,resizeIdentity,videoNodes,channelMenu,menuAxe,chartControls,chartEscape,trackControls,trackEscape,effects:{normal,forced,reduced,lowCostStatic,refractionPixels},errors};report.checks.push(checks);
  if([cursorIdentity,themeIdentity,navigationIdentity,resizeIdentity,channelMenu,chartControls,chartEscape,trackControls,trackEscape].some(v=>!v)||menuAxe.length||errors.length||!supportedProbe.backdropFilter.includes('url(')||fallbackProbe.backdropFilter.includes('url(')||rawDifferentPixels===0||lowCostStatic.backdropFilter!=='none'||forced.backdropFilter!=='none'||(reduced.matched&&reduced.backdropFilter!=='none'))report.failures.push(`interaction checks: ${JSON.stringify(checks)}`);
  await context.close();console.log(JSON.stringify({interactions:checks}));
 }
 writeFileSync(`${reportDir}/${process.argv.includes('--effects')?'effects':process.argv.includes('--video')?'video':phase}.json`,JSON.stringify(report,null,2)+'\n');if(report.failures.length){console.error(JSON.stringify(report.failures));process.exitCode=1;}
}finally{await browser?.close();await server?.close();}
