// Actual application with IPC simulated from a real, read-only XRK diagnostic.
import {launchBrowser,browserTestEntries,browserTestNoWatch} from './browser.mjs';
import {expect} from '@playwright/test';
import {createServer} from 'vite';
import {readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const fixture=readdirSync('data').filter(n=>n.endsWith('.xrk')).sort().at(-1);
assert(fixture,'Local XRK fixture required; recordings are never modified.');
const data=process.env.COACH_UI_DATA?JSON.parse(readFileSync(process.env.COACH_UI_DATA,'utf8')):JSON.parse(execFileSync('cargo',['run','--offline','--manifest-path','src-tauri/Cargo.toml','--example','coach_check','--',`data/${fixture}`],{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','inherit']}));
let server,browser;
try{
 console.log('Coach UI: creating test server');
 server=await createServer({plugins:[browserTestNoWatch],optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});await server.listen();console.log('Coach UI: launching browser');browser=await launchBrowser();console.log('Coach UI: browser ready');
 console.log('Coach UI: opening page');const page=await browser.newPage({viewport:{width:1600,height:1100}});page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 console.log('Coach UI: transferring recording fixture');
 await page.addInitScript(serialized=>{
  const d=JSON.parse(serialized);
  const entry={id:d.session.id,contentVersion:'version',source:d.session.source,name:d.session.name,track:d.session.track,driver:d.session.driver,recordedAt:d.session.recordedAt,lapCount:d.session.laps.length,channelCount:d.session.channels.length,status:'ready',workspace:{contentVersion:'version',primary:d.report.referenceLapId,view:'coach',channels:[]},lastUsed:0};
  // Recording-switch fixtures reuse measured samples; only navigation identities differ.
  const switchSessions=['middle','latest'].map(name=>({...d.session,id:`${d.session.id}-${name}`,name:`UI-only switch ${name}`}));
  const recordings=[d.session,...switchSessions];
  const snapshot={entries:[entry,...switchSessions.map(s=>({...entry,id:s.id,name:s.name,workspace:{...entry.workspace}}))],activeSessionId:d.session.id,warnings:[]};
  // A saved mapping with missing optional footage must never block telemetry focus.
  entry.workspace.video={version:1,sessionId:d.session.id,contentVersion:'version',source:{type:'local',path:'/missing/coach.mp4',size:1,modifiedMs:1},segments:[{id:'mapped',videoStart:0,videoEnd:1000,anchorVideoTime:0,anchorTelemetryTime:0,correctionSeconds:0}],selectedSegmentId:'mapped',preferences:{panelHeight:400,playbackRate:1,pausedVideoTime:0}};
  window.isTauri=true;window.__coachCalls=[];window.__coachPending=[];window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,invoke:async(cmd,args={})=>{
   window.__coachCalls.push({cmd,args});
   if(cmd.startsWith('plugin:event'))return 1;
   if(cmd==='library_snapshot')return snapshot;
   if(cmd==='load_library_session')return recordings.find(s=>s.id===args.sessionId);
   if(cmd==='save_workspace'){snapshot.entries.find(e=>e.id===args.sessionId).workspace=args.workspace;return;}
   if(cmd==='driving_coach_model_terms')return {version:'test-model',terms:'Test terms',policy:'Test use policy'};
   if(cmd==='driving_coach_status')return {jobId:window.__coachJob,phase:'Generating local explanations'};
   if(cmd==='cancel_driving_coach')return;
   if(cmd==='authorize_local_video')throw Error('Local video is missing');
   if(cmd==='analyze_driving_coach'){
    if(window.__nativeCoachJob)throw Error('Another coach request is running');
    window.__nativeCoachJob=args.jobId;
    window.__coachJob=args.jobId;
    try{
     if(window.__holdCoach)await new Promise(resolve=>window.__coachPending.push(resolve));
     const report=window.__coachReport??d.report;
     return {report:{...report,sessionId:args.sessionId,notes:[...report.notes,`UI-only result owner: ${args.sessionId}`]},explanations:[],mode:'deterministic',modelVersion:'test-model',notice:'Showing computed telemetry evidence.',cached:false,elapsedMs:12,targetLapSeconds:args.targetLapSeconds??null,inferenceMetrics:null,...window.__coachPresentationResult};
    }finally{window.__nativeCoachJob=null;}
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
 console.log('Coach UI: opening real-XRK session');
 await page.goto(`${server.resolvedUrls.local[0]}tests/advanced.html`);
 try{await page.getByRole('heading',{name:'How to Improve Your Fastest Lap'}).waitFor();}catch(error){console.error('Coach startup diagnostics:',errors,await page.locator('body').innerText());throw error;}
 await expect(page.locator('.coach-overview')).toContainText('FASTEST VALID LAP');
 await expect(page.locator('.local-badge').last()).toContainText('AI inactive');
 assert(data.report.opportunities.every(o=>o.lapId===data.report.bestLapId),'Every finding must inspect the fastest lap');
 await page.waitForFunction(()=>window.__coachCalls.some(c=>c.cmd==='analyze_driving_coach'&&c.args.referenceId==null));
 await expect(page.getByLabel('Coach reference lap')).toHaveCount(0);
 const coachCalls=()=>page.evaluate(()=>window.__coachCalls.filter(c=>c.cmd==='analyze_driving_coach').length);
 assert.equal(await coachCalls(),1,'Opening Coach starts exactly one analysis');
 await expect(page.getByLabel('Target lap time (optional)',{exact:true})).toHaveCount(0);
 await expect(page.locator('.coach-overview')).toContainText('RECORDED THEORETICAL BEST');
 await expect(page.locator('.coach-overview')).toContainText('MODELED LAP-TIME RANGE');
 const initialRequest=await page.evaluate(()=>window.__coachCalls.find(c=>c.cmd==='analyze_driving_coach').args);
 assert.equal(initialRequest.targetLapSeconds,null,'Telemetry determines potential without a manual target');
 await expect(page.locator('.coach-advanced')).not.toHaveAttribute('open');
 await page.screenshot({path:'test-results/coach-real-xrk-dark-1600.png',fullPage:true});
 if(data.report.improvementPotential){
  const g=data.report.improvementPotential;
  const potential=page.locator('.coach-stat').nth(2).locator('small').filter({hasText:'ESTIMATED IMPROVEMENT'});
  if(g.upperSeconds<0.001)await expect(potential).toContainText('<0.001 s');
  else await expect(potential).toContainText(`${g.upperSeconds.toFixed(3)} s`);
  if(g.lowerSeconds>0&&g.lowerSeconds<0.001)await expect(potential).toContainText('<0.001');
  assert(data.report.enhancedTheoreticalBest,'Quantified potential needs a lap range');
  assert(Math.abs(data.report.bestLapSeconds-g.upperSeconds-data.report.enhancedTheoreticalBest.lowerSeconds)<1e-6,'Enhanced best uses selected gains exactly once');
 }
 if(data.report.fullLap?.modeledLapSeconds){
  await expect(page.getByRole('region',{name:'Full-lap physics model'})).toContainText('simulation coverage');
  await expect(page.getByRole('img',{name:/Actual fastest lap, conservative and nominal optimized speed/})).toBeVisible();
 }
 console.log('Coach automatic potential and minimal overview verified');
 if(!data.report.opportunities.length){
  await expect(page.getByText('No supported opportunity or meaningful signal was identified in the available channels.',{exact:false})).toBeVisible();
  const section=data.report.sectionAssessments.find(s=>s.endTime>s.startTime&&s.evidence.length);
  assert(section,'Real fastest-lap section required for the separate navigation fixture');
  const time=(section.startTime+section.endTime)/2;
  // UI-only controlled findings exercise interaction when raw telemetry supports no claim.
  // These are never presented as real detector output or measured time opportunities.
  data.report={...data.report,primaryOpportunityIds:undefined,opportunities:Array.from({length:6},(_,i)=>({id:`ui-fixture-${i}`,lapId:data.report.bestLapId,referenceLapId:data.report.bestLapId,sectionId:section.sectionId,label:`Controlled UI navigation fixture ${i+1}`,kind:section.kind,startTime:time,endTime:time,startMeters:null,endMeters:null,observedLossSeconds:null,estimatedGainSeconds:null,fasterExampleCount:0,confidence:'low',status:'suspected',priorityScore:0,evidence:section.evidence,observation:'UI-only fixture using a recorded fastest-lap interval; no real inefficiency or time gain is asserted.',action:`UI-only experiment ${i+1}: inspect the recorded speed and RPM traces in the highlighted interval.`,uncertainty:'Controlled UI test data, not a detector result.'}))};
  await page.evaluate(report=>{window.__coachReport=report;},data.report);
  await page.getByRole('button',{name:'Analyze',exact:true}).click();
  await expect(page.locator('.coach-card')).toHaveCount(1);
  console.log('Coach UI: raw XRK empty report verified; using explicitly controlled UI findings for navigation checks');
 }
 const count=await page.locator('.coach-card').count();
 assert(count>0&&count<=3,'At most three recommendations, without padding');
 if(data.report.primaryOpportunityIds?.length)assert.equal(count,data.report.primaryOpportunityIds.length,'Cards preserve the backend non-overlapping selection');
 await expect(page.locator('.coach-time-potential')).toHaveCount(count);
 await expect(page.locator('.coach-estimate-note')).toContainText('each compatible section once');
 for(const card of await page.locator('.coach-card').all()){
  const timeRow=card.locator('.coach-time-potential');
  await expect(timeRow).toBeVisible();
  assert(/Demonstrated opportunity|Engineering hypothesis|Scenario estimate:|Gain not yet quantifiable/.test(await timeRow.innerText()),'Every suggestion identifies its estimate type or explains missing quantification');
  if((await timeRow.innerText()).includes('Scenario estimate:')){
   await expect(timeRow).toContainText('Hypothetical');
   assert(!/Scenario estimate: 0\.000(?:–0\.000)? s/.test(await timeRow.innerText()),'Small positive scenarios must remain visible');
   await card.locator('details > summary').click();
   await expect(card.locator('details')).toContainText('Scenario method:');
   await expect(card.locator('details')).toContainText('not a confidence interval');
   await card.locator('details > summary').click();
  }
 }
 console.log('Coach time estimates: visible per suggestion, conditional assumptions, expanded method and non-overlapping aggregation verified');
 await expect(page.locator('.coach-card details[open]')).toHaveCount(0);
 await expect(page.locator('.coach-card').first()).toContainText('Deterministic telemetry');
 await page.locator('.coach-card details').first().locator('summary').click();
 await expect(page.locator('.coach-card table').first()).toBeVisible();
 await expect(page.locator('.coach-action').first()).not.toBeEmpty();
 const primaryId=data.report.primaryOpportunityIds?.[0];
 const firstFinding=data.report.opportunities.find(o=>o.id===primaryId)??data.report.opportunities[0];
 await expect(page.locator('.coach-card details').first()).toContainText(firstFinding.action);
 await page.locator('.coach-card details').first().locator('summary').click();
 console.log('Coach UI: compact cards and collapsed evidence verified');
 const finding=firstFinding;
 await page.getByRole('button',{name:'Inspect telemetry ↗',exact:true}).first().click();
 await expect(page.getByRole('button',{name:'Video',exact:true})).toHaveClass(/active/);
 await page.waitForFunction(id=>window.__coachCalls.some(c=>c.cmd==='analyze_session'&&c.args.primaryId===id),finding.lapId);
 await page.waitForFunction(()=>document.querySelector('.alignment-note')?.textContent.includes('Focus:'));
 const channels=await page.evaluate(()=>window.__coachCalls.filter(c=>c.cmd==='analyze_session').at(-1).args.channelIds);
 const speed=data.session.channels.find(c=>c.id==='gps-speed')??data.session.channels.find(c=>/speed/i.test(c.name)&&!/rpm|engine|revs/i.test(c.name));
 const rpm=data.session.channels.find(c=>/rpm|engine.*(speed|revs)/i.test(c.name));
 for(const channel of [speed,rpm].filter(Boolean))assert(channels.includes(channel.id),`Inspection restores ${channel.name}`);
 await page.getByRole('button',{name:'AI Driving Coach',exact:true}).click();
 const instantaneous=data.report.opportunities.findIndex(o=>o.startTime===o.endTime);
 if(instantaneous>=0&&instantaneous<3){
  const event=data.report.opportunities[instantaneous];
  await page.getByRole('button',{name:'Inspect telemetry ↗',exact:true}).nth(instantaneous).click();
  await page.waitForFunction(id=>window.__coachCalls.some(c=>c.cmd==='save_workspace'&&c.args.workspace.primary===id&&c.args.workspace.zoom?.max>c.args.workspace.zoom?.min),event.lapId);
  await page.getByRole('button',{name:'AI Driving Coach',exact:true}).click();
 }
 assert((await page.locator('.coach-card').count())<=3);
 console.log('Coach UI: inspection navigation verified');
 // While inference is held, ordinary telemetry remains usable and Cancel owns only its job.
 await page.evaluate(()=>{window.__holdCoach=true;});
 await page.getByRole('button',{name:'Analyze',exact:true}).click();
 await page.getByRole('button',{name:'Cancel analysis',exact:true}).waitFor();
 await page.getByRole('button',{name:'Telemetry',exact:true}).click();
 await expect(page.locator('.chart-toolbar')).toBeVisible();
 await page.getByRole('button',{name:'AI Driving Coach',exact:true}).click();
 await page.getByRole('button',{name:'Cancel analysis',exact:true}).click();
 await page.waitForFunction(()=>window.__coachCalls.some(c=>c.cmd==='cancel_driving_coach'));
 await expect(page.locator('.coach-progress')).toContainText('Cancelled');
 // Retry before the native worker stops: keep one replacement waiting, never overlap IPC.
 const requestsBeforeRetry=await page.evaluate(()=>window.__coachCalls.filter(c=>c.cmd==='analyze_driving_coach').length);
 await page.getByRole('button',{name:'Analyze',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.__coachCalls.filter(c=>c.cmd==='analyze_driving_coach').length),requestsBeforeRetry);
 await page.evaluate(()=>{window.__holdCoach=false;window.__coachPending.splice(0).forEach(resolve=>resolve());});
 await expect(page.locator('.coach-progress')).toContainText('Analysis complete');
 assert.equal(await page.evaluate(()=>window.__coachCalls.filter(c=>c.cmd==='analyze_driving_coach').length),requestsBeforeRetry+1);
 await expect(page.locator('.error-banner')).toHaveCount(0);
 // Refresh preserves the automatic fastest-lap target; no slower-lap target can be selected.
 assert((await page.locator('.coach-card').count())<=3);
 await page.locator('.coach-advanced > summary').click();
 await page.getByText(`Every corner and straight · ${data.report.sectionAssessments.length} sections reviewed`,{exact:true}).click();
 for(const section of data.report.sectionAssessments)await expect(page.getByRole('heading',{name:`${section.label} · ${section.kind}`,exact:true})).toBeVisible();
 await page.locator('.coach-advanced > summary').click();
 console.log('Coach UI: cancellation and collapsed section coverage verified');
 // UI contract fixtures only: these override IPC presentation fields, never run native inference.
 // Real model execution and validation are verified separately by the native diagnostic.
 await page.locator('.coach-advanced > summary').click();
 await page.locator('.coach-terms > summary').click();
 await page.getByRole('checkbox',{name:'I agree to the Gemma terms',exact:false}).check();
 const simulatedHypothesis='Controlled UI-only model interpretation of the selected evidence.';
 const simulatedAction='Try the controlled UI-only coaching experiment.';
 const deterministicTime=await page.locator('.coach-time-potential').first().textContent();
 const deterministicConfidence=await page.locator('.coach-confidence').first().textContent();
 await page.evaluate(({id,hypothesis,action})=>{window.__coachPresentationResult={mode:'localModel',cached:true,notice:'Simulated model response for UI provenance checks; no native inference executed.',inferenceMetrics:null,explanations:[{opportunityId:id,hypothesis,action,interpretationId:null,reasoningSource:'modelGeneratedProse'}]};},{id:finding.id,hypothesis:simulatedHypothesis,action:simulatedAction});
 await page.getByRole('button',{name:'Analyze',exact:true}).click();
 await expect(page.locator('.coach-heading .local-badge')).toHaveText('Cached · Local model interpretation');
 await expect(page.locator('.coach-card-footer').getByText('Gemma coaching',{exact:true})).toHaveCount(1);
 await expect(page.locator('.coach-why').first()).toContainText(simulatedHypothesis);
 await expect(page.locator('.coach-why').first()).toContainText(finding.observation.split(/(?<=[.!?])\s+(?=[A-Z])/)[0]);
 await expect(page.locator('.coach-action').first()).toContainText(simulatedAction);
 await expect(page.locator('.coach-time-potential').first()).toHaveText(deterministicTime);
 await expect(page.locator('.coach-confidence').first()).toHaveText(deterministicConfidence);
 await page.locator('.coach-card details').first().locator('summary').click();
 await expect(page.locator('.coach-card details').first()).toContainText(`Local model experiment: ${simulatedAction}`);
 if(finding.gainRange||finding.modeledGain)await expect(page.locator('.coach-card details').first()).toContainText('The displayed range comes from deterministic physics, not Gemma.');
 await page.locator('.coach-card details').first().locator('summary').click();
 if(count>1)await expect(page.locator('.coach-card-footer').getByText('Deterministic telemetry',{exact:true})).toHaveCount((await page.locator('.coach-card').count())-1);
 await page.evaluate(()=>{window.__coachPresentationResult.cached=false;});
 await page.getByRole('button',{name:'Analyze',exact:true}).click();
 await expect(page.locator('.coach-heading .local-badge')).toHaveText('Local model interpretation');
 await expect(page.locator('.coach-why').first()).toContainText(simulatedHypothesis);
 const modelRequest=await page.evaluate(()=>window.__coachCalls.filter(c=>c.cmd==='analyze_driving_coach').at(-1).args);
 assert.equal(modelRequest.targetLapSeconds,null,'Analyze remains automatic after terms acceptance');
 assert.equal(modelRequest.regenerate,true,'Explicit Analyze refreshes cached model or fallback output');
 assert.equal(modelRequest.modelTermsAccepted,true,'Model terms acceptance reaches the backend');
 await page.evaluate(()=>{window.__coachPresentationResult={mode:'deterministic',cached:true,explanations:[],notice:'Simulated cached fallback for UI provenance verification.',inferenceMetrics:null};});
 await page.getByRole('button',{name:'Analyze',exact:true}).click();
 await expect(page.locator('.coach-heading .local-badge')).toHaveText('Cached · Computed fallback');
 await expect(page.locator('.coach-card-footer').getByText('Gemma coaching',{exact:true})).toHaveCount(0);
 await page.getByRole('checkbox',{name:'I agree to the Gemma terms',exact:false}).uncheck();
 await page.evaluate(()=>{window.__coachPresentationResult=undefined;});
 await page.getByRole('button',{name:'Analyze',exact:true}).click();
 await expect(page.locator('.coach-heading .local-badge')).toHaveText('AI inactive · terms not accepted');
 await page.locator('.coach-advanced > summary').click();
 console.log('Coach UI simulated response coverage: cached/local/fallback provenance, mixed per-card sources, automatic target and explicit retry verified; no native inference claimed');

 await page.getByRole('heading',{name:'How to Improve Your Fastest Lap'}).scrollIntoViewIfNeeded();
 for(const theme of ['dark','light']){
  if(theme==='light')await page.getByRole('button',{name:'Switch to light theme'}).click();
  for(const width of [1600,760,600]){await page.setViewportSize({width,height:1000});await page.screenshot({path:`test-results/coach-${theme}-${width}.png`,fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`horizontal overflow at ${width}`);}
 }
 // Switching recordings remounts Coach. Only the latest queued owner may run.
 await page.setViewportSize({width:1600,height:1100});
 const requestsBeforeSwitch=await coachCalls();
 await page.evaluate(()=>{window.__holdCoach=true;});
 await page.getByRole('button',{name:'Analyze',exact:true}).click();
 await page.waitForFunction(n=>window.__coachCalls.filter(c=>c.cmd==='analyze_driving_coach').length===n,requestsBeforeSwitch+1);
 const oldJob=await page.evaluate(()=>window.__nativeCoachJob);
 for(const name of ['middle','latest']){
  await page.getByRole('button',{name:new RegExp(`UI-only switch ${name}`)}).click();
  await expect(page.locator('.session-button[aria-current=true]')).toContainText(`UI-only switch ${name}`);
  await expect(page.locator('.coach-progress')).toContainText('Validating recording');
 }
 assert.equal(await coachCalls(),requestsBeforeSwitch+1,'Remounted coaches wait for the old native worker');
 assert(await page.evaluate(id=>window.__coachCalls.some(c=>c.cmd==='cancel_driving_coach'&&c.args.jobId===id),oldJob),'Unmount cancels the old recording request');
 await expect(page.locator('.coach-card')).toHaveCount(0);
 await page.evaluate(()=>{window.__holdCoach=false;window.__coachPending.splice(0).forEach(resolve=>resolve());});
 await expect(page.locator('.coach-progress')).toContainText('Analysis complete');
 const switchedRequests=await page.evaluate(n=>window.__coachCalls.filter(c=>c.cmd==='analyze_driving_coach').slice(n).map(c=>c.args.sessionId),requestsBeforeSwitch);
 assert.deepEqual(switchedRequests,[data.session.id,`${data.session.id}-latest`],'Only the latest remounted coach reaches native analysis');
 await expect(page.locator('.coach-advanced')).toContainText(`UI-only result owner: ${data.session.id}-latest`);
 await expect(page.locator('.error-banner')).toHaveCount(0);
 console.log('Coach recording switch: cancelled worker settles, middle recording never runs, latest recording owns the result');
 assert.deepEqual(errors,[]);console.log('Coach workflow passed: real-XRK evidence, inspection/corner focus, bounded ranked cards, async responsiveness, cancellation, stale completion, automatic fastest-lap selection, three evidence tiers, automatic non-overlapping potential, complete section coverage, dark/light responsive layouts.');
}catch(error){console.error('Coach verification failed:',error);throw error;}finally{await browser?.close();await server?.close();}
