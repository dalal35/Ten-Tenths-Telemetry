import {describe,expect,it} from 'vitest';
import {prioritizeFindings,distinctFindings} from './target';
import type {CoachReport,Opportunity} from './types';
const finding=(extra:Partial<Opportunity>={}):Opportunity=>({id:'measured',status:'proven',priorityScore:10,lapId:'best',referenceLapId:'other',sectionId:'one',label:'Corner 1',kind:'corner',startTime:0,endTime:5,startMeters:0,endMeters:100,observedLossSeconds:0.8,estimatedGainSeconds:null,fasterExampleCount:1,confidence:'high',evidence:[{id:'e',metric:'sectionElapsed',unit:'s',lapValue:5,referenceValue:4.2,channelIds:[]}],observation:'A faster section was recorded.',action:'Compare exit profiles.',uncertainty:'Boundary states differ.',...extra});
const report=(extra:Partial<CoachReport>={}):CoachReport=>({analysisVersion:'v',sessionId:'s',referenceLapId:'best',bestLapId:'best',bestLapSeconds:26.585,theoreticalBestSeconds:26.385,theoreticalImprovementSeconds:0.2,validLapCount:2,excludedLaps:[],consistency:{medianSeconds:27,medianAbsoluteDeviationSeconds:0.1,rangeSeconds:0.2,sampleCount:2},sectionAssessments:[],segments:[],laps:[],opportunities:[finding(),finding({id:'likely',status:'likely',observedLossSeconds:null})],totalObservedOpportunitySeconds:0.8,opportunityLapId:'best',notes:[],...extra});
describe('finding priority',()=>{
 it('prioritizes evidence tiers, strongest priority and fastest lap only without mutation',()=>{
  const values=[finding({id:'investigate',status:'investigate',priorityScore:1000}),finding({id:'likely',status:'likely',priorityScore:100}),finding({id:'strong',priorityScore:20}),finding({id:'weak'}),finding({id:'wrong-lap',lapId:'other'})];
  expect(prioritizeFindings(report({opportunities:values})).map(f=>f.id)).toEqual(['strong','weak','likely','investigate']);expect(values[0].id).toBe('investigate');
 });
 it('respects validated model priorities across evidence tiers',()=>{
  const values=[finding({id:'strong',priorityScore:20}),finding({id:'weak',priorityScore:1}),finding({id:'investigate',status:'investigate',priorityScore:500})];
  const explanations=[{opportunityId:'investigate'},{opportunityId:'weak'}];
  expect(prioritizeFindings(report({opportunities:values}),explanations).map(f=>f.id)).toEqual(['investigate','weak','strong']);
 });

});

describe('compact debrief selection',()=>{
 it('shows at most three different experiments without padding duplicated recommendations',()=>{
  const values=[finding({id:'one',action:'Carry more speed through exit.'}),finding({id:'repeat',label:'Corner 2',action:'Carry more speed through exit.'}),finding({id:'two',sectionId:'two',kind:'measured-shift',action:'Try an earlier upshift.'}),finding({id:'three',sectionId:'three',kind:'trajectory',action:'Test a wider entry.'}),finding({id:'four',sectionId:'four',kind:'repeatability',action:'Compare lap repeatability.'})];
  expect(distinctFindings(values).map(f=>f.id)).toEqual(['one','two','three']);
  expect(distinctFindings(values.slice(0,2)).map(f=>f.id)).toEqual(['one']);
  expect(distinctFindings([finding({id:'a',kind:'exit-tradeoff'}),finding({id:'b',kind:'exit-tradeoff',sectionId:'other',action:'Different wording for exit experiment'})]).map(f=>f.id)).toEqual(['a']);
 });
});

it('keeps exactly the backend compatible selection while allowing model order within it',()=>{
 const values=[finding({id:'a'}),finding({id:'b',sectionId:'two',kind:'exit-tradeoff'}),finding({id:'outside',sectionId:'three',priorityScore:100})];
 const selected=prioritizeFindings(report({opportunities:values,primaryOpportunityIds:['a','b']}),[{opportunityId:'outside'},{opportunityId:'b'}]);
 expect(selected.map(f=>f.id)).toEqual(['b','a']);
});
