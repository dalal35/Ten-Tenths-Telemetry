import {displayTrack} from './sessionNames';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {motion,useIsPresent,useReducedMotion} from 'motion/react';
import {motionTokens} from './motion';
import type {LibraryEntry} from './types';
import {recordingDay} from './sessionExplorer';
interface Props {entry:LibraryEntry;onSave:(name:string,driver:string,recordedAt:string)=>Promise<void>;onClose:()=>void}
export default function SessionDetails({entry,onSave,onClose}:Props){
  const initialDate=recordingDay(entry.recordedAt);
  const [name,setName]=useState(entry.name),[driver,setDriver]=useState(entry.driver),[date,setDate]=useState(initialDate),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const dialog=useRef<HTMLDialogElement>(null),previousFocus=useRef<HTMLElement|null>(null);
  const present=useIsPresent(),reduced=useReducedMotion();
  useEffect(()=>{const node=dialog.current;return()=>{const owned=node?.contains(document.activeElement);node?.close();if(owned&&previousFocus.current?.isConnected)previousFocus.current.focus();};},[]);
  useLayoutEffect(()=>{
    const node=dialog.current;if(!node)return;
    if(present){
      if(!node.matches(':modal')){
        previousFocus.current=document.activeElement as HTMLElement|null;
        if(node.open)node.close();
        Object.assign(node.style,{position:'',inset:'',left:'',top:'',width:'',margin:'',zIndex:''});
        node.showModal();
      }
      return;
    }
    // Release native modality now, then let the same inert surface finish its
    // exit outside the top layer. A body portal keeps fixed coordinates stable.
    const rect=node.getBoundingClientRect(),width=node.offsetWidth;node.close();
    Object.assign(node.style,{position:'fixed',inset:'auto',left:`${rect.left}px`,top:`${rect.top}px`,width:`${width}px`,margin:'0',zIndex:'60'});
    node.open=true;
    if(previousFocus.current?.isConnected)previousFocus.current.focus();
  },[present]);
  const save=async()=>{if(busy)return;if(!name.trim()){setError('Enter a session name.');return;}setBusy(true);setError('');try{await onSave(name,driver,date===initialDate?entry.recordedAt:date);onClose();}catch(e){setError(String(e));}finally{setBusy(false);}};
  return createPortal(<motion.dialog ref={dialog} className="merge-dialog session-details" aria-labelledby="session-details-title" inert={!present} aria-hidden={!present||undefined}
    initial={reduced?false:{scale:.985,y:6,opacity:0}} animate={{scale:1,y:0,opacity:1}} exit={reduced?{opacity:0,transition:{duration:0}}:{scale:.995,y:2,opacity:0,transition:{duration:.12}}} transition={reduced?{duration:0}:motionTokens.spring}
    onKeyDown={e=>{e.stopPropagation();}} onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
    <form onSubmit={e=>{e.preventDefault();void save();}}>
      
      <h2 id="session-details-title">Edit session details</h2>
      <p className="library-dialog-intro">Keep the details in your library easy to recognize. Your original recording stays in place.</p>
      <div className="recording-summary" aria-label="Recording summary">
        <div className="recording-summary-source"><span>{entry.mergeSources?'Combined session':'Original recording'}</span><strong title={entry.source}>{entry.mergeSources?`${entry.mergeSources.length} source recordings`:entry.source.split(/[\\/]/).pop()||'Source unavailable'}</strong></div>
        <div className="recording-summary-stats"><span><strong>{entry.lapCount}</strong> laps</span><span><strong>{entry.channelCount}</strong> channels</span><span><strong>{displayTrack(entry.track)||'Unknown'}</strong> circuit</span></div>
      </div>
      <label>Session name<input autoFocus required maxLength={200} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label>
      <label>Recording date<input type="date" min="1970-01-01" max="9999-12-31" value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/></label>
      <label>Driver<input maxLength={200} value={driver} disabled={busy} onChange={e=>setDriver(e.target.value)}/></label>
      {error&&<p role="alert" className="merge-error">{error}</p>}
      <div className="merge-actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" disabled={busy}>{busy?'Saving…':'Save'}</button></div>
    </form>
  </motion.dialog>,document.body);
}
