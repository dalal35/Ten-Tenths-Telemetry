import {useEffect,useMemo,useRef,useState} from 'react';
import type {AdvancedPoint,AdvancedResult} from './types';
import type {AdvancedConfig} from './advancedState';
import {analysisPanelHeight,analysisPlotRect} from './analysisLayout';
type Bin = AdvancedResult['laps'][number]['histogram'][number];
type Inspection = {kind:'point';p:AdvancedPoint;lap:number}|{kind:'bin';bin:Bin;lap:number};
const fmt=(n:number)=>Number.isFinite(n)?n.toLocaleString(undefined,{maximumFractionDigits:2}):'—';
export default function AnalysisCanvas({result,primaryLapId,xLabel,yLabel,config,cursor,onCursor,inspectPosition,active=true}:{active?:boolean;result:AdvancedResult;primaryLapId:string;xLabel?:string;yLabel?:string;config:AdvancedConfig;cursor:number|null;onCursor:(v:number|null)=>void;inspectPosition?:(lapId:string,position:number|null)=>number|null}) {
 const host=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),overlay=useRef<HTMLCanvasElement>(null),keyboardPoint=useRef(0),hit=useRef<{x:number;y:number;p:AdvancedPoint;lap:number}[]>([]),binHits=useRef<{left:number;right:number;top:number;bottom:number;bin:Bin;lap:number}[]>([]);
 const [theme,setTheme]=useState(()=>document.documentElement.dataset.theme);
 useEffect(()=>{const root=document.documentElement,observer=new MutationObserver(()=>setTheme(root.dataset.theme));observer.observe(root,{attributes:true,attributeFilter:['data-theme']});return()=>observer.disconnect();},[]);
 const [dpr,setDpr]=useState(()=>window.devicePixelRatio||1);
 useEffect(()=>{
  let query:MediaQueryList;
  const update=()=>{
   query?.removeEventListener('change',update);
   const density=window.devicePixelRatio||1;setDpr(density);
   query=window.matchMedia(`(resolution: ${density}dppx)`);query.addEventListener('change',update);
  };
  update();return()=>query.removeEventListener('change',update);
 },[]);
 const [size,setSize]=useState({width:700,height:config.panelHeight}),[view,setView]=useState<[number,number,number,number]|null>(null),[hover,setHover]=useState<Inspection|null>(null);
 const drag=useRef<{x:number;y:number;view:[number,number,number,number];moved:boolean}|null>(null),bounds=useRef<[number,number,number,number]>([0,1,0,1]);
 const plotRect=useRef({left:62,right:682,top:18,bottom:376});
 const histogram=result.tool==='histogram';
 const transform=(v:number,axis:'x'|'y')=>config[axis==='x'?'xScale':'yScale']==='log'?v>0?Math.log10(v):NaN:v;
 const renderableBin=(bin:Bin)=>[transform(bin.low,'x'),transform(bin.high,'x'),transform(bin.value,'y')].every(Number.isFinite);
 const excluded=useMemo(()=>histogram?result.laps.flatMap(l=>l.histogram).filter(bin=>!renderableBin(bin)).length:result.laps.flatMap(l=>l.points).filter(p=>!Number.isFinite(transform(p.x,'x'))||!Number.isFinite(transform(p.y,'y'))).length,[result,config.xScale,config.yScale]);
 const inverse=(v:number,axis:'x'|'y')=>config[axis==='x'?'xScale':'yScale']==='log'?10**v:v;
 useEffect(()=>{setView(null);setHover(null);},[result,config.xScale,config.yScale,config.xRange?.[0],config.xRange?.[1],config.yRange?.[0],config.yRange?.[1]]);
 useEffect(()=>{const element=host.current;if(!element)return;const measure=()=>{const width=Math.max(1,element.clientWidth),height=analysisPanelHeight(config.panelHeight,window.innerHeight,element.closest('.workspace-viewport')?510:260);setSize(current=>current.width===width&&current.height===height?current:{width,height});};const observer=new ResizeObserver(measure);observer.observe(element);window.addEventListener('resize',measure);measure();return()=>{observer.disconnect();window.removeEventListener('resize',measure);};},[config.panelHeight]);
 useEffect(()=>{
  if(!active)return;const el=canvas.current;if(!el)return;const ctx=el.getContext('2d');if(!ctx)return;const w=size.width,h=size.height;el.width=w*dpr;el.height=h*dpr;ctx.scale(dpr,dpr);
  const css=getComputedStyle(el),ink=css.getPropertyValue('--muted').trim(),grid=css.getPropertyValue('--grid').trim(),colors=[css.getPropertyValue('--cyan').trim(),css.getPropertyValue('--amber').trim()];ctx.clearRect(0,0,w,h);
  const values=result.laps.flatMap(l=>l.points).filter(p=>Number.isFinite(transform(p.x,'x'))&&Number.isFinite(transform(p.y,'y')));
  const bins=result.laps.flatMap(l=>l.histogram);let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
  if(histogram){for(const b of bins.filter(renderableBin)){xmin=Math.min(xmin,transform(b.low,'x'));xmax=Math.max(xmax,transform(b.high,'x'));ymax=Math.max(ymax,transform(b.value,'y'));}ymin=config.yScale==='log'?Math.min(-2,ymax-1):0;}
  else for(const p of values){xmin=Math.min(xmin,transform(p.x,'x'));xmax=Math.max(xmax,transform(p.x,'x'));ymin=Math.min(ymin,transform(p.y,'y'));ymax=Math.max(ymax,transform(p.y,'y'));}
  if(!Number.isFinite(xmin)||!Number.isFinite(xmax)){xmin=0;xmax=1;}if(!Number.isFinite(ymin)||!Number.isFinite(ymax)){ymin=0;ymax=1;}
  if(result.tool==='traction'){const limit=Math.max(Math.abs(xmin),Math.abs(xmax),Math.abs(ymin),Math.abs(ymax),1);xmin=ymin=-limit;xmax=ymax=limit;}
  if(xmin===xmax){xmin-=.5;xmax+=.5;}if(ymin===ymax){ymin-=.5;ymax+=.5;}
  const manualX=config.xRange?.map(v=>transform(v,'x')),manualY=config.yRange?.map(v=>transform(v,'y'));
  const b=view??[manualX?.[0]??xmin,manualX?.[1]??xmax,manualY?.[0]??ymin,manualY?.[1]??ymax];if(b.some(v=>!Number.isFinite(v)))return;bounds.current=b;
  const {left,top,right,bottom}=analysisPlotRect(w,h,b,result.tool==='traction'&&config.xScale==='linear'&&config.yScale==='linear');plotRect.current={left,top,right,bottom};const px=(v:number)=>left+(transform(v,'x')-b[0])/(b[1]-b[0])*(right-left),py=(v:number)=>bottom-(transform(v,'y')-b[2])/(b[3]-b[2])*(bottom-top);
  ctx.font='11px "IBM Plex Mono", monospace';ctx.textAlign='center';ctx.lineWidth=1;
  for(let i=0;i<=5;i++){const x=left+(right-left)*i/5,y=bottom-(bottom-top)*i/5;ctx.strokeStyle=grid;ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillStyle=ink;ctx.fillText(fmt(inverse(b[0]+(b[1]-b[0])*i/5,'x')),x,bottom+18);ctx.textAlign='right';ctx.fillText(fmt(inverse(b[2]+(b[3]-b[2])*i/5,'y')),left-8,y+3);ctx.textAlign='center';}
  ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
  if(result.tool==='traction'&&config.grid>0){ctx.strokeStyle=grid;for(let g=config.grid;g<=Math.max(b[1],b[3])*2&&g<100;g+=config.grid){ctx.beginPath();ctx.ellipse(px(0),py(0),Math.abs(px(g)-px(0)),Math.abs(py(g)-py(0)),0,0,Math.PI*2);ctx.stroke();}}
  hit.current=[];binHits.current=[];
  const colorValues=values.flatMap(p=>p.color==null?[]:[p.color]);let cmin=Infinity,cmax=-Infinity;for(const c of colorValues){cmin=Math.min(cmin,c);cmax=Math.max(cmax,c);}
  result.laps.forEach((lap,index)=>{const color=colors[lap.lapId===primaryLapId?0:1];ctx.fillStyle=color;ctx.strokeStyle=color;
   if(histogram){ctx.globalAlpha=.35;lap.histogram.forEach(bin=>{if(!renderableBin(bin))return;const x=px(bin.low),y=py(bin.value),width=Math.max(1,px(bin.high)-x-1);ctx.fillRect(x,y,width,bottom-y);const clipped={left:Math.max(left,x),right:Math.min(right,x+width),top:Math.max(top,y),bottom};if(clipped.right>clipped.left&&clipped.bottom>clipped.top)binHits.current.push({...clipped,bin,lap:index});});ctx.globalAlpha=1;}
   else {ctx.globalAlpha=.65;for(const p of lap.points){const x=px(p.x),y=py(p.y);if(!Number.isFinite(x)||!Number.isFinite(y)||x<left||x>right||y<top||y>bottom)continue;ctx.fillStyle=p.color!=null&&cmax>cmin?`hsl(${240-240*(p.color-cmin)/(cmax-cmin)} 75% 52%)`:color;ctx.beginPath();if(config.colorChannel&&lap.lapId!==primaryLapId){ctx.moveTo(x,y-3);ctx.lineTo(x+3,y);ctx.lineTo(x,y+3);ctx.lineTo(x-3,y);ctx.closePath();ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=1;ctx.stroke();}else{ctx.arc(x,y,2,0,Math.PI*2);ctx.fill();}hit.current.push({x,y,p,lap:index});}ctx.globalAlpha=1;

   }
  });ctx.restore();ctx.fillStyle=ink;ctx.textAlign='center';ctx.fillText(`${xLabel?`${xLabel} · `:""}${result.xUnit} · ${config.xScale}`,left+(right-left)/2,h-4);
  ctx.save();ctx.translate(12,top+(bottom-top)/2);ctx.rotate(-Math.PI/2);ctx.fillText(histogram?config.percentage?'Occupancy · %':config.weighting==='time'?'Supported duration · s':'Samples':`${yLabel?`${yLabel} · `:""}${result.yUnit} · ${config.yScale}`,0,0);ctx.restore();
 },[result,primaryLapId,config,size,dpr,view,active,theme,xLabel,yLabel]);
 // Cursor feedback uses a separate bitmap: never repaint the sample cloud just
 // because another synchronized graph moved its cursor.
 useEffect(()=>{
  if(!active)return;const el=overlay.current;if(!el)return;const ctx=el.getContext('2d');if(!ctx)return;
  el.width=size.width*dpr;el.height=size.height*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,size.width,size.height);
  if(cursor==null||histogram)return;const b=bounds.current,r=plotRect.current,css=getComputedStyle(el);
  ctx.save();ctx.beginPath();ctx.rect(r.left,r.top,r.right-r.left,r.bottom-r.top);ctx.clip();
  for(const lap of result.laps){let selected:AdvancedPoint|undefined,dist=Infinity;for(const p of lap.points){const position=inspectPosition?inspectPosition(lap.lapId,p.position):p.position;if(position!=null&&Math.abs(position-cursor)<dist){dist=Math.abs(position-cursor);selected=p;}}
   if(selected){const x=r.left+(transform(selected.x,'x')-b[0])/(b[1]-b[0])*(r.right-r.left),y=r.bottom-(transform(selected.y,'y')-b[2])/(b[3]-b[2])*(r.bottom-r.top);if(!Number.isFinite(x)||!Number.isFinite(y))continue;ctx.strokeStyle=css.getPropertyValue(lap.lapId===primaryLapId?'--cyan':'--amber').trim();ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.stroke();}
  }ctx.restore();
 },[cursor,result,primaryLapId,config,size,dpr,view,inspectPosition,active,theme]);
 const nearest=(e:React.PointerEvent<HTMLCanvasElement>)=>{const rect=e.currentTarget.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;if(histogram){const bin=binHits.current.find(b=>x>=b.left&&x<=b.right&&y>=b.top&&y<=b.bottom);return bin?{kind:'bin' as const,bin:bin.bin,lap:bin.lap}:null;}let best:typeof hit.current[number]|null=null,dist=144;for(const p of hit.current){const d=(p.x-x)**2+(p.y-y)**2;if(d<dist){dist=d;best=p;}}return best?{kind:'point' as const,p:best.p,lap:best.lap}:null;};
 const zoomAt=(delta:number,x?:number,y?:number)=>{const b=bounds.current,f=delta>0?1.15:.87,r=plotRect.current,fx=x==null?.5:Math.max(0,Math.min(1,(x-r.left)/(r.right-r.left))),fy=y==null?.5:1-Math.max(0,Math.min(1,(y-r.top)/(r.bottom-r.top))),cx=b[0]+fx*(b[1]-b[0]),cy=b[2]+fy*(b[3]-b[2]);setView([cx+(b[0]-cx)*f,cx+(b[1]-cx)*f,cy+(b[2]-cy)*f,cy+(b[3]-cy)*f]);};
 useEffect(()=>{const el=canvas.current;if(!el)return;const wheel=(e:WheelEvent)=>{e.preventDefault();const rect=el.getBoundingClientRect();zoomAt(e.deltaY,e.clientX-rect.left,e.clientY-rect.top);};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);},[]);
 const onKeyDown=(e:React.KeyboardEvent<HTMLCanvasElement>)=>{
  if(['+','=','-','Home','Escape','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))e.preventDefault();else return;
  if(e.key==='Home'||e.key==='Escape'){setView(null);setHover(null);return;}
  if(['+','=','-'].includes(e.key)){zoomAt(e.key==='-'?1:-1);return;}
  const b=bounds.current;
  if(e.shiftKey&&e.key.startsWith('Arrow')){const dx=(b[1]-b[0])*.1*(e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0),dy=(b[3]-b[2])*.1*(e.key==='ArrowDown'?-1:e.key==='ArrowUp'?1:0);setView([b[0]+dx,b[1]+dx,b[2]+dy,b[3]+dy]);return;}
  if(e.key==='Enter'){if(hover?.kind==='point'){const p=inspectPosition?inspectPosition(result.laps[hover.lap].lapId,hover.p.position):hover.p.position;if(p!=null&&Number.isFinite(p))onCursor(p);}return;}
  if(histogram){const bins=binHits.current;if(!bins.length)return;keyboardPoint.current=(keyboardPoint.current+(e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:1)+bins.length)%bins.length;const bin=bins[keyboardPoint.current];setHover({kind:'bin',bin:bin.bin,lap:bin.lap});}
  else{const points=hit.current;if(!points.length)return;keyboardPoint.current=(keyboardPoint.current+(e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:1)+points.length)%points.length;const point=points[keyboardPoint.current];setHover({kind:'point',p:point.p,lap:point.lap});}
 };
 return <div className="analysis-surface" ref={host}><canvas ref={canvas} style={{width:'100%',height:size.height}} aria-label={`${result.tool} visualization`} role="img" tabIndex={0} aria-description="Arrow keys inspect samples; Enter synchronizes the cursor. Plus and minus zoom, Shift and arrows pan, Home resets." onKeyDown={onKeyDown} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,view:bounds.current,moved:false};}} onPointerMove={e=>{const d=drag.current;if(d){const r=plotRect.current,dx=(e.clientX-d.x)/(r.right-r.left)*(d.view[1]-d.view[0]),dy=(e.clientY-d.y)/(r.bottom-r.top)*(d.view[3]-d.view[2]);if(Math.abs(e.clientX-d.x)+Math.abs(e.clientY-d.y)>4)d.moved=true;if(d.moved)setView([d.view[0]-dx,d.view[1]-dx,d.view[2]+dy,d.view[3]+dy]);}else{const p=nearest(e);setHover(p);}}} onPointerUp={e=>{if(drag.current&&!drag.current.moved){const p=nearest(e);if(p){setHover(p);if(p.kind==='point'){const position=inspectPosition?inspectPosition(result.laps[p.lap].lapId,p.p.position):p.p.position;if(position!=null&&Number.isFinite(position))onCursor(position);}}}drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onPointerLeave={()=>setHover(null)} onDoubleClick={()=>setView(null)}/>
 <canvas ref={overlay} className="analysis-cursor-layer" aria-hidden="true" style={{width:'100%',height:size.height}}/>
 <div className="surface-footer"><span>Scroll to zoom · Drag to pan · Click to inspect</span><div className="plot-view-actions"><button aria-label="Zoom out analysis plot" onClick={()=>zoomAt(1)}>−</button><button aria-label="Zoom in analysis plot" onClick={()=>zoomAt(-1)}>+</button><button onClick={()=>setView(null)}>Reset view</button></div></div>
 {excluded>0&&<div className="render-exclusions">{excluded} {histogram?'histogram bins':'scatter points'} excluded from rendering: nonpositive log values or nonfinite values.</div>}
 {histogram&&!result.laps.some(l=>l.histogram.some(renderableBin))&&<div className="surface-empty">No bins can be rendered on these axis scales.</div>}
 {hover?.kind==='bin'&&<output className="point-inspector">{result.laps[hover.lap].lapId===primaryLapId?'Primary':'Comparison'} · Lap {result.laps[hover.lap].lapId} · Common bin {fmt(hover.bin.low)}–{fmt(hover.bin.high)} {result.xUnit} · {fmt(hover.bin.value)} {config.percentage?'%':config.weighting==='time'?'s':'samples'} · {config.weighting} weighting · Aggregate bin</output>}
 {hover?.kind==='point'&&<output className="point-inspector">{result.laps[hover.lap].lapId===primaryLapId?'Primary':'Comparison'} · X {fmt(hover.p.x)} {result.xUnit} · Y {fmt(hover.p.y)} {result.yUnit} · Source {hover.p.sourceTime.toFixed(3)} s{hover.p.position==null?' · Position unavailable':` · Position ${hover.p.position.toFixed(2)}`}{inspectPosition&&inspectPosition(result.laps[hover.lap].lapId,hover.p.position)==null?' · Informational: no shared timeline correspondence':''}</output>}
 {!result.laps.some(l=>l.points.length||l.histogram.length)&&<div className="surface-empty">No supported samples for this selection. Check channels, filters and data notes.</div>}
 </div>;
}
