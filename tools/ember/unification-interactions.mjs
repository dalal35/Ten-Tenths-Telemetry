// Supplemental checks: real cached 0361 analysis, simulated IPC, Chromium media.
import {createServer} from 'vite';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {launchBrowser,browserTestEntries,browserTestNoWatch} from '../../scripts/browser.mjs';
import {fixed,initFixture,settleCursor} from './fixture.mjs';

const data=JSON.parse(readFileSync(process.env.EMBER_ADVANCED_FIXTURE||'.tools/advanced-ui/0361.json','utf8'));
const coach=JSON.parse(readFileSync(process.env.EMBER_COACH_FIXTURE||'.tools/coach-ui/0361.json','utf8'));
if(data.analysis.primary.lapId!==fixed.primary||data.analysis.comparison.lapId!==fixed.comparison||!data.analysis.delta||!data.session.source.includes('0361'))throw Error('Expected native 0361 diagnostic fixture');
const out='.tools/ember-unification/interactions.json';
mkdirSync('.tools/ember-unification',{recursive:true});
mkdirSync('docs/ember/screenshots/unification/after',{recursive:true});
const report={method:'Playwright Chromium at DPR 1, reduced motion, cached native 0361 diagnostic analysis with simulated IPC. Local MP4 is a checked-in synthetic fixture decoded by Chromium; native Tauri authorization, WebView2 and codecs are not tested.',contrastMethod:'Visible direct text nodes and selected SVG icon strokes: foreground and background colors composited through ancestor background-color values with WCAG sRGB luminance. Gradients, images, backdrop blur, text shadows, pseudo-elements, canvas pixels, opacity groups and hidden/offscreen content are not sampled; gradient-affected pairs are estimates, not proof of WCAG compliance. Disabled controls are excluded.',cases:[],lifetime:[],failures:[]};
const errors=[];
let server,browser,context;
try {
 server=await createServer({configLoader:'runner',plugins:[browserTestNoWatch],optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}});
 await server.listen();browser=await launchBrowser();
 context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,reducedMotion:'reduce'});
 const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
 const media=readFileSync(resolve('src-tauri/tests/fixtures/windows/long.mp4'));
 await page.route('https://asset.localhost/**',route=>{
  const range=route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
  const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),media.length-1):media.length-1;
  const headers={'access-control-allow-origin':'*','accept-ranges':'bytes','content-length':String(end-start+1)};
  if(range)headers['content-range']=`bytes ${start}-${end}/${media.length}`;
  return route.fulfill({status:range?206:200,body:media.subarray(start,end+1),contentType:'video/mp4',headers});
 });
 await page.addInitScript(initFixture,{data,coach,fixed,theme:'dark'});
 await page.addInitScript(()=>{
  const api=window.__TAURI_INTERNALS__,invoke=api.invoke;
  api.convertFileSrc=()=> 'https://asset.localhost/fixture.mp4';
  api.invoke=async(cmd,args={})=>{
   if(cmd==='library_snapshot'){
    const snapshot=await invoke(cmd,args),entry=snapshot.entries[0];
    entry.workspace.video={version:1,sessionId:entry.id,contentVersion:entry.contentVersion,source:{type:'local',path:'/fixture/long.mp4',size:20112,modifiedMs:1},segments:[],selectedSegmentId:null,preferences:{panelHeight:400,playbackRate:1,pausedVideoTime:7}};
    return snapshot;
   }
   if(cmd==='authorize_local_video')return {path:args.path,size:20112,modifiedMs:1,status:'ready'};
   return invoke(cmd,args);
  };
 });
 await page.goto(server.resolvedUrls.local[0]);await settleCursor(page);
 await page.getByRole('button',{name:'Video',exact:true}).click();
 await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.readyState>=1&&v.videoWidth>0&&Number.isFinite(v.duration)&&Math.abs(v.currentTime-7)<.05&&!v.seeking;});
 const initial=await page.evaluate(()=>{
  const video=document.querySelector('video');
  window.__unificationVideo=video;window.__unificationCanvases=[...document.querySelectorAll('.plot-row .uplot canvas')];
  return {duration:video.duration,width:video.videoWidth,height:video.videoHeight,time:video.currentTime,paused:video.paused,canvasCount:window.__unificationCanvases.length};
 });
 if(!initial.canvasCount)report.failures.push('No original telemetry canvases found');
 const names={telemetry:'Telemetry',advanced:'Advanced',video:'Video',coach:'AI Driving Coach'};
 const tokens=['--font-sans','--font-mono','--ink','--muted','--subtle','--surface-0','--surface-1','--surface-2','--surface-3','--surface-4','--text-primary','--text-secondary','--text-tertiary','--border','--control','--grid','--accent','--trace-primary','--trace-comparison','--radius-control','--radius-surface','--radius-floating','--glass-panel-fill','--glass-raised-fill','--glass-interactive-fill','--glass-floating-fill'];
 let currentTheme='dark';
 for(const theme of ['dark','light']){
  if(theme!==currentTheme){await page.getByRole('button',{name:'Switch to light theme'}).click();currentTheme=theme;}
  for(const workspace of ['telemetry','advanced','video','coach']){
   await page.getByRole('button',{name:names[workspace],exact:true}).click();
   await page.waitForFunction(w=>document.querySelector('.workspace-viewport')?.dataset.workspace===w,workspace);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   if(workspace==='video')await page.screenshot({path:`docs/ember/screenshots/unification/after/video-attached-synthetic-1440x900-${theme}.png`,animations:'disabled',caret:'hide'});
   const result=await page.evaluate(({tokens})=>{
    const color=s=>{const m=s.match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);return m?[+m[1],+m[2],+m[3],m[4]===undefined?1:+m[4]]:null;};
    const blend=(a,b)=>{const alpha=a[3]+b[3]*(1-a[3]);return alpha?[(a[0]*a[3]+b[0]*b[3]*(1-a[3]))/alpha,(a[1]*a[3]+b[1]*b[3]*(1-a[3]))/alpha,(a[2]*a[3]+b[2]*b[3]*(1-a[3]))/alpha,alpha]:[0,0,0,0];};
    const luminance=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
    const sample=e=>{let bg=[0,0,0,0],gradient=false,opacity=false;for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n);bg=blend(bg,color(s.backgroundColor)||[0,0,0,0]);gradient||=s.backgroundImage!=='none'||s.backdropFilter!=='none';opacity||=+s.opacity<1;}return {bg:blend(bg,[0,0,0,1]),gradient,opacity};};
    const visible=e=>{const r=e.getBoundingClientRect();if(r.right<=0||r.left>=innerWidth||r.bottom<=0||r.top>=innerHeight||!r.width||!r.height)return false;for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n);if(s.visibility!=='visible'||s.display==='none'||+s.opacity===0||s.clipPath==='inset(50%)'||/rect\(0px, 0px, 0px, 0px\)/.test(s.clip))return false;const b=n.getBoundingClientRect();if(/hidden|clip|auto|scroll/.test(s.overflowX)&&(r.right<=b.left||r.left>=b.right))return false;if(/hidden|clip|auto|scroll/.test(s.overflowY)&&(r.bottom<=b.top||r.top>=b.bottom))return false;}return true;};
    const identify=e=>({element:e.tagName.toLowerCase(),class:typeof e.className==='string'?e.className:'',text:(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,90)});
    const texts=[...document.querySelectorAll('body *')].flatMap(e=>{const direct=[...e.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()).map(n=>n.textContent.trim()).join(' ');if(!direct||!visible(e)||e.closest(':disabled,[aria-disabled=true]')||['SCRIPT','STYLE'].includes(e.tagName))return [];const s=getComputedStyle(e),fg=color(s.color);if(!fg)return [];const {bg,gradient,opacity}=sample(e),px=parseFloat(s.fontSize),large=px>=24||(px>=18.66&&+s.fontWeight>=700);return [{...identify(e),text:direct.slice(0,90),foreground:s.color,background:bg,ratio:ratio(blend(fg,bg),bg),minimum:large?3:4.5,size:s.fontSize,gradient,opacity}];});
    const icons=[...document.querySelectorAll('.titlebar svg path,.titlebar svg circle,.titlebar svg rect')].flatMap(e=>{if(!visible(e)||e.closest(':disabled,[aria-disabled=true]'))return [];const s=getComputedStyle(e),raw=s.stroke!=='none'?s.stroke:s.fill,fg=color(raw);if(!fg||!fg[3])return [];const {bg,gradient,opacity}=sample(e);return [{...identify(e),foreground:raw,background:bg,ratio:ratio(blend(fg,bg),bg),minimum:3,gradient,opacity}];});
    const root=getComputedStyle(document.querySelector('.app.premium'));
    return {tokens:Object.fromEntries(tokens.map(t=>[t,root.getPropertyValue(t).trim()])),text:{count:texts.length,minimum:texts.length?Math.min(...texts.map(x=>x.ratio)):null,pairs:texts.sort((a,b)=>a.ratio-b.ratio),approximateCount:texts.filter(x=>x.gradient||x.opacity).length},icons:{count:icons.length,minimum:icons.length?Math.min(...icons.map(x=>x.ratio)):null,pairs:icons.sort((a,b)=>a.ratio-b.ratio),approximateCount:icons.filter(x=>x.gradient||x.opacity).length},lifetime:{sameVideo:window.__unificationVideo===document.querySelector('video'),sameCanvases:window.__unificationCanvases.every(e=>e.isConnected),currentTime:window.__unificationVideo.currentTime,paused:window.__unificationVideo.paused,src:window.__unificationVideo.currentSrc}};
   },{tokens});
   const sample={theme,workspace,...result};report.cases.push(sample);report.lifetime.push({theme,workspace,...result.lifetime});
   if(!result.lifetime.sameVideo||!result.lifetime.sameCanvases||!result.lifetime.paused||Math.abs(result.lifetime.currentTime-initial.time)>.06)report.failures.push(`${theme}/${workspace}: media or chart identity/state changed`);
   if(!result.text.count||!result.icons.count)report.failures.push(`${theme}/${workspace}: contrast sample missing`);
   for(const x of [...result.text.pairs,...result.icons.pairs])if(x.ratio<x.minimum&&!x.gradient&&!x.opacity)report.failures.push(`${theme}/${workspace}: contrast ${x.ratio.toFixed(2)} < ${x.minimum} for ${x.element}.${x.class}: ${x.text}`);
  }
  const group=report.cases.filter(c=>c.theme===theme),reference=group[0].tokens;
  for(const c of group.slice(1))for(const token of tokens)if(c.tokens[token]!==reference[token])report.failures.push(`${theme}/${c.workspace}: ${token} differs from telemetry`);
 }
 await page.getByRole('button',{name:'Video',exact:true}).click();
 await page.setViewportSize({width:600,height:500});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.screenshot({path:'docs/ember/screenshots/unification/after/video-attached-synthetic-600x500-light.png',animations:'disabled',caret:'hide'});
 await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const resize=await page.evaluate(()=>({sameVideo:window.__unificationVideo===document.querySelector('video'),sameCanvases:window.__unificationCanvases.every(e=>e.isConnected),time:window.__unificationVideo.currentTime,paused:window.__unificationVideo.paused}));
 report.initial=initial;report.resizeRoundtrip=resize;
 if(!resize.sameVideo||!resize.sameCanvases||!resize.paused||Math.abs(resize.time-initial.time)>.06)report.failures.push('Resize roundtrip changed media or telemetry chart identity/state');
 await page.getByRole('button',{name:'Video',exact:true}).click();
 await page.evaluate(async()=>{const v=window.__unificationVideo;v.muted=true;await v.play();});
 await page.waitForTimeout(300);
 const playingStart=await page.evaluate(()=>({time:window.__unificationVideo.currentTime,paused:window.__unificationVideo.paused}));
 if(playingStart.paused||playingStart.time<=initial.time+.1)report.failures.push('Playing fixture video did not advance before workspace switch');
 report.playingRoundtrip=[];
 for(const workspace of ['advanced','coach','telemetry','video']){
  await page.getByRole('button',{name:names[workspace],exact:true}).click();
  await page.waitForFunction(w=>document.querySelector('.workspace-viewport')?.dataset.workspace===w,workspace);
  const state=await page.evaluate(()=>({sameVideo:window.__unificationVideo===document.querySelector('video'),sameCanvases:window.__unificationCanvases.every(e=>e.isConnected),paused:window.__unificationVideo.paused,time:window.__unificationVideo.currentTime}));
  report.playingRoundtrip.push({workspace,...state});
  // Existing VideoWorkspace behavior pauses playback on leaving Video.
  if(!state.sameVideo||!state.sameCanvases||!state.paused||Math.abs(state.time-playingStart.time)>.5)report.failures.push(`${workspace}: media or chart identity/pause position changed`);
 }
 const finalTime=await page.evaluate(()=>{const v=window.__unificationVideo;v.pause();return v.currentTime;});
 report.playingStart=playingStart;report.playingFinalTime=finalTime;
 if(errors.length)report.failures.push(...errors.map(e=>`Page error: ${e}`));
}catch(error){report.failures.push(`Harness error: ${error.stack||error}`);}finally{
 await context?.close();await browser?.close();await server?.close();
 writeFileSync(out,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({output:out,cases:report.cases.length,initial:report.initial,resizeRoundtrip:report.resizeRoundtrip,failures:report.failures},null,2));
}
if(report.failures.length)process.exitCode=1;
