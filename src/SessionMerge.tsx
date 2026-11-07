import {displaySessionName,recordingLabel} from './sessionNames';
import {useEffect,useRef,useState} from 'react';
import {motion,useIsPresent,useReducedMotion} from 'motion/react';
import {motionTokens} from './motion';
import type {LibraryEntry,MergePreview} from './types';
interface Props {preview:MergePreview;entries:LibraryEntry[];busy:boolean;error:string;onConfirm:(acknowledged:boolean)=>void;onCancel:()=>void}
export default function SessionMerge({preview,entries,busy,error,onConfirm,onCancel}:Props){
  const [acknowledged,setAcknowledged]=useState(false),dialog=useRef<HTMLElement>(null);
  const present=useIsPresent(),reduced=useReducedMotion();
  useEffect(()=>{if(!present)return;const previous=document.activeElement as HTMLElement|null;dialog.current?.focus({preventScroll:true});return()=>previous?.focus();},[present]);
  return <motion.div className="merge-backdrop" inert={!present} aria-hidden={!present||undefined} initial={{opacity:reduced?1:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:reduced?0:.12}}><motion.section ref={dialog} tabIndex={-1} className="merge-dialog library-merge" role="dialog" aria-modal="true" aria-labelledby="merge-title" initial={reduced?false:{scale:.985,y:8}} animate={{scale:1,y:0}} exit={reduced?{transition:{duration:0}}:{scale:.995,y:2,transition:{duration:.12}}} transition={reduced?{duration:0}:motionTokens.spring} onKeyDown={event=>{
    if(event.key==='Escape'&&!busy){event.stopPropagation();onCancel();}
    if(event.key==='Tab'){const controls=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')??[]),first=controls[0],last=controls.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  }}>
    <h2 id="merge-title">Merge sessions</h2>
    <p className="library-dialog-intro">Combine recordings into one session, with laps ordered oldest first. Unmerge any time to show them separately again.</p>
    <div className="merge-overview"><span><strong>{preview.sources.length}</strong> recordings</span><span><strong>{preview.laps.length}</strong> laps</span><span><strong>{preview.day}</strong> recording day</span></div>
    <div className="merge-source-heading">RECORDINGS TO COMBINE</div>
    <ul className="merge-source-list">{preview.sources.map((source,index)=>{const entry=entries.find(e=>e.id===source.sessionId);return <li key={source.sessionId}><span className="merge-source-index">{String(index+1).padStart(2,'0')}</span><span><strong>{entry?displaySessionName(entry.name)||recordingLabel(entry):source.sessionId}</strong><small>{entry?recordingLabel(entry):'Combined session'}{entry?` · ${entry.lapCount} laps`:''}</small></span></li>;})}</ul>
    <p className="merge-preserved">Original files and saved workspaces stay intact.</p>
    {preview.warnings.length>0&&<><h3>Review recording differences</h3><ul className="merge-warnings">{preview.warnings.map(w=><li key={w}>{w}</li>)}</ul><label className="merge-ack"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={e=>setAcknowledged(e.target.checked)}/> I have reviewed these warnings</label></>}
    {error&&<p role="alert" className="merge-error">{error} Cancel and review the sources again before retrying.</p>}
    <div className="merge-actions"><button disabled={busy} onClick={onCancel}>Cancel</button><button className="import-button" disabled={busy||preview.warnings.length>0&&!acknowledged} onClick={()=>onConfirm(acknowledged)}>{busy?'Merging…':'Confirm merge'}</button></div>
  </motion.section></motion.div>;
}
