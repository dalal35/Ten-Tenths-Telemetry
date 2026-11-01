import type {CoachReport,Opportunity} from './types';
import {supportedGain} from './presentation';

const tier=(finding:Opportunity)=>supportedGain(finding)?0:finding.status==='likely'?1:2;
type ExplanationOrder=readonly {opportunityId:string}[];
export function prioritizeFindings(report:CoachReport,explanations:ExplanationOrder=[]):Opportunity[]{
 const modelRank=(finding:Opportunity)=>{const index=explanations.findIndex(e=>e.opportunityId===finding.id);return index<0?explanations.length:index;};
 return report.opportunities.filter(f=>f.lapId===report.bestLapId&&(report.primaryOpportunityIds==null||report.primaryOpportunityIds.includes(f.id))).slice().sort((a,b)=>modelRank(a)-modelRank(b)||(report.primaryOpportunityIds?report.primaryOpportunityIds.indexOf(a.id)-report.primaryOpportunityIds.indexOf(b.id):0)||tier(a)-tier(b)||(Number.isFinite(b.priorityScore)?b.priorityScore:0)-(Number.isFinite(a.priorityScore)?a.priorityScore:0)||a.id.localeCompare(b.id));
}
/** Keep experiments distinct; repeated corner templates do not earn extra cards. */
export function distinctFindings(findings:Opportunity[],explanations:readonly {opportunityId:string;action:string}[]=[]):Opportunity[]{
 const seen=new Set<string>(),sections=new Set<string>(),mechanisms=new Set<string>();
 return findings.filter(f=>{
  const action=explanations.find(e=>e.opportunityId===f.id)?.action||f.action;
  const key=action.toLowerCase().replace(/(?:corner|turn|straight|section)\s*\d+/g,'section').replace(/[^a-z]+/g,' ').trim();
  const mechanism=!['corner','straight'].includes(f.kind)?f.kind:null;
  if(seen.has(key)||(f.sectionId!=null&&sections.has(f.sectionId))||(mechanism!=null&&mechanisms.has(mechanism)))return false;
  seen.add(key);if(f.sectionId!=null)sections.add(f.sectionId);if(mechanism!=null)mechanisms.add(mechanism);return true;
 }).slice(0,3);
}
