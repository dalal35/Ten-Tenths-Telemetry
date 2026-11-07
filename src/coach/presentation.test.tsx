import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import Coach from './Coach';
import {cardCoaching,confidenceLabel,findingTitle,supportedGain,conciseCoaching,coachingObservation,visibleExplanations} from './presentation';
import TimePotential from './TimePotential';
import type {CoachResult,Opportunity} from './types';
import type {Session} from '../types';
const proven:Opportunity={id:'finding',priorityScore:1,sectionId:'turn-1',label:'Turn 1',kind:'corner',startTime:100,endTime:104,startMeters:0,endMeters:100,fasterExampleCount:1,confidence:'medium',observation:'Measured difference',action:'Compare exits',uncertainty:'Not guaranteed',status:'proven',lapId:'best',referenceLapId:'example',observedLossSeconds:0.42,estimatedGainSeconds:0.21,evidence:[{metric:'sectionElapsed',lapValue:4,referenceValue:3.58,unit:'s',id:'timing',channelIds:[]}]};
describe('fastest-lap coach presentation',()=>{
 it('presents automatic fastest-lap analysis without a comparison target selector',()=>{
  const html=renderToStaticMarkup(<Coach session={{id:'session',laps:[]} as unknown as Session} contentVersion="v" revision={0} active={false} onInspect={()=>{}}/>);
  expect(html).toContain('Your driving debrief');
  expect(html).not.toContain('<select');
  expect(html).not.toContain('Target lap time');
  expect(html).toContain('Recorded composite');
  expect(html).toContain('Modeled lap-time range');
  expect(html).toContain('Simulated from your laps');
  expect(html.match(/>Analyze<\/button>/g)).toHaveLength(1);
  expect(html).toContain('AI inactive');
  expect(html).not.toContain('Regenerate explanations');
  expect(html).not.toContain('Path to Target');
 });
 it('shows numerical opportunities only for proven measured section differences',()=>{
  expect(supportedGain(proven)).toEqual({observed:0.42,estimated:0.21});
  expect(supportedGain({...proven,status:'suspected'})).toBeNull();
  expect(supportedGain({...proven,evidence:[]})).toBeNull();
  expect(supportedGain({...proven,observedLossSeconds:2})).toBeNull();
  expect(supportedGain({...proven,observedLossSeconds:NaN})).toBeNull();
  expect(supportedGain({...proven,referenceLapId:'best'})).toBeNull();
  expect(supportedGain({...proven,estimatedGainSeconds:0.5})).toEqual({observed:0.42,estimated:null});
  expect(supportedGain({...proven,evidence:[{...proven.evidence[0],referenceValue:4.1}]})).toBeNull();
 });
});

it('uses the observed mechanism for titles rather than incidental RPM evidence',()=>{expect(findingTitle({...proven,kind:'exit-tradeoff',evidence:[{...proven.evidence[0],metric:'rpmRecovery'}]})).toBe('Preserve exit momentum');});

it('keeps the practical experiment concise and preserves the original wording',()=>{
 expect(conciseCoaching('Compare the traces. Try a wider entry while preserving exit speed. Validate full section time.',true)).toBe('Try a wider entry while preserving exit speed.');
 expect(conciseCoaching('Measured pattern. Possible explanation. Long methodological caveat.')).toBe('Measured pattern. Possible explanation.');
});

it('summarizes known measured patterns without carrying long caveats into the debrief',()=>{
 expect(coachingObservation({...proven,kind:'exit-tradeoff'})).toBe('A supporting lap exits faster at a similar entry speed, suggesting an entry-versus-exit tradeoff worth testing.');
 expect(coachingObservation({...proven,kind:'unknown'})).toBe('Measured difference');
});

