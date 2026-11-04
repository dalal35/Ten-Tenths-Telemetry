// Deterministic captures use locally cached real XRK diagnostic output. IPC is simulated.
import { createServer } from 'vite';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { launchBrowser, browserTestEntries, browserTestNoWatch } from '../../scripts/browser.mjs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { initFixture, fixed, settleCursor } from './fixture.mjs';
import AxeBuilder from '@axe-core/playwright';

const phase = process.argv[2] || 'before';
const measureOnly = process.argv.includes('--measure-only');
assert(['before','pass-a','after'].includes(phase), 'Use before, pass-a, or after');
const output = phase === 'before' ? 'docs/ember/screenshots/before' : phase === 'pass-a' ? 'docs/ember/screenshots/after/pass-a' : 'docs/ember/screenshots/after';
const fixturePath = process.env.EMBER_ADVANCED_FIXTURE || '.tools/advanced-ui/0361.json';
const coachPath = process.env.EMBER_COACH_FIXTURE || '.tools/coach-ui/0361.json';
const data = JSON.parse(readFileSync(fixturePath, 'utf8'));
const coach = JSON.parse(readFileSync(coachPath, 'utf8'));
assert.equal(data.analysis.primary.lapId, 'lap-8');
assert.equal(data.analysis.comparison.lapId, 'lap-9');
assert(data.analysis.delta && data.session.source.includes('0361'), 'Expected real 0361 comparison diagnostic');
const sizes = phase === 'pass-a' ? [[1440,900]] : [[1440,900],[1920,1080],[600,500]];
const captures = [];
for (const [w,h] of sizes) for (const theme of ['dark','light']) captures.push({workspace:'telemetry',w,h,theme});
if (phase === 'before') for (const workspace of ['advanced','coach','video','library']) for (const theme of ['dark','light']) captures.push({workspace,w:1440,h:900,theme});
mkdirSync(output,{recursive:true});
if (phase === 'before' && !measureOnly && captures.some(c=>existsSync(`${output}/${c.workspace==='coach'?'ai-coach':c.workspace}-${c.w}x${c.h}-${c.theme}.png`))) throw Error('Baseline screenshot already exists: refusing to overwrite it.');
let server,browser;
const results = {phase, simulatedIPC:true, fixed, captures:[], renderCounts:'React development DevTools hook commit traversal, counting changed props/state; approximate component updates, not React Profiler timings', weaknesses:[]};
try {
 server=await createServer({configLoader:'runner',plugins:[browserTestNoWatch],optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});await server.listen();browser=await launchBrowser();
 for(const c of captures){
  const context=await browser.newContext({viewport:{width:c.w,height:c.h},deviceScaleFactor:1,reducedMotion:'reduce'});
  const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(initFixture,{data,coach,fixed,theme:c.theme});
  await page.goto(server.resolvedUrls.local[0]);
  await settleCursor(page);
  if(c.workspace==='advanced')await page.getByRole('button',{name:'Advanced',exact:true}).click();
  if(c.workspace==='coach')await page.getByRole('button',{name:'AI Driving Coach',exact:true}).click();
  if(c.workspace==='video')await page.getByRole('button',{name:'Video',exact:true}).click();
  if(c.workspace==='library') {await page.getByRole('button',{name:'Session actions',exact:true}).click();await page.getByRole('menuitem',{name:'Edit details',exact:true}).click();}
  await page.waitForTimeout(700);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const name=`${c.workspace==='coach'?'ai-coach':c.workspace}-${c.w}x${c.h}-${c.theme}.png`;
  if(!measureOnly)await page.screenshot({path:`${output}/${name}`,animations:'disabled',caret:'hide'});
  const metrics=await page.evaluate(()=>{
   const ws=document.querySelector('.workspace-viewport'),plots=[...document.querySelectorAll('.plot-row')].filter(e=>!e.hidden),viewport={width:innerWidth,height:innerHeight};
   const rect=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};};
   const box=ws?rect(ws):null,main=document.querySelector('main.main'),mainBox=main?rect(main):null;
   const rows=plots.map(e=>{const b=rect(e),visible=Math.max(0,Math.min(b.y+b.height,box?.y+box?.height??innerHeight,innerHeight)-Math.max(b.y,box?.y??0,0));return {box:b,visibleHeight:visible};});
   const font=selector=>{const e=document.querySelector(selector);if(!e)return null;const s=getComputedStyle(e);return {size:s.fontSize,family:s.fontFamily,color:s.color,background:s.backgroundColor};};
   return {viewport,workspace:box,mainWorkspace:mainBox,plots:rows,mainUtilization:mainBox?.height?rows.reduce((n,r)=>n+r.visibleHeight,0)/mainBox.height:null,utilization:box?.height?rows.reduce((n,r)=>n+r.visibleHeight,0)/box.height:null,documentOverflow:document.documentElement.scrollWidth>innerWidth,bodyOverflow:document.body.scrollWidth>innerWidth,fonts:{body:font('body'),label:font('.plot-label'),legend:font('.readout'),secondary:font('.chart-help'),axis:font('.axis-label')},canvasCount:document.querySelectorAll('.uplot canvas').length,canvasFonts:window.__emberCanvasFonts,canvasTextColors:window.__emberCanvasColors,reactCommitCounts:window.__emberCommits.length,reactComponentUpdates:window.__emberCommits.reduce((all,commit)=>{for(const [key,value] of Object.entries(commit))all[key]=(all[key]||0)+value;return all;},{})};
  });
  if(c.workspace==='telemetry'&&c.w===1440){
   const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
   metrics.axe=axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length}));
   const before=await page.evaluate(()=>{window.__emberCanvasIdentity=[...document.querySelectorAll('.uplot canvas')];return {commits:window.__emberCommits.length,components:window.__emberCommits.length?window.__emberCommits.at(-1):{}};});
   const graph=page.locator('[data-plot]').first();await graph.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');
   await page.waitForTimeout(100);
   metrics.cursorInteraction=await page.evaluate(before=>({sameCanvas:window.__emberCanvasIdentity.every((c,i)=>c===document.querySelectorAll('.uplot canvas')[i]),reactCommits:window.__emberCommits.length-before.commits,componentUpdates:window.__emberCommits.slice(before.commits).reduce((a,c)=>{for(const [k,v] of Object.entries(c))a[k]=(a[k]||0)+v;return a;},{})}),before);
   await page.getByRole('button',{name:`Switch to ${c.theme==='dark'?'light':'dark'} theme`}).click();await page.waitForTimeout(200);
   metrics.themeInteraction=await page.evaluate(()=>({sameCanvas:window.__emberCanvasIdentity.every((c,i)=>c===document.querySelectorAll('.uplot canvas')[i])}));
  }
  results.captures.push({...c,path:`${output}/${name}`,metrics,errors});
  console.log(JSON.stringify({capture:name,utilization:metrics.utilization,heights:metrics.plots.map(x=>x.box.height),errors}));
  await context.close();
 }
 writeFileSync(`tools/ember/${phase}-measurements.json`,JSON.stringify(results,null,2)+'\n');
}finally{await browser?.close();await server?.close();}
