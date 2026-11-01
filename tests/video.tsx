import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {VideoWorkspace,type VideoWorkspaceProps} from '../src/video/VideoWorkspace';
import type {Session} from '../src/types';
import type {VideoSegment,VideoSource,VideoStateV1} from '../src/video/model';
import type {VideoPlayer} from '../src/video/player';
import {defaultVideoState} from '../src/video/state';
import '../src/styles.css';

const initialSession: Session = {id:'video-fixture',source:'generated',name:'Video fixture',driver:'',track:'Fixture circuit',recordedAt:'',channels:[],warnings:[],
  laps:[{id:'lap1',number:1,start:100,end:120,duration:20,complete:true},{id:'lap2',number:2,start:120,end:140,duration:20,complete:true},{id:'lap3',number:3,start:140,end:160,duration:20,complete:true},{id:'lap4',number:4,start:160,end:180,duration:20,complete:true}]};
  function Fixture() {
    const [session, setSession] = useState(initialSession);
    const [showVideo,setShowVideo]=useState(true);
    const [state, setState] = useState<VideoStateV1>(()=>defaultVideoState(session,'fixture-v1'));
    const [availability, setAvailability] = useState<VideoWorkspaceProps['availability']>('ready');
    const [telemetryTime, setTelemetry] = useState<number|null>(100);
    const [player, setPlayer] = useState<VideoPlayer|null>(null);
    const fixture = window as any;
    fixture.releaseBlocked??=false;
    fixture.releaseBarrier??=null;
    fixture.fixtureShowVideo=setShowVideo;
    fixture.fixtureState=state;
    fixture.fixtureSetState=setState;
    fixture.fixtureAvailability=setAvailability;
    fixture.fixtureTelemetry=setTelemetry;
    fixture.fixtureReset=()=>setState(defaultVideoState(session,'fixture-v1'));
    fixture.fixtureRestore=()=>setState({...defaultVideoState(session,'fixture-v1'),source:{type:'local',path:'/fixture/restore.mp4',size:100,modifiedMs:1},preferences:{panelHeight:400,pausedVideoTime:12,playbackRate:1.5}});
    fixture.fixtureYouTube=(source:Extract<VideoSource,{type:'youtube'}>,segments:VideoSegment[]=[])=>setState({...defaultVideoState(session,'fixture-v1'),source,segments,selectedSegmentId:segments[0]?.id??null});
    fixture.fixturePlayer=player;
    fixture.fixtureSession=session;
    fixture.fixtureSwitchSession=(next:Session)=>{setSession(next);setState(defaultVideoState(next,'fixture-v1'));};
    fixture.fixtureRerender=()=>setSession({...session,laps:session.laps.map(lap=>({...lap}))});
    fixture.fixtureLaps=(laps:Session['laps'])=>setSession({...session,laps});
    return <main style={{padding:24}}><h1>Onboard footage</h1><div className="workspace-body"><div className="chart-workspace">
      {showVideo&&<VideoWorkspace session={session} state={state} availability={availability} telemetryTime={telemetryTime} saveReady
        beforeRelease={async()=>{if(fixture.releaseBlocked)await new Promise<void>(resolve=>{fixture.releaseBarrier=resolve;});}}
        onChange={(next:VideoStateV1)=>{fixture.fixtureSaves=(fixture.fixtureSaves??0)+1;setState(next);}}
        onPlayer={setPlayer} onSeekTelemetry={(time:number)=>setTelemetry(time)} onSeekVideo={(time:number)=>{fixture.fixtureSeeks=[...(fixture.fixtureSeeks??[]),time];void player?.seek(time,new AbortController().signal);}}>
      <div className="chart-empty" style={{height:1600,alignItems:'start',paddingTop:30}}>Telemetry graphs loading…</div></VideoWorkspace>}
    </div><aside className="inspector">GPS inspector remains visible</aside></div><pre aria-label="Saved video state">{JSON.stringify(state)}</pre></main>;
  }
  createRoot(document.getElementById('root')!).render(<Fixture/>);
