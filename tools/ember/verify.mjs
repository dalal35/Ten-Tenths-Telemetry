// Local browser verification. All IPC is simulated; telemetry values come from real 0361 diagnostics.
import {createServer} from 'vite';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {launchBrowser,browserTestEntries,browserTestNoWatch} from '../../scripts/browser.mjs';
import {initFixture} from './fixture.mjs';
import {contrast} from './contrast.mjs';
import AxeBuilder from '@axe-core/playwright';
import pixelmatch from 'pixelmatch';
import {PNG} from 'pngjs';

const data=JSON.parse(readFileSync(process.env.EMBER_ADVANCED_FIXTURE||'.tools/advanced-ui/0361.json'));
const coach=JSON.parse(readFileSync(process.env.EMBER_COACH_FIXTURE||'.tools/coach-ui/0361.json'));
const baseline=JSON.parse(readFileSync('tools/ember/before-measurements.json'));
const fixed=baseline.fixed;
const report={simulatedIPC:true,themes:[],differences:[],failures:[]};
let server,browser;
try{
 server=await createServer({configLoader:'runner',plugins:[browserTestNoWatch],optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}});
 await server.listen();browser=await launchBrowser();
 for(const theme of ['dark','light']){
  const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,reducedMotion:'reduce'});
  const page=await context.newPage();await page.addInitScript(initFixture,{data,coach,fixed,theme});
  await page.goto(server.resolvedUrls.local[0]);await page.locator('.uplot').first().waitFor();await page.evaluate(()=>document.fonts.ready);
  await page.waitForTimeout(500);
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  const result={theme,axe:axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary,html:n.html}))}))};
  result.contrast=await page.evaluate(()=>{
   const root=getComputedStyle(document.documentElement),color=name=>root.getPropertyValue(name).trim();
   const canvas=getComputedStyle(document.querySelector('.plot-row')).backgroundColor;
   const pairs=[];
   for(const bg of ['--surface-0','--surface-1','--surface-2','--surface-3','--surface-4'])for(const fg of ['--ink','--muted','--subtle'])pairs.push({foreground:fg,background:bg,fg:color(fg),bg:color(bg),minimum:4.5});
   for(const fg of ['--trace-primary','--trace-comparison','--delta-ahead','--delta-behind'])pairs.push({foreground:fg,background:'actual plot background',fg:color(fg),bg:canvas,minimum:3});
   for(const bg of ['--bg','--panel','--raised'])for(const fg of ['--accent-focus','--control'])pairs.push({foreground:fg,background:bg,fg:color(fg),bg:color(bg),minimum:3});
   return pairs;
  });
  for(const pair of result.contrast){try{pair.ratio=contrast(pair.fg,pair.bg);pair.pass=pair.ratio>=pair.minimum;}catch(e){pair.error=e.message;pair.pass=false;}}
  result.smallText=await page.evaluate(()=>[...document.querySelectorAll('.titlebar *, .sidebar *, main *, .statusbar *')].filter(e=>e.getClientRects().length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<11).map(e=>({tag:e.tagName,class:e.className,text:e.textContent.slice(0,70),size:getComputedStyle(e).fontSize})));
  await page.evaluate(()=>{window.__emberIdentity=[...document.querySelectorAll('.uplot canvas')];window.__emberCommits=[];});
  const graph=page.locator('[data-plot]').first();await graph.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');await page.waitForTimeout(100);
  result.cursor=await page.evaluate(()=>({sameCanvas:window.__emberIdentity.every((c,i)=>c===document.querySelectorAll('.uplot canvas')[i]),commits:window.__emberCommits.length,plotUpdates:window.__emberCommits.reduce((n,c)=>n+(c.Plots||0),0),focusOutline:getComputedStyle(document.activeElement).outlineStyle}));
  await page.getByRole('button',{name:`Switch to ${theme==='dark'?'light':'dark'} theme`}).click();await page.waitForTimeout(150);
  result.themeSwitch=await page.evaluate(()=>({sameCanvas:window.__emberIdentity.every((c,i)=>c===document.querySelectorAll('.uplot canvas')[i]),theme:document.documentElement.dataset.theme}));
  await page.getByRole('button',{name:`Switch to ${theme} theme`}).click();await page.waitForTimeout(100);
  const over=page.locator('.u-over').first(),b=await over.boundingBox();
  const zoom=()=>page.evaluate(()=>window.__emberCalls.filter(c=>c.cmd==='save_workspace').at(-1)?.args.workspace.zoom);
  await page.mouse.move(b.x+b.width*.2,b.y+20);await page.mouse.down();await page.mouse.move(b.x+b.width*.7,b.y+20,{steps:8});await page.mouse.up();await page.waitForTimeout(850);const narrowed=await zoom();
  await page.keyboard.down('Shift');await page.mouse.move(b.x+b.width*.6,b.y+30);await page.mouse.down();await page.mouse.move(b.x+b.width*.5,b.y+30,{steps:6});await page.mouse.up();await page.keyboard.up('Shift');await page.waitForTimeout(850);const panned=await zoom();
  await page.getByRole('button',{name:'↔ Reset zoom',exact:true}).click();await page.waitForTimeout(850);const reset=await zoom();
  result.zoomPan={narrowed,panned,reset,narrowedRange:!!narrowed&&narrowed.max-narrowed.min<fixed.zoom.max-fixed.zoom.min,panPreservesRange:!!panned&&!!narrowed&&Math.abs((panned.max-panned.min)-(narrowed.max-narrowed.min))<.01&&panned.min!==narrowed.min,resetCleared:reset==null};
  result.interactionIdentity=await page.evaluate(()=>window.__emberIdentity.every((c,i)=>c===document.querySelectorAll('.uplot canvas')[i]));
  if(theme==='dark'){
   const cdp=await context.newCDPSession(page);
   for(const type of ['protanopia','deuteranopia']){await cdp.send('Emulation.setEmulatedVisionDeficiency',{type});await page.screenshot({path:`docs/ember/screenshots/after/telemetry-1440x900-dark-${type}.png`,animations:'disabled',caret:'hide'});}
   await cdp.detach();
  }
  report.themes.push(result);await context.close();
 }
 for(const capture of baseline.captures.filter(c=>c.workspace==='telemetry')){
  const after=capture.path.replace('/before/','/after/');if(!existsSync(after))continue;
  const a=PNG.sync.read(readFileSync(capture.path)),b=PNG.sync.read(readFileSync(after)),diff=new PNG({width:a.width,height:a.height});
  const pixels=pixelmatch(a.data,b.data,diff.data,a.width,a.height,{threshold:.1});
  const path=after.replace('.png','-diff.png');writeFileSync(path,PNG.sync.write(diff));report.differences.push({before:capture.path,after,path,pixels,fraction:pixels/(a.width*a.height)});
 }
 for(const r of report.themes){if(r.axe.length)report.failures.push(`${r.theme}: axe violations`);if(r.smallText.length)report.failures.push(`${r.theme}: text below 11px`);if(r.contrast.some(p=>!p.pass))report.failures.push(`${r.theme}: contrast failures`);if(!r.themeSwitch.sameCanvas||!r.cursor.sameCanvas||!r.interactionIdentity)report.failures.push(`${r.theme}: canvas remount`);if(!r.zoomPan.narrowedRange||!r.zoomPan.panPreservesRange||!r.zoomPan.resetCleared)report.failures.push(`${r.theme}: zoom/pan/reset`);}
 mkdirSync('tools/ember',{recursive:true});writeFileSync('tools/ember/verification.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report.themes.map(r=>({theme:r.theme,axe:r.axe.map(v=>[v.id,v.nodes.length]),smallText:r.smallText,cursor:r.cursor,themeSwitch:r.themeSwitch,zoomPan:r.zoomPan,contrastFailures:r.contrast.filter(p=>!p.pass)})),null,2));
 if(report.failures.length){console.error(report.failures);process.exitCode=1;}
}finally{await browser?.close();await server?.close();}
