import {useCallback,useLayoutEffect,useRef} from 'react';
import {flushSync} from 'react-dom';
import {createWorkspaceNavigator} from './workspaceNavigation';
import {LayoutGroup,motion,useReducedMotion} from 'motion/react';
import type {RefObject} from 'react';

// Motion owns spatial continuity; CSS owns control feedback. Chart cursors stay immediate.
export const motionTokens={
  spring:{type:'spring' as const,stiffness:420,damping:38,mass:.8},
  settle:{duration:.22,ease:[.22,1,.36,1] as const},
  quick:{duration:.14,ease:[.22,1,.36,1] as const},
};
const workspaces=[['telemetry','Telemetry'],['advanced','Advanced'],['video','Video'],['coach','AI Driving Coach']] as const;
export type WorkspaceView=typeof workspaces[number][0];

export function SelectionRail({group,value}:{group:string;value:string}){
  return <motion.span aria-hidden="true" className="selection-rail" layoutId={group} layoutDependency={value} transition={motionTokens.spring}/>;
}

export function WorkspaceTabs({value,onChange}:{value:WorkspaceView;onChange:(view:WorkspaceView)=>void}){
  return <LayoutGroup id="workspaces"><div className="workspace-switch segmented" aria-label="Workspace">
    {workspaces.map(([view,label])=><motion.button key={view} className={view===value?'active':''} aria-pressed={view===value} onClick={()=>onChange(view)}>
      {view===value&&<motion.span className="workspace-selection" layoutId="workspace-selection" transition={motionTokens.spring}/>}
      <span className="workspace-tab-label">{label}</span>
    </motion.button>)}
  </div></LayoutGroup>;
}

// Only the viewport is captured. The shell and live chart coordinate space never move.
export function useWorkspaceMotion(viewport:RefObject<HTMLElement|null>,view:WorkspaceView,sessionId:string,available=true){
  const reduced=useReducedMotion();
  const preference=useRef(reduced);preference.current=reduced;
  const requested=useRef(view);
  const navigator=useRef<ReturnType<typeof createWorkspaceNavigator>|null>(null);
  const fallback=useRef<Animation|null>(null);
  const positions=useRef(new Map<string,number>());
  useLayoutEffect(()=>{
    if(!available)return;requested.current=view;
    const host=viewport.current;
    let capture=0;
    const controller=createWorkspaceNavigator({
      commit:update=>flushSync(update),
      start:()=>typeof document.startViewTransition==='function'&&host?update=>{
        const ticket=++capture;
        host.style.viewTransitionName='workspace-content';
        const transition=document.startViewTransition(()=>{
          // Capture only the outgoing scene; a captured incoming tree loses hit-testing.
          if(ticket===capture)host.style.removeProperty('view-transition-name');
          update();
        });
        return transition;
      }:undefined,
      reduced:()=>preference.current===true||window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      fallback:()=>{
        fallback.current?.cancel();
        // Legacy WebKit swaps immediately. Avoid cloning canvas/video/large Coach trees.
        fallback.current=viewport.current?.animate([{opacity:.88},{opacity:1}],{duration:160,easing:'ease-out'})??null;
      },
    });
    navigator.current=controller;
    const interrupt=()=>{controller.skip();fallback.current?.cancel();fallback.current=null;};
    const inputHost=host?.parentElement;
    // Captured elements temporarily leave hit-testing. Listen on the stationary
    // parent and include their rectangle, even when the event targets that parent.
    const input=(event:Event)=>{
      if(!host||!controller.animating()&&!fallback.current)return;
      if(host.contains(event.target as Node)){interrupt();return;}
      const point=event instanceof MouseEvent?event:'touches' in event?(event as TouchEvent).touches[0]:null;
      if(!point)return;
      const rect=host.getBoundingClientRect();
      if(point.clientX>=rect.left&&point.clientX<=rect.right&&point.clientY>=rect.top&&point.clientY<=rect.bottom)interrupt();
    };
    inputHost?.addEventListener('pointerdown',input,true);
    inputHost?.addEventListener('pointermove',input,true);
    inputHost?.addEventListener('wheel',input,{passive:true,capture:true});
    inputHost?.addEventListener('keydown',input,true);
    inputHost?.addEventListener('touchstart',input,{passive:true,capture:true});
    window.addEventListener('resize',interrupt);
    const resize=new ResizeObserver(interrupt);if(host)resize.observe(host);
    return()=>{
      controller.dispose();++capture;host?.style.removeProperty('view-transition-name');fallback.current?.cancel();resize.disconnect();
      inputHost?.removeEventListener('pointerdown',input,true);inputHost?.removeEventListener('pointermove',input,true);inputHost?.removeEventListener('wheel',input,true);
      inputHost?.removeEventListener('keydown',input,true);inputHost?.removeEventListener('touchstart',input,true);
      window.removeEventListener('resize',interrupt);navigator.current=null;
    };
  },[viewport,sessionId,available]);
  useLayoutEffect(()=>{if(reduced){navigator.current?.skip();fallback.current?.cancel();}},[reduced]);
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
    requested.current=next;fallback.current?.cancel();
    if(navigator.current)navigator.current.navigate(update);else update();
  },[]);
}
