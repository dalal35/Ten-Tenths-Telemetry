// Focused completion check: distinguish intentional scrolling from lost controls.
import {createServer} from 'vite';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {launchBrowser,browserTestEntries,browserTestNoWatch} from '../../scripts/browser.mjs';
import {initFixture,fixed,settleCursor} from './fixture.mjs';
const data=JSON.parse(readFileSync('.tools/advanced-ui/0361.json','utf8'));
const coach=JSON.parse(readFileSync('.tools/coach-ui/0361.json','utf8'));
const report={method:'Focused 0361 simulated-IPC Chromium checks in both themes and sizes; scroll each selected critical control into view and test its center for viewport containment/occlusion. This does not exhaustively prove all text or transient-state layouts.',cases:[],failures:[]};
const selectors={
 telemetry:'.chart-toolbar button,.chart-toolbar summary,.inspector .segment-card',
 advanced:'.advanced-nav button,.analysis-panel-heading button,.analysis-setup select,.surface-footer button',
 video:'.video-view-switch button,.video-source-controls input,.video-source-controls button,.video-anchor-controls select,.video-controls button',
 coach:'.coach-overview button,.coach-opportunity-list button,.coach-advanced>summary',
 library:'.session-details input,.session-details .merge-actions button',
 onboarding:'.launch-import-button,.launch-perspectives summary',
};
let server,browser;
try{
 server=await createServer({configLoader:'runner',plugins:[browserTestNoWatch],optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}});await server.listen();browser=await launchBrowser();
 for(const [width,height] of [[1440,900],[600,500]])for(const theme of ['dark','light'])for(const workspace of Object.keys(selectors).filter(w=>!process.argv.includes('--video-only')||w==='video')){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce'});
  try{
   const page=await context.newPage();page.setDefaultTimeout(8000);await page.addInitScript(initFixture,{data,coach,fixed,theme});
   if(workspace==='onboarding')await page.addInitScript(()=>{const invoke=window.__TAURI_INTERNALS__.invoke;window.__TAURI_INTERNALS__.invoke=async(cmd,args)=>cmd==='library_snapshot'?{entries:[],activeSessionId:null,warnings:[]}:invoke(cmd,args);});
   await page.goto(server.resolvedUrls.local[0]);if(workspace==='onboarding')await page.locator('.launch-workspace').waitFor();else await settleCursor(page);
   const name={advanced:'Advanced',video:'Video',coach:'AI Driving Coach'}[workspace];if(name)await page.getByRole('button',{name,exact:true}).click();
   if(workspace==='library'){if(width===600)await page.getByRole('button',{name:'Open session explorer'}).click();await page.getByRole('button',{name:'Session actions',exact:true}).click();await page.getByRole('menuitem',{name:'Edit details'}).click();}
   const controls=page.locator(selectors[workspace]),checks=[];
   for(let i=0;i<await controls.count();i++){
    const control=controls.nth(i);if(!await control.isVisible()||await control.isDisabled())continue;
    await control.scrollIntoViewIfNeeded();
    checks.push(await control.evaluate(e=>{const b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2,top=document.elementFromPoint(x,y);return {box:{x:b.x,y:b.y,width:b.width,height:b.height},tag:e.tagName,label:(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,70),withinViewport:b.left>=-.5&&b.right<=innerWidth+.5&&b.top>=-.5&&b.bottom<=innerHeight+.5,unobscured:!!top&&(top===e||e.contains(top))};}));
   }
   if(checks.some(c=>!c.withinViewport||!c.unobscured))await page.screenshot({path:`docs/ember/screenshots/unification/after/layout-${workspace}-${width}-${theme}.png`,animations:'disabled'});
   const result={workspace,width,height,theme,controls:checks};report.cases.push(result);for(const c of checks)if(!c.withinViewport||!c.unobscured)report.failures.push({...result,controls:undefined,control:c});
  }finally{await context.close();}
 }
}catch(e){report.failures.push({error:String(e)});}finally{await browser?.close();await server?.close();mkdirSync('.tools/ember-unification',{recursive:true});writeFileSync('.tools/ember-unification/layout.json',JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({cases:report.cases.length,controls:report.cases.reduce((n,c)=>n+c.controls.length,0),failures:report.failures}));if(report.failures.length)process.exitCode=1;
