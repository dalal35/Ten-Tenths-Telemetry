import type {Opportunity} from './types';
import {rangeSeconds,supportedRange,supportedModel} from './presentation';
export default function TimePotential({finding}:{finding:Opportunity}){
 const range=supportedRange(finding),model=supportedModel(finding);
 if(range)return <div className="coach-time-potential"><strong className="mono">{rangeSeconds(range)} s</strong><small>{range.basis==='demonstrated'?'Demonstrated opportunity':'Simulated'} · estimated lap-time gain</small></div>;
 if(model)return <div className="coach-time-potential"><strong>Scenario estimate: <span className="mono">{rangeSeconds(model)} s</span></strong><small>Hypothetical · estimated lap-time gain</small></div>;
 return <div className="coach-time-potential"><strong>Gain not yet quantifiable</strong><small>No supported time range in this recording.</small></div>;
}
