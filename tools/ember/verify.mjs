// Local browser verification. All IPC is simulated; telemetry values come from real 0361 diagnostics.
import {createServer} from 'vite';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {launchBrowser,browserTestEntries,browserTestNoWatch} from '../../scripts/browser.mjs';
import {initFixture,settleCursor} from './fixture.mjs';
import {contrast} from './contrast.mjs';
import AxeBuilder from '@axe-core/playwright';
import pixelmatch from 'pixelmatch';
import {PNG} from 'pngjs';

const data=JSON.parse(readFileSync(process.env.EMBER_ADVANCED_FIXTURE||'.tools/advanced-ui/0361.json'));
const coach=JSON.parse(readFileSync(process.env.EMBER_COACH_FIXTURE||'.tools/coach-ui/0361.json'));
const passB1=process.argv.includes('--pass-b1');
const baseline=JSON.parse(readFileSync(`tools/ember/${passB1?'after':'before'}-measurements.json`));
const b1=passB1?JSON.parse(readFileSync('tools/ember/pass-b1-measurements.json')):null;
const b1Before=passB1?JSON.parse(readFileSync('tools/ember/pass-b1-before-measurements.json')):null;
const fixed=baseline.fixed;
const report={simulatedIPC:true,themes:[],differences:[],failures:[]};
let server,browser;
try{
 server=await createServer({configLoader:'runner',plugins:[browserTestNoWatch],optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}});
 await server.listen();browser=await launchBrowser();
 for(const theme of ['dark','light']){
  const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,reducedMotion:'reduce'});
  const page=await context.newPage();await page.addInitScript(initFixture,{data,coach,fixed,theme});
  await page.goto(server.resolvedUrls.local[0]);await settleCursor(page);
  await page.waitForTimeout(500);
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  const result={theme,axe:axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary,html:n.html}))}))};
  result.contrast=await page.evaluate(()=>{
   const root=getComputedStyle(document.documentElement),color=name=>root.getPropertyValue(name).trim();
   const canvas=getComputedStyle(document.querySelector('.plot-row')).backgroundColor;
   const pairs=[];
   for(const bg of ['--surface-0','--surface-1','--surface-2','--surface-3','--surface-4'])for(const fg of ['--ink','--muted','--subtle'])pairs.push({foreground:fg,background:bg,fg:color(fg),bg:color(bg),minimum:4.5});
   for(const fg of ['--trace-primary','--trace-comparison','--delta-trace','--delta-ahead','--delta-behind'])pairs.push({foreground:fg,background:'actual plot background',fg:color(fg),bg:canvas,minimum:3});
   for(const bg of ['--bg','--panel','--raised'])for(const fg of ['--accent-focus','--control'])pairs.push({foreground:fg,background:bg,fg:color(fg),bg:color(bg),minimum:3});
   return pairs;
  });
  for(const pair of result.contrast){try{pair.ratio=contrast(pair.fg,pair.bg);pair.pass=pair.ratio>=pair.minimum;}catch(e){pair.error=e.message;pair.pass=false;}}
  if(passB1){
   const trigger=page.locator('button.chart-help-control, .chart-help-control button');
   if(await trigger.count()){
    await trigger.focus();
    result.tooltip={triggerCount:await trigger.count(),focused:await trigger.evaluate(e=>document.activeElement===e),visible:await page.locator('.chart-help-tooltip').evaluate(e=>{const s=getComputedStyle(e);return !!e.getClientRects().length&&s.visibility==='visible'&&s.display!=='none'&&Number(s.opacity)>0;}),accessibleName:await trigger.getAttribute('aria-label')};
    await trigger.hover();await trigger.evaluate(e=>e.blur());
    const triggerBox=await trigger.boundingBox(),tooltipBox=await page.locator('.chart-help-tooltip').boundingBox();
    await page.mouse.move(triggerBox.x+triggerBox.width/2,tooltipBox.y+10,{steps:12});
    result.tooltip.hoverReachable=await page.locator('.chart-help-tooltip').isVisible();
    await trigger.focus();await page.keyboard.press('Escape');
    result.tooltip.escapeDismissed=await page.locator('.chart-help-tooltip').evaluate(e=>getComputedStyle(e).display==='none');
    result.tooltip.focusRetained=await trigger.evaluate(e=>document.activeElement===e);
    const source=page.locator('.sidebar-footer');await source.focus();
    result.sourceTooltip={visible:await source.evaluate(e=>getComputedStyle(e,'::after').content!=='none')};
    await source.hover();await source.evaluate(e=>e.blur());
    const sourceBox=await source.boundingBox();await page.mouse.move(sourceBox.x+80,sourceBox.y-10,{steps:12});
    result.sourceTooltip.hoverReachable=await source.evaluate(e=>getComputedStyle(e,'::after').content!=='none');
    await source.focus();await page.keyboard.press('Escape');
    result.sourceTooltip.escapeDismissed=await source.evaluate(e=>getComputedStyle(e,'::after').content==='none');
    result.sourceTooltip.focusRetained=await source.evaluate(e=>document.activeElement===e);
   }else result.tooltip={triggerCount:0,focused:false,visible:false};
  }
  if(passB1){
   result.fontFloors=await page.evaluate(()=>{
    const styles=selector=>[...document.querySelectorAll(selector)].filter(e=>e.getClientRects().length).map(e=>({size:parseFloat(getComputedStyle(e).fontSize),text:e.textContent?.trim().slice(0,40)}));
    const body=parseFloat(getComputedStyle(document.body).fontSize),legends=styles('.readout, .plot-label');
    const canvas=[...new Set([...document.querySelectorAll('.plot-row .uplot canvas')].flatMap(c=>window.__emberCanvasFontMap.get(c)||[]))].map(font=>({font,size:Number(font.match(/([\d.]+)px/)?.[1]||0)}));
    const loaded=[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family);
    return {body,legends,canvas,loaded,bodyPass:body>=12,legendsPass:legends.every(x=>x.size>=12),canvasPass:canvas.length>0&&canvas.every(x=>x.size>=11),geistLoaded:loaded.includes('Geist')&&document.fonts.check('12px Geist'),canvasFamilyPass:canvas.every(x=>x.font.includes('Geist'))};
   });
  }
  result.smallText=await page.evaluate(()=>[...document.querySelectorAll('.titlebar *, .sidebar *, main *, .statusbar *')].filter(e=>e.getClientRects().length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<11).map(e=>({tag:e.tagName,class:e.className,text:e.textContent.slice(0,70),size:getComputedStyle(e).fontSize})));
  await page.evaluate(()=>{window.__emberIdentity=[...document.querySelectorAll('.uplot canvas')];window.__emberCommits=[];});
  const graph=page.locator('[data-plot]').first();await graph.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');await page.waitForTimeout(100);
  result.cursor=await page.evaluate(()=>({sameCanvas:window.__emberIdentity.every((c,i)=>c===document.querySelectorAll('.uplot canvas')[i]),commits:window.__emberCommits.length,plotUpdates:window.__emberCommits.reduce((n,c)=>n+(c.Plots||0),0),focusOutline:getComputedStyle(document.activeElement).outlineStyle}));
  await page.getByRole('button',{name:`Switch to ${theme==='dark'?'light':'dark'} theme`}).click();await page.waitForTimeout(150);
  result.themeSwitch=await page.evaluate(()=>{
   const strokes=[...document.querySelectorAll('.uplot canvas')].map(c=>window.__emberStrokes.get(c)||[]),style=getComputedStyle(document.documentElement);
   const primary=style.getPropertyValue('--trace-primary').trim().toLowerCase(),comparison=style.getPropertyValue('--trace-comparison').trim().toLowerCase(),delta=style.getPropertyValue('--delta-trace').trim().toLowerCase();
   const axis=style.getPropertyValue('--muted').trim().toLowerCase();
   const ctx=document.createElement('canvas').getContext('2d'),normalize=c=>{ctx.fillStyle=c;return ctx.fillStyle.toLowerCase();};
   const dotColors=[...document.querySelectorAll('.u-cursor-pt')].map(p=>normalize(getComputedStyle(p).backgroundColor));
   return {sameCanvas:window.__emberIdentity.every((c,i)=>c===document.querySelectorAll('.uplot canvas')[i]),theme:document.documentElement.dataset.theme,primaryPainted:strokes.some(s=>s.some(p=>p.color===primary&&!p.dash.length)),comparisonDashed:strokes.some(s=>s.some(p=>p.color===comparison&&p.dash.length)),deltaPainted:strokes.some(s=>s.some(p=>p.color===delta)),axisPainted:window.__emberCanvasColors.map(c=>c.toLowerCase()).includes(axis),dotColors,cursorDotsCurrent:dotColors.length>0&&dotColors.every(c=>[primary,comparison,delta].includes(c))};
  });
  await page.getByRole('button',{name:`Switch to ${theme} theme`}).click();await page.waitForTimeout(100);
  const over=page.locator('.u-over').first(),b=await over.boundingBox();
  const zoom=()=>page.evaluate(()=>window.__emberCalls.filter(c=>c.cmd==='save_workspace').at(-1)?.args.workspace.zoom);
  await page.mouse.move(b.x+b.width*.2,b.y+20);await page.mouse.down();await page.mouse.move(b.x+b.width*.7,b.y+20,{steps:8});await page.mouse.up();await page.waitForTimeout(850);const narrowed=await zoom();
  await page.keyboard.down('Shift');await page.mouse.move(b.x+b.width*.6,b.y+30);await page.mouse.down();await page.mouse.move(b.x+b.width*.5,b.y+30,{steps:6});await page.mouse.up();await page.keyboard.up('Shift');await page.waitForTimeout(850);const panned=await zoom();
  await page.getByRole('button',{name:'↔ Reset zoom',exact:true}).click();await page.waitForTimeout(850);const reset=await zoom();
  const fullMax=Math.max(...data.analysis.primary.series.map(s=>s.x.at(-1)||0),data.analysis.delta.x.at(-1)||0);
  result.zoomPan={narrowed,panned,reset,narrowedRange:!!narrowed&&narrowed.max-narrowed.min<fixed.zoom.max-fixed.zoom.min,panPreservesRange:!!panned&&!!narrowed&&Math.abs((panned.max-panned.min)-(narrowed.max-narrowed.min))<.01&&panned.min!==narrowed.min,resetCleared:reset==null||(Math.abs(reset.min)<.01&&Math.abs(reset.max-fullMax)<.01)};
  result.interactionIdentity=await page.evaluate(()=>window.__emberIdentity.every((c,i)=>c===document.querySelectorAll('.uplot canvas')[i]));
  // Restore the exact fixed zoom/cursor before the CVD and narrow-window checks.
  await page.reload();await settleCursor(page);await page.waitForTimeout(200);
  if(!passB1 && theme==='dark'){
   const cdp=await context.newCDPSession(page);
   for(const type of ['protanopia','deuteranopia']){await cdp.send('Emulation.setEmulatedVisionDeficiency',{type});await page.screenshot({path:`docs/ember/screenshots/after/telemetry-1440x900-dark-${type}.png`,animations:'disabled',caret:'hide'});}
   await cdp.detach();
  }
  await page.setViewportSize({width:600,height:500});await page.waitForTimeout(200);
  result.narrow={controls:[]};
  for(const selector of ['.channel-control>button','[data-plot]','.corner-controls button:not(:disabled)','.track-position-control input','.segment-card']){
   const controls=page.locator(selector);
   for(let i=0;i<await controls.count();i++){const control=controls.nth(i);await control.scrollIntoViewIfNeeded();const box=await control.boundingBox();result.narrow.controls.push({selector,index:i,reachable:!!box&&box.x>=0&&box.x+box.width<=600.5&&box.y<472&&box.y+box.height>52});}
  }
  await page.locator('.channel-control>button').click();
  result.narrow.channelMenu=await page.locator('.channel-menu').evaluate(e=>{const b=e.getBoundingClientRect();return {x:b.x,right:b.right,top:b.top,bottom:b.bottom,height:b.height};});
  await page.locator('.channel-menu input').last().focus();
  const lastChannel=await page.locator('.channel-menu input').last().boundingBox();
  result.narrow.lastChannelReachable=!!lastChannel&&lastChannel.y>=result.narrow.channelMenu.top&&lastChannel.y+lastChannel.height<=Math.min(result.narrow.channelMenu.bottom,472);
  await page.locator('.channel-control>button').click();
  result.narrow.overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.body.scrollWidth>innerWidth);
  result.narrow.plotHeights=await page.locator('[data-plot]').evaluateAll(elements=>elements.map(e=>e.getBoundingClientRect().height));
  result.narrow.axe=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations.map(v=>({id:v.id,nodes:v.nodes.length}));
  report.themes.push(result);await context.close();
 }
 for(const capture of baseline.captures.filter(c=>c.workspace==='telemetry')){
  const after=passB1?capture.path.replace('/after/','/after/pass-b1/'):capture.path.replace('/before/','/after/');if(!existsSync(after))continue;
  const a=PNG.sync.read(readFileSync(capture.path)),b=PNG.sync.read(readFileSync(after)),diff=new PNG({width:a.width,height:a.height});
  const pixels=pixelmatch(a.data,b.data,diff.data,a.width,a.height,{threshold:.1});
  const path=after.replace('.png','-diff.png');writeFileSync(path,PNG.sync.write(diff));report.differences.push({before:capture.path,after,path,pixels,fraction:pixels/(a.width*a.height)});
 }
 if(passB1){
 report.geometry=[];
 for(const capture of b1.captures){
  const previous=baseline.captures.find(x=>x.workspace==='telemetry'&&x.w===capture.w&&x.h===capture.h&&x.theme===capture.theme);
  if(!previous){report.failures.push(`missing Pass B geometry ${capture.w}x${capture.h} ${capture.theme}`);continue;}
  const m=capture.metrics,old=previous.metrics;
  const plotChanges=m.plots.map((p,i)=>({before:old.plots[i]?.box,after:p.box,heightChange:old.plots[i]?.box.height?(p.box.height/old.plots[i].box.height-1):null}));
  const beforeRegions=b1Before.captures.find(x=>x.w===capture.w&&x.h===capture.h&&x.theme===capture.theme)?.metrics.regions||null;
  const regionChanges=Object.fromEntries(['sidebar','inspector','plots'].map(name=>{const a=beforeRegions?.[name]?.box,b=m.regions?.[name]?.box;return [name,a&&b?{x:b.x-a.x,y:b.y-a.y,width:b.width-a.width,height:b.height-a.height}:null];}));
  report.geometry.push({viewport:[capture.w,capture.h],theme:capture.theme,utilizationBefore:old.utilization,utilizationAfter:m.utilization,plotChanges,regionsBefore:beforeRegions,regionsAfter:m.regions,regionChanges,overflow:m.documentOverflow||m.bodyOverflow,textAudit:m.textAudit});
  for(const [name,diff] of Object.entries(regionChanges))if(!diff||Math.abs(diff.x)>.5||Math.abs(diff.width)>.5||(capture.w>600&&Math.abs(diff.y)>24))report.failures.push(`${capture.theme} ${capture.w}: ${name} region shifted`);
  if(capture.w>600&&(m.utilization<.65||m.utilization>.75))report.failures.push(`${capture.theme} ${capture.w}: chart utilization outside 65-75%`);
  if(plotChanges.some(p=>p.heightChange===null||Math.abs(p.heightChange)>.05))report.failures.push(`${capture.theme} ${capture.w}: plot height changed by >5%`);
  if(m.documentOverflow||m.bodyOverflow)report.failures.push(`${capture.theme} ${capture.w}: horizontal overflow`);
  if(capture.errors.length)report.failures.push(`${capture.theme} ${capture.w}: page errors`);
 }
 }
 if(passB1)for(const r of report.themes){if(!r.fontFloors.geistLoaded||!r.fontFloors.canvasFamilyPass)report.failures.push(`${r.theme}: font loading or canvas family`);if(!r.tooltip.hoverReachable||!r.tooltip.escapeDismissed||!r.tooltip.focusRetained||!r.sourceTooltip.hoverReachable||!r.sourceTooltip.visible||!r.sourceTooltip.escapeDismissed||!r.sourceTooltip.focusRetained)report.failures.push(`${r.theme}: tooltip dismissal or hover access`);if(r.cursor.commits!==2||r.cursor.plotUpdates!==2)report.failures.push(`${r.theme}: cursor renders increased versus Pass B`);}
 for(const r of report.themes){if(passB1&&(!r.fontFloors.bodyPass||!r.fontFloors.legendsPass||!r.fontFloors.canvasPass))report.failures.push(`${r.theme}: font minimums`);if(passB1&&(!r.tooltip?.focused||!r.tooltip?.visible||!r.tooltip?.accessibleName))report.failures.push(`${r.theme}: keyboard tooltip`);if(r.axe.length||r.narrow.axe.length)report.failures.push(`${r.theme}: axe violations`);if(r.smallText.length)report.failures.push(`${r.theme}: text below 11px`);if(r.contrast.some(p=>!p.pass))report.failures.push(`${r.theme}: contrast failures`);if(!r.themeSwitch.sameCanvas||!r.cursor.sameCanvas||!r.interactionIdentity)report.failures.push(`${r.theme}: canvas remount`);if(!r.themeSwitch.primaryPainted||!r.themeSwitch.comparisonDashed||!r.themeSwitch.deltaPainted||!r.themeSwitch.axisPainted||!r.themeSwitch.cursorDotsCurrent)report.failures.push(`${r.theme}: resolved canvas palette`);if(!r.zoomPan.narrowedRange||!r.zoomPan.panPreservesRange||!r.zoomPan.resetCleared)report.failures.push(`${r.theme}: zoom/pan/reset`);if(r.narrow.overflow||r.narrow.controls.some(c=>!c.reachable)||r.narrow.plotHeights.some(h=>h<119.5)||r.narrow.channelMenu.x<0||r.narrow.channelMenu.right>600||r.narrow.channelMenu.bottom>472||!r.narrow.lastChannelReachable)report.failures.push(`${r.theme}: narrow layout`);}
 mkdirSync('tools/ember',{recursive:true});writeFileSync(`tools/ember/${passB1?'pass-b1-verification':'verification'}.json`,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report.themes.map(r=>({theme:r.theme,axe:r.axe.map(v=>[v.id,v.nodes.length]),smallText:r.smallText,cursor:r.cursor,themeSwitch:r.themeSwitch,zoomPan:r.zoomPan,contrastFailures:r.contrast.filter(p=>!p.pass)})),null,2));
 if(report.failures.length){console.error(report.failures);process.exitCode=1;}
}finally{await browser?.close();await server?.close();}
