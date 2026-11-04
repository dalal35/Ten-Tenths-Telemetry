import type {Analysis,TrackSegment} from './types';
import {metricDifference} from './telemetry';
import './telemetry-inspector.css';
const value=(n:number|null,unit:string)=>n==null||!Number.isFinite(n)?'—':`${n.toFixed(1)} ${unit}`;
const toMph=(v:number|null)=>v==null||!Number.isFinite(v)?null:v*2.2369362921;
export default function Segments({analysis,selected,onSelect}:{analysis:Analysis;selected:string|null;onSelect:(segment:TrackSegment)=>void}){
  if(!analysis.segments?.length)return null;
  const largestLoss=analysis.segments.filter(s=>s.deltaSeconds!=null&&s.deltaSeconds>0).reduce<TrackSegment|null>((best,s)=>!best||s.deltaSeconds!>best.deltaSeconds!?s:best,null);
  return <section className="segment-section" aria-label="Track section comparison">
    {largestLoss&&<div className="section-finding"><span aria-hidden="true">↗</span><p><strong>{largestLoss.label} · largest section loss</strong><span>+{largestLoss.deltaSeconds!.toFixed(3)} s against reference · select to inspect</span></p></div>}
    <div className="section-heading">Section comparison <span>{analysis.segments.length} sections</span></div>
    <p className="segment-note">Δ primary − reference. Select a section for speed and channel evidence.</p>
    <div className="segment-list">{analysis.segments.map((segment,index)=><button key={segment.id} className={`segment-card ${selected===segment.id?'selected':''}`} onClick={()=>onSelect(segment)} aria-pressed={selected===segment.id} aria-label={`Compare ${segment.label}`} title={`Approximate boundary resolution ${segment.uncertaintyMeters.toFixed(0)} meters`}>
      <span className="segment-overview"><span className="segment-index">{String(index+1).padStart(2,'0')}</span><span className="segment-identity"><b>{segment.label}</b><small>{segment.startMeters.toFixed(0)}–{segment.endMeters.toFixed(0)} m</small></span><strong className="mono segment-delta">{segment.deltaSeconds==null?'—':`${segment.deltaSeconds>0?'+':''}${segment.deltaSeconds.toFixed(3)}`}<small>{segment.deltaSeconds==null?'':' s'}</small></strong><span className="segment-chevron" aria-hidden="true">›</span></span>
      {selected===segment.id&&<span className="segment-details"><span className="segment-evidence-heading">Speed · mph <small>Primary / reference</small></span><span className="segment-speeds">{(['entrySpeed','minSpeed','exitSpeed'] as const).map((key,i)=><span key={key}><small>{['Entry','Minimum','Exit'][i]}</small><span className="mono">{value(toMph(segment.primary[key]),'')}</span>{segment.comparison&&<em className="mono">{value(toMph(segment.comparison[key]),'')}</em>}</span>)}</span><span>Section time: {value(segment.primary.elapsed,'s')}{segment.comparison&&` / ${value(segment.comparison.elapsed,'s')}`}</span>{segment.primary.channels.map(channel=>{const comparison=segment.comparison?.channels.find(c=>c.channelId===channel.channelId);return <span key={channel.channelId}>{channel.name}: {value(channel.mean,channel.unit)}{comparison&&<> / {value(comparison.mean,channel.unit)} <span className="muted">(Δ {metricDifference(channel.mean,comparison.mean,channel.unit)})</span></>}</span>;})}<span className="muted">Approximate boundary resolution ~{segment.uncertaintyMeters.toFixed(0)} m; timing resolution ~{analysis.alignment.timingUncertaintyS?.toFixed(2)??'unknown'} s. Channel values are section means.</span></span>}
    </button>)}</div>
  </section>;
}
