import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import Plots from '../src/Plots';
import '../src/styles.css';
import '../src/design-system.css';
import type {Analysis} from '../src/types';

const series=(values:number[])=>({channelId:'speed',name:'Speed',unit:'mph',x:[0,50,100],values});
const lap=(lapId:string,values:number[])=>({lapId,duration:10,length:100,mapping:[],track:[],warnings:[],series:[series(values)]});
const analysis:Analysis={primary:lap('a',[10,20,30]),comparison:lap('b',[11,21,31]),alignment:{method:'spatial',referenceLength:100,positionUncertaintyM:null,timingUncertaintyS:null,coverage:1,notes:[]},segments:[],delta:{x:[0,50,100],values:[0,-.25,.5],method:'spatial',uncertaintySeconds:null},warnings:[]};
function Test(){
 const [cursor,setCursor]=useState<number|null>(null),[unavailable,setUnavailable]=useState(false);
 return <div className="app premium"><button onClick={()=>setUnavailable(!unavailable)}>Toggle unavailable delta</button><output>{cursor}</output><Plots analysis={unavailable?{...analysis,delta:null}:analysis} axis="distance" onCursor={setCursor} resetVersion={0} cursor={cursor}/></div>;
}
createRoot(document.getElementById('root')!).render(<Test/>);
