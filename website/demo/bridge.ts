import type {Analysis,Axis,Session,LapView,TrackSegment,LibrarySnapshot,AdvancedStats,AdvancedResult} from '../../src/types';
import type {AdvancedConfig,Formula} from '../../src/advancedState';
import {CIRCUIT_LENGTH,positions,lapTimes,circuitPoint,sampleValue,sampleSessions} from './data';
import {interpolate} from '../../src/telemetry';
import {defaultAdvanced} from '../../src/advancedState';
import type {Workspace} from '../../src/workspace';
export const isNative=false;
export interface LocalVideoInfo {path:string;size:number;modifiedMs:number;status:'ready'|'missing'}
const version='synthetic-v1';
const sessions=new Map(sampleSessions.map(s=>[s.id,s]));
const boundaries=new Map<string,number[]>();
const workspaceFor=(s:Session)=>({contentVersion:version,primary:s.laps[3].id,comparison:s.laps[1].id,channels:['gps-speed','rpm','throttle','brake'],axis:'distance',layout:'compact',zoom:null,advanced:defaultAdvanced(),video:{version:1,sessionId:s.id,contentVersion:version,source:{type:'local',path:'/demo/synthetic-onboard',size:0,modifiedMs:0},segments:[{id:'demo-continuous',videoStart:0,videoEnd:s.laps.at(-1)!.end,anchorVideoTime:0,anchorTelemetryTime:0,anchorLapId:s.laps[0].id,correctionSeconds:0}],selectedSegmentId:'demo-continuous',preferences:{panelHeight:300,playbackRate:1,pausedVideoTime:s.laps[3].start}}});
const workspaces=new Map<string,unknown>();
const get=(id:string)=>{const s=sessions.get(id);if(!s)throw new Error('Sample session unavailable. Reload the demo to restore the library.');return s;};
const desktop=()=>{throw new Error('This browser demo uses bundled synthetic sessions. XRK import, file management and session merging run locally in the desktop app. No files are uploaded.');};
export const pickLocalVideo=async():Promise<LocalVideoInfo|null>=>desktop();
export const authorizeLocalVideo=async():Promise<LocalVideoInfo>=>desktop();
export const importPaths=async(_paths:string[]):Promise<Session[]>=>desktop();
export const importFiles=async():Promise<Session[]>=>desktop();
export const subscribeFileDrop=async(_callback:(paths:string[])=>void)=>()=>{};
export async function librarySnapshot():Promise<LibrarySnapshot>{return {entries:[...sessions.values()].map((s,i)=>({id:s.id,contentVersion:version,source:s.source,name:s.name,driver:s.driver,track:s.track,recordedAt:s.recordedAt,lapCount:s.laps.length,channelCount:s.channels.length,status:'ready',workspace:workspaces.get(s.id)??workspaceFor(s),lastUsed:1781440000000-i*1000})),activeSessionId:sampleSessions[0].id,warnings:[]};}
export const loadSession=async(id:string)=>get(id);
export const updateLibraryDetails=async(_id:string,_name:string,_driver:string,_recordedAt:string):Promise<import('../../src/types').LibraryEntry>=>desktop();
export const saveWorkspace=async(id:string,w:Workspace)=>{workspaces.set(id,w);};
export const removeSession=async(_id:string):Promise<LibrarySnapshot>=>desktop();
export const refreshSession=async(id:string)=>get(id);
export const locateSession=async(_id:string):Promise<Session|null>=>desktop();
export const previewMergeSessions=async(_ids:string[]):Promise<import('../../src/types').MergePreview>=>desktop();
export const mergeSessions=async(_ids:string[],_version:string,_acknowledge:boolean):Promise<Session>=>desktop();
export const unmergeSession=async(_id:string):Promise<LibrarySnapshot>=>desktop();
export const setCornerBoundaries=async(id:string,primary:string,values:number[]|null)=>{if(values)boundaries.set(`${id}/${primary}`,values);else boundaries.delete(`${id}/${primary}`);};
const sessionIndex=(s:Session)=>s.id.endsWith('-1')?1:0;
function valuesFor(s:Session,lap:number,id:string,formulas:Formula[],stack:string[]=[]):number[]{
 const channel=s.channels.find(c=>c.id===id);if(channel)return positions.map(p=>sampleValue(id,p,lap,sessionIndex(s)));
 const f=formulas.find(f=>f.id===id);if(!f)throw new Error(`Channel ${id} unavailable.`);if(stack.includes(id))throw new Error('Circular formula reference.');
 return calculateFormula(f.expression,s,lap,formulas,[...stack,id]);
}
/** A small parser, never eval: browser examples support arithmetic and documented math functions. */
function calculateFormula(expression:string,s:Session,lap:number,formulas:Formula[],stack:string[]):number[]{
 const tokens=expression.match(/\[[^\]]+\]|"[^"]*"|\d+(?:\.\d+)?(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[()+*/^,\-]/g)??[];
 if(tokens.join('').replace(/\s/g,'')!==expression.replace(/\s/g,''))throw new Error('Demo formulas support arithmetic, [channel-id], abs, sqrt, min, max, clamp, sin, cos, tan, log, exp, derivative and convert. Use the desktop app for unit constants and comparisons.');
 let at=0;const times=lapTimes(lap,sessionIndex(s));
 const scalar=(n:number)=>positions.map(()=>n);
 const parse=(minimum=0):number[]=>{let left:number[],token=tokens[at++];if(!token)throw new Error('Incomplete expression.');if(token==='-'||token==='+'){const v=parse(4);left=v.map(n=>token==='-'?-n:n);}else if(token==='('){left=parse();if(tokens[at++]!==')')throw new Error('Missing closing parenthesis.');}else if(token.startsWith('['))left=valuesFor(s,lap,token.slice(1,-1),formulas,stack);else if(/^\d/.test(token))left=scalar(Number(token));else{
  const name=token;if(tokens[at++]!=='(')throw new Error(`Unknown function ${name}.`);const args:number[][]=[];let unit='';if(tokens[at]!==')'){args.push(parse());while(tokens[at]===','){at++;if(tokens[at]?.startsWith('"'))unit=tokens[at++].slice(1,-1);else args.push(parse());}}if(tokens[at++]!==')')throw new Error('Missing closing parenthesis.');
  if(name==='derivative'&&args.length===1)left=args[0].map((v,i)=>i?(v-args[0][i-1])/(times[i]-times[i-1]):0);
  else if(name==='convert'&&args.length===1&&['mph','km/h','m/s'].includes(unit)){const sourceId=/\[([^\]]+)\]/.exec(expression)?.[1],source=s.channels.find(c=>c.id===sourceId)?.unit;if(source!=='km/h')throw new Error('Demo conversion supports recorded GPS speed (km/h).');const factor=unit==='mph'?.621371:unit==='m/s'?1/3.6:1;left=args[0].map(v=>v*factor);}
  else {const functions:Record<string,{arity:number;run:(...v:number[])=>number}>={abs:{arity:1,run:Math.abs},sqrt:{arity:1,run:Math.sqrt},min:{arity:2,run:Math.min},max:{arity:2,run:Math.max},clamp:{arity:3,run:(x,a,b)=>Math.max(a,Math.min(b,x))},sin:{arity:1,run:Math.sin},cos:{arity:1,run:Math.cos},tan:{arity:1,run:Math.tan},log:{arity:1,run:Math.log},exp:{arity:1,run:Math.exp}};const fn=functions[name];if(!fn||args.length!==fn.arity)throw new Error(`Unsupported function or argument count: ${name}.`);left=positions.map((_,i)=>fn.run(...args.map(a=>a[i])));}
 }
 while(at<tokens.length){const op=tokens[at],priority=op==='+'||op==='-'?1:op==='*'||op==='/'?2:op==='^'?3:0;if(priority<=minimum)break;at++;const right=parse(priority);left=left.map((v,i)=>op==='+'?v+right[i]:op==='-'?v-right[i]:op==='*'?v*right[i]:op==='/'?v/right[i]:v**right[i]);}return left;};
 const result=parse();if(at!==tokens.length)throw new Error('Unexpected formula token.');if(result.some(v=>!Number.isFinite(v)))throw new Error('Formula produces unsupported or non-finite values.');return result;
}
const formulaUnit=(f:Formula)=>/convert\(.*"mph"/.test(f.expression)?'mph':/convert\(.*"m\/s"/.test(f.expression)?'m/s':/derivative/.test(f.expression)?'rpm/s':'';
export async function validateFormulas(id:string,formulas:Formula[]){const s=get(id);return formulas.map(f=>{calculateFormula(f.expression,s,1,formulas,[f.id]);return {id:f.id,name:f.name,unit:formulaUnit(f)};});}
function lapView(s:Session,id:string,axis:Axis,channels:string[],formulas:Formula[]):LapView {
 const lap=s.laps.find(l=>l.id===id);if(!lap)throw new Error('Sample lap unavailable.');const times=lapTimes(lap.number,sessionIndex(s));const x=positions.map((p,i)=>axis==='distance'?p*CIRCUIT_LENGTH:times[i]);
 return {lapId:id,duration:lap.duration,length:CIRCUIT_LENGTH,mapping:positions.map((p,i)=>({meters:p*CIRCUIT_LENGTH,time:times[i]})),series:channels.map(id=>{const c=s.channels.find(c=>c.id===id),f=formulas.find(f=>f.id===id);return {channelId:id,name:c?.name??f?.name??id,unit:c?.unit??(f?formulaUnit(f):''),x,values:valuesFor(s,lap.number,id,formulas)};}),track:positions.map((p,i)=>({...circuitPoint(p),position:x[i],speed:sampleValue('gps-speed',p,lap.number,sessionIndex(s))/3.6})),warnings:[]};
}
export async function analyzeSession(id:string,primaryId:string,comparisonId:string|null,axis:Axis,channels:string[],formulas:Formula[]=[]):Promise<Analysis>{
 const s=get(id),primary=lapView(s,primaryId,axis,channels,formulas),comparison=comparisonId?lapView(s,comparisonId,axis,channels,formulas):null;
 if(axis==='time'&&comparison){const sharedTime=primary.mapping.map(p=>p.time);comparison.series=comparison.series.map(series=>({...series,x:sharedTime}));comparison.track=comparison.track.map((point,i)=>({...point,position:sharedTime[i]}));}
 const custom=boundaries.get(`${id}/${primaryId}`),cuts=[0,...(custom??[.09,.17,.25,.34,.42,.51,.58,.67,.75,.84,.89,.96].map(v=>v*CIRCUIT_LENGTH)),CIRCUIT_LENGTH];
 const at=(lap:LapView,m:number)=>interpolate(lap.mapping.map(v=>v.meters),lap.mapping.map(v=>v.time),m)??0;
 const metric=(lap:LapView,start:number,end:number)=>{const points=lap.track.filter(p=>p.position>=(axis==='distance'?start:at(primary,start))&&p.position<=(axis==='distance'?end:at(primary,end))),speeds=points.map(p=>(p.speed??0)*3.6);return {elapsed:at(lap,end)-at(lap,start),entrySpeed:(points[0]?.speed??0),exitSpeed:(points.at(-1)?.speed??0),minSpeed:Math.min(...speeds)/3.6,channels:lap.series.map(c=>{const v=c.values.filter((_,i)=>c.x[i]>=(axis==='distance'?start:at(primary,start))&&c.x[i]<=(axis==='distance'?end:at(primary,end)));return {channelId:c.channelId,name:c.name,unit:c.unit,mean:v.length?v.reduce((a,b)=>a+b,0)/v.length:null};})};};
 const segments:TrackSegment[]=cuts.slice(0,-1).map((start,i)=>{const end=cuts[i+1],a=metric(primary,start,end),b=comparison?metric(comparison,start,end):null;return {id:`section-${i}`,label:i%2?`Turn ${Math.ceil(i/2)}`:i===0?'Start / finish':`Straight ${i/2}`,kind:i%2?'corner':'straight',start:axis==='distance'?start:at(primary,start),end:axis==='distance'?end:at(primary,end),startMeters:start,endMeters:end,uncertaintyMeters:CIRCUIT_LENGTH/600,primary:a,comparison:b,deltaSeconds:b?a.elapsed!-b.elapsed!:null};});
 return {primary,comparison,segments,cornerBoundaries:custom??null,alignment:{method:'spatial',referenceLength:CIRCUIT_LENGTH,positionUncertaintyM:CIRCUIT_LENGTH/600,timingUncertaintyS:.14,coverage:1,notes:[]},delta:comparison?{x:primary.mapping.map(v=>axis==='distance'?v.meters:v.time),values:primary.mapping.map((v,i)=>v.time-comparison.mapping[i].time),method:'spatial',uncertaintySeconds:.14}:null,warnings:[]};
}
const stats=(v:number[],duration:number):AdvancedStats=>{const sorted=[...v].sort((a,b)=>a-b),q=(p:number)=>sorted[Math.floor((sorted.length-1)*p)]??null;return {count:v.length,duration,min:q(0),max:q(1),mean:v.length?v.reduce((a,b)=>a+b,0)/v.length:null,median:q(.5),p05:q(.05),p95:q(.95),absoluteP95:[...v].map(Math.abs).sort((a,b)=>a-b)[Math.floor((v.length-1)*.95)]??null};};
export async function analyzeAdvanced(id:string,primaryId:string,comparisonId:string|null,axis:Axis,c:AdvancedConfig,formulas:Formula[]):Promise<AdvancedResult>{
 const s=get(id),analysis=await analyzeSession(id,primaryId,comparisonId,axis,[],formulas),corner=analysis.segments.find(v=>v.id===c.cornerId),unit=(id:string|null)=>s.channels.find(v=>v.id===id)?.unit??(formulas.find(f=>f.id===id)?formulaUnit(formulas.find(f=>f.id===id)!):'');
 const xId=c.tool==='histogram'?c.histChannel:c.xChannel,yId=c.yChannel;
 const laps=[primaryId,...(comparisonId?[comparisonId]:[])].map(lapId=>{
 const lap=s.laps.find(l=>l.id===lapId)!,times=lapTimes(lap.number,sessionIndex(s));
 const values=(id:string|null)=>id?valuesFor(s,lap.number,id,formulas):positions.map(()=>0),xs=values(xId),ys=values(yId),colors=c.colorChannel?values(c.colorChannel):null,filter=c.valueFilter?values(c.valueFilter.channel):null;
 const accepted=positions.map((p,i)=>({i,position:axis==='distance'?p*CIRCUIT_LENGTH:analysis.primary.mapping[i].time})).filter(({i,position})=>(!c.range||position>=c.range[0]&&position<=c.range[1])&&(!corner||position>=corner.start&&position<=corner.end)&&(!filter||(!Number.isFinite(c.valueFilter?.min)||filter[i]>=c.valueFilter!.min!)&&(!Number.isFinite(c.valueFilter?.max)||filter[i]<=c.valueFilter!.max!)));
 const points=accepted.map(({i,position})=>({sourceTime:lap.start+times[i],position,x:xs[i]*(c.tool==='traction'?c.xSign:1)-(c.tool==='traction'?c.xOffset:0),y:ys[i]*(c.tool==='traction'?c.ySign:1)-(c.tool==='traction'?c.yOffset:0),color:colors?.[i]??null}));
 const supportedDuration=accepted.reduce((v,{i})=>v+(i?times[i]-times[i-1]:0),0),xStats=stats(points.map(p=>p.x),supportedDuration),yStats=stats(points.map(p=>p.y),supportedDuration);
 const min=xStats.min??0,max=xStats.max??1,width=c.binWidth??((max-min)/c.bins||1),count=Math.min(200,Math.max(1,Math.ceil((max-min)/width))),histogram=Array.from({length:count},(_,i)=>({low:min+i*width,high:min+(i+1)*width,value:0}));let total=0;
 for(const {i} of accepted){const bin=Math.min(count-1,Math.max(0,Math.floor((xs[i]-min)/width))),weight=c.weighting==='time'?(i?times[i]-times[i-1]:0):1;histogram[bin].value+=weight;total+=weight;}if(c.percentage&&total)histogram.forEach(bin=>bin.value=bin.value/total*100);
 const rpm=values('rpm'),gear=values('gear'),events:import('../../src/types').AdvancedEvent[]=[];
 if(c.tool==='shifts'||c.tool==='bog')for(const {i,position} of accepted){if(!i)continue;const shift=gear[i]>gear[i-1]&&rpm[i-1]-rpm[i]>250/c.sensitivity,bog=rpm[i]<c.bogThreshold&&rpm[i-1]>=c.bogThreshold;
 if(!(c.tool==='shifts'?shift:bog))continue;const eventId=`${lapId}-${c.tool}-${i}`,end=Math.min(times.length-1,i+Math.max(2,Math.round(c.minDuration/.14)));if(c.excludedIds.includes(eventId))continue;
 events.push({id:eventId,lapId,kind:c.tool==='shifts'?'Upshift':'Low-RPM recovery candidate',evidence:'Synthetic RPM and gear samples · illustrative detection',sourceTime:lap.start+times[i],endTime:lap.start+times[end],position,endPosition:axis==='distance'?positions[end]*CIRCUIT_LENGTH:analysis.primary.mapping[end].time,rpmBefore:rpm[i-1],rpmAfter:rpm[i],rpmChange:rpm[i]-rpm[i-1],minRpm:Math.min(...rpm.slice(i,end+1)),duration:times[end]-times[i],recoveryTime:times[end]-times[i],cornerId:analysis.segments.find(v=>position>=v.start&&position<v.end)?.id??null});}
 return {lapId,points,stats:xStats,yStats,histogram,events,excludedCount:c.excludedIds.filter(v=>v.startsWith(lapId)).length};});
 return {tool:c.tool,xUnit:unit(xId),yUnit:c.tool==='histogram'?(c.percentage?'%':c.weighting==='time'?'s':'samples'):unit(yId),laps,notes:['Browser demonstration computed from deterministic synthetic samples. Native XRK decoding and production analysis run in the desktop app.','Range, section and value filters apply to samples; histogram time weights use sample intervals. Event detection is illustrative.']};
}

// Keep the actual Coach UI usable without bundling a model, runtime, or remote API.
export const coachModelTerms=async():Promise<null>=>null;
export const coachStatus=async()=>({jobId:null,phase:'Synthetic preview'});
export const cancelCoach=async(_jobId:string)=>{};
export async function analyzeCoach(id:string,_reference:string|null,_jobId:string,_regenerate=false,_accepted=false){
 const session=get(id),ordered=[...session.laps].sort((a,b)=>a.duration-b.duration),best=ordered[0],reference=ordered[1];
 const analysis=await analyzeSession(id,best.id,reference.id,'distance',['gps-speed','rpm','throttle','brake']);
 const evidence=(section:TrackSegment)=>[{id:`${section.id}-elapsed`,metric:'sectionTime',unit:'s',lapValue:section.primary.elapsed??0,referenceValue:section.comparison?.elapsed??null,channelIds:['gps-speed']},{id:`${section.id}-minimum`,metric:'minimumSpeed',unit:'m/s',lapValue:section.primary.minSpeed??0,referenceValue:section.comparison?.minSpeed??null,channelIds:['gps-speed']}];
 const at=(meters:number)=>(interpolate(analysis.primary.mapping.map(p=>p.meters),analysis.primary.mapping.map(p=>p.time),meters)??0)+best.start;
 const sections=analysis.segments,opportunities=sections.filter(s=>(s.deltaSeconds??0)>0).sort((a,b)=>b.deltaSeconds!-a.deltaSeconds!).slice(0,3).map((s,i)=>({id:`synthetic-${s.id}`,status:'suspected' as const,priorityScore:3-i,lapId:best.id,referenceLapId:reference.id,sectionId:s.id,label:`Review ${s.label.toLowerCase()}`,kind:s.kind,startTime:at(s.startMeters),endTime:at(s.endMeters),startMeters:s.startMeters,endMeters:s.endMeters,observedLossSeconds:null,estimatedGainSeconds:null,fasterExampleCount:1,confidence:'illustrative',evidence:evidence(s),observation:`The synthetic primary lap spends ${s.deltaSeconds!.toFixed(3)} s more in this section than the supporting sample lap. These generated traces demonstrate the evidence workflow.`,action:'Select Inspect telemetry to compare the speed trace, braking point and corner exit in this sample section.',uncertainty:'Illustrative synthetic samples, not driving advice. Sample differences below the ~0.14 s timing resolution are not meaningful measured gains.'}));
 const middle=(values:number[])=>values.length%2?values[Math.floor(values.length/2)]:(values[values.length/2-1]+values[values.length/2])/2;
 const durations=ordered.map(l=>l.duration),median=middle(durations),deviations=durations.map(d=>Math.abs(d-median)).sort((a,b)=>a-b);
 return {mode:'deterministic',modelVersion:'Synthetic UI preview · no AI model running',notice:'Synthetic demonstration only. Coaching findings show the desktop evidence workflow using generated samples. Local AI model explanations and analysis of your recordings require the desktop app.',cached:false,elapsedMs:0,explanations:[],report:{analysisVersion:'synthetic-preview',sessionId:id,referenceLapId:reference.id,bestLapId:best.id,bestLapSeconds:best.duration,theoreticalBestSeconds:null,theoreticalImprovementSeconds:null,validLapCount:ordered.length,excludedLaps:[],consistency:{medianSeconds:median,medianAbsoluteDeviationSeconds:middle(deviations),rangeSeconds:durations.at(-1)!-durations[0],sampleCount:durations.length},sectionAssessments:sections.map(s=>({sectionId:s.id,label:s.label,kind:s.kind,startTime:at(s.startMeters),endTime:at(s.endMeters),startMeters:s.startMeters,endMeters:s.endMeters,evidence:evidence(s),notes:['Generated samples illustrate section evidence. No real driver performance is assessed.']})),segments:[],laps:ordered.map(l=>({lapId:l.id,durationSeconds:l.duration,spatialComparison:true,coverage:1,timingResolutionSeconds:.14,totalObservedLossSeconds:null,notes:['Synthetic sample lap']})),opportunities,totalObservedOpportunitySeconds:null,opportunityLapId:null,notes:['Synthetic browser preview. Desktop coaching evaluates your recordings locally; no model is loaded or called here.']}};
}
