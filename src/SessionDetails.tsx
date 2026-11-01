import {useEffect,useRef,useState} from 'react';
import type {LibraryEntry} from './types';
import {recordingDay} from './sessionExplorer';
interface Props {entry:LibraryEntry;onSave:(name:string,driver:string,recordedAt:string)=>Promise<void>;onClose:()=>void}
export default function SessionDetails({entry,onSave,onClose}:Props){
  const initialDate=recordingDay(entry.recordedAt);
  const [name,setName]=useState(entry.name),[driver,setDriver]=useState(entry.driver),[date,setDate]=useState(initialDate),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();return()=>{dialog.current?.close();if(previous?.isConnected)previous.focus();};},[]);
  const save=async()=>{if(busy)return;if(!name.trim()){setError('Enter a session name.');return;}setBusy(true);setError('');try{await onSave(name,driver,date===initialDate?entry.recordedAt:date);onClose();}catch(e){setError(String(e));}finally{setBusy(false);}};
  return <dialog ref={dialog} className="merge-dialog session-details" aria-labelledby="session-details-title" onKeyDown={e=>{e.stopPropagation();}} onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
    <form onSubmit={e=>{e.preventDefault();void save();}}>
      <h2 id="session-details-title">Edit session details</h2>
      <label>Session name<input autoFocus required maxLength={200} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label>
      <label>Recording date<input type="date" min="1970-01-01" max="9999-12-31" value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/></label>
      <label>Driver<input maxLength={200} value={driver} disabled={busy} onChange={e=>setDriver(e.target.value)}/></label>
      {error&&<p role="alert" className="merge-error">{error}</p>}
      <div className="merge-actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" disabled={busy}>{busy?'Saving…':'Save'}</button></div>
    </form>
  </dialog>;
}
