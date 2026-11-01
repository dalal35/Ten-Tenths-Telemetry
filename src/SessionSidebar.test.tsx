import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import SessionExplorer from './SessionSidebar';
import {defaultExplorerPreferences} from './sessionExplorer';
import type {LibraryEntry,Session} from './types';

const original=(id:string):LibraryEntry=>({id,source:`/recordings/Long recording filename ${id}.xrk`,name:`Run ${id}`,track:'Track',driver:'Driver',recordedAt:'2026-10-23',contentVersion:'v1',lapCount:1,channelCount:0,status:'ready',workspace:null,lastUsed:0});
const a=original('a'),b=original('b');
const combined:LibraryEntry={...a,id:'merge-100-ab',source:'',name:'Combined recordings',lapCount:2,mergeSources:[a,b].map(entry=>({sessionId:entry.id,contentVersion:entry.contentVersion}))};
const source=(entry:LibraryEntry):Session=>({...entry,laps:[{id:'lap',number:1,start:100,end:120,duration:20,complete:true}],warnings:[],channels:[]});
const sources=[a,b].map(entry=>({...combined.mergeSources!.find(ref=>ref.sessionId===entry.id)!,session:source(entry)}));
const laps=sources.map((source,i)=>({...source.session.laps[0],id:JSON.stringify([source.sessionId,'lap']),sourceSessionId:source.sessionId,sourceLapId:'lap',displayNumber:i+1}));
const session:Session={...source(combined),laps,merge:{sources,preview:{sources:combined.mergeSources!,laps,channels:[],day:'2026-10-23',previewVersion:'merged-v1',warnings:[]}}};
const noop=()=>{};
function render(entries:LibraryEntry[],activeSession:Session|undefined=session){
 return renderToStaticMarkup(<SessionExplorer entries={entries} session={activeSession} sessionId={activeSession?.id??''} primary={activeSession?.laps[0].id??''} comparison={null}
  preferences={{...defaultExplorerPreferences,grouping:'none'}} onPreferences={noop} narrow={false} drawerOpen={false} onDrawer={noop}
  busy={false} restoring={false} lifecycle={false} mergeMode={false} mergeError="" selectedIds={[]}
  onMergeMode={noop} onCancelMerge={noop} onMerge={noop} onMergeSelection={noop} onSelect={noop} onManage={noop} onEditDetails={async()=>{}} onLap={noop} onCompare={noop} onImport={noop}/>);
}
describe('combined session explorer',()=>{
 it('shows one combined row and simple lap numbers without source filename sublines',()=>{
  const html=render([a,b,combined]);
  expect(html.match(/class="library-entry /g)).toHaveLength(1);
  expect(html).toContain('SESSIONS <span>1</span>');
  expect(html).toContain('LAPS <span>2</span>');
  expect(html).toContain('Compare lap 2');
  expect(html).not.toContain('lap-source');
  expect(html).not.toContain('Long recording filename');
 });
 it('restores both source rows after unmerge',()=>{
  const html=render([a,b],source(a));
  expect(html.match(/class="library-entry /g)).toHaveLength(2);
  expect(html).toContain('SESSIONS <span>2</span>');
 });
 it('keeps unavailable original recordings and their repair actions reachable',()=>{
  const html=render([{...a,status:'missing'},b,{...combined,status:'missing'}],undefined);
  expect(html.match(/class="library-entry /g)).toHaveLength(3);
  expect(html).toContain('File missing · locate original');
  expect(html).toContain('Source unavailable · repair original recording');
  expect(html).toContain('Actions for Run a');
 });
});
