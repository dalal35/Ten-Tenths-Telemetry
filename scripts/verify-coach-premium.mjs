// Production Coach rendered with native IPC simulated from a private XRK diagnostic.
import {launchBrowser,browserTestEntries,browserTestNoWatch} from './browser.mjs';
import {expect} from '@playwright/test';
import {createServer,preview} from 'vite';
import {readFileSync,mkdirSync} from 'node:fs';
import {dirname,basename,join} from 'node:path';
import assert from 'node:assert/strict';

const fixture=process.env.COACH_UI_DATA;
assert(fixture,'Set COACH_UI_DATA to a cached coach_check JSON generated from a local recording.');
const data=JSON.parse(readFileSync(fixture,'utf8'));
const prefix=process.env.COACH_SCREENSHOT_PREFIX||join('.tools','coach-ui',basename(fixture,'.json'));
mkdirSync(dirname(prefix),{recursive:true});
let server,browser;
try{
 if(process.env.COACH_PRODUCTION==='1')server=await preview({configLoader:'runner',preview:{host:'127.0.0.1',port:0,strictPort:false}});
 else {server=await createServer({configLoader:'runner',plugins:[browserTestNoWatch],optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});await server.listen();}
 browser=await launchBrowser();
 const page=await browser.newPage({viewport:{width:1600,height:1100},reducedMotion:'no-preference'});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 page.setDefaultTimeout(15000);
 await page.addInitScript(serialized=>{
  const d=JSON.parse(serialized);
  const entry={id:d.session.id,contentVersion:'version',source:d.session.source,name:d.session.name,track:d.session.track,driver:d.session.driver,recordedAt:d.session.recordedAt,lapCount:d.session.laps.length,channelCount:d.session.channels.length,status:'ready',workspace:{contentVersion:'version',primary:d.report.referenceLapId,view:'coach',channels:[]},lastUsed:0};
  const snapshot={entries:[entry],activeSessionId:d.session.id,warnings:[]};
  window.isTauri=true;window.__coachCalls=[];window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,invoke:async(cmd,args={})=>{
   window.__coachCalls.push({cmd,args});
   if(cmd.startsWith('plugin:event'))return 1;
   if(cmd==='library_snapshot')return snapshot;
   if(cmd==='load_library_session')return d.session;
   if(cmd==='save_workspace'){entry.workspace=args.workspace;return;}
   if(cmd==='driving_coach_model_terms')return {version:'test-model',terms:'Test terms',policy:'Test use policy'};
   if(cmd==='driving_coach_status')return {jobId:window.__coachJob,phase:'Generating local explanations'};
   if(cmd==='cancel_driving_coach')return;
   if(cmd==='analyze_driving_coach'){
    window.__coachJob=args.jobId;
    return {report:d.report,explanations:[],mode:'deterministic',modelVersion:'test-model',notice:'Showing computed telemetry evidence.',cached:false,elapsedMs:12,targetLapSeconds:args.targetLapSeconds??null,inferenceMetrics:null};
   }
   if(cmd==='analyze_session'){
    const result=structuredClone(d.analyses[`${args.primaryId}:${args.axis}`]);
    result.comparison=args.comparisonId?structuredClone(d.analyses[`${args.comparisonId}:${args.axis}`].primary):null;
    for(const view of [result.primary,result.comparison].filter(Boolean))view.series=view.series.filter(s=>args.channelIds.includes(s.channelId));
    return result;
   }
   throw Error(`Unexpected coach IPC ${cmd}`);
  }};
 },JSON.stringify(data));
 await page.goto(server.resolvedUrls.local[0]);
 await expect(page.locator('.coach-premium')).toBeVisible();
 await expect(page.locator('.coach-progress')).toContainText('Analysis complete');
 await expect(page.locator('.coach-heading .local-badge')).toContainText('AI inactive');
 const request=await page.evaluate(()=>window.__coachCalls.find(call=>call.cmd==='analyze_driving_coach')?.args);
 assert.equal(request.targetLapSeconds,null);
 assert.equal(request.modelTermsAccepted,false);
 const opportunities=page.locator('.coach-opportunity-list button');
 const expected=data.report.primaryOpportunityIds.map(id=>data.report.opportunities.find(item=>item.id===id));
 assert(expected.every(Boolean),'Backend primary IDs must resolve to opportunities');
 await expect(opportunities).toHaveCount(expected.length);
 for(let i=0;i<expected.length;i++)await expect(opportunities.nth(i)).toHaveAttribute('aria-label',new RegExp(expected[i].label));
 await expect(opportunities.first()).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.coach-focus')).toContainText(expected[0].label);
 await page.evaluate(()=>document.fonts.ready);
 // Let the interval band settle after the responsive chart measures its width.
 const initialProfile=data.report.simulatedProfiles?.find(p=>p.strategy==='full-lap'),initialSection=data.report.sectionAssessments.find(s=>s.sectionId===expected[0].sectionId);
 if(data.report.fullLap&&initialProfile&&initialSection)await expect.poll(()=>page.locator('.coach-profile-selection').evaluate((element,{start,end,from,to})=>{const svg=element.ownerSVGElement,plot=svg.getBoundingClientRect(),box=element.getBoundingClientRect(),width=svg.viewBox.baseVal.width,scale=plot.width/width,expectedLeft=plot.left+(46+(from-start)/(end-start)*(width-70))*scale;return Math.abs(box.left-expectedLeft);},{start:initialProfile.points[0].meters,end:initialProfile.points.at(-1).meters,from:initialSection.startMeters,to:initialSection.endMeters})).toBeLessThan(1);
 await page.screenshot({path:`${prefix}-desktop.png`});

 assert(expected.length>1,'Selection check requires two real ranked opportunities');
 await opportunities.nth(1).click();
 await expect(opportunities.nth(1)).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.coach-focus')).toContainText(expected[1].label);
 await page.locator('.coach-focus details > summary').click();
 await expect(page.locator('.coach-focus details table')).toBeVisible();
 await expect(page.locator('.coach-focus details')).toContainText(expected[1].observation);
 await page.screenshot({path:`${prefix}-detail.png`});
 await page.locator('.coach-focus .coach-evidence-link').first().click();
 await expect(page.getByRole('button',{name:'Telemetry',exact:true})).toHaveClass(/active/);
 const evidenceChannels=expected[1].evidence[0]?.channelIds??[];
 await page.waitForFunction(ids=>{const latest=window.__coachCalls.filter(call=>call.cmd==='analyze_session').at(-1);return latest&&ids.every(id=>latest.args.channelIds.includes(id));},evidenceChannels);
 await page.getByRole('button',{name:'AI Driving Coach',exact:true}).click();
 await expect(opportunities.nth(1)).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.coach-focus details')).toHaveAttribute('open','');

 const profile=data.report.simulatedProfiles?.find(item=>item.strategy==='full-lap');
 if(profile?.points.length>1){
  const slider=page.getByRole('slider',{name:'Inspect speed by track distance'});
  await expect(slider).toBeVisible();
  const nextIndex=Math.min(Number(await slider.inputValue())+1,profile.points.length-1);
  await slider.focus();await slider.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext',`${profile.points[nextIndex].meters.toFixed(0)} meters`);
  const readout=page.locator('.coach-profile-readout');
  await expect(readout).toContainText(`${(profile.points[nextIndex].baselineSpeedMps*2.2369362920544).toFixed(1)} mph`);
 }
 const target=data.report.sectionAssessments.find(section=>section.sectionId!==expected[1].sectionId&&section.endTime>section.startTime);
 assert(target,'A distinct measured section is required');
 const sections=page.locator('.coach-section-ribbon button');
 const sectionIndex=data.report.sectionAssessments.indexOf(target);
 await sections.nth(sectionIndex).click();
 await expect(sections.nth(sectionIndex)).toHaveAttribute('aria-pressed','true');
 if(!expected.some(finding=>finding.sectionId===target.sectionId))await expect(page.locator('.coach-independent-focus')).toContainText(`Reviewing ${target.label} evidence`);
 await expect(page.locator('.coach-section-overview')).toContainText(target.label);
 const mapSection=page.getByRole('button',{name:`Review ${target.label}`,exact:true});
 if(await mapSection.count()){await mapSection.focus();await mapSection.press('Enter');await expect(mapSection).toHaveAttribute('aria-pressed','true');}
 if(profile?.points.length>1&&target.startMeters<profile.points.at(-1).meters&&target.endMeters>profile.points[0].meters)await expect(page.locator('.coach-profile-selection')).toHaveCount(1);
 await page.getByRole('button',{name:'Inspect section telemetry ↗'}).click();
 await expect(page.getByRole('button',{name:'Telemetry',exact:true})).toHaveClass(/active/);
 await page.waitForFunction(id=>window.__coachCalls.some(call=>call.cmd==='analyze_session'&&call.args.primaryId===id),data.report.bestLapId);
 await page.waitForFunction(()=>document.querySelector('.alignment-note')?.textContent.includes('Focus:'));
 await page.getByRole('button',{name:'AI Driving Coach',exact:true}).click();
 await expect(sections.nth(sectionIndex)).toHaveAttribute('aria-pressed','true');
 // Returning to the Coach must preserve the open evidence for the selected opportunity.
 if(!expected.some(finding=>finding.sectionId===target.sectionId))await expect(page.locator('.coach-focus details')).toHaveAttribute('open','');

 await page.getByRole('button',{name:'Local model settings ↗',exact:true}).click();
 await expect(page.locator('.coach-advanced')).toHaveAttribute('open','');
 await expect(page.locator('.coach-terms')).toHaveAttribute('open','');
 await expect(page.getByRole('checkbox',{name:'I agree to the Gemma terms',exact:false})).not.toBeChecked();
 await page.locator('.coach-advanced > summary').click();

 await page.emulateMedia({reducedMotion:'reduce'});
 await page.setViewportSize({width:600,height:500});
 await page.locator('.workspace-viewport').evaluate(element=>{element.scrollTop=0;});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Compact layout has horizontal document overflow');
 await page.screenshot({path:`${prefix}-compact.png`});
 await page.locator('.coach-focus .coach-card-heading').scrollIntoViewIfNeeded();
 await page.screenshot({path:`${prefix}-compact-insight.png`});
 await page.locator('.coach-full-lap').scrollIntoViewIfNeeded();
 await page.screenshot({path:`${prefix}-compact-profile.png`});
 await page.setViewportSize({width:1600,height:1100});
 await page.getByRole('button',{name:'Switch to light theme'}).click();
 await page.locator('.workspace-viewport').evaluate(element=>{element.scrollTop=0;});
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Light layout has horizontal document overflow');
 await page.screenshot({path:`${prefix}-light.png`});
 await page.locator('.coach-corner-review').scrollIntoViewIfNeeded();
 await page.screenshot({path:`${prefix}-corners.png`});
 await page.setViewportSize({width:600,height:500});
 await page.locator('.workspace-viewport').evaluate(element=>{element.scrollTop=0;});
 await page.screenshot({path:`${prefix}-light-compact.png`});
 assert.deepEqual(errors,[],'No uncaught page errors');
 console.log(`Premium Coach verified for ${basename(fixture)}: backend ranking, evidence, section selection, sampled speed, telemetry navigation, retained state, reduced motion and desktop/compact/light screenshots.`);
}finally{await browser?.close();if(server?.close)await server.close();else if(server?.httpServer)await new Promise((resolve,reject)=>server.httpServer.close(error=>error?reject(error):resolve()));}
