import {useMemo,useState} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import type {Analysis,Channel} from '../types';
import {trackGeometry,trackPath} from '../telemetry';
import {motionTokens} from '../motion';
import type {CoachReport,CoachResult,Opportunity} from './types';
import {cardCoaching,rangeSeconds,supportedGain,supportedModel,supportedRange} from './presentation';
import EvidenceTable from './EvidenceTable';
import TimePotential from './TimePotential';
import FullLapProfile from './FullLapProfile';

import type {CoachInspection} from './navigation';
interface Props {report:CoachReport;findings:Opportunity[];explanations:CoachResult['explanations'];channels:Pick<Channel,'id'|'name'|'unit'>[];analysis?:Analysis|null;onInspect:(interval:CoachInspection)=>void;lapLabel:(id:string)=>string}

export default function CoachDebrief({report,findings,explanations,channels,analysis,onInspect,lapLabel}:Props){
 const [selectedId,setSelectedId]=useState<string|null>(null),[sectionId,setSectionId]=useState<string|null>(null);
 const reduced=useReducedMotion();
 const finding=findings.find(f=>f.id===selectedId)??findings[0];
 const section=report.sectionAssessments.find(s=>s.sectionId===sectionId)??report.sectionAssessments.find(s=>s.sectionId===finding?.sectionId)??report.sectionAssessments[0];
 const selectFinding=(next:Opportunity)=>{setSelectedId(next.id);setSectionId(next.sectionId);};
 const selectSection=(id:string)=>{setSectionId(id);const related=findings.find(f=>f.sectionId===id);if(related)setSelectedId(related.id);};
 const selectedRange=section?{startMeters:section.startMeters,endMeters:section.endMeters,label:section.label}:null;
 const geometry=useMemo(()=>analysis?.primary.lapId===report.bestLapId?trackGeometry(analysis.primary.track):[],[analysis,report.bestLapId]);
 const circuitSections=useMemo(()=>report.sectionAssessments.map(s=>{const segment=analysis?.segments.find(segment=>segment.id===s.sectionId);return {section:s,path:segment?trackPath(geometry.filter(p=>p.position>=segment.start&&p.position<=segment.end)):''};}),[analysis,geometry,report.sectionAssessments]);
 const selectedPath=circuitSections.find(s=>s.section.sectionId===section?.sectionId)?.path;
 const explanation=explanations.find(e=>e.opportunityId===finding?.id),coaching=finding?cardCoaching(finding,explanation):null;
 const range=finding?supportedRange(finding):null,model=finding?supportedModel(finding):null,gain=finding?supportedGain(finding):null;
 const totalMeters=report.sectionAssessments.at(-1)?.endMeters;
 const sectionModel=report.fullLap?.sections.find(s=>s.sectionId===section?.sectionId);
 const scenarioTimes=sectionModel?[{label:'Recorded section',seconds:sectionModel.baselineSeconds,kind:'actual'},{label:'Conservative scenario',seconds:sectionModel.conservativeSeconds,kind:'conservative'},{label:'Nominal scenario',seconds:sectionModel.nominalSeconds,kind:'nominal'}]:[];
 const maximumSectionTime=Math.max(0,...scenarioTimes.map(s=>s.seconds!=null&&Number.isFinite(s.seconds)?s.seconds:0));
 const matchingChannels=(pattern:RegExp)=>channels.filter(c=>pattern.test(c.name)||pattern.test(c.id));
 const positionAvailable=matchingChannels(/latitude/i).length>0&&matchingChannels(/longitude/i).length>0;
 const coverage=[{label:'Braking',available:matchingChannels(/brake|braking/i),missing:'No direct brake channel · speed changes alone do not establish pedal input.'},{label:'Acceleration',available:matchingChannels(/throttle|accelerator|gas.?pedal/i),missing:'No direct throttle channel · acceleration and RPM describe response, not pedal position.'},{label:'Cornering',available:matchingChannels(/lateral|accelerometer.?y|gyro.?z|yaw/i),missing:'No recognized lateral or yaw channel · inspect speed and position evidence before inferring cornering behavior.'}];
 return <div className="coach-debrief">
  <div className="coach-debrief-grid">
   <aside className="coach-opportunities" aria-label="Ranked opportunities">
    <div className="coach-block-heading"><h3>Ranked opportunities</h3><span>{findings.length} {findings.length===1?'experiment':'experiments'}</span></div>
    <p className="coach-caption">Prioritized from your fastest lap. Select an experiment to review its evidence.</p>
    <ol className="coach-opportunity-list">{findings.map((f,i)=>{const c=cardCoaching(f,explanations.find(e=>e.opportunityId===f.id)),r=supportedRange(f),m=supportedModel(f),label=report.sectionAssessments.find(s=>s.sectionId===f.sectionId)?.label||f.label,title=c.title.startsWith(`${label}: `)?c.title.slice(label.length+2):c.title;return <li key={f.id}><button className={finding?.id===f.id?'selected':''} aria-label={`${f.label}: ${c.title}`} aria-pressed={finding?.id===f.id} onClick={()=>selectFinding(f)}><span className="coach-opportunity-rank">{String(i+1).padStart(2,'0')}</span><span className="coach-opportunity-copy"><small>{label}</small><strong>{title}</strong><span>{r||m?`${rangeSeconds((r||m)!)} s`:'Unquantified'}<small>{r?.basis==='demonstrated'?'Demonstrated':'Conditional hypothesis'}</small></span></span><span aria-hidden="true">↗</span></button></li>;})}</ol>
    {!findings.length&&<p className="coach-empty">No supported opportunity or meaningful signal was identified in the available channels.</p>}
    <div className="coach-circuit-context">
     <div className="coach-block-heading"><h3>Lap intelligence</h3><span>{lapLabel(report.bestLapId)}</span></div>
     {geometry.length>1?<svg viewBox="0 0 320 260" role="group" aria-label="Measured GPS circuit with selectable sections"><path className="coach-circuit-ground" d={trackPath(geometry)}/><path className="coach-circuit-line" d={trackPath(geometry)}/>{selectedPath&&<motion.path key={section?.sectionId} className="coach-circuit-selected" d={selectedPath} initial={reduced?false:{opacity:.25}} animate={{opacity:1}} transition={reduced?{duration:0}:motionTokens.quick}/>} {circuitSections.filter(s=>s.path).map(s=><path key={s.section.sectionId} className="coach-circuit-hit" d={s.path} role="button" tabIndex={0} aria-label={`Review ${s.section.label}`} aria-pressed={section?.sectionId===s.section.sectionId} onClick={()=>selectSection(s.section.sectionId)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectSection(s.section.sectionId);}}}><title>{s.section.label}</title></path>)}</svg>:<p className="coach-caption">Select a section below to explore the measured lap by distance.</p>}
     <div className="coach-circuit-meta"><span>{report.validLapCount} valid laps reviewed</span><span>{totalMeters!=null&&Number.isFinite(totalMeters)?`${(totalMeters/1000).toFixed(2)} km`:'Distance unavailable'}</span></div>
    </div>
   </aside>
   <div className="coach-focus-column">
    {finding&&section&&finding.sectionId!==section.sectionId&&<div className="coach-independent-focus" role="status"><span>Reviewing {section.label} evidence. The selected experiment remains {report.sectionAssessments.find(s=>s.sectionId===finding.sectionId)?.label||finding.label}.</span><button onClick={()=>selectFinding(finding)}>Focus experiment ↗</button></div>}
    {finding&&coaching&&<motion.article className="coach-card coach-focus" key={finding.id} initial={reduced?false:{opacity:.5,x:8}} animate={{opacity:1,x:0}} transition={reduced?{duration:0}:motionTokens.settle}>
     <div className="coach-focus-top"><span>{finding.label} · {lapLabel(finding.lapId)}</span><span className={`coach-confidence ${finding.confidence}`}>{finding.confidence} confidence</span></div>
     <div className="coach-card-heading"><div><small>Next session: try this</small><h3>{coaching.title}</h3></div></div>
     <div className="coach-focus-summary"><div><TimePotential finding={finding}/>{(range||model)&&<div className="coach-gain-interval" role="img" aria-label={`Conditional gain range ${rangeSeconds((range||model)!)} seconds, from zero to the upper scenario bound`}><svg viewBox="0 0 240 26" aria-hidden="true"><line className="coach-gain-track" x1="4" x2="236" y1="13" y2="13"/><line className="coach-gain-bound" x1={4+232*(range||model)!.lowerSeconds/(range||model)!.upperSeconds} x2="236" y1="13" y2="13"/><path className="coach-gain-tick" d={`M4 8v10 M${4+232*(range||model)!.lowerSeconds/(range||model)!.upperSeconds} 6v14 M236 6v14`}/></svg><span>0 s <span>Conditional bounds</span></span></div>}</div><div className="coach-uncertainty"><span>{range?.basis==='demonstrated'?'Recorded evidence':range||model?'Modeled prediction':'Investigation'}</span><p>{range||model?'Conditional scenario bounds, not a confidence interval or guaranteed saving.':'No supported numerical gain is available.'}</p></div></div>
     <p className="coach-why">{coaching.observation}</p>
     <div className="coach-experiment"><div className="coach-action"><small>Try this</small><p>{coaching.action}</p></div><div className="coach-verify"><small>Verify on track</small><p>{coaching.validation}</p></div></div>
     <div className="coach-card-footer"><span>{coaching.source}</span><button onClick={()=>onInspect(finding)}>Inspect telemetry ↗</button></div>
     <details><summary>Evidence & validation · {finding.evidence.length} measurements</summary><p>{finding.observation}</p>{explanation?.hypothesis&&<p>Local model hypothesis: {explanation.hypothesis}</p>}<p>Full experiment: {finding.action}</p>{explanation?.action&&<p>Local model experiment: {explanation.action} The displayed range comes from deterministic physics, not Gemma.</p>}{explanation?.reasoningSource==='modelSelectedInterpretation'&&<p>Gemma selected this interpretation and experiment from bounded alternatives grounded in telemetry. Rust validates the intervention, evidence and sensor claims and supplies all numerical estimates.</p>}<EvidenceTable evidence={finding.evidence} modeled={finding.kind==='physics-counterfactual'||finding.kind==='physics'} onInspect={e=>onInspect({...finding,channelIds:e.channelIds})}/>{gain&&<p>{gain.observed.toFixed(3)} s measured section difference vs {lapLabel(finding.referenceLapId)}; not a guaranteed gain.</p>}{range&&<><p>Gain method: {range.method}</p><p>Assumption: {range.assumption}</p><p>Scenario bounds are conditional estimates, not a confidence interval or a guaranteed minimum saving.</p></>}{!range&&model&&<><p>Scenario method: {model.method}</p><p>Assumption: {model.assumption}</p>{model.referenceLapId&&<p>Scenario reference: {lapLabel(model.referenceLapId)}.</p>}<p>This range describes hypothetical inputs, not a confidence interval or a guaranteed minimum saving.</p></>}{explanation?.validation&&<p>{explanation.validation}</p>}<p>{finding.uncertainty}</p></details>
    </motion.article>}
    {report.fullLap&&<FullLapProfile interactive diagnostics={report.fullLap} profile={report.simulatedProfiles?.find(p=>p.strategy==='full-lap')} selectedRange={selectedRange} onSelectSection={s=>selectSection(s.sectionId)}/>}
   </div>
  </div>
  <section className="coach-corner-review" aria-label="Corner-by-corner performance">
   <div className="coach-block-heading"><h3>Corner-by-corner debrief</h3><span>{report.sectionAssessments.length} sections · measured intervals</span></div>
   <div className="coach-section-ribbon" aria-label="Select a track section">{report.sectionAssessments.map(s=><button key={s.sectionId} aria-pressed={section?.sectionId===s.sectionId} className={section?.sectionId===s.sectionId?'selected':''} onClick={()=>selectSection(s.sectionId)}><span>{s.label}</span><small>{s.kind}</small></button>)}</div>
   {section?<div className="coach-section-evidence"><div className="coach-section-overview"><h4>{section.label}</h4><span>{section.startMeters.toFixed(0)}–{section.endMeters.toFixed(0)} m · {section.kind}</span>{section.notes.map((note,i)=><p key={i}>{note}</p>)}{maximumSectionTime>0&&<div className="coach-section-comparison" aria-label="Recorded versus modeled section times">{scenarioTimes.map(s=><div key={s.kind} className={s.kind}><span>{s.label}</span><strong>{s.seconds!=null&&Number.isFinite(s.seconds)?`${s.seconds.toFixed(3)} s`:'Unavailable'}</strong>{s.seconds!=null&&Number.isFinite(s.seconds)&&s.seconds>=0&&<i aria-hidden="true" style={{transform:`scaleX(${s.seconds/maximumSectionTime})`}}/>}</div>)}<p>Scenarios follow the recorded path. Section tradeoffs are linked across the lap.</p></div>}<button onClick={()=>onInspect({lapId:report.bestLapId,referenceLapId:report.bestLapId,startTime:section.startTime,endTime:section.endTime})}>Inspect section telemetry ↗</button></div><EvidenceTable evidence={section.evidence} onInspect={e=>onInspect({lapId:report.bestLapId,referenceLapId:report.bestLapId,startTime:section.startTime,endTime:section.endTime,channelIds:e.channelIds})}/></div>:<p className="coach-caption">No supported section intervals available.</p>}
  </section>
  <section className="coach-channel-support" aria-label="Analysis signal coverage"><h3>What the recording can tell us</h3><div>{coverage.map(({label,available,missing})=><div key={label}><strong>{label}</strong><p>{available.length?`Recorded channels: ${available.map(c=>c.name).join(', ')}. Channel names alone do not establish calibration or a driving cause; inspect section evidence.`:missing}</p></div>)}<div><strong>Racing line</strong><p>{positionAvailable?'GPS coordinates recorded. Path geometry does not identify an optimal line, track limits or available grip.':`${matchingChannels(/gps.?speed/i).length?'GPS speed is recorded; ':''}GPS coordinates are unavailable. Racing-line geometry cannot be assessed.`}</p></div></div></section>
 </div>;
}
