// Deterministic captures use locally cached real XRK diagnostic output. IPC is simulated.
import { createServer } from 'vite';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { launchBrowser, browserTestEntries, browserTestNoWatch } from '../../scripts/browser.mjs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { initFixture, fixed, settleCursor } from './fixture.mjs';
import AxeBuilder from '@axe-core/playwright';

const phase = process.argv[2] || 'before';
const measureOnly = process.argv.includes('--measure-only') || phase === 'pass-b1-before' || phase === 'pass-b1-regions';
assert(['before','pass-a','after','pass-b1-before','pass-b1-regions','pass-b1'].includes(phase), 'Use before, pass-a, after, pass-b1-before, pass-b1-regions, or pass-b1');
if (phase === 'pass-b1-before' && existsSync('tools/ember/pass-b1-before-measurements.json')) throw Error('Pass B.1 pre-edit measurement already exists: refusing to overwrite it.');
const output = phase === 'before' ? 'docs/ember/screenshots/before' : phase === 'pass-a' ? 'docs/ember/screenshots/after/pass-a' : phase.startsWith('pass-b1') ? 'docs/ember/screenshots/after/pass-b1' : 'docs/ember/screenshots/after';
const fixturePath = process.env.EMBER_ADVANCED_FIXTURE || '.tools/advanced-ui/0361.json';
const coachPath = process.env.EMBER_COACH_FIXTURE || '.tools/coach-ui/0361.json';
const data = JSON.parse(readFileSync(fixturePath, 'utf8'));
const coach = JSON.parse(readFileSync(coachPath, 'utf8'));
assert.equal(data.analysis.primary.lapId, 'lap-8');
assert.equal(data.analysis.comparison.lapId, 'lap-9');
assert(data.analysis.delta && data.session.source.includes('0361'), 'Expected real 0361 comparison diagnostic');
const sizes = (phase === 'pass-a' || phase === 'pass-b1-before') ? [[1440,900]] : [[1440,900],[1920,1080],[600,500]];
const captures = [];
for (const [w,h] of sizes) for (const theme of ['dark','light']) captures.push({workspace:'telemetry',w,h,theme});
if (phase === 'before') for (const workspace of ['advanced','coach','video','library']) for (const theme of ['dark','light']) captures.push({workspace,w:1440,h:900,theme});
mkdirSync(output,{recursive:true});
if (phase === 'before' && !measureOnly && captures.some(c=>existsSync(`${output}/${c.workspace==='coach'?'ai-coach':c.workspace}-${c.w}x${c.h}-${c.theme}.png`))) throw Error('Baseline screenshot already exists: refusing to overwrite it.');
// Restore modified tracked source files in the Vite transform pipeline only; disk files stay untouched.
const baselinePaths=phase==='pass-b1-regions'?execFileSync('git',['diff','--name-only','da64955','--','src'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean):[];
const baselineSources=Object.fromEntries(baselinePaths.map(path=>[path,execFileSync('git',['show',`da64955:${path}`],{encoding:'utf8'})]));
const baselinePlugin={name:'ember-pass-b-baseline',enforce:'pre',transform(code,id){const path=id.replaceAll('\\','/').split('?')[0];const key=Object.keys(baselineSources).find(p=>path.endsWith('/'+p));if(key)return {code:baselineSources[key],map:null};}};
let server,browser;
const results = {phase, simulatedIPC:true, fixed, captures:[], renderCounts:'React development DevTools hook commit traversal, counting changed props/state; approximate component updates, not React Profiler timings', weaknesses:[]};
try {
 server=await createServer({configLoader:'runner',plugins:[...(phase==='pass-b1-regions'?[baselinePlugin]:[]),browserTestNoWatch],optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});await server.listen();browser=await launchBrowser();
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
   const audit=()=>{
    // Count visible direct-text owners, once each. Clip against viewport and every overflow-clipping ancestor.
    const entries=[...document.querySelectorAll('body *')].flatMap(e=>{
     const text=[...e.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent.trim()).filter(Boolean).join(' ').replace(/\s+/g,' ');
     if(!text || ['SCRIPT','STYLE'].includes(e.tagName))return [];
     const style=getComputedStyle(e);if(style.visibility!=='visible'||style.display==='none'||Number(style.opacity)===0||style.clipPath==='inset(50%)'||/rect\(0px, 0px, 0px, 0px\)/.test(style.clip))return [];
     let b=e.getBoundingClientRect(),l=Math.max(0,b.left),r=Math.min(innerWidth,b.right),t=Math.max(0,b.top),bottom=Math.min(innerHeight,b.bottom);
     for(let a=e.parentElement;a;a=a.parentElement){const s=getComputedStyle(a);if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)===0||s.clipPath==='inset(50%)'||/rect\(0px, 0px, 0px, 0px\)/.test(s.clip))return [];const x=a.getBoundingClientRect();if(/hidden|clip|auto|scroll/.test(s.overflowX)){l=Math.max(l,x.left);r=Math.min(r,x.right);}if(/hidden|clip|auto|scroll/.test(s.overflowY)){t=Math.max(t,x.top);bottom=Math.min(bottom,x.bottom);}}
     if(r<=l||bottom<=t)return [];
     const supporting=!!e.closest('.session-meta, .session-facts, .session-source, .lap-table-head, .reading-key, .chart-help, .map-caption-hint, .segment-index, .track-source, .best-stat, .local-badge, .statusbar') || (e.classList.contains('map-caption') && text==='Select a section to focus · use the slider to inspect');
     return [{text,tag:e.tagName.toLowerCase(),class:typeof e.className==='string'?e.className:'',size:style.fontSize,supporting}];
    });const safe=/^(Telemetry|Advanced|Video|AI Driving Coach|LOCAL WORKSPACE|Session library|Laps|Lap|Time|Ref\.|Primary|Reference|Primary lap|Comparison lap|Primary ahead|Distance|Compact|Channels|GPS Speed|RPM|Spatial time delta|Delta|Ahead|Track position|Measured GPS|Speed|Delta to reference|Lap position|Section comparison|DRAG TO ZOOM|SHIFT \+ DRAG TO PAN|CURSOR SYNCED TO GPS|Saved on this computer)$/i;return {method:'Visible direct-text owners intersecting viewport and overflow-clipping ancestors; visually hidden content, closed menus and canvas text excluded',count:entries.length,supportingCount:entries.filter(e=>e.supporting).length,supportingDefinition:'Visible direct-text owners in session metadata, lap-table headings, repeated plot reading keys, chart help, map hint, section index, track source, fastest-lap summary, local badge, or status bar',examples:entries.filter(e=>safe.test(e.text)).slice(0,30)};
   };
   const region=selectors=>{for(const selector of selectors){const e=document.querySelector(selector);if(e)return {selector,box:rect(e)};}return null;};
   const font=selector=>{const e=document.querySelector(selector);if(!e)return null;const s=getComputedStyle(e);return {size:s.fontSize,family:s.fontFamily,color:s.color,background:s.backgroundColor};};
   return {viewport,workspace:box,mainWorkspace:mainBox,plots:rows,textAudit:audit(),regions:{sidebar:region(['.sidebar']),inspector:region(['.inspector','.right-sidebar','.details-panel']),plots:region(['.plots','.plot-stack','.workspace-viewport'])},mainUtilization:mainBox?.height?rows.reduce((n,r)=>n+r.visibleHeight,0)/mainBox.height:null,utilization:box?.height?rows.reduce((n,r)=>n+r.visibleHeight,0)/box.height:null,documentOverflow:document.documentElement.scrollWidth>innerWidth,bodyOverflow:document.body.scrollWidth>innerWidth,fonts:{body:font('body'),label:font('.plot-label'),legend:font('.readout'),secondary:font('.chart-help'),axis:font('.axis-label')},fontsLoaded:[...document.fonts].map(f=>({family:f.family,status:f.status})),geistCheck:document.fonts.check('12px Geist'),canvasCount:document.querySelectorAll('.uplot canvas').length,canvasFonts:window.__emberCanvasFonts,canvasTextColors:window.__emberCanvasColors,reactCommitCounts:window.__emberCommits.length,reactComponentUpdates:window.__emberCommits.reduce((all,commit)=>{for(const [key,value] of Object.entries(commit))all[key]=(all[key]||0)+value;return all;},{})};
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
  results.captures.push({...c,path:`${['pass-b1-before','pass-b1-regions'].includes(phase)?'docs/ember/screenshots/after':output}/${name}`,metrics,errors});
  console.log(JSON.stringify({capture:name,utilization:metrics.utilization,heights:metrics.plots.map(x=>x.box.height),errors}));
  await context.close();
 }
 writeFileSync(`tools/ember/${phase}-measurements.json`,JSON.stringify(results,null,2)+'\n');
}finally{await browser?.close();await server?.close();}
