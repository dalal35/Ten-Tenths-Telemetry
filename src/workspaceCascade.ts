// A workspace builds itself when you arrive: the shell holds still while content
// materialises in reading order, charts draw from left to right and numbers roll up to
// their recorded values. It animates mounted elements, so it owns no product state:
// nothing remounts, input is live from the first frame, and the next navigation cancels it.
export const cascadeTokens={rise:12,scale:.985,blur:8,duration:460,stagger:55,maxDelay:480,rowBand:24,ease:'cubic-bezier(.22,1,.36,1)',draw:760,drawEase:'cubic-bezier(.45,0,.15,1)',count:900,lateWindow:2500};

// Outer panels are deliberately absent: they are the stationary ground the pieces land on.
const pieceSelector=[
  '.chart-toolbar','.plot-row','.plots>.axis-label',
  '.track-instruments','.track-map-frame','.track-position-control','.segment-section','.reading-guide',
  '.advanced-heading','.advanced-nav','.analysis-panel-heading','.analysis-setup','.analysis-legend','.analysis-surface','.analysis-statistics',
  '.video-studio-heading','.video-sticky-player','.video-sync-inspector','.video-timeline',
  '.coach-heading','.coach-stat','.coach-overview>.import-button','.coach-empty','.coach-advanced','.coach-opportunities','.coach-focus-column>*','.coach-lap-intelligence','.coach-corner-review','.coach-full-lap',
].join(',');
const chartSelector='.plot-row,.analysis-surface';
const counterSelector='.track-instruments strong,.segment-delta,.stat-metrics dd,.video-instrument strong,.coach-stat strong';
const lineSelector='.primary-line,.coach-circuit-line,.coach-profile-line.actual';

export interface CascadePiece{left:number;top:number;media:boolean}
export interface CascadeStep<T extends CascadePiece>{piece:T;delay:number;rise:number}

export function planCascade<T extends CascadePiece>(pieces:T[]):CascadeStep<T>[]{
  const rows:T[][]=[];
  for(const piece of [...pieces].sort((a,b)=>a.top-b.top)){
    const row=rows.at(-1);
    if(row&&piece.top-row[0].top<=cascadeTokens.rowBand)row.push(piece);else rows.push([piece]);
  }
  const ordered=rows.flatMap(row=>row.sort((a,b)=>a.left-b.left));
  const step=Math.min(cascadeTokens.stagger,cascadeTokens.maxDelay/Math.max(1,ordered.length-1));
  // Charts stay put: uPlot caches its pointer rectangle, so a moving chart would misread the cursor.
  return ordered.map((piece,index)=>({piece,delay:Math.round(index*step),rise:piece.media?0:cascadeTokens.rise}));
}

export interface Counter{prefix:string;suffix:string;value:number;minutes:boolean;decimals:number;grouped:boolean}