const modeled={lowerSeconds:0.012,upperSeconds:0.048,assumption:'If recovery starts earlier with no exit loss.',method:'Integrate a bounded earlier recovery scenario.'};
it('shows distinct physics mechanisms and section-specific success metrics without changing gains',()=>{
 const recovery:Opportunity={...proven,kind:'physics-counterfactual',modeledGain:modeled,observation:'Recovery remains slow after the minimum. A sustained modeled recovery may reduce downstream time.',action:'Try building speed continuously after the minimum.',coaching:{mechanism:'exit-recovery',title:'Recover speed sooner after the minimum',validation:'Compare recovery distance and downstream section time.',hypotheses:[]}};
 const deceleration:Opportunity={...recovery,coaching:{...recovery.coaching!,mechanism:'deceleration',title:'Reduce the second deceleration',validation:'Check the second speed dip and complete section time.'},action:'Try a repeatable approach with a single smooth speed reduction.'};
 expect(cardCoaching(recovery)).toEqual({title:'Recover speed sooner after the minimum',observation:recovery.observation,action:recovery.action,validation:recovery.coaching?.validation,source:'Deterministic telemetry'});
 expect(cardCoaching(deceleration).title).not.toBe(cardCoaching(recovery).title);
 expect(cardCoaching(deceleration).action).not.toBe(cardCoaching(recovery).action);
 expect(recovery.modeledGain).toBe(modeled);
 expect(findingTitle({...recovery,coaching:null})).toBe('Investigate the modeled speed difference');
});
it('lets validated Gemma experiments contribute to modeled cards with explicit attribution',()=>{
 const explanation:CoachResult['explanations'][number]={opportunityId:proven.id,action:'Try a smoother exit arc while keeping approach speed repeatable.',hypothesis:'The exit arc may interrupt recovery.',validation:'Compare recovery distance and downstream time.',reasoningSource:'modelSelectedInterpretation',interpretationId:'exit-arc'};
 const result={mode:'localModel',explanations:[explanation]} as CoachResult;
 const visible=visibleExplanations(result,true);
 const card=cardCoaching({...proven,modeledGain:modeled},visible[0]);
 expect(card.action).toBe(explanation.action);
 expect(card.observation).toBe(`${proven.observation} ${explanation.hypothesis}`);
 expect(card.validation).toBe(explanation.validation);
 expect(card.source).toBe('Chosen by local AI (Gemma)');
 expect(visibleExplanations(result,false)).toEqual([]);
 expect(visibleExplanations({...result,mode:'deterministic'},true)).toEqual([]);
 expect(visibleExplanations({...result,explanations:[{...explanation,reasoningSource:undefined}]},true)).toEqual([]);
 expect(cardCoaching(proven).source).toBe('Deterministic telemetry');
});
it('uses the selected alternative headline and retains a measured fact beside its reasoning',()=>{
 const finding:Opportunity={...proven,observation:'Recorded minimum is slower than the scenario. The peak gap is downstream.',coaching:{mechanism:'exit-recovery',title:'Build speed after the minimum',validation:'Compare recovery distance.',hypotheses:[{id:'check-model-alignment',title:'Check the modeled gap',hypothesis:'Geometry or calibration may explain the gap.',experiment:'Repeat the approach and inspect alignment.',validation:'Compare repeated section timing.'}]}};
 const selected=finding.coaching!.hypotheses[0];
 const card=cardCoaching(finding,{opportunityId:finding.id,interpretationId:selected.id,reasoningSource:'modelSelectedInterpretation',hypothesis:selected.hypothesis,action:selected.experiment,validation:selected.validation});
 expect(card.title).toBe('Check the modeled gap');
 expect(card.observation).toBe('Recorded minimum is slower than the scenario. Geometry or calibration may explain the gap.');
 expect(card.action).toBe(selected.experiment);
});
it('retains the fallback experiment location when the mechanism repeats in another corner',()=>{
 const first=cardCoaching({...proven,action:'Corner 4: Try a smoother arc through minimum speed. Review the speed trace near 120 m, where the modeled gap is largest. Full methodology remains available.'});
 const second=cardCoaching({...proven,action:'Corner 6: Try a smoother arc through minimum speed. Review the speed trace near 260 m, where the modeled gap is largest.'});
 expect(first.action).toContain('near 120 m');
 expect(second.action).toContain('near 260 m');
 expect(first.action).not.toContain('Full methodology');
});
it('uses a disclosed scenario range when the recorded comparison only provides a point estimate',()=>{
 const html=renderToStaticMarkup(<TimePotential finding={{...proven,modeledGain:modeled}}/>);
 expect(html).toContain('Scenario estimate');expect(html).toContain('0.012–0.048 s');expect(html).not.toContain('0.210 s');
});
it('labels an untested idea as something to try and keeps measured confidence tiers',()=>{
 expect(confidenceLabel('low')).toBe('To test on track');
 expect(confidenceLabel('medium')).toBe('Medium confidence');
 expect(confidenceLabel('high')).toBe('High confidence');
});

