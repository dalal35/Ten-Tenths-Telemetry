// Lean adaptation of React Bits CountUp's Motion animate/onUpdate/cleanup pattern.
// Source and MIT + Commons Clause notice are in ../../THIRD_PARTY_NOTICES.md.
// Only a user-selected lap summary animates. Cursor/trace values stay immediate.
import {animate,useReducedMotion} from 'motion/react';
import {useEffect,useRef} from 'react';
import {formatTime} from '../data';
export function LapTime({seconds}:{seconds:number}){
 const target=useRef<HTMLSpanElement>(null),previous=useRef(seconds),reduced=useReducedMotion();
 useEffect(()=>{
  const from=previous.current;previous.current=seconds;
  if(reduced||window.matchMedia('(prefers-reduced-motion: reduce)').matches){if(target.current)target.current.textContent=formatTime(seconds);return;}
  const control=animate(from,seconds,{duration:.28,ease:[.22,1,.36,1],onUpdate:value=>{if(target.current)target.current.textContent=formatTime(value);}});
  return()=>control.stop();
 },[seconds,reduced]);
 return <><span aria-hidden="true" ref={target}>{formatTime(seconds)}</span><span className="sr-only">{formatTime(seconds)}</span></>;
}
