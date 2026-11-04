import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import './plots.css';
import type { Workspace } from './workspace';
import type { Analysis, Axis, Series, TrackSegment, AdvancedEvent } from './types';
import { interpolate, mergeSeries } from './telemetry';
const noEvents:AdvancedEvent[]=[];
type Row={id:string;name:string;unit:string;primary:Series;comparison?:Series;primaryUnavailable?:boolean};
function updateReadout(element:HTMLElement|undefined,row:Row,position:number|null){
  if(!element)return;
  const format=(series:Series|undefined)=>{
    const value=position==null||!series?null:interpolate(series.x,series.values,position,series.gaps);
    if(value==null||!Number.isFinite(value))return '—';
    if(row.id==='__delta')return `${value>0?'+':''}${value.toFixed(3)}`;
    return value.toFixed(row.unit.toLowerCase()==='rpm'?0:1);
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
export default function Plots({analysis,axis,onCursor,resetVersion,cursor=null,events=noEvents,focus=null,layout='comfortable',initialZoom=null,onZoom,onSeek,visibleChannels,active=true}:{visibleChannels?:string[];active?:boolean;analysis:Analysis;axis:Axis;onCursor:(x:number|null)=>void;resetVersion:number;cursor?:number|null;events?:AdvancedEvent[];focus?:TrackSegment|null;layout?:Workspace['layout'];initialZoom?:{min:number;max:number}|null;onZoom?:(range:{min:number;max:number})=>void;onSeek?:(position:number)=>void}){
  // Freeze the render/initialization context while hidden. First construction
  // and any data replacement happen only when this workspace is active.
  const context=useRef<{analysis:Analysis;axis:Axis;layout:Workspace['layout']}|null>(null);
  if(active)context.current={analysis,axis,layout};
  if(context.current){analysis=context.current.analysis;axis=context.current.axis;layout=context.current.layout;}
  const hasContext=context.current!==null;
  const applyingZoom=useRef(false);
  const eventOverlay=useRef(events);eventOverlay.current=events;
  const applyingCursor=useRef(false),sharedCursor=useRef(cursor);sharedCursor.current=cursor;
  const host=useRef<HTMLDivElement>(null),plots=useRef<uPlot[]>([]),callback=useRef(onCursor);callback.current=onCursor;
  const zoomCallback=useRef(onZoom);zoomCallback.current=onZoom;
  const seekCallback=useRef(onSeek);seekCallback.current=onSeek;
  useEffect(callbackEffect(zoomCallback,onZoom),[onZoom]);
  useEffect(callbackEffect(seekCallback,onSeek),[onSeek]);
  const previousReset=useRef(resetVersion),previousFocus=useRef<TrackSegment|null>(null);
  const readouts=useRef(new Map<string,HTMLElement>());
  const rows:Row[]=!context.current?[]:Array.from(new Map([...analysis.primary.series,...(analysis.comparison?.series??[])].map(s=>[s.channelId,s])).values()).map(s=>{const primary=analysis.primary.series.find(p=>p.channelId===s.channelId);return {id:s.channelId,name:s.name,unit:s.unit,primary:primary??{...s,x:[],values:[],gaps:[]},primaryUnavailable:!primary,comparison:analysis.comparison?.series.find(c=>c.channelId===s.channelId)};});
  const samples=[...analysis.primary.series,...(analysis.comparison?.series??[])];
  if(context.current&&analysis.delta)rows.push({id:'__delta',name:analysis.delta.method==='spatial'?'Spatial time delta':'Estimated time delta',unit:'s',primary:{channelId:'__delta',name:analysis.delta.method==='spatial'?'Spatial time delta':'Estimated time delta',unit:'s',...analysis.delta}});
  const visiblePlotCount=Math.max(1,rows.filter(row=>!visibleChannels||visibleChannels.includes(row.id)||row.id==='__delta').length);
  useEffect(()=>{
    if(!host.current||!context.current)return;
    const nodes=host.current.querySelectorAll<HTMLDivElement>('[data-plot]');
    // Canvas does not resolve CSS variables: snapshot the active semantic colors
    // and refresh them on theme changes without replacing the uPlot instances.
    const readPalette=()=>{
      const style=getComputedStyle(host.current!);
      const color=(name:string,fallback:string)=>style.getPropertyValue(name).trim()||style.getPropertyValue(fallback).trim();
      return {ink:color('--muted','--ink'),grid:color('--grid','--border'),primary:color('--trace-primary','--cyan'),comparison:color('--trace-comparison','--amber'),delta:color('--delta-trace','--cyan')};
    };
    let palette=readPalette();
    const axisFont="11px 'IBM Plex Mono', ui-monospace, monospace";
    let initialized=false;
    const fallbackHeight=layout==='compact'?120:152;
    const plotHeight=(node:HTMLElement)=>{
      const height=Number.parseFloat(getComputedStyle(node).height);
      return Number.isFinite(height)&&height>0?Math.max(120,Math.min(260,height)):fallbackHeight;
    };
    plots.current=rows.map((row,i)=>{
      const pairs=[row.primary,...(row.comparison?[row.comparison]:[])];
      const plot=new uPlot({width:Math.max(nodes[i].clientWidth,200),height:plotHeight(nodes[i]),padding:[14,18,0,0],legend:{show:false},cursor:{sync:{key:'telemetry'},drag:{x:true,y:false,setScale:true},points:{size:5}},select:{show:true,left:0,top:0,width:0,height:0},scales:{x:{time:false}},axes:[{font:axisFont,stroke:()=>palette.ink,grid:{show:false},ticks:{stroke:()=>palette.grid},size:32,values:(_u,ticks)=>ticks.map(n=>`${Math.round(n*10)/10}`)},{font:axisFont,stroke:()=>palette.ink,grid:{stroke:()=>palette.grid,width:1},ticks:{stroke:()=>palette.grid},size:68,gap:10}],series:[{},...pairs.map((s,index)=>({label:s.name,stroke:()=>row.id==='__delta'?palette.delta:index?palette.comparison:palette.primary,width:index?1.5:2,dash:index?[6,4]:undefined,spanGaps:false}))],hooks:{ready:[u=>{applyingCursor.current=true;try{const position=sharedCursor.current,left=position==null?-10:u.valToPos(position,'x');if(Number.isFinite(left))u.setCursor({left,top:30});}finally{applyingCursor.current=false;}}],draw:[u=>{
        // Zero is a meaningful reference only when it falls inside the visible delta scale.
        if(row.id==='__delta'&&u.scales.y.min!=null&&u.scales.y.max!=null&&u.scales.y.min<=0&&u.scales.y.max>=0){
          const y=u.valToPos(0,'y',true);u.ctx.save();u.ctx.strokeStyle=palette.ink;u.ctx.globalAlpha=.45;u.ctx.lineWidth=window.devicePixelRatio;u.ctx.setLineDash([4*window.devicePixelRatio,4*window.devicePixelRatio]);u.ctx.beginPath();u.ctx.moveTo(u.bbox.left,y);u.ctx.lineTo(u.bbox.left+u.bbox.width,y);u.ctx.stroke();u.ctx.restore();
        }
        if(!/rpm|engine.*(speed|revs)/i.test(row.name))return;for(const event of eventOverlay.current){if(event.position==null)continue;const x=u.valToPos(event.position,'x',true);u.ctx.save();u.ctx.strokeStyle=event.lapId===analysis.primary.lapId?palette.primary:palette.comparison;u.ctx.fillStyle=u.ctx.strokeStyle;u.ctx.globalAlpha=.15;if(event.endPosition!=null&&event.endPosition>event.position)u.ctx.fillRect(x,u.bbox.top,u.valToPos(event.endPosition,'x',true)-x,u.bbox.height);u.ctx.globalAlpha=.8;u.ctx.beginPath();u.ctx.moveTo(x,u.bbox.top);u.ctx.lineTo(x,u.bbox.top+u.bbox.height);u.ctx.stroke();u.ctx.restore();}}],setCursor:[u=>{
        const x=u.cursor.left==null||u.cursor.left<0?null:u.posToVal(u.cursor.left,'x');
        // uPlot can fire this hook while constructing/destroying a plot, before scales exist.
        if(!initialized||(x!=null&&!Number.isFinite(x)))return;
        if(!applyingCursor.current&&nodes[i].querySelector('.u-over')?.matches(':hover'))callback.current(x);
        updateReadout(readouts.current.get(row.id),row,x);
      }],setScale:[u=>{if(initialized&&!applyingZoom.current&&i===0&&u.scales.x.min!=null&&u.scales.x.max!=null)zoomCallback.current?.({min:u.scales.x.min,max:u.scales.x.max});if(u.scales.x.min!=null&&u.scales.x.max!=null)plots.current.forEach(other=>{if(other!==u&&(other.scales.x.min!==u.scales.x.min||other.scales.x.max!==u.scales.x.max))other.setScale('x',{min:u.scales.x.min!,max:u.scales.x.max!});});}]}},mergeSeries(pairs) as uPlot.AlignedData,nodes[i]);
      const el=nodes[i];let intent:{x:number;y:number;eligible:boolean}|null=null;let pan:{start:number;min:number;max:number}|null=null;
      const down=(e:PointerEvent)=>{intent={x:e.clientX,y:e.clientY,eligible:e.button===0&&!e.shiftKey};if(e.shiftKey||e.button===1){e.preventDefault();pan={start:e.clientX,min:plot.scales.x.min!,max:plot.scales.x.max!};el.setPointerCapture(e.pointerId);}};
      const move=(e:PointerEvent)=>{if(pan){const dx=(e.clientX-pan.start)/(plot.bbox.width/window.devicePixelRatio)*(pan.max-pan.min);plot.setScale('x',{min:pan.min-dx,max:pan.max-dx});}};
      const key=(e:KeyboardEvent)=>{
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
      const up=(e:PointerEvent)=>{if(intent?.eligible&&!pan&&Math.hypot(e.clientX-intent.x,e.clientY-intent.y)<4){const over=el.querySelector('.u-over')?.getBoundingClientRect();if(over&&e.clientX>=over.left&&e.clientX<=over.right&&e.clientY>=over.top&&e.clientY<=over.bottom){const position=plot.posToVal(e.clientX-over.left,'x');if(Number.isFinite(position))seekCallback.current?.(position);}}intent=null;pan=null;};
      el.addEventListener('pointerdown',down,true);el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);el.addEventListener('keydown',key);
      const observer=new ResizeObserver(()=>{const width=el.clientWidth,height=plotHeight(el);if(width>0&&(plot.width!==Math.max(width,200)||plot.height!==height))plot.setSize({width:Math.max(width,200),height});});observer.observe(el);
      (plot as uPlot & {dispose:()=>void}).dispose=()=>{observer.disconnect();el.removeEventListener('pointerdown',down,true);el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);el.removeEventListener('keydown',key);plot.destroy();};
      return plot;
    });
    if(initialZoom){const max=Math.max(...samples.map(s=>s.x.at(-1)??0),analysis.delta?.x.at(-1)??0,1);if(initialZoom.min>=0&&initialZoom.max<=max)plots.current.forEach(p=>p.setScale('x',initialZoom));}
    initialized=true;
    const themeObserver=new MutationObserver(()=>{
      palette=readPalette();
      const mounted=[...plots.current];
      mounted.forEach(plot=>plot.redraw(false,true));
      // Cursor points are DOM nodes cached by sample index. Refresh them after
      // the canvas paint even when the cursor is stationary, without callbacks.
      queueMicrotask(()=>{
        if(!initialized||mounted.some(plot=>!plots.current.includes(plot)))return;
        applyingCursor.current=true;
        try{mounted.forEach(plot=>{const {left,top}=plot.cursor;if(left!=null&&top!=null&&left>=0&&top>=0){plot.setCursor({left:-10,top:-10},false);plot.setCursor({left,top},false);}});}
        finally{applyingCursor.current=false;}
      });
    });
    themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    return()=>{
      themeObserver.disconnect();
      initialized=false;
      plots.current.forEach(p=>{
        // A disposed uPlot can outlive its canvas in browser allocation caches.
        // Release our closure so it cannot retain detached UI and recording props.
        const plot=p as uPlot&{dispose?:()=>void},dispose=plot.dispose;
        delete plot.dispose;
        dispose?.();
      });
      plots.current=[];
    };
  },[analysis,axis,layout,hasContext]);
  useEffect(()=>{
    if(!active||!initialZoom||!Number.isFinite(initialZoom.min)||!Number.isFinite(initialZoom.max)||initialZoom.max<=initialZoom.min)return;
    const max=Math.max(...samples.map(s=>s.x.at(-1)??0),analysis.delta?.x.at(-1)??0,1);
    if(initialZoom.min<0||initialZoom.max>max)return;
    applyingZoom.current=true;
    try{let changed=false;plots.current.forEach(p=>{if(p.scales.x.min!==initialZoom.min||p.scales.x.max!==initialZoom.max){p.setScale('x',initialZoom);changed=true;}});
      if(changed){applyingCursor.current=true;try{const position=sharedCursor.current;plots.current.forEach(p=>p.setCursor({left:position==null?-10:p.valToPos(position,'x'),top:30}));}finally{applyingCursor.current=false;}}
    }
    finally{applyingZoom.current=false;}
  },[initialZoom?.min,initialZoom?.max,analysis,axis,layout,active]);
  useEffect(()=>{if(!active||previousReset.current===resetVersion)return;previousReset.current=resetVersion;plots.current.forEach(p=>p.setScale('x',{min:Math.min(...samples.map(s=>s.x[0]??0),0),max:Math.max(...samples.map(s=>s.x[s.x.length-1]??0),analysis.delta?.x.at(-1)??0,1)}));},[resetVersion,active]);
  useEffect(()=>{if(!active||previousFocus.current===focus)return;previousFocus.current=focus;if(focus&&focus.end>focus.start)plots.current.forEach(p=>{p.batch(()=>p.setScale('x',{min:focus.start,max:focus.end}));p.setCursor({left:p.valToPos((focus.start+focus.end)/2,'x'),top:30});});},[focus,analysis,active]);
  useEffect(()=>{if(!active)return;applyingCursor.current=true;try{plots.current.forEach(p=>p.setCursor({left:cursor==null?-10:p.valToPos(cursor,'x'),top:30}));}finally{applyingCursor.current=false;}rows.forEach(row=>updateReadout(readouts.current.get(row.id),row,cursor));},[cursor,analysis,axis,layout,active]);
  useEffect(()=>{
    // uPlot commits its initial auto-scales in a microtask. Never reset them with
    // redraw() during construction; overlays only need a paint after that commit.
    if(!active)return;const frame=requestAnimationFrame(()=>{applyingCursor.current=true;try{plots.current.forEach(plot=>{plot.redraw(false,false);const position=sharedCursor.current;plot.setCursor({left:position==null?-10:plot.valToPos(position,'x'),top:30});});}finally{applyingCursor.current=false;}});
    return()=>cancelAnimationFrame(frame);
  },[events,active]);
  return <div ref={host} className="plots" style={{'--plot-count':visiblePlotCount} as CSSProperties}>{rows.map(row=><section className={`plot-row${row.id==='__delta'?' plot-delta':''}`} key={row.id} hidden={!!visibleChannels&&!visibleChannels.includes(row.id)&&row.id!=='__delta'}><div className="plot-label"><span className="plot-title">{row.name} <small className="plot-unit">{row.unit}</small>{row.primaryUnavailable&&<small> · Primary unavailable</small>}{analysis.comparison&&!row.comparison&&row.id!=='__delta'&&<small> · Comparison unavailable</small>}</span><span className="mono readout" ref={el=>{if(el)readouts.current.set(row.id,el);}}><span className="plot-reading primary-reading"><span className="plot-sr-only">{row.id==='__delta'?'Delta':'Primary lap'} </span><span className="reading-key" aria-hidden="true">{row.id==='__delta'?'Δ':'Primary'}</span><span data-primary-value>—</span>{row.id==='__delta'&&<span data-delta-direction/>}</span>{row.id!=='__delta'&&analysis.comparison&&<span className="plot-reading comparison-reading"><span className="plot-sr-only">Comparison lap </span><span className="reading-key" aria-hidden="true">Reference</span><span data-comparison-value>—</span></span>}</span></div><div data-plot role="group" title="Move over a graph or use arrow keys to inspect. Drag to zoom; Shift and drag to pan." /></section>)}<div className="axis-label">{axis==='distance'?analysis.alignment?.method==='spatial'?'Reference track position · meters':'Distance into lap · meters':analysis.alignment?.method==='spatial'?'Primary lap time at aligned position · seconds':'Time into lap · seconds'}</div></div>;
}
