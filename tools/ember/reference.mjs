// Local reference captures. Parsed telemetry is real 0361 data; native IPC is simulated.
import {createServer} from 'vite';
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {launchBrowser, browserTestEntries, browserTestNoWatch} from '../../scripts/browser.mjs';
import {initFixture, fixed, settleCursor} from './fixture.mjs';
import AxeBuilder from '@axe-core/playwright';
import {PNG} from 'pngjs';
import {execFileSync} from 'node:child_process';

const quick=process.argv.includes('--quick');
const checksOnly=process.argv.includes('--checks');
const serve=process.argv.includes('--serve');
const baseline=process.argv.includes('--baseline');
const referenceArg=process.argv.indexOf('--reference');
const reference=referenceArg>=0?process.argv[referenceArg+1]:process.env.EMBER_REFERENCE_IMAGE;
const output='docs/ember/screenshots/reference';
const reportDir='.tools/ember-reference';
const data=JSON.parse(readFileSync(process.env.EMBER_ADVANCED_FIXTURE||'.tools/advanced-ui/0361.json','utf8'));
const coach=JSON.parse(readFileSync(process.env.EMBER_COACH_FIXTURE||'.tools/coach-ui/0361.json','utf8'));
if(data.analysis.primary.lapId!==fixed.primary||data.analysis.comparison.lapId!==fixed.comparison||!data.analysis.delta||!data.session.source.includes('0361')) throw Error('Expected real 0361 diagnostics for fixed comparison');
mkdirSync(output,{recursive:true});mkdirSync(reportDir,{recursive:true});
if(process.argv.includes('--performance')){
 const changed=execFileSync('git',['diff','--name-only','HEAD','--','src'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
 const baselineSources=Object.fromEntries(changed.map(path=>[path,execFileSync('git',['show',`HEAD:${path}`],{encoding:'utf8'})]));
 const results=[];
 for(const variant of ['HEAD','current']){
  const plugin={name:`performance-${variant}`,enforce:'pre',transform(code,id){if(variant==='HEAD'){const path=id.replaceAll('\\','/').split('?')[0];const key=Object.keys(baselineSources).find(p=>path.endsWith('/'+p));if(key)return {code:baselineSources[key],map:null};}}};
  let server,browser;
  try{
   server=await createServer({configLoader:'runner',plugins:[plugin,browserTestNoWatch],optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}});await server.listen();browser=await launchBrowser();
   const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,reducedMotion:'reduce'}),page=await context.newPage();
   await page.addInitScript(initFixture,{data,coach,fixed,theme:'dark'});await page.goto(server.resolvedUrls.local[0]);await settleCursor(page);await page.waitForTimeout(350);
   const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));const before=await metrics();
   await page.evaluate(()=>{window.__referenceIdentity=[...document.querySelectorAll('.uplot canvas')];window.__emberCommits=[];window.__referenceFrameTimes=[];window.__referenceTracking=true;const frame=t=>{if(!window.__referenceTracking)return;window.__referenceFrameTimes.push(t);requestAnimationFrame(frame);};requestAnimationFrame(frame);});
   const box=await page.locator('.u-over').first().boundingBox(),start=Date.now();for(let i=0;i<60;i++)await page.mouse.move(box.x+box.width*(.1+.8*i/59),box.y+box.height*.5);const moveDurationMs=Date.now()-start;await page.waitForTimeout(100);
   const frame=await page.evaluate(()=>{window.__referenceTracking=false;const t=window.__referenceFrameTimes,intervals=t.slice(1).map((v,i)=>v-t[i]);return {count:t.length,averageFrameMs:intervals.length?intervals.reduce((a,b)=>a+b,0)/intervals.length:null,maxFrameMs:intervals.length?Math.max(...intervals):null,sameCanvas:window.__referenceIdentity.every((c,i)=>c===document.querySelectorAll('.uplot canvas')[i]),reactCommits:window.__emberCommits.length,plotsUpdates:window.__emberCommits.reduce((n,c)=>n+(c.Plots||0),0)};});
   const after=await metrics();results.push({variant,pointerMoves:60,moveDurationMs,scriptDurationMs:(after.ScriptDuration-before.ScriptDuration)*1000,taskDurationMs:(after.TaskDuration-before.TaskDuration)*1000,...frame});await context.close();
  }finally{await browser?.close();await server?.close();}
 }
 const result={method:'One instrumented development Chromium run per variant, identical 60 sequential Playwright pointer moves at 1440×900, reduced motion; baseline serves tracked HEAD sources via Vite transforms only; browser timing includes automation and dev-hook overhead, not native GPU performance.',results};writeFileSync(`${reportDir}/performance.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));process.exit(0);
}
const report={simulatedIPC:true,recording:'0361',fixture:'cached native diagnostics',captures:[],checks:[],failures:[]};
const sizes=checksOnly?[[1440,900]]:quick?[[1672,941]]:[[1672,941],[1440,900],[1920,1080],[600,500]];
let server,browser;
try{
 const baselineMain=baseline?execFileSync('git',['show','HEAD:src/main.tsx'],{encoding:'utf8'}):null;
 const baselinePlugin={name:'reference-baseline',enforce:'pre',transform(code,id){if(baselineMain&&id.replaceAll('\\','/').endsWith('/src/main.tsx'))return {code:baselineMain,map:null};}};
 const fixturePlugin={name:'reference-fixture',transformIndexHtml(html){if(!serve)return html;const arg=JSON.stringify({data,coach,fixed,theme:'dark'}).replaceAll('<','\\u003c');return html.replace('<head>',`<head><script>(${initFixture.toString()})(${arg})</script>`);}};
 server=await createServer({configLoader:'runner',plugins:[baselinePlugin,fixturePlugin,browserTestNoWatch],optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}});
 await server.listen();
 if(serve){console.log(`Reference fixture server: ${server.resolvedUrls.local[0]}`);await new Promise(resolve=>process.once('SIGINT',resolve));}
 else browser=await launchBrowser();
 if(!serve){
 for(const [width,height] of sizes) for(const theme of quick||checksOnly?['dark']:['dark','light']){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce'});
  const page=await context.newPage();page.setDefaultTimeout(20000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(initFixture,{data,coach,fixed,theme});
  await page.goto(server.resolvedUrls.local[0]);await settleCursor(page);
  await page.waitForTimeout(350);
  const file=`${output}/${baseline?'baseline-':'telemetry-'}${width}x${height}-${theme}.png`;
  await page.screenshot({path:file,animations:'disabled',caret:'hide'});
  const geometry=await page.evaluate(()=>{
   const rect=el=>{if(!el)return null;const b=el.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};};
   return {overflow:document.documentElement.scrollWidth>innerWidth||document.body.scrollWidth>innerWidth,sidebar:rect(document.querySelector('.sidebar')),inspector:rect(document.querySelector('.inspector')),workspace:rect(document.querySelector('.workspace-viewport')),plots:[...document.querySelectorAll('.plot-row')].filter(e=>!e.hidden).map(rect)};
  });
  const capture={width,height,theme,file,geometry,errors};report.captures.push(capture);
  console.log(JSON.stringify(capture));
  if(errors.length||geometry.overflow||geometry.plots.length!==3||(width>1100&&geometry.inspector.y+geometry.inspector.height>height))report.failures.push(`${width}x${height} ${theme}: page error, overflow, or missing plots`);
  if(!quick&&width===1440){
   const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length}));
   await page.evaluate(()=>{window.__referenceIdentity=[...document.querySelectorAll('.uplot canvas')];window.__emberCommits=[];});
   await page.locator('[data-plot]').first().focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');await page.waitForTimeout(100);
   const cursor=await page.evaluate(()=>({sameCanvas:window.__referenceIdentity.length>0&&window.__referenceIdentity.every((c,i)=>c===document.querySelectorAll('.uplot canvas')[i]),commits:window.__emberCommits.length,plotUpdates:window.__emberCommits.reduce((n,c)=>n+(c.Plots||0),0)}));
   await page.getByRole('button',{name:`Switch to ${theme==='dark'?'light':'dark'} theme`}).click();await page.waitForTimeout(150);
   const themeSwitch=await page.evaluate(()=>({sameCanvas:window.__referenceIdentity.length>0&&window.__referenceIdentity.every((c,i)=>c===document.querySelectorAll('.uplot canvas')[i]),theme:document.documentElement.dataset.theme}));
   await page.getByRole('button',{name:`Switch to ${theme} theme`}).click();
   const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
   const metricMap=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
   const beforeMetrics=await metricMap();
   await page.evaluate(()=>{window.__referenceFrameTimes=[];window.__referenceTracking=true;const frame=t=>{if(!window.__referenceTracking)return;window.__referenceFrameTimes.push(t);requestAnimationFrame(frame);};requestAnimationFrame(frame);});
   const cursorBox=await page.locator('.u-over').first().boundingBox();const movementStarted=Date.now();
   for(let i=0;i<60;i++)await page.mouse.move(cursorBox.x+cursorBox.width*(.1+.8*i/59),cursorBox.y+cursorBox.height*.5);
   const moveDurationMs=Date.now()-movementStarted;await page.waitForTimeout(100);
   const frames=await page.evaluate(()=>{window.__referenceTracking=false;const t=window.__referenceFrameTimes,intervals=t.slice(1).map((v,i)=>v-t[i]);return {count:t.length,averageFrameMs:intervals.length?intervals.reduce((a,b)=>a+b,0)/intervals.length:null,maxFrameMs:intervals.length?Math.max(...intervals):null,sameCanvas:window.__referenceIdentity.every((c,i)=>c===document.querySelectorAll('.uplot canvas')[i])};});
   const afterMetrics=await metricMap();Object.assign(frames,{pointerMoves:60,moveDurationMs,scriptDurationMs:(afterMetrics.ScriptDuration-beforeMetrics.ScriptDuration)*1000,taskDurationMs:(afterMetrics.TaskDuration-beforeMetrics.TaskDuration)*1000,measurement:'Playwright pointer moves with CDP main-thread metrics and frame intervals; browser-only, not native GPU timing'});
   const rendering=await page.evaluate(()=>({canvasFilters:[...document.querySelectorAll('.uplot canvas')].map(e=>({filter:getComputedStyle(e).filter,backdropFilter:getComputedStyle(e).backdropFilter})),fonts:[...new Set([...document.querySelectorAll('.plot-row .uplot canvas')].flatMap(c=>window.__emberCanvasFontMap.get(c)||[]))]}));
   const contrast=await page.evaluate(()=>{
    const rgba=s=>{const m=s.match(/[\d.]+/g);return m?[Number(m[0]),Number(m[1]),Number(m[2]),m[3]===undefined?1:Number(m[3])]:[0,0,0,0];};
    const blend=(top,bottom)=>{const a=top[3]+bottom[3]*(1-top[3]);return a?[(top[0]*top[3]+bottom[0]*bottom[3]*(1-top[3]))/a,(top[1]*top[3]+bottom[1]*bottom[3]*(1-top[3]))/a,(top[2]*top[3]+bottom[2]*bottom[3]*(1-top[3]))/a,a]:[0,0,0,0];};
    const background=e=>{let color=[0,0,0,0];for(let n=e;n;n=n.parentElement)color=blend(color,rgba(getComputedStyle(n).backgroundColor));return blend(color,[0,0,0,1]);};
    const lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
    const plot=document.querySelector('.plot-row');const root=getComputedStyle(plot);const resolve=value=>{const el=document.createElement('span');el.style.color=value;plot.append(el);const color=rgba(getComputedStyle(el).color);el.remove();return color;};
    const pairs=[['title','.workspace-heading h1'],['metadata','.workspace-heading p'],['plot title','.plot-title'],['plot value','.primary-reading'],['lap number','.lap-number'],['section','.segment-identity b']].flatMap(([name,selector])=>{const e=document.querySelector(selector);if(!e)return [];const bg=background(e),fg=blend(rgba(getComputedStyle(e).color),bg);return [{name,ratio:ratio(fg,bg),minimum:4.5}];});
    if(plot){const bg=background(plot);for(const name of ['--trace-primary','--trace-comparison','--delta-trace'])pairs.push({name,ratio:ratio(resolve(root.getPropertyValue(name)),bg),minimum:3});}
    return {pairs,method:'Computed foreground composited over ancestor background colors; gradients and backdrop sampling are not modeled'};
   });
   const channelButton=page.locator('.channel-control>button');await channelButton.click();
   const channelMenu=await page.locator('.channel-menu').isVisible();const rpm=page.locator('.channel-menu label').filter({hasText:/^RPM/}).locator('input');const rpmRow=page.locator('.plot-row').filter({hasText:/^RPM/});
   await rpm.uncheck();await rpmRow.waitFor({state:'hidden'});const channelRemoved=!(await rpm.isChecked());await rpm.check();await rpmRow.waitFor({state:'visible'});const channelRestored=await rpm.isChecked();await channelButton.click();await settleCursor(page);
   const over=page.locator('.u-over').first(),box=await over.boundingBox();
   const savedZoom=()=>page.evaluate(()=>window.__emberCalls.filter(c=>c.cmd==='save_workspace').at(-1)?.args.workspace.zoom);
   await page.mouse.move(box.x+box.width*.2,box.y+20);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+20,{steps:8});await page.mouse.up();await page.waitForTimeout(850);
   const narrowed=await savedZoom();
   await page.keyboard.down('Shift');await page.mouse.move(box.x+box.width*.6,box.y+30);await page.mouse.down();await page.mouse.move(box.x+box.width*.5,box.y+30,{steps:6});await page.mouse.up();await page.keyboard.up('Shift');await page.waitForTimeout(850);
   const panned=await savedZoom();
   const resetButton=page.getByRole('button',{name:'↔ Reset zoom',exact:true});
   const chartOptions=page.getByLabel('Chart options',{exact:true});if(!await resetButton.isVisible())await chartOptions.click();
   await resetButton.click();await page.waitForTimeout(850);const reset=await savedZoom();
   const fullMax=Math.max(...data.analysis.primary.series.map(s=>s.x.at(-1)||0),data.analysis.delta.x.at(-1)||0);
   const zoomPan={narrowed:!!narrowed&&narrowed.max-narrowed.min<fixed.zoom.max-fixed.zoom.min,panned:!!panned&&!!narrowed&&Math.abs((panned.max-panned.min)-(narrowed.max-narrowed.min))<.01&&panned.min!==narrowed.min,reset:reset==null||(Math.abs(reset.min)<.01&&Math.abs(reset.max-fullMax)<.01)};
   const section=page.locator('.segment-card').first();await section.click();
   const sectionSelected=await section.evaluate(e=>e.classList.contains('selected'));
   if(!await page.locator('details.chart-options').evaluate(e=>e.open))await chartOptions.click();
   await page.getByRole('button',{name:'Compact',exact:true}).click();const compact=await page.locator('.app').evaluate(e=>e.classList.contains('compact'));
   await page.getByRole('button',{name:'Comfortable',exact:true}).click();const comfortable=await page.locator('.app').evaluate(e=>e.classList.contains('comfortable'));
   await page.getByRole('button',{name:'Compact',exact:true}).focus();await page.keyboard.press('Escape');
   const chartEscape=await chartOptions.evaluate(e=>document.activeElement===e&&!e.closest('details').open);
   const trackOptions=page.getByLabel('Track options and data notes',{exact:true});await trackOptions.click();
   const noteCount=await page.locator('.track-options .data-note').count();
   const notesVisible=noteCount===0||await page.locator('.track-options .data-note').first().isVisible();
   await page.getByRole('button',{name:'Edit boundaries',exact:true}).click();const editing=await page.getByRole('button',{name:'Done editing',exact:true}).isVisible();
   await page.getByRole('button',{name:'Done editing',exact:true}).click();await page.getByRole('button',{name:'Edit boundaries',exact:true}).focus();await page.keyboard.press('Escape');
   const trackEscape=await trackOptions.evaluate(e=>document.activeElement===e&&!e.closest('details').open);
   const resizer=page.getByRole('separator',{name:'Resize session explorer'});const oldWidth=Number(await resizer.getAttribute('aria-valuenow'));await resizer.focus();await page.keyboard.press('ArrowRight');const newWidth=Number(await resizer.getAttribute('aria-valuenow'));
   await page.getByRole('button',{name:'Collapse sidebar'}).click();const collapsed=await page.getByRole('button',{name:'Expand sidebar'}).isVisible();await page.getByRole('button',{name:'Expand sidebar'}).click();const expanded=await page.getByRole('button',{name:'Collapse sidebar'}).isVisible();
   await page.emulateMedia({forcedColors:'active'});const forced=await page.locator('.channel-control>button').evaluate(e=>getComputedStyle(e).backdropFilter);await page.emulateMedia({forcedColors:'none'});
   await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});const reduced=await page.locator('.channel-control>button').evaluate(e=>({matched:matchMedia('(prefers-reduced-transparency: reduce)').matches,filter:getComputedStyle(e).backdropFilter}));await cdp.send('Emulation.setEmulatedMedia',{features:[]});await cdp.detach();
   const checks={theme,violations,contrast,cursor,themeSwitch,frames,rendering,channelMenu,channelRemoved,channelRestored,zoomPan,sectionSelected,options:{compact,comfortable,chartEscape,editing,trackEscape,noteCount,notesVisible},sidebar:{resized:newWidth>oldWidth,collapsed,expanded},effects:{forcedColorsBackdrop:forced,reducedTransparency:reduced}};report.checks.push(checks);
   if(violations.length||contrast.pairs.some(p=>p.ratio<p.minimum)||!cursor.sameCanvas||!themeSwitch.sameCanvas||!frames.sameCanvas||!channelMenu||!channelRemoved||!channelRestored||!sectionSelected||Object.values(zoomPan).some(v=>!v)||[compact,comfortable,chartEscape,editing,trackEscape,notesVisible,newWidth>oldWidth,collapsed,expanded].some(v=>!v)||rendering.canvasFilters.some(f=>f.filter!=='none'||f.backdropFilter!=='none')||rendering.fonts.length===0||rendering.fonts.some(f=>!f.includes('13px'))||forced!=='none'||(reduced.matched&&reduced.filter!=='none'))report.failures.push(`${theme}: accessibility, effects, or interaction check failed`);
  }
  if(!quick&&width===600){
   const button=page.locator('.channel-control>button');await button.scrollIntoViewIfNeeded();await button.click();
   const menu=page.locator('.channel-menu'),menuBox=await menu.boundingBox();
   const last=menu.locator('input').last();await last.focus();const lastBox=await last.boundingBox();
   const narrow={theme,channelMenuVisible:await menu.isVisible(),menuWithinViewport:!!menuBox&&menuBox.x>=0&&menuBox.x+menuBox.width<=width+.5,lastChannelReachable:!!lastBox&&!!menuBox&&lastBox.y>=menuBox.y&&lastBox.y+lastBox.height<=Math.min(menuBox.y+menuBox.height,height)};
   await button.click();await page.getByRole('button',{name:'Open session explorer'}).click();narrow.drawerOpened=await page.getByRole('dialog',{name:'Session explorer'}).isVisible();await page.locator('.sidebar button[aria-label="Close session explorer"]').click();narrow.drawerClosed=await page.getByRole('button',{name:'Open session explorer'}).isVisible();
   report.checks.push({narrow});if(Object.entries(narrow).some(([key,value])=>key!=='theme'&&!value))report.failures.push(`${theme}: narrow channel menu unreachable`);
  }
  await context.close();
 }
 if(!quick){
  // Exercise the warning disclosure independently; the real fixture has no data notes.
  const warningData=structuredClone(data);warningData.analysis.primary.warnings.push('GPS source timestamp gaps');
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});const page=await context.newPage();
  await page.addInitScript(initFixture,{data:warningData,coach,fixed,theme:'dark'});await page.goto(server.resolvedUrls.local[0]);await settleCursor(page);
  const warningSummary=page.locator('.track-options>summary');const warningIndicator=(await warningSummary.getAttribute('aria-label')).includes('warnings');await warningSummary.click();
  const warningVisible=await page.getByText('Warning · Racing line has gaps',{exact:true}).isVisible();report.checks.push({syntheticWarningDisclosure:{warningIndicator,warningVisible}});if(!warningIndicator||!warningVisible)report.failures.push('synthetic warning disclosure failed');await context.close();
  const touchContext=await browser.newContext({viewport:{width:1440,height:900},hasTouch:true,reducedMotion:'reduce'});const touchPage=await touchContext.newPage();
  await touchPage.addInitScript(initFixture,{data,coach,fixed,theme:'dark'});await touchPage.goto(server.resolvedUrls.local[0]);await settleCursor(touchPage);
  const touch=await touchPage.evaluate(()=>{const inspect=selector=>{const el=document.querySelector(selector);if(!el)return null;const s=getComputedStyle(el),r=el.getBoundingClientRect();return {opacity:Number(s.opacity),visibility:s.visibility,display:s.display,width:r.width,height:r.height};};return {hoverNone:matchMedia('(hover: none)').matches,compare:inspect('.compare-toggle:not(:disabled)'),clear:inspect('[aria-label="Clear comparison"]'),header:inspect('.header-actions .import-button'),sessionActions:inspect('.row-actions')};});
  report.checks.push({touch});if(!touch.hoverNone||[touch.compare,touch.clear,touch.header].some(x=>!x||x.opacity!==1||x.visibility!=='visible'||x.display==='none'||x.width<=0||x.height<=0)||!touch.sessionActions||touch.sessionActions.opacity<.7||touch.sessionActions.width<=0||touch.sessionActions.height<=0)report.failures.push('touch action discoverability failed');await touchContext.close();
 }
 if(reference&&existsSync(reference)){
  const a=PNG.sync.read(readFileSync(reference));const b=PNG.sync.read(readFileSync(`${output}/telemetry-1672x941-dark.png`));
  const combined=new PNG({width:a.width+b.width,height:Math.max(a.height,b.height),fill:true});
  PNG.bitblt(a,combined,0,0,a.width,a.height,0,0);PNG.bitblt(b,combined,0,0,b.width,b.height,a.width,0);
  writeFileSync(`${output}/reference-side-by-side.png`,PNG.sync.write(combined));
 }
 writeFileSync(`${reportDir}/${baseline?'baseline':checksOnly?'checks':quick?'quick':'report'}.json`,JSON.stringify(report,null,2)+'\n');
 if(report.failures.length){console.error(JSON.stringify(report.failures));process.exitCode=1;}
 }
}finally{await browser?.close();await server?.close();}
