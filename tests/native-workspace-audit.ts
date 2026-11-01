// Injected only by serve-workspace-transition-audit.mjs; never a production import.
export {};
const labels=['Telemetry','Advanced','Video','AI Driving Coach'];
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const report={
  capturedAt:new Date().toISOString(),userAgent:navigator.userAgent,
  nativeIPC:!!(window as unknown as {__TAURI_INTERNALS__?:unknown}).__TAURI_INTERNALS__,
  nativeViewTransitions:typeof document.startViewTransition==='function',reducedMotion:reduced.matches,
  environment:'Native development WebKit; instrumentation reads shell geometry per frame. Constrained mode is a 600×500 app surface, not an OS window resize.',
  idleRuns:[] as Record<string,unknown>[],transitions:[] as Record<string,unknown>[],runs:[] as Record<string,unknown>[],failures:[] as string[],captures:[] as Record<string,unknown>[],
};
const style=document.createElement('style');
style.textContent=`#workspace-native-audit{position:fixed;right:8px;bottom:32px;z-index:2147483647;max-width:calc(100vw - 16px);padding:6px 9px;border:1px solid #36cdd3;border-radius:4px;background:#101315ed;color:#dce8e8;font:10px/1.4 ui-monospace,monospace;pointer-events:none;white-space:pre-line}html.native-audit-compact .app{width:600px!important;height:500px!important;max-width:100vw;max-height:100vh}html.native-audit-compact #root{width:600px!important;height:500px!important;max-width:100vw;max-height:100vh}`;
document.head.append(style);
const hud=document.createElement('div');hud.id='workspace-native-audit';hud.setAttribute('role','status');
document.addEventListener('DOMContentLoaded',()=>document.body.append(hud),{once:true});
if(document.body)document.body.append(hud);
const say=(message:string)=>{hud.textContent=`NATIVE TRANSITION AUDIT · ${report.nativeViewTransitions?'snapshots supported':'legacy path'}\n${message}`;};
say('Alt+Shift+1–4 switch · P pause next · → step · R run pairs · M compact · S save');
const nodes=new WeakMap<Element,number>();let nextNode=0;
const nodeId=(selector:string)=>{const node=document.querySelector(selector);if(!node)return null;if(!nodes.has(node))nodes.set(node,++nextNode);return nodes.get(node);};
const active=()=>document.querySelector('.workspace-switch button.active')?.textContent?.trim()??null;
const frames=(count=1)=>new Promise<void>(resolve=>{const tick=()=>--count<=0?resolve():requestAnimationFrame(tick);requestAnimationFrame(tick);});
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const rects=()=>Object.fromEntries(['.titlebar','.explorer-slot','.workspace-heading','.lap-summary','.workspace-switch'].map(selector=>{
  const rect=document.querySelector(selector)?.getBoundingClientRect();
  return [selector,rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null];
}));
const rectDelta=(before:ReturnType<typeof rects>,after:ReturnType<typeof rects>)=>Math.max(0,...Object.keys(before).flatMap(selector=>{
  const a=before[selector],b=after[selector];return a&&b?[Math.abs(a.x-b.x),Math.abs(a.y-b.y),Math.abs(a.width-b.width),Math.abs(a.height-b.height)]:[0];
}));
const summary=(values:number[])=>{
  const sorted=[...values].sort((a,b)=>a-b);const quantile=(p:number)=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]??null;
  return {samples:sorted.length,medianMs:quantile(.5),p95Ms:quantile(.95),maxMs:sorted.at(-1)??null};
};
let armCapture=false,paused:Animation[]=[],captureTime=0,lastTransition:ViewTransition|null=null,running=false;
const nativeStart=document.startViewTransition?.bind(document);
if(nativeStart){
  document.startViewTransition=((...args:Parameters<Document['startViewTransition']>)=>{
    const started=performance.now(),from=active(),before=rects();let tracking=true,lastFrame:number|undefined,lastTick=started,maxShift=0;
    const intervals:number[]=[],loopLag:number[]=[],longTasks:number[]=[];
    const record:Record<string,unknown>={from,startedMs:started,mode:document.documentElement.classList.contains('native-audit-compact')?'constrained-600x500':'native-window',appSize:document.querySelector('.app')?.getBoundingClientRect().toJSON(),plotNode:nodeId('.uplot'),advancedCanvas:nodeId('.analysis-surface canvas'),videoNode:nodeId('video')};
    const sample=(now:number)=>{if(!tracking)return;if(lastFrame!==undefined)intervals.push(now-lastFrame);lastFrame=now;maxShift=Math.max(maxShift,rectDelta(before,rects()));requestAnimationFrame(sample);};requestAnimationFrame(sample);
    const timer=setInterval(()=>{const now=performance.now();loopLag.push(Math.max(0,now-lastTick-16));lastTick=now;},16);
    let observer:PerformanceObserver|undefined;
    if(PerformanceObserver.supportedEntryTypes.includes('longtask')){observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(entry=>entry.duration)));observer.observe({type:'longtask'});}
    const transition=nativeStart(...args);lastTransition=transition;
    transition.ready.then(()=>{
      record.readyMs=performance.now()-started;record.to=active();
      const animations=document.getAnimations().filter(animation=>['workspace-out','workspace-in'].includes((animation as CSSAnimation).animationName));
      record.snapshotAnimations=animations.map(animation=>({name:(animation as CSSAnimation).animationName,duration:animation.effect?.getTiming().duration}));
      if(armCapture){record.pausedCapture=true;armCapture=false;paused=animations;captureTime=0;for(const animation of paused){animation.pause();animation.currentTime=0;}report.captures.push({from,to:active(),timeMs:0,layers:paused.length,shell:rects()});say(`PAUSED ${from} → ${active()} at 0 / 220 ms · → advances55ms`);}
    }).catch(()=>{record.skipped=true;});
    transition.finished.then(()=>{
      tracking=false;clearInterval(timer);observer?.disconnect();record.finishedMs=performance.now()-started;record.to=active();record.shellMaxShiftPx=maxShift;record.frameIntervals=summary(intervals);record.frameIntervalsMs=intervals;record.eventLoopLag=summary(loopLag);record.eventLoopLagMs=loopLag;record.longTasksSupported=PerformanceObserver.supportedEntryTypes.includes('longtask');record.longTasksMs=longTasks;
      report.transitions.push(record);if(maxShift>1)report.failures.push(`Shell shifted ${maxShift.toFixed(2)}px during ${from} → ${active()}`);
    }).catch(error=>{tracking=false;clearInterval(timer);observer?.disconnect();report.failures.push(`Transition failed: ${String(error)}`);});
    return transition;
  }) as Document['startViewTransition'];
}
function choose(index:number){
  const button=Array.from(document.querySelectorAll<HTMLButtonElement>('.workspace-switch button')).find(button=>button.textContent?.trim()===labels[index]);
  if(!button)throw Error(`Workspace button unavailable: ${labels[index]}`);button.click();
}
async function settle(){
  const transition=lastTransition;if(transition)await Promise.race([transition.finished.catch(()=>{}),sleep(1400)]);
  await frames(3);
}
async function save(){
  const response=await fetch('/__workspace-transition-audit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(report)});
  if(!response.ok)throw Error(await response.text());
  say(`SAVED ${report.transitions.length} transitions · ${report.failures.length} failures · native-audit.json`);
}
async function run(){
  if(running)return;running=true;paused.forEach(animation=>animation.finish());paused=[];armCapture=false;
  const original=active(),originalCompact=document.documentElement.classList.contains('native-audit-compact');
  try{
    const idle:number[]=[];let idleLast=performance.now();for(let index=0;index<60;index++){await frames();const now=performance.now();idle.push(now-idleLast);idleLast=now;}report.idleRuns.push({appSize:document.querySelector('.app')?.getBoundingClientRect().toJSON(),frameIntervals:summary(idle),frameIntervalsMs:idle});
    for(const compact of [false,true]){
      document.documentElement.classList.toggle('native-audit-compact',compact);await frames(8);
      const begin=report.transitions.length;
      for(let from=0;from<4;from++)for(let to=0;to<4;to++)if(from!==to){
        say(`RUNNING ${compact?'600×500 surface':'native window'} · ${labels[from]} → ${labels[to]}`);
        choose(from);await settle();const before=rects();choose(to);await settle();
        const shift=rectDelta(before,rects());if(shift>1)report.failures.push(`Settled shell shifted ${shift.toFixed(2)}px: ${labels[from]} → ${labels[to]}`);
        if(active()!==labels[to])report.failures.push(`Stale workspace: wanted ${labels[to]}, saw ${active()}`);
      }
      say(`RAPID ${compact?'600×500 surface':'native window'} · 24 requests at35ms`);
      for(let index=0;index<24;index++){choose(index%4);await sleep(35);}await settle();
      if(active()!==labels[3])report.failures.push('Rapid switching did not end on AI Driving Coach');
      report.runs.push({mode:compact?'constrained-600x500':'native-window',transitions:report.transitions.length-begin,requestedPairs:12,rapidRequests:24,finalWorkspace:active()});
    }
  }catch(error){report.failures.push(String(error));}
  finally{
    document.documentElement.classList.toggle('native-audit-compact',originalCompact);await frames(5);
    const index=labels.indexOf(original??'');if(index>=0){choose(index);await settle();}
    running=false;await save();
  }
}
document.addEventListener('keydown',event=>{
  if(!event.altKey||!event.shiftKey)return;
  const number=/^Digit([1-4])$/.exec(event.code);
  if(number){event.preventDefault();choose(Number(number[1])-1);return;}
  if(!['KeyP','ArrowRight','KeyR','KeyM','KeyS'].includes(event.code))return;event.preventDefault();
  if(event.code==='KeyP'){armCapture=!armCapture;say(armCapture?'ARMED · switch workspace to pause its native snapshots':'Capture disarmed');}
  if(event.code==='ArrowRight'){
    captureTime=Math.min(220,captureTime+55);for(const animation of paused){animation.pause();animation.currentTime=captureTime;}
    report.captures.push({workspace:active(),timeMs:captureTime,mode:document.documentElement.classList.contains('native-audit-compact')?'constrained-600x500':'native-window',shell:rects()});
    say(`PAUSED ${active()} at ${captureTime} / 220 ms · ${paused.length} snapshot layers`);
    if(captureTime===220){paused.forEach(animation=>animation.finish());paused=[];}
  }
  if(event.code==='KeyR')void run().catch(error=>say(`ERROR ${String(error)}`));
  if(event.code==='KeyM'){document.documentElement.classList.toggle('native-audit-compact');say(document.documentElement.classList.contains('native-audit-compact')?'600×500 constrained app surface':'Native window surface');}
  if(event.code==='KeyS')void save().catch(error=>say(`ERROR ${String(error)}`));
});
