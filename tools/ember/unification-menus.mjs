// Supplemental contextual-state baseline, using the same real fixture and IPC simulator.
import {createServer} from 'vite';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import {launchBrowser,browserTestEntries,browserTestNoWatch} from '../../scripts/browser.mjs';
import {initFixture,fixed,settleCursor} from './fixture.mjs';
const phase=process.argv[2];if(!['before','after'].includes(phase))throw Error('Use before or after');
const receiptOnly=process.argv.includes('--receipt-only');
const dir='docs/ember/screenshots/unification/'+phase,reportFile=`.tools/ember-unification/${phase}-${receiptOnly?'receipt':'menus'}.json`;
if(phase==='before'&&existsSync(reportFile))throw Error('Baseline menu report exists');
mkdirSync(dir,{recursive:true});mkdirSync('.tools/ember-unification',{recursive:true});
const data=JSON.parse(readFileSync('.tools/advanced-ui/0361.json','utf8')),coach=JSON.parse(readFileSync('.tools/coach-ui/0361.json','utf8'));
const baselineCommit='30ce7e6';
const changed=phase==='before'&&receiptOnly?execFileSync('git',['diff','--name-only','--diff-filter=M',baselineCommit,'--','src'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean):[];
const original=Object.fromEntries(changed.map(path=>[path,execFileSync('git',['show',`${baselineCommit}:${path}`],{encoding:'utf8'})]));
const originalSource={name:'unification-receipt-baseline',enforce:'pre',transform(code,id){const path=id.replaceAll('\\','/').split('?')[0],key=Object.keys(original).find(p=>path.endsWith('/'+p));if(key)return {code:original[key],map:null};}};
const report={phase,simulatedIPC:true,source:'0361 native diagnostic cache',sourceRevision:phase==='before'&&receiptOnly?baselineCommit:'working tree',captures:[],errors:[]};const save=()=>writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
let server,browser;
try{
 server=await createServer({configLoader:'runner',plugins:[...(phase==='before'&&receiptOnly?[originalSource]:[]),browserTestNoWatch],optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}});await server.listen();browser=await launchBrowser();
 for(const [width,height,theme] of [[1440,900,'dark'],[1440,900,'light'],[600,500,'dark']])for(const menu of receiptOnly?['import-receipt']:['channel','chart-options','track-options','session-actions','organize','coach-settings']){
  const key=`0361-${menu}-${width}x${height}-${theme}`,context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(12000);
  try{
   await page.addInitScript(initFixture,{data,coach,fixed,theme});
   if(receiptOnly)await page.addInitScript(session=>{const invoke=window.__TAURI_INTERNALS__.invoke;window.__TAURI_INTERNALS__.invoke=async(cmd,args)=>cmd==='plugin:dialog|open'?['C:\\laps\\0361.xrk']:cmd==='import_session'?structuredClone(session):invoke(cmd,args);},data.session);
   await page.goto(server.resolvedUrls.local[0]);await settleCursor(page);
   if(menu==='coach-settings')await page.getByRole('button',{name:'AI Driving Coach',exact:true}).click();
   if(width===600&&['session-actions','organize'].includes(menu))await page.getByRole('button',{name:'Open session explorer'}).click();
   const target=menu==='channel'?page.locator('.channel-control>button'):menu==='chart-options'?page.getByLabel('Chart options',{exact:true}):menu==='track-options'?page.getByLabel('Track options and data notes',{exact:true}):menu==='session-actions'?page.getByRole('button',{name:'Session actions',exact:true}):menu==='organize'?page.getByRole('button',{name:'Sort & group sessions',exact:true}):menu==='import-receipt'?page.getByRole('button',{name:/Import telemetry/}):page.locator('.coach-advanced>summary');
   await target.scrollIntoViewIfNeeded();await target.click();if(receiptOnly)await page.getByRole('region',{name:'Telemetry import'}).getByText('Already in library').waitFor();await page.waitForTimeout(150);const screenshot=`${dir}/${key}.png`;if(phase==='before'&&existsSync(screenshot))throw Error('Baseline image exists');await page.screenshot({path:screenshot,animations:'disabled',caret:'hide'});
   const result=await new AxeBuilder({page}).analyze();report.captures.push({key,width,height,theme,menu,screenshot,violations:result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),incomplete:result.incomplete.map(v=>({id:v.id,nodes:v.nodes.length}))});console.log(key);save();
  }catch(e){report.errors.push({key,error:String(e)});console.error(`${key}: ${e}`);save();}finally{await context.close();}
 }
}finally{save();await browser?.close();await server?.close();}
const serious=report.captures.flatMap(c=>c.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({key:c.key,id:v.id,nodes:v.nodes.length})));
report.failures=serious;save();if(report.errors.length||serious.length)process.exitCode=1;
