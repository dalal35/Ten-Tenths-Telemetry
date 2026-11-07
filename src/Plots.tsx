import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import './plots.css';
import type { Workspace } from './workspace';
import type { Analysis, Axis, Series, TrackSegment, AdvancedEvent } from './types';
import { interpolate, mergeSeries } from './telemetry';
const noEvents:AdvancedEvent[]=[];
const rpmReadout=new Intl.NumberFormat('en-US',{maximumFractionDigits:0});
// Include 4× decades for the reference's readable distance-axis rhythm.
const referenceIncrements=Array.from({length:20},(_,i)=>[1,2,4,5].map(n=>n*10**(i-8))).flat();
// uPlot's own numeric increments, which the time axis keeps in the reference layout.
const defaultIncrements=Array.from({length:20},(_,i)=>[1,2,2.5,5].map(n=>n*10**(i-8))).flat();
type Row={id:string;name:string;unit:string;primary:Series;comparison?:Series;primaryUnavailable?:boolean};
function updateReadout(element:HTMLElement|undefined,row:Row|undefined,position:number|null){
  if(!element||!row)return;
  const format=(series:Series|undefined)=>{
    const value=position==null||!series?null:interpolate(series.x,series.values,position,series.gaps);
    if(value==null||!Number.isFinite(value))return '—';
    if(row.id==='__delta')return `${value>0?'+':''}${value.toFixed(3)}`;
    return row.unit.toLowerCase()==='rpm'&&element.closest('.premium [data-workspace=telemetry]')?rpmReadout.format(value):value.toFixed(row.unit.toLowerCase()==='rpm'?0:1);
  };
  const primary=element.querySelector<HTMLElement>('[data-primary-value]');
  const comparison=element.querySelector<HTMLElement>('[data-comparison-value]');
  if(primary)primary.textContent=format(row.primary);
  if(comparison)comparison.textContent=format(row.comparison);
  if(row.id==='__delta'){
    const value=position==null?null:interpolate(row.primary.x,row.primary.values,position,row.primary.gaps);
    const direction=element.querySelector<HTMLElement>('[data-delta-direction]');
    const reading=element.querySelector<HTMLElement>('.primary-reading');
    const state=value==null||!Number.isFinite(value)?'unavailable':value<0?'ahead':value>0?'behind':'even';
    if(reading)reading.dataset.delta=state;
    if(direction)direction.textContent=state==='unavailable'?'':state==='ahead'?'Ahead':state==='behind'?'Behind':'Even';
  }
}
// Keep callback captures outside the render scope retained by disposed uPlot instances.
function callbackEffect<T>(ref:{current:T|undefined},value:T|undefined){
  return()=>{ref.current=value;return()=>{ref.current=undefined;};};
}
function plotRows(analysis:Analysis):Row[]{
  const rows:Row[]=Array.from(new Map([...analysis.primary.series,...(analysis.comparison?.series??[])].map(s=>[s.channelId,s])).values()).map(s=>{const primary=analysis.primary.series.find(p=>p.channelId===s.channelId);return {id:s.channelId,name:s.name,unit:s.unit,primary:primary??{...s,x:[],values:[],gaps:[]},primaryUnavailable:!primary,comparison:analysis.comparison?.series.find(c=>c.channelId===s.channelId)};});
  if(analysis.delta)rows.push({id:'__delta',name:analysis.delta.method==='spatial'?'Spatial time delta':'Estimated time delta',unit:'s',primary:{channelId:'__delta',name:analysis.delta.method==='spatial'?'Spatial time delta':'Estimated time delta',unit:'s',...analysis.delta}});
  return rows;
}
const rowSeries=(row:Row)=>[row.primary,...(row.comparison?[row.comparison]:[])];
// All charts share one x range, so a position lines up across every row.
function sharedRange(rows:Row[]):{min:number;max:number}|null{
  const xs=rows.flatMap(row=>rowSeries(row).flatMap(s=>s.x.length?[s.x[0],s.x[s.x.length-1]]:[])).filter(Number.isFinite);
  if(!xs.length)return null;
  const min=Math.min(...xs),max=Math.max(...xs);
  return max>min?{min,max}:null;
}
const axisDescription=(analysis:Analysis,axis:Axis,pending:boolean)=>pending?(axis==='distance'?'Distance · meters':'Time · seconds'):axis==='distance'?analysis.alignment?.method==='spatial'?'Reference track position · meters':'Distance into lap · meters':analysis.alignment?.method==='spatial'?'Primary lap time at aligned position · seconds':'Time into lap · seconds';
export default function Plots({analysis,axis,onCursor,resetVersion,cursor=null,events=noEvents,focus=null,layout='comfortable',initialZoom=null,onZoom,onSeek,visibleChannels,active=true,pending=null}:{visibleChannels?:string[];active?:boolean;analysis:Analysis;axis:Axis;onCursor:(x:number|null)=>void;resetVersion:number;cursor?:number|null;events?:AdvancedEvent[];focus?:TrackSegment|null;layout?:Workspace['layout'];initialZoom?:{min:number;max:number}|null;onZoom?:(range:{min:number;max:number})=>void;onSeek?:(position:number)=>void;pending?:'loading'|'unavailable'|null}){
  // Freeze the render/initialization context while hidden. First construction
  // and any data replacement happen only when this workspace is active.
  const context=useRef<{analysis:Analysis;axis:Axis;layout:Workspace['layout'];pending:typeof pending}|null>(null);
  if(active)context.current={analysis,axis,layout,pending};
  if(context.current){analysis=context.current.analysis;axis=context.current.axis;layout=context.current.layout;pending=context.current.pending;}
  const hasContext=context.current!==null;
  const eventOverlay=useRef(events);eventOverlay.current=events;
  const applyingCursor=useRef(false),sharedCursor=useRef(cursor);sharedCursor.current=cursor;
  // True while replacing data or restoring zoom: uPlot's hooks then report no gesture.
  const applying=useRef(false);
  const host=useRef<HTMLDivElement>(null),plots=useRef<uPlot[]>([]),callback=useRef(onCursor);callback.current=onCursor;
  const instances=useRef(new Map<string,uPlot&{dispose?:()=>void}>());
  const zoomCallback=useRef(onZoom);zoomCallback.current=onZoom;
  const seekCallback=useRef(onSeek);seekCallback.current=onSeek;
  useEffect(callbackEffect(zoomCallback,onZoom),[onZoom]);
  useEffect(callbackEffect(seekCallback,onSeek),[onSeek]);
  const previousReset=useRef(resetVersion),previousFocus=useRef<TrackSegment|null>(null);
  const readouts=useRef(new Map<string,HTMLElement>());
  const rows=useMemo(()=>hasContext?plotRows(analysis):[],[analysis,hasContext]);
  const rowsById=useMemo(()=>new Map(rows.map(row=>[row.id,row])),[rows]);
  const samples=[...analysis.primary.series,...(analysis.comparison?.series??[])];
  const visiblePlotCount=Math.max(1,rows.filter(row=>!visibleChannels||visibleChannels.includes(row.id)||row.id==='__delta').length);
  // Long-lived uPlot closures read the current selection here, never a captured one.
  const live=useRef({rows:new Map<string,Row>(),analysis,axis,layout,pending});
  live.current={rows:rowsById,analysis,axis,layout,pending};
  const palette=useRef({ink:'',grid:'',primary:'',comparison:'',delta:'',font:''});
  const readPalette=()=>{
    const style=getComputedStyle(host.current!);
    const color=(name:string,fallback:string)=>style.getPropertyValue(name).trim()||style.getPropertyValue(fallback).trim();
    return {ink:color('--muted','--ink'),grid:color('--grid','--border'),primary:color('--trace-primary','--cyan'),comparison:color('--trace-comparison','--amber'),delta:color('--delta-trace','--cyan'),font:style.getPropertyValue('--font-chart').trim()||"'IBM Plex Mono', ui-monospace, monospace"};
  };
  const isReference=()=>!!host.current?.closest('.premium [data-workspace="telemetry"]');
  const plotHeight=(node:HTMLElement)=>{
    const reference=isReference(),fallbackHeight=live.current.layout==='compact'?120:152;
    const height=Number.parseFloat(getComputedStyle(node).height);
    return Number.isFinite(height)&&height>0?Math.max(reference?100:120,Math.min(260,height)):fallbackHeight;
  };
  const seriesOptions=(rowId:string,index:number,name:string):uPlot.Series=>({label:name,stroke:()=>rowId==='__delta'?palette.current.delta:index?palette.current.comparison:palette.current.primary,width:index?1.5:2,fill:isReference()&&rowId==='__delta'?()=>`${palette.current.delta}10`:undefined,dash:index?[6,4]:undefined,spanGaps:false});
  const createPlot=(row:Row,el:HTMLDivElement)=>{
    const id=row.id,reference=isReference(),axisFont=`${reference?13:11}px ${palette.current.font}`;
    // The x increments follow the live axis, so changing axis keeps this instance.
    const xIncrements=reference?()=>live.current.axis==='distance'?referenceIncrements:defaultIncrements:undefined;
    let initialized=false;
    const plot:uPlot&{dispose?:()=>void}=new uPlot({width:Math.max(el.clientWidth,200),height:plotHeight(el),padding:[14,18,0,0],legend:{show:false},cursor:{sync:{key:'telemetry'},drag:{x:true,y:false,setScale:true},points:{size:5}},select:{show:true,left:0,top:0,width:0,height:0},scales:{x:{time:false}},axes:[{font:axisFont,space:reference?80:50,incrs:xIncrements,stroke:()=>palette.current.ink,grid:{show:false},ticks:{stroke:()=>palette.current.grid},size:32,values:(_u,ticks)=>ticks.map(n=>`${Math.round(n*10)/10}`)},{font:axisFont,stroke:()=>palette.current.ink,space:reference?22:50,incrs:reference?referenceIncrements:undefined,grid:{stroke:()=>palette.current.grid,width:1},ticks:{stroke:()=>palette.current.grid},size:68,gap:10}],series:[{},...rowSeries(row).map((s,index)=>seriesOptions(id,index,s.name))],hooks:{ready:[u=>{applyingCursor.current=true;try{const position=sharedCursor.current,left=position==null?-10:u.valToPos(position,'x');if(Number.isFinite(left))u.setCursor({left,top:30});}finally{applyingCursor.current=false;}}],draw:[u=>{
        // Zero is a meaningful reference only when it falls inside the visible delta scale.
        const colors=palette.current,current=live.current;
        if(current.pending)return;
        if(id==='__delta'&&u.scales.y.min!=null&&u.scales.y.max!=null&&u.scales.y.min<=0&&u.scales.y.max>=0){
          const y=u.valToPos(0,'y',true);u.ctx.save();u.ctx.strokeStyle=colors.ink;u.ctx.globalAlpha=.45;u.ctx.lineWidth=window.devicePixelRatio;u.ctx.setLineDash([4*window.devicePixelRatio,4*window.devicePixelRatio]);u.ctx.beginPath();u.ctx.moveTo(u.bbox.left,y);u.ctx.lineTo(u.bbox.left+u.bbox.width,y);u.ctx.stroke();u.ctx.restore();
        }
        if(!/rpm|engine.*(speed|revs)/i.test(current.rows.get(id)?.name??''))return;for(const event of eventOverlay.current){if(event.position==null)continue;const x=u.valToPos(event.position,'x',true);u.ctx.save();u.ctx.strokeStyle=event.lapId===current.analysis.primary.lapId?colors.primary:colors.comparison;u.ctx.fillStyle=u.ctx.strokeStyle;u.ctx.globalAlpha=.15;if(event.endPosition!=null&&event.endPosition>event.position)u.ctx.fillRect(x,u.bbox.top,u.valToPos(event.endPosition,'x',true)-x,u.bbox.height);u.ctx.globalAlpha=.8;u.ctx.beginPath();u.ctx.moveTo(x,u.bbox.top);u.ctx.lineTo(x,u.bbox.top+u.bbox.height);u.ctx.stroke();u.ctx.restore();}}],setCursor:[u=>{
        const x=u.cursor.left==null||u.cursor.left<0?null:u.posToVal(u.cursor.left,'x');
        // uPlot can fire this hook while constructing/destroying a plot, before scales exist.
        if(!initialized||(x!=null&&!Number.isFinite(x)))return;
        if(!applyingCursor.current&&!applying.current&&!live.current.pending&&el.querySelector('.u-over')?.matches(':hover'))callback.current(x);
        updateReadout(readouts.current.get(id),live.current.rows.get(id),x);
      }],setScale:[u=>{if(!initialized||applying.current||live.current.pending||u.scales.x.min==null||u.scales.x.max==null)return;if(plots.current[0]===u)zoomCallback.current?.({min:u.scales.x.min,max:u.scales.x.max});plots.current.forEach(other=>{if(other!==u&&(other.scales.x.min!==u.scales.x.min||other.scales.x.max!==u.scales.x.max))other.setScale('x',{min:u.scales.x.min!,max:u.scales.x.max!});});}]}},mergeSeries(rowSeries(row)) as uPlot.AlignedData,el);
    let intent:{x:number;y:number;eligible:boolean}|null=null;let pan:{start:number;min:number;max:number}|null=null;
    const down=(e:PointerEvent)=>{if(live.current.pending)return;intent={x:e.clientX,y:e.clientY,eligible:e.button===0&&!e.shiftKey};if(e.shiftKey||e.button===1){e.preventDefault();pan={start:e.clientX,min:plot.scales.x.min!,max:plot.scales.x.max!};el.setPointerCapture(e.pointerId);}};
    const move=(e:PointerEvent)=>{if(pan){const dx=(e.clientX-pan.start)/(plot.bbox.width/window.devicePixelRatio)*(pan.max-pan.min);plot.setScale('x',{min:pan.min-dx,max:pan.max-dx});}};
    const key=(e:KeyboardEvent)=>{
      if(live.current.pending)return;
      const position=sharedCursor.current;
      if((e.key==='Enter'||e.key===' ')&&position!==null&&Number.isFinite(position)){e.preventDefault();seekCallback.current?.(position);return;}
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
      const min=plot.scales.x.min,max=plot.scales.x.max;
      if(min==null||max==null||!Number.isFinite(min)||!Number.isFinite(max))return;
      const step=(max-min)*(e.shiftKey ? .1 : .01),current=position==null?min:Math.max(min,Math.min(max,position));
      const next=e.key==='Home'?min:e.key==='End'?max:Math.max(min,Math.min(max,current+(e.key==='ArrowLeft'?-step:step)));
      e.preventDefault();callback.current(next);
    };
    el.tabIndex=0;el.setAttribute('aria-label',`${row.name} graph cursor`);
    const up=(e:PointerEvent)=>{if(!live.current.pending&&intent?.eligible&&!pan&&Math.hypot(e.clientX-intent.x,e.clientY-intent.y)<4){const over=el.querySelector('.u-over')?.getBoundingClientRect();if(over&&e.clientX>=over.left&&e.clientX<=over.right&&e.clientY>=over.top&&e.clientY<=over.bottom){const position=plot.posToVal(e.clientX-over.left,'x');if(Number.isFinite(position))seekCallback.current?.(position);}}intent=null;pan=null;};
    el.addEventListener('pointerdown',down,true);el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);el.addEventListener('keydown',key);
    const observer=new ResizeObserver(()=>{const width=el.clientWidth,height=plotHeight(el);if(width>0&&(plot.width!==Math.max(width,200)||plot.height!==height))plot.setSize({width:Math.max(width,200),height});});observer.observe(el);
    plot.dispose=()=>{initialized=false;observer.disconnect();el.removeEventListener('pointerdown',down,true);el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);el.removeEventListener('keydown',key);plot.destroy();};
    initialized=true;
    return plot;
  };
  // Replace a chart's data, series count and x range in one commit, so no frame
  // pairs the new selection with the previous lap's samples.
  const replaceData=(plot:uPlot,row:Row,range:{min:number;max:number}|null)=>{
    const pairs=rowSeries(row);
    plot.batch(()=>{
      while(plot.series.length-1>pairs.length)plot.delSeries(plot.series.length-1);
      while(plot.series.length-1<pairs.length){const index=plot.series.length-1;plot.addSeries(seriesOptions(row.id,index,pairs[index].name));}
      plot.setData(mergeSeries(pairs) as uPlot.AlignedData,true);
      if(range)plot.setScale('x',range);
    });
  };
  const restorableZoom=()=>{
    const max=Math.max(...samples.map(s=>s.x.at(-1)??0),analysis.delta?.x.at(-1)??0,1);
    return !pending&&initialZoom&&Number.isFinite(initialZoom.min)&&Number.isFinite(initialZoom.max)&&initialZoom.max>initialZoom.min&&initialZoom.min>=0&&initialZoom.max<=max?initialZoom:null;
  };
  // The instances outlive selection changes. Only this effect owns their lifetime.
  useEffect(()=>{
    if(!host.current||!context.current)return;
    palette.current=readPalette();
    // Canvas does not resolve CSS variables: snapshot the active semantic colors
    // and refresh them on theme changes without replacing the uPlot instances.
    let mountedPlots=true;
    const themeObserver=new MutationObserver(()=>{
      palette.current=readPalette();
      const mounted=[...plots.current];
      mounted.forEach(plot=>plot.redraw(false,true));
      // Cursor points are DOM nodes cached by sample index. Refresh them after
      // the canvas paint even when the cursor is stationary, without callbacks.
      queueMicrotask(()=>{
        if(!mountedPlots||mounted.some(plot=>!plots.current.includes(plot)))return;
        applyingCursor.current=true;
        try{mounted.forEach(plot=>{const {left,top}=plot.cursor;if(left!=null&&top!=null&&left>=0&&top>=0){plot.setCursor({left:-10,top:-10},false);plot.setCursor({left,top},false);}});}
        finally{applyingCursor.current=false;}
      });
    });
    // Font loading changes canvas glyph metrics, not chart ownership or data.
    if(host.current.closest('.premium'))void document.fonts.ready.then(()=>{
      if(mountedPlots)plots.current.forEach(plot=>plot.redraw(false,true));
    });
    themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    const owned=instances.current;
    return()=>{
      themeObserver.disconnect();
      mountedPlots=false;
      owned.forEach(plot=>{
        // A disposed uPlot can outlive its canvas in browser allocation caches.
        // Release our closure so it cannot retain detached UI and recording props.
        const dispose=plot.dispose;delete plot.dispose;dispose?.();
      });
      owned.clear();
      plots.current=[];
    };
  },[hasContext]);
  // Reconcile rows with instances: keep every chart whose channel remains and
  // replace its data in place. A channel entering or leaving creates or disposes only its own.
  useEffect(()=>{
    if(!host.current||!context.current)return;
    const nodes=host.current.querySelectorAll<HTMLDivElement>('[data-plot]'),ids=new Set(rows.map(row=>row.id));
    instances.current.forEach((plot,id)=>{if(ids.has(id))return;const dispose=plot.dispose;delete plot.dispose;dispose?.();instances.current.delete(id);readouts.current.delete(id);});
    const range=restorableZoom()??sharedRange(rows);
    applying.current=true;
    try{
      plots.current=rows.map((row,i)=>{
        const existing=instances.current.get(row.id);
        if(existing){replaceData(existing,row,range);return existing;}
        const plot=createPlot(row,nodes[i]);
        if(range)plot.setScale('x',range);
        instances.current.set(row.id,plot);
        return plot;
      });
    }finally{applying.current=false;}
    // As on first construction, the saved range follows what the charts now show.
    if(!pending&&range&&range!==initialZoom)zoomCallback.current?.(range);
  },[analysis,axis,hasContext]);
  // Density changes the CSS height, or the fallback height outside the reference
  // layout. Measure without the chart so its own height cannot hold the row open.
  useEffect(()=>{
    plots.current.forEach(plot=>{
      const el=plot.root.parentElement;if(!el||!el.clientWidth)return;
      const display=plot.root.style.display;plot.root.style.display='none';
      const height=plotHeight(el);plot.root.style.display=display;
      if(plot.height!==height)plot.setSize({width:Math.max(el.clientWidth,200),height});
    });
  },[layout]);
  useEffect(()=>{
    const zoom=active?restorableZoom():null;
    if(!zoom)return;
    applying.current=true;
    try{let changed=false;plots.current.forEach(p=>{if(p.scales.x.min!==zoom.min||p.scales.x.max!==zoom.max){p.batch(()=>p.setScale('x',zoom));changed=true;}});
      if(changed){applyingCursor.current=true;try{const position=sharedCursor.current;plots.current.forEach(p=>p.setCursor({left:position==null?-10:p.valToPos(position,'x'),top:30}));}finally{applyingCursor.current=false;}}
    }
    finally{applying.current=false;}
  },[initialZoom?.min,initialZoom?.max,analysis,axis,layout,active,pending]);
  useEffect(()=>{if(!active||previousReset.current===resetVersion)return;previousReset.current=resetVersion;if(pending)return;plots.current.forEach(p=>p.setScale('x',{min:Math.min(...samples.map(s=>s.x[0]??0),0),max:Math.max(...samples.map(s=>s.x[s.x.length-1]??0),analysis.delta?.x.at(-1)??0,1)}));},[resetVersion,active]);
  useEffect(()=>{if(!active||pending||previousFocus.current===focus)return;previousFocus.current=focus;if(focus&&focus.end>focus.start)plots.current.forEach(p=>{p.batch(()=>p.setScale('x',{min:focus.start,max:focus.end}));p.setCursor({left:p.valToPos((focus.start+focus.end)/2,'x'),top:30});});},[focus,analysis,active,pending]);
  useEffect(()=>{if(!active)return;const position=pending?null:cursor;applyingCursor.current=true;try{plots.current.forEach(p=>p.setCursor({left:position==null?-10:p.valToPos(position,'x'),top:30}));}finally{applyingCursor.current=false;}rows.forEach(row=>updateReadout(readouts.current.get(row.id),row,position));},[cursor,analysis,axis,layout,active,pending]);
  useEffect(()=>{
    // uPlot commits its initial auto-scales in a microtask. Never reset them with
    // redraw() during construction; overlays only need a paint after that commit.
    if(!active)return;const frame=requestAnimationFrame(()=>{applyingCursor.current=true;try{plots.current.forEach(plot=>{plot.redraw(false,false);const position=sharedCursor.current;plot.setCursor({left:position==null?-10:plot.valToPos(position,'x'),top:30});});}finally{applyingCursor.current=false;}});
    return()=>cancelAnimationFrame(frame);
  },[events,active]);
  const unavailable=pending==='unavailable';
  return <div ref={host} className="plots" aria-busy={pending==='loading'} data-pending={pending??undefined} style={{'--plot-count':visiblePlotCount} as CSSProperties}>{pending&&<div className="plots-status" role="status">{!unavailable&&<span className="loading-line"/>}{unavailable?'This selection could not be analyzed.':'Aligning telemetry…'}</div>}{rows.map(row=><section className={`plot-row${row.id==='__delta'?' plot-delta':''}`} key={row.id} hidden={!!visibleChannels&&!visibleChannels.includes(row.id)&&row.id!=='__delta'}><div className="plot-label"><span className="plot-title">{row.name} <small className="plot-unit">{row.unit}</small>{!pending&&row.primaryUnavailable&&<small> · Primary unavailable</small>}{!pending&&analysis.comparison&&!row.comparison&&row.id!=='__delta'&&<small> · Comparison unavailable</small>}</span><span className="mono readout" ref={el=>{if(el)readouts.current.set(row.id,el);}}><span className="plot-reading primary-reading"><span className="plot-sr-only">{row.id==='__delta'?'Delta':'Primary lap'} </span><span className="reading-key" aria-hidden="true">{row.id==='__delta'?'Δ':'Primary'}</span><span data-primary-value>—</span>{row.id==='__delta'&&<span data-delta-direction/>}</span>{row.id!=='__delta'&&analysis.comparison&&<span className="plot-reading comparison-reading"><span className="plot-sr-only">Comparison lap </span><span className="reading-key" aria-hidden="true">Reference</span><span data-comparison-value>—</span></span>}</span></div><div data-plot role="group" title="Move over a graph or use arrow keys to inspect. Drag to zoom; Shift and drag to pan." /></section>)}<div className="axis-label"><span className="plot-legend"><span>Primary</span>{analysis.comparison&&<span>Reference</span>}</span><span>{axisDescription(analysis,axis,!!pending)}</span></div></div>;
}