it('shows a hypothetical range and its assumption without presenting a confidence interval',()=>{
 const html=renderToStaticMarkup(<TimePotential finding={{...proven,status:'suspected',modeledGain:modeled}}/>);
 expect(html).toContain('Scenario estimate');expect(html).toContain('0.012–0.048 s');expect(html).not.toContain(modeled.assumption);expect(html).toContain('Hypothetical');
});
it.each([
 {...modeled,lowerSeconds:-1},{...modeled,upperSeconds:0},{...modeled,lowerSeconds:1,upperSeconds:0.5},
 {...modeled,lowerSeconds:NaN},{...modeled,upperSeconds:Infinity},{...modeled,assumption:''},{...modeled,method:''},
])('does not display invalid or unexplained scenario estimates: %j',modeledGain=>{
 const html=renderToStaticMarkup(<TimePotential finding={{...proven,status:'suspected',modeledGain}}/>);
 expect(html).toContain('not yet quantifiable');expect(html).not.toContain('Scenario estimate');
});
it('does not turn a measured difference alone into an estimated saving',()=>{
 const html=renderToStaticMarkup(<TimePotential finding={{...proven,estimatedGainSeconds:null}}/>);
 expect(html).toContain('Gain not yet quantifiable');expect(html).not.toContain('0.420 s');
});
it('keeps a small positive scenario visible below the display precision',()=>{
 const html=renderToStaticMarkup(<TimePotential finding={{...proven,status:'suspected',modeledGain:{...modeled,lowerSeconds:0.00001,upperSeconds:0.0001}}}/>);
 expect(html).not.toContain('0.000');expect(html).toContain('&lt;0.001 s');
});

it('explains when no time estimate is available',()=>{
 const html=renderToStaticMarkup(<TimePotential finding={{...proven,status:'suspected',estimatedGainSeconds:null}}/>);
 expect(html).toContain('not yet quantifiable');expect(html).not.toContain('0.420');
});

it('shows deterministic demonstrated ranges prominently instead of a single point estimate',()=>{
 const html=renderToStaticMarkup(<TimePotential finding={{...proven,gainRange:{lowerSeconds:0.08,upperSeconds:0.18,basis:'demonstrated',assumption:'Repeated compatible exits.',method:'Section timing less uncertainty.'}}}/>);
 expect(html).toContain('0.080–0.180 s');expect(html).toContain('Demonstrated');expect(html).not.toContain('0.210 s');
});
it('does not invent a range from a legacy point estimate',()=>{
 const html=renderToStaticMarkup(<TimePotential finding={proven}/>);
 expect(html).toContain('Gain not yet quantifiable');
});

it.each([
 {lowerSeconds:-0.1,upperSeconds:0.2}, {lowerSeconds:0.3,upperSeconds:0.2},
 {lowerSeconds:NaN,upperSeconds:0.2}, {lowerSeconds:0.1,upperSeconds:Infinity},
])('withholds invalid deterministic ranges without calculating a replacement',bounds=>{
 const html=renderToStaticMarkup(<TimePotential finding={{...proven,gainRange:{...bounds,basis:'hypothesis',assumption:'Conditional recovery',method:'Fixed distance integration'}}}/>);
 expect(html).toContain('Gain not yet quantifiable');
});
it('requires measured section evidence before labeling a range demonstrated',()=>{
 const html=renderToStaticMarkup(<TimePotential finding={{...proven,evidence:[],gainRange:{lowerSeconds:0.08,upperSeconds:0.18,basis:'demonstrated',assumption:'Recorded difference',method:'Timing uncertainty'}}}/>);
 expect(html).toContain('Gain not yet quantifiable');
});

it('waits for backend validation before labeling a lap fastest valid',()=>{
 const session={id:'s',laps:[{complete:true,duration:1,start:50,end:40}]} as unknown as Session;
 const html=renderToStaticMarkup(<Coach session={session} contentVersion="v" revision={0} active={false} onInspect={()=>{}}/>);
 expect(html).not.toContain('0:01.000');
});

it('presents merged recordings as one coaching session with explicit conditions',()=>{
 const session={id:'merged',laps:[],merge:{sources:[{},{}]}} as unknown as Session;
 const html=renderToStaticMarkup(<Coach session={session} contentVersion="merged-v" revision={0} active={false} onInspect={()=>{}}/>);
 expect(html).toContain('2 recordings');
 expect(html).toContain('equivalent grip and conditions');
 expect(html).not.toContain('Choose an original recording');
 expect(html).toContain('Recorded composite');
});
