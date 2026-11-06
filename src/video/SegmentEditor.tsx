import {useEffect, useState} from 'react';
import type {Lap} from '../types';
import {validateSegments} from './model';
import type {VideoSegment} from './model';

export interface SegmentEditorProps {
  segments: VideoSegment[];
  laps: Lap[];
  duration: number | null;
  selectedSegmentId: string | null;
  onSelect: (id: string) => void;
  onChange: (segments: VideoSegment[]) => void;
}

export function SegmentEditor({segments,laps,duration,selectedSegmentId,onSelect,onChange}:SegmentEditorProps) {
  const selected=segments.find(segment=>segment.id===selectedSegmentId);
  const [draft,setDraft]=useState<Record<string,string>>({});
  const [error,setError]=useState('');
  useEffect(()=>{
    setError('');
    setDraft(selected?Object.fromEntries(['videoStart','videoEnd','anchorVideoTime','anchorTelemetryTime','correctionSeconds'].map(key=>[key,String(selected[key as keyof VideoSegment])])):{});
  },[selected]);
  const apply=(next:VideoSegment[])=>{
    const errors=validateSegments(next,laps,duration??undefined);
    if(errors.length){setError(errors.join(' '));return;}
    setError('');onChange(next);
  };
  const numberField=(key:string,label:string)=><label>{label}<input type="number" step="any" value={draft[key]??''} onChange={event=>setDraft({...draft,[key]:event.target.value})}/></label>;
  return <section className="video-segment-editor" aria-label="Edited footage segments">
    <div className="video-step-label"><b>02</b> Refine the mapping</div>
    <p className="video-refine-help">Adjust the sync to keep video aligned with telemetry.</p>
    <div className="video-actions video-nudge-actions">
      <button type="button" aria-label="Nudge −0.10 s correction" disabled={!selected} onClick={()=>selected&&apply(segments.map(segment=>segment.id===selected.id?{...segment,correctionSeconds:Number((segment.correctionSeconds-.1).toFixed(6))}:segment))}><span aria-hidden="true">←</span> <span className="video-nudge-word">Nudge </span>−0.10 s</button>
      <button type="button" aria-label="Nudge +0.10 s correction" disabled={!selected} onClick={()=>selected&&apply(segments.map(segment=>segment.id===selected.id?{...segment,correctionSeconds:Number((segment.correctionSeconds+.1).toFixed(6))}:segment))}><span aria-hidden="true">→</span> <span className="video-nudge-word">Nudge </span>+0.10 s</button>
    </div>
    <div className="video-section-title"><h3>Segments</h3><small>Each cut has its own alignment</small></div>
    <div className="video-segment-tabs" aria-label="Select segment">
      {segments.map((segment,index)=><button key={segment.id} aria-pressed={segment.id===selectedSegmentId} onClick={()=>onSelect(segment.id)}>Segment {index+1} <span className="mono">{segment.videoStart.toFixed(1)}–{segment.videoEnd.toFixed(1)}s</span></button>)}
      {!segments.length&&<p className="video-note">Pause on a start/finish crossing and use Sync Here to create the first segment.</p>}
    </div>
    {selected&&<>
      <div className="video-offset-readout"><span>Telemetry − video offset</span><strong className="mono">{(selected.anchorTelemetryTime-selected.anchorVideoTime+selected.correctionSeconds)>=0?'+':''}{(selected.anchorTelemetryTime-selected.anchorVideoTime+selected.correctionSeconds).toFixed(3)}<small> s</small></strong><span>Includes {selected.correctionSeconds>=0?'+':''}{selected.correctionSeconds.toFixed(3)}s correction</span></div>
      <form onSubmit={event=>{event.preventDefault();if(Object.values(draft).some(value=>!value.trim())){setError('Enter a finite value for every segment field.');return;}
        const changes=Object.fromEntries(Object.entries(draft).map(([key,value])=>[key,Number(value)]));
        const anchorLapId=laps.find(lap=>lap.start===changes.anchorTelemetryTime)?.id;
        apply(segments.map(segment=>segment.id===selected.id?{...segment,...changes,anchorLapId}:segment));}}>
        <div className="video-segment-fields">
          {numberField('videoStart','Segment start (s)')}{numberField('videoEnd','Segment end (s)')}{numberField('anchorVideoTime','Video anchor (s)')}
          <label>Segment anchor lap<select value={laps.find(lap=>lap.start===Number(draft.anchorTelemetryTime))?.id??''} onChange={event=>{const lap=laps.find(lap=>lap.id===event.target.value);if(lap)setDraft({...draft,anchorTelemetryTime:String(lap.start)});}}><option value="">Explicit timestamp</option>{laps.map(lap=><option key={lap.id} value={lap.id}>Lap {lap.number} · {lap.start.toFixed(2)}s</option>)}</select></label>
          {numberField('anchorTelemetryTime','Telemetry anchor (s)')}{numberField('correctionSeconds','Correction (s)')}
        </div>
        <p className="video-note">Positive correction maps this frame to a later telemetry time. Trim an existing segment before adding a cut; the anchor must stay inside its bounds.</p>
        <div className="video-actions"><button type="submit" className="video-primary">Apply segment edits</button>
          <button type="button" className="video-remove" onClick={()=>apply(segments.filter(segment=>segment.id!==selected.id))}>Remove selected segment</button>
        </div>
      </form>
      {error&&<p role="alert" className="video-error">{error}</p>}
    </>}
  </section>;
}
