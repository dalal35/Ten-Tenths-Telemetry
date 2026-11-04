import {motion,useReducedMotion} from 'motion/react';
import './onboarding.css';

const workspaces=[
 ['01','Telemetry','See the lap. Find the difference.','Overlay laps, trace your line and follow where time is gained or lost.'],
 ['02','Advanced','Go deeper into the data.','Explore channels, distributions and events in a connected analysis canvas.'],
 ['03','Video','Put every input in context.','Connect onboard footage to your telemetry with manual alignment.'],
 ['04','AI Coach','Turn evidence into a next step.','Review driving insights from your recording, with optional local AI explanations.'],
] as const;
export default function Welcome({onImport,busy,hasLibrary}:{onImport:()=>void;busy:boolean;hasLibrary:boolean}) {
 const reduced=useReducedMotion();
 return <section className="launch-workspace" aria-labelledby="launch-title">
  <motion.div className="launch-intro" initial={reduced?false:{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{duration:reduced?0:.35}}>
   <div className="launch-kicker"><span aria-hidden="true"/> TEN TENTHS TELEMETRY</div>
   {/* React Bits BlurText's soft-focus reveal, limited to one phrase and disabled for reduced motion. */}
   <h1 id="launch-title">Every lap.<br/>A little <motion.em initial={reduced?false:{opacity:0,filter:'blur(4px)'}} animate={{opacity:1,filter:'blur(0px)'}} transition={{duration:reduced?0:.4,delay:reduced?0:.05}}>closer.</motion.em></h1>
   <p className="launch-lead">Your line. Your inputs. Your next tenth.<br/>Bring the whole lap into focus.</p>
   <div className="launch-import">
    <div className="launch-import-heading"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h9l5 5v13H5zM14 3v6h5M12 17v-6m-3 3 3-3 3 3"/></svg><div><h2>{hasLibrary?'Continue your analysis':'Start with your first recording'}</h2><p>{hasLibrary?'Choose a session in the explorer or import another recording.':'Choose one recording, or bring in a whole day at the circuit.'}</p></div></div>
    <button className="import-button launch-import-button" disabled={busy} onClick={onImport}>{busy?'Reading telemetry…':'Import XRK recordings'}<span aria-hidden="true">↗</span></button>
    <p className="launch-file-note">AiM XRK · Select multiple files or drop them into the desktop app.</p>
    <div className="launch-local"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="8" width="12" height="9" rx="1"/><path d="M6 8V5a4 4 0 0 1 8 0v3"/></svg><span>Processed on your computer. Original recordings stay intact.</span></div>
   </div>
  </motion.div>
  <div className="launch-guide">
   <div className="launch-guide-heading"><span>ONE RECORDING. FOUR PERSPECTIVES.</span><span aria-hidden="true">TTT / 01</span></div>
   <div className="launch-racing-line" aria-hidden="true"><svg viewBox="0 0 520 165" fill="none"><path className="launch-road" d="M-20 129h150c70 0 54-92 116-92h57c66 0 36 94 111 94h126"/><motion.path className="launch-line" d="M-20 130h152c65 0 60-91 116-91h53c55 0 44 93 111 93h128" initial={reduced?false:{pathLength:0}} animate={{pathLength:1}} transition={{duration:reduced?0:.85,ease:'easeOut'}}/><path d="M244 19v40M260 19v40" stroke="currentColor" strokeDasharray="3 4"/></svg><span>FIND YOUR NEXT TENTH.</span></div>
   <div className="launch-perspectives">{workspaces.map(([number,title,lead,text],index)=><motion.details key={title} initial={reduced?false:{opacity:0,y:5}} animate={{opacity:1,y:0}} transition={{duration:reduced?0:.25,delay:reduced?0:index*.035}}><summary><span className="launch-number">{number}</span><span><strong>{title}</strong><small>{lead}</small></span><span className="launch-expand" aria-hidden="true">＋</span></summary><p>{text}</p></motion.details>)}</div>
   <p className="launch-guide-note">Import a recording to unlock your workspaces.<br/>Your lap selections and analysis are saved locally as you go.</p>
  </div>
 </section>;
}
