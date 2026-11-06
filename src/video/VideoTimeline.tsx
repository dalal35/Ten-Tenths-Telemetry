import {useMemo} from 'react';
import type {lapMarkers, VideoSegment} from './model';

export interface VideoTimelineProps {
  segments: VideoSegment[];
  markers: ReturnType<typeof lapMarkers>;
  duration: number | null;
  time: number;
  onSeekVideo: (time: number) => void;
}

const formatTime = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

export function VideoTimeline({segments, markers, duration, time, onSeekVideo}: VideoTimelineProps) {
  const known = duration !== null && Number.isFinite(duration) && duration > 0;
  const end = known ? duration : 1;
  const current = Number.isFinite(time) ? Math.min(end, Math.max(0, time)) : 0;
  const lane = useMemo(() => {
    if (!known) return {segments: [], markers: [], ticks: []};
    return {
      segments: segments.flatMap((segment, index) => {
        const start = Math.max(0, Math.min(end, segment.videoStart));
        const finish = Math.max(0, Math.min(end, segment.videoEnd));
        return Number.isFinite(start) && Number.isFinite(finish) && finish > start
          ? [{id: segment.id, number: index + 1, left: 100 * start / end, width: 100 * (finish - start) / end}]
          : [];
      }),
      markers: markers.filter(marker => Number.isFinite(marker.videoTime) && marker.videoTime >= 0 && marker.videoTime <= end),
      ticks: [0, .25, .5, .75, 1].map(fraction => ({fraction, label: formatTime(end * fraction)})),
    };
  }, [known, end, segments, markers]);

  return <div className="video-timeline">
    <div className="video-timeline-heading">
      <div><span>Footage timeline</span><small>Lap crossings predicted from telemetry</small></div>
      <span className="video-timeline-time mono">{formatTime(known?current:Number.isFinite(time)?time:0)} <span>/ {known ? formatTime(end) : '—'}</span></span>
    </div>
    {known ? <div className="video-timeline-ruler" aria-hidden="true">
      {lane.ticks.map(tick => <span key={tick.fraction}>{tick.label}</span>)}
    </div> : <div className="video-timeline-unknown">Timeline available when footage duration is known.</div>}
    <div className="video-timeline-rail" aria-hidden="true">
      {lane.segments.map(segment => <span key={segment.id} className="video-timeline-segment" style={{left:`${segment.left}%`,width:`${segment.width}%`}}>{segment.number}</span>)}
      {lane.markers.map(marker => <span key={`${marker.segmentId}:${marker.lapId}`} className="video-timeline-marker" style={{left:`${100 * marker.videoTime / end}%`}} />)}
      {known && <span className="video-playhead" style={{left:`${100 * current / end}%`}} />}
    </div>
    <input type="range" aria-label="Video timeline" min={0} max={end} step={.1} value={current} disabled={!known} onChange={event=>onSeekVideo(Number(event.target.value))}/>
    <div className="video-marker-list">
      {markers.map(marker=><button key={`${marker.segmentId}:${marker.lapId}`} data-marker-segment={marker.segmentId} data-video-time={marker.videoTime}
        aria-label={`Predicted lap ${marker.lapNumber} crossing at ${marker.videoTime.toFixed(2)} seconds`} onClick={()=>onSeekVideo(marker.videoTime)}>
        <span className="dot cyan"/> Lap {marker.lapNumber} <span className="mono">{marker.videoTime.toFixed(2)}s</span>
      </button>)}
      {!markers.length&&<small>No predicted lap crossings in mapped footage.</small>}
    </div>
  </div>;
}
