import {useEffect,useRef,useState} from 'react';
import {isTauri} from '@tauri-apps/api/core';
import {relaunch} from '@tauri-apps/plugin-process';
import {check,type Update} from '@tauri-apps/plugin-updater';
import {advanceDownload,downloadFraction,formatDownload,type DownloadProgress} from './updater';

type Phase={kind:'idle'}|{kind:'available'}|{kind:'downloading';progress:DownloadProgress}|{kind:'ready'}|{kind:'installing'}|{kind:'failed';message:string};

// Checks once per launch. An offline or failed check is never worth interrupting anyone for.
export function UpdatePrompt(){
  const [phase,setPhase]=useState<Phase>({kind:'idle'});
  const [version,setVersion]=useState('');
  const [hidden,setHidden]=useState(false);
  const update=useRef<Update|null>(null);
  useEffect(()=>{
    if(!isTauri())return;
    let cancelled=false;
    check().then(found=>{
      if(!found)return;
      if(cancelled){void found.close();return;}
      update.current=found;setVersion(found.version);setPhase({kind:'available'});
    }).catch(error=>console.warn('Update check failed',error));
    return ()=>{cancelled=true;};
  },[]);
  const download=async()=>{
    if(!update.current)return;
    let progress:DownloadProgress={downloaded:0,total:null};
    setHidden(false);setPhase({kind:'downloading',progress});
    try{
      await update.current.download(event=>{progress=advanceDownload(progress,event);setPhase({kind:'downloading',progress});});
      setHidden(false);setPhase({kind:'ready'});
    }catch(error){setHidden(false);setPhase({kind:'failed',message:`The download did not finish: ${String(error)}`});}
  };
  const install=async()=>{
    if(!update.current)return;
    setPhase({kind:'installing'});
    try{
      // Windows hands over to the installer and exits here; macOS needs the explicit relaunch.
      await update.current.install();
      await relaunch();
    }catch(error){setPhase({kind:'failed',message:`The update could not be installed: ${String(error)}`});}
  };
  const later=()=>{
    // Release the installer held in memory. The prompt returns next time the app opens.
    void update.current?.close().catch(()=>{});
    update.current=null;setPhase({kind:'idle'});
  };
  if(phase.kind==='idle'||hidden)return null;
  const fraction=phase.kind==='downloading'?downloadFraction(phase.progress):null;
  return <aside className="update-prompt" role="dialog" aria-modal="false" aria-labelledby="update-prompt-title" aria-describedby="update-prompt-text">
    <h2 id="update-prompt-title">{phase.kind==='failed'?'Update not installed':phase.kind==='ready'?`Version ${version} is ready`:phase.kind==='available'?'Update available':`Updating to ${version}`}</h2>
    <p id="update-prompt-text" role="status">
      {phase.kind==='available'&&`Ten Tenths Telemetry ${version} is ready to download. Your sessions and settings are kept.`}
      {phase.kind==='downloading'&&`Downloading ${formatDownload(phase.progress)}. You can keep working.`}
      {phase.kind==='ready'&&'Restart to finish installing. Your sessions and settings are kept.'}
      {phase.kind==='installing'&&'Installing. The app will reopen by itself.'}
      {phase.kind==='failed'&&phase.message}
    </p>
    {phase.kind==='downloading'&&<div className="update-progress" role="progressbar" aria-label="Update download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fraction===null?undefined:Math.round(fraction*100)}><span data-indeterminate={fraction===null||undefined} style={fraction===null?undefined:{transform:`scaleX(${fraction})`}}/></div>}
    {phase.kind!=='installing'&&<div className="update-actions">
      {phase.kind==='downloading'?<button type="button" onClick={()=>setHidden(true)}>Hide</button>:<button type="button" onClick={later}>Later</button>}
      {phase.kind==='available'&&<button type="button" className="update-primary" onClick={()=>void download()}>Update now</button>}
      {phase.kind==='ready'&&<button type="button" className="update-primary" onClick={()=>void install()}>Restart now</button>}
      {phase.kind==='failed'&&<button type="button" className="update-primary" onClick={()=>void download()}>Try again</button>}
    </div>}
  </aside>;
}
