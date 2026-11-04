import type {Axis,Channel,Lap,LapView,Session} from '../types';
import {sessionTimeToCursor} from '../video/model';
export interface EvidenceInterval {lapId:string;startTime:number;endTime:number}
export interface CoachInspection extends EvidenceInterval {referenceLapId:string;channelIds?:string[]}
export function inspectionChannels(selected:string[],channels:Pick<Channel,'id'|'name'>[]):string[]{
 const speed=channels.find(c=>c.id==='gps-speed')??channels.find(c=>/speed/i.test(c.name)&&!/rpm|engine|revs/i.test(c.name));
 const rpm=channels.find(c=>/rpm|engine.*(speed|revs)/i.test(c.name));
 return [...new Set([...selected,...(speed?[speed.id]:[]),...(rpm?[rpm.id]:[])])];
}
export function inspectionLapChannels(selected:string[],session:Session,lapId:string):string[]{
 if(!session.merge)return inspectionChannels(selected,session.channels);
 const sourceId=session.merge.preview.laps.find(lap=>lap.id===lapId)?.sourceSessionId;
 // Select source-qualified channels; names alone may match another recording.
 return inspectionChannels(selected,sourceId?session.merge.preview.channels.filter(channel=>channel.sourceSessionId===sourceId):[]);
}
export function inspectionRange(interval:EvidenceInterval,lap:Lap,view:LapView,axis:Axis){
 if(interval.lapId!==lap.id||view.lapId!==lap.id||!Number.isFinite(interval.startTime)||!Number.isFinite(interval.endTime)||interval.startTime<lap.start||interval.endTime>lap.end||interval.endTime<interval.startTime)return null;
 const start=sessionTimeToCursor(interval.startTime,lap,view,axis),end=sessionTimeToCursor(interval.endTime,lap,view,axis);
 if(start==null||end==null||end<start)return null;
 const limit=axis==='time'?lap.duration:view.mapping.at(-1)?.meters;
 if(limit==null)return null;
 const padding=axis==='time'?2:20;
 return {min:Math.max(0,start-padding),max:Math.min(limit,end+padding),cursor:(start+end)/2};
}