const counterPattern=/^([^\d\p{L}]*?)(?:(\d+):(\d{2}(?:\.\d+)?)|((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?))([^\d]*)$/u;

/** A single number in display text, or null when there is nothing to roll (zero, ranges, words). */
export function parseCounter(text:string):Counter|null{
  const match=counterPattern.exec(text);
  if(!match)return null;
  const [,prefix,minutes,seconds,plain,suffix]=match;
  const digits=minutes?seconds:plain;
  const decimals=digits.split('.')[1]?.length??0;
  const value=minutes?Number(minutes)*60+Number(seconds):Number(plain.replaceAll(',',''));
  if(!value)return null;
  return {prefix,suffix,value,minutes:!!minutes,decimals,grouped:!minutes&&plain.includes(',')};
}

export function formatCounter(counter:Counter,value:number):string{
  const {prefix,suffix,minutes,decimals,grouped}=counter;
  let body:string;
  if(minutes){
    const whole=Math.floor(value/60);
    body=`${whole}:${(value-whole*60).toFixed(decimals).padStart(decimals?decimals+3:2,'0')}`;
  }else if(grouped){
    body=value.toLocaleString('en-US',{minimumFractionDigits:decimals,maximumFractionDigits:decimals});
  }else body=value.toFixed(decimals);
  return prefix+body+suffix;
}

const noop=()=>{};
const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Machines the glass layer already marks as weak get the build without blur. */
const staticGlass=()=>document.documentElement.dataset.glassQuality==='static';

interface Roll{node:Text;counter:Counter;original:string;written:string;start:number}

/** Starts the build for what is on screen in `root`. Returns the cancel for the next navigation. */
export function runWorkspaceCascade(root:HTMLElement,{countSummary=false}:{countSummary?:boolean}={}):()=>void{
  if(typeof root.animate!=='function'||reducedMotion())return noop;
  const viewport=root.closest<HTMLElement>('.workspace-viewport')??root;
  const animations:Animation[]=[],glints:HTMLElement[]=[],rolls:Roll[]=[];
  const seen=new WeakSet<Element>();
  const blur=staticGlass()?0:cascadeTokens.blur;
  const startedAt=performance.now();
  let frame=0,lateFrame=0;

  const draw=(element:HTMLElement,delay:number)=>{
    const timing={id:'workspace-cascade-draw',duration:cascadeTokens.draw,delay:delay+90,easing:cascadeTokens.drawEase,fill:'backwards' as const};
    // A mask, not a clip: clipped pixels stop taking the pointer, and these canvases hit-test themselves.
    if(element.matches('.analysis-surface'))for(const canvas of element.querySelectorAll('canvas')){
      const mask={maskImage:'radial-gradient(circle closest-side,#000 72%,transparent)',maskRepeat:'no-repeat',maskPosition:'center'};
      animations.push(canvas.animate([{...mask,maskSize:'0% 0%'},{...mask,maskSize:'320% 320%'}],timing));
    }
    for(const plot of element.querySelectorAll<HTMLElement>('.uplot')){
      const canvas=plot.querySelector('canvas'),over=plot.querySelector('.u-over');
      if(!canvas||!over)continue;
      const box=canvas.getBoundingClientRect(),area=over.getBoundingClientRect(),own=plot.getBoundingClientRect();
      if(!box.width||!area.width)continue;
      // Axes are there at once; the traces draw across them behind a travelling edge of light.
      const hidden=(box.right-area.left)/box.width*100;
      animations.push(canvas.animate({clipPath:[`inset(-4px ${hidden}% -4px -4px)`,'inset(-4px -4px -4px -4px)']},timing));
      const glint=document.createElement('span');
      glint.className='cascade-glint';glint.setAttribute('aria-hidden','true');
      Object.assign(glint.style,{left:`${area.left-own.left}px`,top:`${area.top-own.top}px`,height:`${area.height}px`});
      plot.append(glint);glints.push(glint);
      const travel=glint.animate({transform:['translateX(0)',`translateX(${area.width}px)`]},timing);
      animations.push(travel,glint.animate({opacity:[0,1,1,0],offset:[0,.08,.86,1]},{...timing,easing:'linear'}));
      travel.finished.then(()=>glint.remove(),()=>glint.remove());
    }
    for(const line of element.querySelectorAll<SVGPathElement>(lineSelector)){
      const length=line.getTotalLength?.();
      if(!length)continue;
      const dash=`${length} ${length}`;
      animations.push(line.animate([{strokeDasharray:dash,strokeDashoffset:length},{strokeDasharray:dash,strokeDashoffset:0}],{...timing,duration:cascadeTokens.draw+180}));
    }
  };

  const tick=(now:number)=>{
    let pending=false;
    for(const item of rolls){
      if(!item.written)continue;
      // React updated this value: the live number wins immediately.
      if(item.node.nodeValue!==item.written){item.written='';continue;}
      const progress=Math.min(1,Math.max(0,(now-item.start)/cascadeTokens.count));
      if(progress>=1){item.node.nodeValue=item.original;item.written='';continue;}
      item.written=formatCounter(item.counter,item.counter.value*(1-(1-progress)**4));
      item.node.nodeValue=item.written;pending=true;
    }
    frame=pending?requestAnimationFrame(tick):0;
  };

  const roll=(scope:Element,delay:number)=>{
    const targets=scope.matches(counterSelector)?[scope]:Array.from(scope.querySelectorAll(counterSelector));
    for(const target of targets){
      const node=Array.from(target.childNodes).find((child):child is Text=>child.nodeType===Node.TEXT_NODE&&/\d/.test(child.nodeValue??''));
      const original=node?.nodeValue??'',counter=parseCounter(original);
      if(!node||!counter)continue;
      const written=formatCounter(counter,0);
      node.nodeValue=written;
      rolls.push({node,counter,original,written,start:performance.now()+delay});
    }
    if(rolls.length&&!frame)frame=requestAnimationFrame(tick);
  };

  const build=()=>{
    const bounds=viewport.getBoundingClientRect();
    const pieces=Array.from(root.querySelectorAll<HTMLElement>(pieceSelector)).flatMap(element=>{
      if(seen.has(element))return [];
      // One owner per element: a nested piece would multiply its parent's opacity.
      if(element.parentElement?.closest(pieceSelector))return [];
      const rect=element.getBoundingClientRect();
      if(!rect.width||!rect.height||rect.bottom<=bounds.top||rect.top>=bounds.bottom)return [];
      return [{element,left:rect.left,top:rect.top,media:element.matches(chartSelector)||!!element.querySelector('canvas')}];
    });
    for(const {piece,delay,rise} of planCascade(pieces)){
      seen.add(piece.element);
      const from:Keyframe={opacity:0};
      if(rise)from.transform=`translateY(${rise}px) scale(${cascadeTokens.scale})`;
      if(blur)from.filter=`blur(${blur}px)`;
      animations.push(piece.element.animate([from,{}],{id:'workspace-cascade',duration:cascadeTokens.duration,delay,easing:cascadeTokens.ease,fill:'backwards'}));
      draw(piece.element,delay);
      roll(piece.element,delay);
    }
  };

  build();
  if(countSummary)for(const value of viewport.parentElement?.querySelectorAll('.lap-summary strong.mono')??[])roll(value,0);

  // A session's charts arrive after its analysis: late pieces join the same build.
  const late=new MutationObserver(()=>{
    if(performance.now()-startedAt>cascadeTokens.lateWindow){late.disconnect();return;}
    if(!lateFrame)lateFrame=requestAnimationFrame(()=>{lateFrame=0;build();});
  });
  late.observe(root,{childList:true,subtree:true});

  return ()=>{
    late.disconnect();cancelAnimationFrame(frame);cancelAnimationFrame(lateFrame);
    for(const animation of animations)animation.cancel();
    for(const glint of glints)glint.remove();
    for(const item of rolls)if(item.written&&item.node.nodeValue===item.written)item.node.nodeValue=item.original;
  };
}
