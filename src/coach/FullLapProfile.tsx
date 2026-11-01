import {memo} from 'react';
import {displaySpeedUnit,speedFactor} from '../speedDisplay';
import {rangeSeconds} from './presentation';
import type {FullLapDiagnostics,SimulatedProfile} from './types';

const delta=(baseline:number|null,scenario:number|null)=>{
 if(baseline==null||scenario==null||!Number.isFinite(baseline)||!Number.isFinite(scenario))return 'Unavailable';
 const difference=baseline-scenario;
 return `${Math.abs(difference).toFixed(3)} s ${difference<0?'slower':'faster'}`;
};

function FullLapProfile({diagnostics,profile}:{diagnostics:FullLapDiagnostics;profile?:SimulatedProfile}){
 const points=profile?.points??[];
 const drawable=points.length>1&&points.every((point,i)=>Number.isFinite(point.meters)&&[point.baselineSpeedMps,point.conservativeSpeedMps,point.nominalSpeedMps].every(v=>Number.isFinite(v)&&v>0)&&(i===0||point.meters>points[i-1].meters));
 const start=points[0]?.meters??0,end=points.at(-1)?.meters??0;
 const maximum=drawable?Math.max(...points.flatMap(p=>[p.baselineSpeedMps,p.conservativeSpeedMps,p.nominalSpeedMps]))*1.08:1;
 const path=(field:'baselineSpeedMps'|'conservativeSpeedMps'|'nominalSpeedMps')=>points.map((p,i)=>`${i?'L':'M'}${(46+(p.meters-start)/(end-start)*830).toFixed(2)},${(160-p[field]/maximum*132).toFixed(2)}`).join(' ');
 return <section className="coach-full-lap" aria-label="Full-lap physics model">
  <div className="coach-profile-heading"><h3>Actual versus optimized speed</h3><span>{(diagnostics.coverageFraction*100).toFixed(1)}% simulation coverage · {diagnostics.coveredMeters.toFixed(0)} / {diagnostics.totalMeters.toFixed(0)} m</span></div>
  <p className="coach-profile-note">Deterministic physics scenarios · conditional capacity, with calibration uncertainty. Gemma interprets the results; numerical estimates come from the solver.</p>
  {drawable?<>
   <div className="coach-profile-legend"><span className="actual">Actual fastest lap</span><span className="conservative">Conservative</span><span className="nominal">Nominal</span></div>
   <svg className="coach-profile-chart" viewBox="0 0 900 194" role="img" aria-label={`Actual fastest lap, conservative and nominal optimized speed by track distance in meters; speed in ${displaySpeedUnit('m/s')}`}>
    <title>Actual versus optimized full-lap speed</title>
    {[0,0.5,1].map(f=><g key={f}><line className="coach-profile-grid" x1="46" x2="876" y1={160-f*132} y2={160-f*132}/><text x="38" y={164-f*132} textAnchor="end">{(f*maximum*speedFactor('m/s')).toFixed(0)}</text></g>)}
    <text x="46" y="14">{displaySpeedUnit('m/s')}</text>
    <path className="coach-profile-line actual" d={path('baselineSpeedMps')}/><path className="coach-profile-line conservative" d={path('conservativeSpeedMps')}/><path className="coach-profile-line nominal" d={path('nominalSpeedMps')}/>
    <text x="46" y="181">{start.toFixed(0)} m</text><text x="876" y="181" textAnchor="end">{end.toFixed(0)} m</text>
   </svg>
  </>:<p className="coach-profile-note">Speed overlay unavailable: a continuous finite speed profile is required.</p>}
  <details><summary>Full-lap coverage, section tradeoffs & assumptions</summary>
   <p>Withheld validation · {diagnostics.validation.trainingLapIds.length} training / {diagnostics.validation.withheldLapIds.length} withheld laps · target: {diagnostics.validation.target}.</p>
   <p>Optimal-bound speed RMSE: {diagnostics.validation.speedRmseMps==null?'unavailable':`${(diagnostics.validation.speedRmseMps*speedFactor('m/s')).toFixed(1)} ${displaySpeedUnit('m/s')}`} · section time MAE: {diagnostics.validation.sectionTimeMaeSeconds==null?'unavailable':`${diagnostics.validation.sectionTimeMaeSeconds.toFixed(3)} s`} · recorded speed above modeled bound: {diagnostics.validation.envelopeExceedanceFraction==null?'unavailable':`${(diagnostics.validation.envelopeExceedanceFraction*100).toFixed(1)}%`}.</p>
   {diagnostics.validation.prediction&&<><p>Short-horizon prediction · {diagnostics.validation.prediction.horizonSeconds.toFixed(1)} s ahead · speed RMSE {diagnostics.validation.prediction.speedRmseMps==null?'unavailable':`${(diagnostics.validation.prediction.speedRmseMps*speedFactor('m/s')).toFixed(2)} ${displaySpeedUnit('m/s')}`} · persistence baseline {diagnostics.validation.prediction.persistenceSpeedRmseMps==null?'unavailable':`${(diagnostics.validation.prediction.persistenceSpeedRmseMps*speedFactor('m/s')).toFixed(2)} ${displaySpeedUnit('m/s')}`} · covered-section time MAE {diagnostics.validation.prediction.coveredSectionTimeMaeSeconds?.toFixed(3)??'unavailable'} s. {diagnostics.validation.prediction.sampleCount} windows; {(diagnostics.validation.prediction.temporalCoverageFraction*100).toFixed(1)}% temporal coverage.</p><p>{diagnostics.validation.prediction.target}</p></>}
   {diagnostics.dynamicsSupport&&<p>Dynamics support: {diagnostics.dynamicsSupport.accelerationSamples} acceleration / {diagnostics.dynamicsSupport.brakingSamples} braking windows · {(diagnostics.dynamicsSupport.extrapolatedDistanceFraction*100).toFixed(1)}% distance uses outer-speed extrapolation; maximum extent {(diagnostics.dynamicsSupport.maximumSpeedExtrapolationMps*speedFactor('m/s')).toFixed(1)} {displaySpeedUnit('m/s')}.</p>}
   {diagnostics.baselineIntegrationErrorSeconds!=null&&<p>Actual speed integration minus crossing time: {diagnostics.baselineIntegrationErrorSeconds.toFixed(3)} s.</p>}
   <p>Feasibility: {diagnostics.validation.feasibilityViolations} violations / {diagnostics.validation.testedCells} tested cells · maximum constraint excess {diagnostics.validation.maximumConstraintExcess.toFixed(4)}.</p>
   {diagnostics.validation.notes.map((note,i)=><p key={`validation-${i}`}>{note}</p>)}
   <p>Signed section changes compare measured section elapsed time with integrated modeled speeds. A slower section may enable a faster following section; these are linked scenarios and must not be added to separate recorded gains.</p>
   <table><thead><tr><th>Section</th><th>Conservative change</th><th>Nominal change</th><th>Potential range</th><th>Coverage issues</th></tr></thead><tbody>{diagnostics.sections.map(section=><tr key={section.sectionId}><td>{section.label}<small>{section.startMeters.toFixed(0)}–{section.endMeters.toFixed(0)} m</small></td><td>{delta(section.baselineSeconds,section.conservativeSeconds)}</td><td>{delta(section.baselineSeconds,section.nominalSeconds)}</td><td>{section.gainRange?`${rangeSeconds(section.gainRange)} s`:'Unquantified'}</td><td>{section.excludedReasons.join('; ')||'—'}</td></tr>)}</tbody></table>
   {diagnostics.assumptions.map((assumption,i)=><p key={i}>{assumption}</p>)}
  </details>
  {!!diagnostics.rejectionReasons.length&&<p className="coach-profile-rejection">Model withheld: {diagnostics.rejectionReasons.join('; ')}</p>}
 </section>;
}

export default memo(FullLapProfile);
