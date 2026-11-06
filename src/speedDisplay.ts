import type {AdvancedResult,AdvancedStats} from './types';

export function speedFactor(unit:string):number {
 switch(unit.trim().toLowerCase()) {
  case 'km/h': case 'kph': case 'kmh': return 0.6213711922;
  case 'm/s': case 'mps': return 2.2369362921;
  default: return 1;
 }
}
export function displaySpeedUnit(unit:string):string {
 return speedFactor(unit)!==1||unit.trim().toLowerCase()==='mph'?'mph':unit;
}
const displayStats=(stats:AdvancedStats,factor:number):AdvancedStats=>({...stats,...Object.fromEntries(
 (['min','max','mean','median','p05','p95','absoluteP95'] as const).map(key=>[key,stats[key]==null?null:stats[key]*factor])
)});
// Only presentation copies change; filters, formulas and analysis stay in source units.
export function displayAdvancedResult(result:AdvancedResult):AdvancedResult {
 const x=speedFactor(result.xUnit),y=speedFactor(result.yUnit);
 return {...result,xUnit:displaySpeedUnit(result.xUnit),yUnit:displaySpeedUnit(result.yUnit),laps:result.laps.map(lap=>({...lap,
  points:lap.points.map(point=>({...point,x:point.x*x,y:point.y*y})),
  stats:displayStats(lap.stats,x),yStats:lap.yStats?displayStats(lap.yStats,y):undefined,
  histogram:lap.histogram.map(bin=>({...bin,low:bin.low*x,high:bin.high*x})),
 }))};
}

/** Shows speeds written in m/s inside generated coaching text in the app's display unit. Calculations keep original units. */
export function displaySpeedText(text:string){
 return text.replace(/(-?\d+(?:\.\d+)?)\s*m\/s(?![²\w^])/g,(_,value:string)=>`${(Number(value)*speedFactor('m/s')).toFixed(1)} ${displaySpeedUnit('m/s')}`);
}
