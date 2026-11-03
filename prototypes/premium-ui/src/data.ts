// Safe, deterministic sample generators already shipped in the browser demo.
// These values are representative, never a recorded or validated XRK session.
import {CIRCUIT_LENGTH,positions,lapTimes,sampleValue,circuitPoint} from '../../../website/demo/data';
export const length=CIRCUIT_LENGTH;
export const laps=[2,3,4,5,6].map(number=>({number,time:lapTimes(number).at(-1)!}));
export const formatTime=(seconds:number)=>`${Math.floor(seconds/60)}:${(seconds%60).toFixed(3).padStart(6,'0')}`;
export const signed=(value:number,digits=3)=>`${value>=0?'+':'−'}${Math.abs(value).toFixed(digits)}`;
export const channels=['speed','rpm','delta'] as const;
export type Channel=typeof channels[number];
export const chartScales={speed:{min:60,max:220,ticks:[220,140,60]},rpm:{min:4000,max:9000,ticks:[9000,6500,4000]},delta:{min:-1.5,max:1.5,ticks:[1.5,0,-1.5]}};
export const corners=[{name:'Turn 1',start:.08,end:.17},{name:'Turn 2',start:.25,end:.34},{name:'Turn 3',start:.42,end:.51},{name:'Turn 4',start:.58,end:.67},{name:'Turn 5',start:.75,end:.84},{name:'Turn 6',start:.88,end:.97}];
export const samples=positions.map(p=>({p,...circuitPoint(p)}));
export function valueAt(channel:Channel,p:number,lap:number,reference=6){
 const index=Math.round(p*(positions.length-1));
 if(channel==='delta')return lapTimes(lap)[index]-lapTimes(reference)[index];
 return sampleValue(channel==='speed'?'gps-speed':'rpm',p,lap);
}
// Precompute all traces once. Pointer movement never regenerates a lap.
export const traces=new Map(laps.map(lap=>[lap.number,{times:lapTimes(lap.number),speed:positions.map(p=>sampleValue('gps-speed',p,lap.number)),rpm:positions.map(p=>sampleValue('rpm',p,lap.number))}]));
export function read(channel:Channel,p:number,lap:number,reference=6){
 const index=Math.min(positions.length-1,Math.max(0,Math.round(p*(positions.length-1)))),data=traces.get(lap)!;
 return channel==='delta'?data.times[index]-traces.get(reference)!.times[index]:data[channel][index];
}
export function sectionDelta(index:number,lap:number,reference:number){const c=corners[index];return read('delta',c.end,lap,reference)-read('delta',c.start,lap,reference);}
export function pathFor(channel:Channel,lap:number,reference:number,start=0,end=1,width=1000,height=120){
 const {min,max}=chartScales[channel],bounds=[min,max];
 return positions.filter(p=>p>=start&&p<=end).map((p,i)=>`${i?'L':'M'}${(48+(p-start)/(end-start)*(width-64)).toFixed(2)},${(8+(1-(read(channel,p,lap,reference)-bounds[0])/(bounds[1]-bounds[0]))*(height-31)).toFixed(2)}`).join(' ');
}
export const trackPath=samples.map((p,i)=>`${i?'L':'M'}${(p.x*.28+225).toFixed(2)},${(p.y*.28+173).toFixed(2)}`).join(' ')+' Z';
export function trackPosition(p:number){const point=circuitPoint(p);return {x:point.x*.28+225,y:point.y*.28+173};}
