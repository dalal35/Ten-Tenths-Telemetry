import type {Analysis,Axis,Session,Series} from './types';
import {fastestLap} from './telemetry';
import {restoreAdvanced} from './advancedState';
import type {AdvancedState} from './advancedState';
import {restoreVideoState,serializeVideoState} from './video/state';
import {speedFactor,displaySpeedUnit} from './speedDisplay';
export interface Zoom {primary:string;comparison:string|null;axis:Axis;min:number;max:number}
export interface Workspace {contentVersion:string;primary:string;comparison:string|null;channels:string[];axis:Axis;layout:'comfortable'|'compact';zoom:Zoom|null;advanced?:AdvancedState;video?:ReturnType<typeof restoreVideoState>;sourceVideos?:Record<string,ReturnType<typeof restoreVideoState>>;coach?:{referenceId:string|null};view?:'telemetry'|'advanced'|'video'|'coach'}
export function restoreWorkspace(s:Session,saved:unknown,contentVersion=''):Workspace {
  const candidate=(saved&&typeof saved==='object'?saved:{}) as Partial<Workspace>;
  const w=contentVersion&&candidate.contentVersion!==contentVersion?{}:candidate;
  const primary=s.laps.some(l=>l.id===w.primary)?w.primary!:fastestLap(s.laps)?.id??s.laps[0]?.id??'';
  const defaults=[s.channels.find(c=>/gps.*speed/i.test(c.name))??s.channels.find(c=>/speed/i.test(c.name)&&!/engine/i.test(c.name)),s.channels.find(c=>/rpm|engine.*(speed|revs)/i.test(c.name))].filter(Boolean).map(c=>c!.id);
  const video=restoreVideoState(candidate.video,s,contentVersion);
  if(contentVersion&&candidate.contentVersion!==contentVersion&&candidate.video!==undefined){video.state=null;delete video.futureRaw;if(!video.warnings.length)video.warnings.push('Video mappings were cleared because the telemetry content version changed.');}
  const sourceVideos=s.merge?Object.fromEntries(s.merge.sources.map(source=>[source.sessionId,restoreVideoState((w.sourceVideos as Record<string,unknown>|undefined)?.[source.sessionId],source.session,source.contentVersion)])):undefined;
  const activeSource=s.merge?.preview.laps.find(l=>l.id===primary)?.sourceSessionId;
  const activeVideo=activeSource?sourceVideos?.[activeSource]:video;
  const restoredAdvanced=restoreAdvanced(w.advanced);restoredAdvanced.config.axis=w.axis==='time'?'time':'distance';
  const channels=Array.isArray(w.channels)?[...new Set(w.channels)].filter(id=>s.channels.some(c=>c.id===id)||restoredAdvanced.formulas.some(f=>f.id===id)):defaults.length?defaults:s.channels.slice(0,2).map(c=>c.id);
  return {contentVersion,primary,comparison:w.comparison!==primary&&s.laps.some(l=>l.id===w.comparison)?w.comparison!:null,channels,axis:w.axis==='time'?'time':'distance',layout:w.layout==='compact'?'compact':'comfortable',zoom:w.zoom??null,advanced:restoredAdvanced,coach:{referenceId:s.laps.some(l=>l.id===w.coach?.referenceId&&l.complete)?w.coach!.referenceId:null},...(s.merge?{sourceVideos}:candidate.video===undefined?{}:{video}),view:w.view==='coach'?'coach':w.view==='advanced'?'advanced':w.view==='video'&&(s.merge||activeVideo?.state)?'video':'telemetry'};
}
export function serializeWorkspace(w:Workspace):Record<string,unknown> {
  const {video,sourceVideos,...rest}=w;
  const saved={...rest,advanced:w.advanced?.readOnly?w.advanced.raw:w.advanced,...(video===undefined?{}:{video:serializeVideoState(video)}),...(sourceVideos===undefined?{}:{sourceVideos:Object.fromEntries(Object.entries(sourceVideos).map(([id,value])=>[id,serializeVideoState(value)]))})};
  if(new TextEncoder().encode(JSON.stringify(saved)).length>65536)throw new Error('Workspace exceeds the 64 KiB local storage limit. Remove video mappings or advanced preferences before saving.');
  return saved;
}
export function compatibleZoom(w:Workspace):{min:number;max:number}|null {const z=w.zoom;return z&&z.primary===w.primary&&z.comparison===w.comparison&&z.axis===w.axis&&Number.isFinite(z.min)&&Number.isFinite(z.max)&&z.min>=0&&z.max>z.min?{min:z.min,max:z.max}:null;}
export function moveBoundary(boundaries:number[],index:number,meters:number,length:number):number[]{return boundaries.map((v,i)=>i===index?Math.max((boundaries[i-1]??0)+2,Math.min((boundaries[i+1]??length)-2,meters)):v);}
export function displayAnalysis(a:Analysis):Analysis {
  const series=(s:Series):Series=>{const factor=speedFactor(s.unit);return displaySpeedUnit(s.unit)==='mph'?{...s,unit:'mph',values:factor===1?s.values:s.values.map(v=>v*factor)}:s;};
  return {...a,primary:{...a.primary,series:a.primary.series.map(series)},comparison:a.comparison?{...a.comparison,series:a.comparison.series.map(series)}:null,segments:a.segments.map(s=>({...s,primary:{...s.primary,channels:s.primary.channels.map(c=>{const converted=series({...c,x:[],values:c.mean==null?[]:[c.mean]});return {...c,unit:converted.unit,mean:c.mean==null?null:converted.values[0]};})},comparison:s.comparison?{...s.comparison,channels:s.comparison.channels.map(c=>{const converted=series({...c,x:[],values:c.mean==null?[]:[c.mean]});return {...c,unit:converted.unit,mean:c.mean==null?null:converted.values[0]};})}:null}))};
}
