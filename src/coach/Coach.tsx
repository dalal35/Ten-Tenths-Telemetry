import {useEffect,useMemo,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import {motionTokens} from '../motion';
import type {Session} from '../types';
import type {CoachEvidence,CoachResult,Opportunity} from './types';
import {analyzeCoach,cancelCoach,coachStatus,coachModelTerms} from '../bridge';
import {displaySpeedUnit,speedFactor} from '../speedDisplay';
import {formatTime} from '../telemetry';
import {lapDisplayNumber} from '../merging';
import {CoachQueue,CoachRequests} from './requests';
import {cardCoaching,visibleExplanations,rangeSeconds,supportedGain,supportedModel,supportedRange} from './presentation';
import {distinctFindings,prioritizeFindings} from './target';
import TimePotential from './TimePotential';
import FullLapProfile from './FullLapProfile';
import './coach.css';

const coachQueue=new CoachQueue<CoachResult>();

function EvidenceTable({evidence,modeled=false}:{evidence:CoachEvidence[];modeled?:boolean}){return <table><thead><tr><th>Evidence</th><th>{modeled?'Calculated / baseline':'Fastest lap'}</th><th>{modeled?'Scenario / timing reference':'Supporting example'}</th></tr></thead><tbody>{evidence.map(e=><tr key={e.id}><td>{e.metric.replace(/([A-Z])/g,' $1')}<small>{e.id}{e.channelIds.length?` · ${e.channelIds.join(', ')}`:''}</small></td><td className="mono">{(e.lapValue*speedFactor(e.unit)).toFixed(3)} {displaySpeedUnit(e.unit)}</td><td className="mono">{e.referenceValue==null?'—':`${(e.referenceValue*speedFactor(e.unit)).toFixed(3)} ${displaySpeedUnit(e.unit)}`}</td></tr>)}</tbody></table>;}

interface Props {session:Session;contentVersion:string;revision:number;active:boolean;onInspect:(finding:Opportunity)=>void}
export default function Coach({session,contentVersion,revision,active,onInspect}:Props){
 const [result,setResult]=useState<CoachResult|null>(null),[running,setRunning]=useState(false),[phase,setPhase]=useState(''),[error,setError]=useState('');
 const requests=useRef(new CoachRequests());
 const inspect=useRef(onInspect);inspect.current=onInspect;
 const lastPresentation=useRef<ReactNode>(null);
 const reducedMotion=useReducedMotion();
 const autoAnalysis=useRef(''),[termsReady,setTermsReady]=useState(false);
 const [terms,setTerms]=useState<{version:string;terms:string;policy:string}|null>(null),[accepted,setAccepted]=useState(false);
 useEffect(()=>{let ignore=false;void coachModelTerms().then(value=>{if(!ignore){setTerms(value);try{setAccepted(localStorage.getItem('ttt-coach-terms')===value.version);}catch{}}}).catch(()=>{}).finally(()=>{if(!ignore)setTermsReady(true);});return()=>{ignore=true;};},[]);
 const cancel=()=>{const id=requests.current.clear();if(id)coachQueue.cancel(id);setRunning(false);setPhase('Cancelled');};
 useEffect(()=>{setResult(null);setError('');setRunning(false);setPhase('');return()=>{const id=requests.current.clear();if(id)coachQueue.cancel(id);};},[session.id,contentVersion,revision]);
 const run=async(refresh=false)=>{
  autoAnalysis.current=JSON.stringify([session.id,contentVersion,revision,accepted]);
  const token=requests.current.begin(crypto.randomUUID());setRunning(true);setError('');setPhase('Validating recording');
  const timer=window.setInterval(()=>{void coachStatus().then(status=>{if(requests.current.accepts(token)&&status.jobId===token.id)setPhase(status.phase);}).catch(()=>{});},500);
  try{const next=await coachQueue.run(token.id,()=>analyzeCoach(session.id,null,token.id,refresh,accepted,null),()=>{void cancelCoach(token.id).catch(e=>{if(requests.current.accepts(token))setError(`Cancellation could not be sent: ${String(e)}`);});});if(next&&requests.current.accepts(token)){setResult(next);setPhase('Analysis complete');}}
  catch(e){if(requests.current.accepts(token)){setError(String(e));setPhase('Analysis failed');}}
  finally{window.clearInterval(timer);if(requests.current.accepts(token)){requests.current.clear();setRunning(false);}}
 };
 useEffect(()=>{const key=JSON.stringify([session.id,contentVersion,revision,accepted]);if(active&&termsReady&&autoAnalysis.current!==key){autoAnalysis.current=key;void run(false);}},[active,termsReady,session.id,contentVersion,revision,accepted]);
 const lapLabel=(id:string)=>`Lap ${lapDisplayNumber(session,id)}`;
 const report=result?.report;
 const explanations=visibleExplanations(result,accepted);
 const ranked=report?prioritizeFindings(report,explanations):[];
 const findings=report?.primaryOpportunityIds?ranked.slice(0,3):distinctFindings(ranked,explanations);
 const fastest=report?.bestLapSeconds;
 const source=running?'Analyzing locally':!accepted?'AI inactive · terms not accepted':!result?'Local model · not run':result.mode==='localModel'?`${result.cached?'Cached · ':''}Local model interpretation`:`${result.cached?'Cached · ':''}Computed fallback`;
 const presentation=useMemo(()=>{if(!active&&lastPresentation.current!==null)return lastPresentation.current;return <section className="coach-workspace" aria-label="AI Driving Coach">
  <div className="coach-heading"><div><div className="eyebrow">AI DRIVING COACH · OFFLINE</div><h2>How to Improve Your Fastest Lap</h2></div><span className="local-badge">{source}</span></div>
  <form className="coach-overview" aria-busy={running} onSubmit={e=>{e.preventDefault();void run(!!result);}}>
   <div className="coach-stat"><small>FASTEST VALID LAP</small><strong className="mono">{fastest==null?'—':formatTime(fastest)}</strong>{report&&<small>{lapLabel(report.bestLapId)}</small>}</div>
   <div className="coach-stat"><small>RECORDED THEORETICAL BEST</small><strong className="mono">{report?.theoreticalBestSeconds==null?'—':formatTime(report.theoreticalBestSeconds)}</strong><small>Compatible recorded sections</small></div>
   <div className="coach-stat"><small>MODELED LAP-TIME RANGE</small><strong className="mono">{report?.fullLap?.modeledLapSeconds?`${formatTime(report.fullLap.modeledLapSeconds.lowerSeconds)}–${formatTime(report.fullLap.modeledLapSeconds.upperSeconds)}`:'Not yet quantifiable'}</strong><small>Deterministic physics · conditional estimate</small>{report?.improvementPotential&&<small>ESTIMATED IMPROVEMENT: {rangeSeconds(report.improvementPotential)} s</small>}{report?.fullLap?.modeledLapSeconds&&report.fullLap.modeledLapSeconds.upperSeconds>report.bestLapSeconds&&<small>Conservative scenario is slower · no minimum gain established</small>}</div>
   <button type="submit" className="import-button" disabled={!termsReady||running}>Analyze</button>
   {running&&<button type="button" onClick={cancel}>Cancel analysis</button>}
  </form>
  <div className={`coach-progress${running?' is-running':''}`} role="status" aria-live="polite">{running&&<span className="coach-signal" aria-hidden="true"><i/><i/><i/><i/></span>}<span>{phase}{result&&!running?` · ${result.cached?'Cached result':`${(result.elapsedMs/1000).toFixed(1)} s local analysis`}`:''}</span>{running&&<span className="coach-progress-rail" aria-hidden="true"><i/></span>}</div>
  {error&&<div className="error-banner" role="alert">{error}</div>}
  {session.merge&&<p className="warnings">Unified session · {session.merge.sources.length} recordings. Assumes the same kart and track with approximately equivalent grip and conditions unless telemetry indicates otherwise.</p>}
  {!report&&!running&&<div className="coach-empty">Analyze your fastest valid lap for up to three supported driving experiments.</div>}
  {report&&<>
   <div className="coach-section-title"><h3>Next session: try these</h3><span>{lapLabel(report.bestLapId)} · {report.validLapCount} valid laps reviewed</span></div>
   {!findings.length&&<p className="coach-empty">No supported opportunity or meaningful signal was identified in the available channels. Review advanced details for missing evidence.</p>}
   <div className="coach-findings">{findings.map((finding,index)=>{const gain=supportedGain(finding),range=supportedRange(finding),model=supportedModel(finding),explanation=explanations.find(e=>e.opportunityId===finding.id),coaching=cardCoaching(finding,explanation);return <motion.article className="coach-card" key={finding.id} initial={reducedMotion?false:{opacity:0,y:12,scale:.99}} animate={{opacity:1,y:0,scale:1}} transition={reducedMotion?{duration:0}:{...motionTokens.spring,delay:index*.06}}>
    <div className="coach-card-heading"><span className="coach-rank mono">{String(index+1).padStart(2,'0')}</span><div><small>{finding.label}</small><h3>{coaching.title}</h3></div></div>
    <div className="coach-card-meta"><span className={`coach-confidence ${finding.confidence}`}>{finding.confidence} confidence</span><span>{range?.basis==='demonstrated'?'Demonstrated opportunity':range||model?'Engineering hypothesis · simulated':finding.status==='likely'?'Improvement hypothesis':'Investigation idea'}</span></div>
    <TimePotential finding={finding}/>
    <p className="coach-why">{coaching.observation}</p>
    <div className="coach-action"><small>TRY THIS</small><p>{coaching.action}</p></div>
    <div className="coach-verify"><small>VERIFY</small><p>{coaching.validation}</p></div>
    <div className="coach-card-footer"><span>{coaching.source}</span><button onClick={()=>inspect.current(finding)}>Inspect telemetry ↗</button></div>
    <details><summary>Evidence & validation</summary><p>{finding.observation}</p>{explanation?.hypothesis&&<p>Local model hypothesis: {explanation.hypothesis}</p>}<p>Full experiment: {finding.action}</p>{explanation?.action&&<p>Local model experiment: {explanation.action} The displayed range comes from deterministic physics, not Gemma.</p>}{explanation?.reasoningSource==='modelSelectedInterpretation'&&<p>Gemma selected this interpretation and experiment from bounded alternatives grounded in the telemetry. Rust validates the selected intervention, its evidence and sensor claims, and supplies all numerical estimates.</p>}<EvidenceTable evidence={finding.evidence} modeled={finding.kind==='physics-counterfactual'||finding.kind==='physics'}/>{gain&&<p>{gain.observed.toFixed(3)} s measured section difference vs {lapLabel(finding.referenceLapId)}; not a guaranteed gain.</p>}{range&&<><p>Gain method: {range.method}</p><p>Assumption: {range.assumption}</p><p>Scenario bounds are conditional estimates, not a confidence interval or a guaranteed minimum saving.</p></>}{!range&&model&&<><p>Scenario method: {model.method}</p><p>Assumption: {model.assumption}</p>{model.referenceLapId&&<p>Scenario reference: {lapLabel(model.referenceLapId)}.</p>}<p>This range describes hypothetical inputs, not a confidence interval or a guaranteed minimum saving. Validate full section and lap time after testing.</p></>}{explanation?.validation&&<p>{explanation.validation}</p>}<p>{finding.uncertainty}</p></details>
   </motion.article>;})}</div>
   {report.fullLap&&<FullLapProfile diagnostics={report.fullLap} profile={report.simulatedProfiles?.find(profile=>profile.strategy==='full-lap')}/>}
   {!!findings.length&&<p className="coach-estimate-note">The lap estimate counts each compatible section once; these cards show the top three experiments. Hypothetical gains remain conditional until verified on track.</p>}
  </>}
  <details className="coach-advanced"><summary>Advanced details · evidence, methodology & model settings</summary>
   {result?.notice&&<p>{result.notice}</p>}
   {result?.inferenceMetrics&&<p>Native inference: {result.inferenceMetrics.generatedTokens} tokens · {(result.inferenceMetrics.inferenceMs/1000).toFixed(1)} s · {result.inferenceMetrics.gpu?'GPU':'CPU'}. Model load {(result.inferenceMetrics.modelLoadMs/1000).toFixed(1)} s.</p>}
   {result&&<p>Result: {result.mode==='localModel'?'validated local model output':'deterministic measurements and fallback'} · {result.modelVersion} · {result.cached?'cached':'fresh'}.</p>}
   {terms&&<details className="coach-terms"><summary>Bundled local model · terms of use</summary><p>Local AI is inactive until these terms are accepted. Computed telemetry remains available.</p><div className="coach-license"><pre>{terms.terms}{'\n\n'}{terms.policy}</pre></div><label><input type="checkbox" checked={accepted} disabled={running} onChange={e=>{setResult(null);setPhase('');autoAnalysis.current='';setAccepted(e.target.checked);try{if(e.target.checked)localStorage.setItem('ttt-coach-terms',terms.version);else localStorage.removeItem('ttt-coach-terms');}catch{}}}/> I agree to the Gemma terms and use restrictions for local model explanations.</label></details>}
   {report&&<>
    {report.improvementPotential&&<><p>Enhanced estimate: {report.improvementPotential.method}</p><p>Assumption: {report.improvementPotential.assumption}</p><p>{report.enhancementBudget?.length??0} compatible section budgets contribute to this estimate; only the top three driving experiments are shown above.</p></>}
    {!!report.enhancementBudget?.length&&<details><summary>Full-lap opportunity budget · {report.enhancementBudget.length} sections</summary>{report.enhancementBudget.map(entry=><p key={entry.sectionId}>{report.sectionAssessments.find(s=>s.sectionId===entry.sectionId)?.label||entry.sectionId} · {rangeSeconds(entry.gainRange)} s · {entry.gainRange.basis==='demonstrated'?'demonstrated':'hypothesis'} · source {lapLabel(entry.sourceLapId)}. {entry.gainRange.assumption}</p>)}</details>}
    {report.performanceEnvelope&&<details><summary>Vehicle performance envelope · observed and conditional capacity</summary><p>{report.performanceEnvelope.validLapCount} valid laps · observed lateral demand {report.performanceEnvelope.observedLateralMps2.toFixed(2)} m/s² · sensitivity {report.performanceEnvelope.conservativeLateralMps2.toFixed(2)}–{report.performanceEnvelope.nominalLateralMps2.toFixed(2)} m/s².</p><table><thead><tr><th>Speed ({displaySpeedUnit('m/s')})</th><th>Samples</th><th>Acceleration (m/s²)</th><th>Braking (m/s²)</th></tr></thead><tbody>{report.performanceEnvelope.speedBands.map((band,i)=><tr key={i}><td>{(band.minSpeedMps*speedFactor('m/s')).toFixed(1)}–{(band.maxSpeedMps*speedFactor('m/s')).toFixed(1)}</td><td>{band.sampleCount}</td><td>{band.conservativeAccelerationMps2.toFixed(2)}–{band.nominalAccelerationMps2.toFixed(2)}</td><td>{band.conservativeBrakingMps2.toFixed(2)}–{band.nominalBrakingMps2.toFixed(2)}</td></tr>)}</tbody></table>{[...report.performanceEnvelope.assumptions,...report.performanceEnvelope.rpmEvidence].map((text,i)=><p key={i}>{text}</p>)}</details>}
    {!!report.simulatedProfiles?.length&&<details><summary>Counterfactual profiles · strategy and sensitivity</summary><p>Times cover the complete modeled interval, including downstream momentum and the return to the recorded speed. Scenario bounds describe model sensitivity.</p><table><thead><tr><th>Strategy</th><th>Interval (m)</th><th>Baseline (s)</th><th>Conservative (s)</th><th>Nominal (s)</th></tr></thead><tbody>{report.simulatedProfiles.map((profile,i)=><tr key={i}><td>{profile.strategy}</td><td>{profile.startMeters.toFixed(1)}–{profile.endMeters.toFixed(1)}</td><td>{profile.baselineSeconds.toFixed(3)}</td><td>{profile.conservativeSeconds.toFixed(3)}</td><td>{profile.nominalSeconds.toFixed(3)}</td></tr>)}</tbody></table></details>}
    <p>Fastest valid lap {lapLabel(report.bestLapId)} · theoretical best {report.theoreticalBestSeconds==null?'unavailable':formatTime(report.theoreticalBestSeconds)} · compatible improvement {report.theoreticalImprovementSeconds==null?'unquantified':`${report.theoreticalImprovementSeconds.toFixed(3)} s`}. Recorded segments are not a promised lap.</p>
    <details><summary>Every corner and straight · {report.sectionAssessments.length} sections reviewed</summary>{report.sectionAssessments.map(section=><div key={section.sectionId}><h4>{section.label} · {section.kind}</h4>{section.notes.map((note,i)=><p key={i}>{note}</p>)}<EvidenceTable evidence={section.evidence}/></div>)}</details>
    <p>Repeatability: median {formatTime(report.consistency.medianSeconds)} · median absolute deviation {report.consistency.medianAbsoluteDeviationSeconds.toFixed(3)} s · range {report.consistency.rangeSeconds.toFixed(3)} s across {report.consistency.sampleCount} laps.</p>
    <details><summary>Supporting lap comparison quality</summary>{report.laps.map(l=><p key={l.lapId}>{lapLabel(l.lapId)} · spatial coverage {(l.coverage*100).toFixed(1)}% · {l.notes.join(' ')}</p>)}</details>
    <details><summary>Theoretical segment sources</summary>{report.segments.map(s=><p key={s.sectionId}>{s.label} · {lapLabel(s.lapId)} · {s.elapsedSeconds.toFixed(3)} s</p>)}</details>
    {report.notes.map((n,i)=><p key={i}>{n}</p>)}{report.excludedLaps.map(l=><p key={l.lapId}>{lapLabel(l.lapId)} excluded: {l.reason}</p>)}
   </>}
  </details>
 </section>;},[active,result,running,phase,error,accepted,terms,termsReady,session,contentVersion,revision,reducedMotion]);
 lastPresentation.current=presentation;
 return presentation;
}
