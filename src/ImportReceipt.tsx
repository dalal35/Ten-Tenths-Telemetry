import Icon from './Icon';
import {displaySessionName,displayTrack} from './sessionNames';
import {motion,useIsPresent,useReducedMotion} from 'motion/react';
import type {ImportReceipt} from './importExperience';

const labels={reading:'Reading XRK',added:'Added to library',existing:'Already in library',reconnected:'Source reconnected',error:'Could not import'};
export default function ImportReceiptPanel({receipt,onClose,onImport,onSelect,disabled,blocked,canOpen}:{receipt:ImportReceipt;onClose:()=>void;onImport:()=>void;onSelect:(id:string)=>void;disabled:boolean;blocked:boolean;canOpen:(id:string)=>boolean}) {
 const reduced=useReducedMotion(),present=useIsPresent();
 const complete=receipt.phase==='complete',finished=receipt.rows.filter(r=>r.status!=='reading').length;
 const failures=receipt.rows.filter(r=>r.status==='error').length;
 const warnings=receipt.rows.some(r=>r.warnings?.length);
 const title=!complete?receipt.phase==='choosing'?'Choose your recordings':'Reading your recordings':receipt.error?'Import needs attention':failures?'Import complete with issues':'Your recordings are ready';
 return <motion.aside className="import-receipt" role="region" aria-label="Telemetry import" tabIndex={-1} hidden={blocked} inert={blocked||!present} aria-hidden={blocked||!present||undefined}
  initial={reduced?false:{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,transition:{duration:reduced?0:.12}}} transition={{duration:reduced?0:.22}}
  onKeyDown={event=>{if(event.key==='Escape'&&complete){event.stopPropagation();onClose();}}}>
  <header><div><h2>{title}</h2></div>{complete&&<button className="receipt-dismiss" aria-label="Dismiss import summary" onClick={onClose}><Icon name="close"/></button>}</header>
  <p className="receipt-status" role="status" aria-live="polite">{receipt.phase==='choosing'?'Select one or more AiM XRK files in the file picker.':complete?`${finished-failures} ready${failures?` · ${failures} failed`:''}${warnings?' · review data notes below':''}`:`${finished} of ${receipt.total} files processed · reading locally`}</p>
  {!complete&&receipt.phase==='reading'&&<progress aria-label="Files processed" value={finished} max={receipt.total}/>}
  <div className="receipt-results">{receipt.rows.map(row=><article className="receipt-row" key={row.index} data-status={row.status}>
   <div className="receipt-file"><span className="receipt-file-icon" aria-hidden="true">{row.status==='error'?'!':row.status==='reading'?'…':'✓'}</span><div><strong title={row.path}>{row.file}</strong><span>{labels[row.status]}</span></div></div>
   {row.sessionId&&<div className="receipt-recording"><p>{displayTrack(row.track??'')||displaySessionName(row.name??'')}</p><span>{row.laps} laps <span aria-hidden="true">·</span> {row.channels} channels</span>{row.status==='existing'&&<small>Saved workspace preserved.</small>}{!canOpen(row.sessionId)&&complete&&<small>Recording unavailable. Review it in the session library.</small>}<button disabled={disabled||!canOpen(row.sessionId)} onClick={()=>{onSelect(row.sessionId!);onClose();}} aria-label={`Open recording ${row.name}`}>Open recording <span aria-hidden="true">↗</span></button></div>}
   {row.error&&<p className="receipt-issue">{row.error}</p>}
   {!!row.warnings?.length&&<details className="receipt-notes"><summary>{row.warnings.length} data {row.warnings.length===1?'note':'notes'}</summary><ul>{row.warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul></details>}
  </article>)}</div>
  {receipt.error&&<p className="receipt-issue" role="alert">{receipt.error}</p>}
  {complete&&<footer><p>{failures||receipt.error?'Review the file and try again. Successful recordings stay in your library.':'Choose a lap, then add a comparison with ＋ in the explorer.'}</p><div><button disabled={disabled} onClick={onImport}>Import more</button><button className="receipt-done" onClick={onClose}>Done</button></div></footer>}
 </motion.aside>;
}
