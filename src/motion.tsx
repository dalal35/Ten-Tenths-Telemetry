import {useCallback,useLayoutEffect,useRef} from 'react';
import {flushSync} from 'react-dom';
import {createWorkspaceNavigator} from './workspaceNavigation';
import {LayoutGroup,motion,useIsPresent,useReducedMotion} from 'motion/react';
import type {HTMLMotionProps} from 'motion/react';
import type {RefObject} from 'react';

// Motion owns spatial continuity; CSS owns control feedback. Chart cursors stay immediate.
export const motionTokens={
  spring:{type:'spring' as const,stiffness:520,damping:42,mass:.85},
  settle:{duration:.22,ease:[.22,1,.36,1] as const},
  quick:{duration:.14,ease:[.22,1,.36,1] as const},
};
const workspaces=[['telemetry','Telemetry'],['advanced','Advanced'],['video','Video'],['coach','AI Driving Coach']] as const;
export type WorkspaceView=typeof workspaces[number][0];

// Presence never owns product state. Exiting surfaces immediately release input.
export function Surface({children,...props}:HTMLMotionProps<'div'>){
  const reduced=useReducedMotion(),present=useIsPresent();
  return <motion.div {...props} inert={!present||props.inert} aria-hidden={!present?true:props['aria-hidden']}
    initial={reduced?false:{y:-4,scale:.985}} animate={{y:0,scale:1,opacity:1}}
    exit={reduced?{opacity:0,transition:{duration:0}}:{y:-2,scale:.99,opacity:0,transition:{duration:.12,ease:[.4,0,1,1]}}}
    transition={reduced?{duration:0}:motionTokens.spring}>{children}</motion.div>;
}

function WorkspaceIcon({view}:{view:WorkspaceView}){
  return <svg className="workspace-icon" width="15" height="15" viewBox="0 0 20 20" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {view==='telemetry'?<path d="M2 14h3l3-8 4 10 3-7h3"/>:view==='advanced'?<><path d="M3 17V3m0 14h14"/><path d="m6 12 3-5 4 3 4-6"/></>:view==='video'?<><rect x="2" y="4" width="16" height="12" rx="2"/><path d="m8 7 5 3-5 3Z"/></>:<><path d="M4 14a7 7 0 1 1 12 0M5 16h10M8 10l2 2 4-5"/><path d="M10 2v2M3 8h2m10 0h2"/></>}
  </svg>;
}

export function SelectionRail({group,value}:{group:string;value:string}){
  return <motion.span aria-hidden="true" className="selection-rail" layoutId={group} layoutDependency={value} transition={motionTokens.spring}/>;
}

export function SelectionHighlight({group}:{group:string}){
  return <motion.span aria-hidden="true" className="control-selection" layoutId={group} transition={motionTokens.spring}/>;
}

export function AxisTabs({value,onChange}:{value:'distance'|'time';onChange:(axis:'distance'|'time')=>void}){
  return <LayoutGroup id="horizontal-axis"><div className="segmented axis-switch" aria-label="Horizontal axis">
    {(['distance','time'] as const).map(axis=><button key={axis} className={value===axis?'active':''} aria-pressed={value===axis} onClick={()=>onChange(axis)}>
      {value===axis&&<SelectionHighlight group="axis-selection"/>}{axis==='distance'?'Distance':'Time'}
    </button>)}
  </div></LayoutGroup>;
}

export function WorkspaceTabs({value,onChange,inert=false}:{value:WorkspaceView;onChange:(view:WorkspaceView)=>void;inert?:boolean}){
  return <LayoutGroup id="workspaces"><nav className="workspace-switch segmented" aria-label="Workspace" inert={inert}>
    {workspaces.map(([view,label])=><motion.button key={view} className={view===value?'active':''} aria-pressed={view===value} whileTap={{scale:.98}} onClick={()=>onChange(view)}>
      {view===value&&<motion.span className="workspace-selection" layoutId="workspace-selection" transition={motionTokens.spring}/>}
      <WorkspaceIcon view={view}/><span className="workspace-tab-label">{label}</span>
    </motion.button>)}
  </nav></LayoutGroup>;
}

// Navigation changes application state immediately; only the selected tab moves.
export function useWorkspaceMotion(viewport:RefObject<HTMLElement|null>,view:WorkspaceView,sessionId:string,available=true){
  const requested=useRef(view);
  const navigator=useRef<ReturnType<typeof createWorkspaceNavigator>|null>(null);
  const positions=useRef(new Map<string,number>());
  useLayoutEffect(()=>{
    if(!available)return;
    requested.current=view;
    const controller=createWorkspaceNavigator({
      commit:update=>flushSync(update),
      start:()=>undefined,
      reduced:()=>true,
      fallback:()=>{},
    });
    navigator.current=controller;
    return()=>{controller.dispose();navigator.current=null;};
  },[viewport,sessionId,available]);
  useLayoutEffect(()=>{
    if(!navigator.current?.pending())requested.current=view;
    const host=viewport.current;if(!host||!available)return;
    const key=`${sessionId}:${view}`,target=positions.current.get(key)??0;
    let restoring=true;
    const restore=()=>{
      if(!restoring)return;
      host.scrollTop=target;
      if(host.scrollHeight-host.clientHeight>=target-1)restoring=false;
    };
    restore();
    const resize=new ResizeObserver(restore);
    const observe=()=>{Array.from(host.children).forEach(child=>resize.observe(child));restore();};
    const mutations=new MutationObserver(observe);
    observe();mutations.observe(host,{childList:true});
    const interrupt=()=>{restoring=false;};
    host.addEventListener('wheel',interrupt,{passive:true});host.addEventListener('touchstart',interrupt,{passive:true});
    host.addEventListener('pointerdown',interrupt);host.addEventListener('keydown',interrupt);
    const remember=()=>{if(!restoring)positions.current.set(key,host.scrollTop);};
    host.addEventListener('scroll',remember,{passive:true});
    return()=>{
      host.removeEventListener('scroll',remember);host.removeEventListener('wheel',interrupt);host.removeEventListener('touchstart',interrupt);
      host.removeEventListener('pointerdown',interrupt);host.removeEventListener('keydown',interrupt);
      resize.disconnect();mutations.disconnect();
    };
  },[viewport,view,sessionId,available]);
  return useCallback((next:WorkspaceView,update:()=>void,semantic=false)=>{
    if(next===requested.current&&!semantic)return;
    requested.current=next;
    if(navigator.current)navigator.current.navigate(update);else update();
  },[]);
}
