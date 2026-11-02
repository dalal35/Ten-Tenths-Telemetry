import type {CoachResult,Opportunity} from './types';
/** Measured claims require a proven section difference against another lap. */
export function supportedGain(finding:Opportunity):{observed:number;estimated:number|null}|null {
 const observed=finding.observedLossSeconds;
 if(finding.status!=='proven'||finding.referenceLapId===finding.lapId||observed==null||!Number.isFinite(observed)||observed<=0||!finding.evidence.some(e=>e.metric==='sectionElapsed'&&e.unit==='s'&&e.referenceValue!=null&&Number.isFinite(e.lapValue)&&Number.isFinite(e.referenceValue)&&e.lapValue>e.referenceValue&&Math.abs(e.lapValue-e.referenceValue-observed)<0.000001))return null;
 const estimated=finding.estimatedGainSeconds;
 return {observed,estimated:estimated!=null&&Number.isFinite(estimated)&&estimated>0&&estimated<=observed?estimated:null};
}

export function findingTitle(finding:Opportunity){
 if(finding.coaching?.title.trim())return finding.coaching.title;
 const kind=finding.kind.toLowerCase();
 if(kind==='physics-counterfactual'||kind==='physics')return 'Investigate the modeled speed difference';
 if(/shift/.test(kind))return 'Test shift timing';
 if(/rpm|bog/.test(kind))return 'Check RPM recovery';
 if(/trajectory|curvature|line/.test(kind))return 'Compare the driving line';
 if(/exit/.test(kind))return 'Preserve exit momentum';
 if(/apex-recovery/.test(kind))return 'Test earlier speed recovery';
 if(/apex/.test(kind))return 'Preserve corner speed';
 if(/momentum/.test(kind))return 'Reduce momentum interruptions';
 return finding.status==='proven'?'Recover the section difference':'Test section momentum';
}

/** Model prose is visible only while consent and validated result provenance agree. */
export function visibleExplanations(result:CoachResult|null,accepted:boolean){
 return accepted&&result?.mode==='localModel'?result.explanations.filter(e=>e.reasoningSource==='modelSelectedInterpretation'||e.reasoningSource==='modelGeneratedProse'):[];
}

export function cardCoaching(finding:Opportunity,explanation?:CoachResult['explanations'][number]){
 const selected=finding.coaching?.hypotheses.find(h=>h.id===explanation?.interpretationId);
 const measured=conciseCoaching(finding.observation).split(/(?<=[.!?])\s+(?=[A-Z])/)[0];
 return {
  title:selected?.title||findingTitle(finding),
  observation:explanation?.hypothesis?`${measured} ${conciseCoaching(explanation.hypothesis)}`:coachingObservation(finding),
  action:explanation?.action?conciseCoaching(explanation.action,true):conciseCoaching(finding.action),
  validation:conciseCoaching(explanation?.validation||finding.coaching?.validation||'Compare repeated clean laps through the highlighted section and the following straight. Keep the change only if full section and lap time improve without losing exit speed.'),
  source:explanation?.reasoningSource==='modelSelectedInterpretation'?'Gemma-selected experiment':explanation?.reasoningSource==='modelGeneratedProse'?'Gemma coaching':'Deterministic telemetry',
 };
}

/** Select complete source sentences; detailed validation remains inspectable. */
export function conciseCoaching(text:string,experiment=false):string{
 const sentences=text.trim().split(/(?<=[.!?])\s+(?=[A-Z])/);
 if(!experiment)return sentences.slice(0,2).join(' ');
  const experimentSentence=sentences.find(sentence=>/^(?:Try |Test (?!one repeatable change))/i.test(sentence))||sentences[0]||text;
 return experimentSentence.replace(/; validate.*$/i,'.');
}

/** Short descriptions of detector-defined patterns; full measurements remain in evidence. */
export function coachingObservation(finding:Opportunity,hypothesis?:string):string{
 if(hypothesis)return conciseCoaching(hypothesis);
 switch(finding.kind){
  case 'apex-tradeoff':return 'A supporting lap holds more minimum speed without a substantially faster entry or poorer exit; that apex approach may help.';
  case 'exit-tradeoff':return 'A supporting lap exits faster at a similar entry speed, suggesting an entry-versus-exit tradeoff worth testing.';
  case 'apex-recovery':return 'Your fastest lap has a prolonged low-speed phase after the minimum; earlier smooth recovery is a hypothesis to test.';
  default:return conciseCoaching(finding.observation);
 }
}

/** Scenario ranges carry deterministic assumptions, separate from measured claims. */
export function supportedModel(finding:Opportunity){
 const model=finding.modeledGain;
 return model&&Number.isFinite(model.lowerSeconds)&&Number.isFinite(model.upperSeconds)&&model.lowerSeconds>=0&&model.upperSeconds>0&&model.lowerSeconds<=model.upperSeconds&&typeof model.assumption==='string'&&model.assumption.trim()&&typeof model.method==='string'&&model.method.trim()?model:null;
}
export function gainSeconds(seconds:number){return seconds>0&&seconds<0.001?'<0.001':seconds.toFixed(3);}

/** Only deterministic ranges with a disclosed basis and method may be displayed. */
export function supportedRange(finding:Opportunity){
 const range=finding.gainRange;
 if(!range||!['demonstrated','hypothesis'].includes(range.basis)||!Number.isFinite(range.lowerSeconds)||!Number.isFinite(range.upperSeconds)||range.lowerSeconds<0||range.upperSeconds<=0||range.lowerSeconds>range.upperSeconds||!range.assumption?.trim()||!range.method?.trim())return null;
 if(range.basis==='demonstrated'&&!supportedGain(finding))return null;
 return range;
}
export function rangeSeconds(range:{lowerSeconds:number;upperSeconds:number}){
 return range.upperSeconds<0.001?'<0.001':`${gainSeconds(range.lowerSeconds)}–${gainSeconds(range.upperSeconds)}`;
}
