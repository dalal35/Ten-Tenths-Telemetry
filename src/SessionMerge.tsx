import {useEffect,useRef,useState} from 'react';
import type {LibraryEntry,MergePreview} from './types';
interface Props {preview:MergePreview;entries:LibraryEntry[];busy:boolean;error:string;onConfirm:(acknowledged:boolean)=>void;onCancel:()=>void}
export default function SessionMerge({preview,entries,busy,error,onConfirm,onCancel}:Props){
  const [acknowledged,setAcknowledged]=useState(false),dialog=useRef<HTMLElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();return()=>previous?.focus();},[]);
  return <div className="merge-backdrop"><section ref={dialog} className="merge-dialog" role="dialog" aria-modal="true" aria-labelledby="merge-title" onKeyDown={event=>{
    if(event.key==='Escape'&&!busy){event.stopPropagation();onCancel();}
    if(event.key==='Tab'){const controls=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')??[]),first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  }}>
    <div className="eyebrow">COMBINED SESSION</div><h2 id="merge-title">Merge sessions</h2>
    <p>{preview.sources.length} recordings · {preview.laps.length} laps · {preview.day}</p><p className="muted">Combine these recordings in one session, with laps ordered oldest first. Unmerge to show the recordings separately again. Original files and saved workspaces stay intact.</p>
    <ul>{preview.sources.map(source=>{const entry=entries.find(e=>e.id===source.sessionId);return <li key={source.sessionId}>{entry?.source.split(/[\\/]/).pop()||entry?.name||source.sessionId}</li>;})}</ul>
    {preview.warnings.length>0&&<><h3>Review recording differences</h3><ul className="merge-warnings">{preview.warnings.map(w=><li key={w}>{w}</li>)}</ul><label className="merge-ack"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={e=>setAcknowledged(e.target.checked)}/> I have reviewed these warnings</label></>}
    {error&&<p role="alert" className="merge-error">{error} Cancel and review the sources again before retrying.</p>}
    <div className="merge-actions"><button disabled={busy} onClick={onCancel}>Cancel</button><button className="import-button" disabled={busy||preview.warnings.length>0&&!acknowledged} onClick={()=>onConfirm(acknowledged)}>{busy?'Merging…':'Confirm merge'}</button></div>
  </section></div>;
}
