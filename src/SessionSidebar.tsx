import {displayDriver,displaySessionName,displayTrack,distinctRecordingLabels,lapName,recordingLabel} from './sessionNames';
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ReferenceMark,SelectionPlate,SelectionRail,Surface,motionTokens} from './motion';
import {AnimatePresence,motion,useIsPresent} from 'motion/react';
import SessionDetails from './SessionDetails';
import type {CSSProperties,ReactNode} from 'react';
import type {LibraryEntry,Session} from './types';
import type {ExplorerPreferences,SessionSort,SessionGrouping} from './sessionExplorer';
import {organizeSessions,formatRecordingDate} from './sessionExplorer';
import {fastestLap,formatTime} from './telemetry';
import {lapDisplayNumber,lapBoundaryLabel,visibleSessionEntries} from './merging';
import './library-premium.css';

type Action='refresh'|'locate'|'remove'|'unmerge';
interface Props {
  refined?:boolean;entries:LibraryEntry[];session?:Session;sessionId:string;primary:string;comparison:string|null;
  preferences:ExplorerPreferences;onPreferences:(p:ExplorerPreferences)=>void;
  narrow:boolean;drawerOpen:boolean;onDrawer:(open:boolean)=>void;
  busy:boolean;restoring:boolean;lifecycle:boolean;mergeMode:boolean;mergeError:string;selectedIds:string[];
  onMergeMode:()=>void;onCancelMerge:()=>void;onMerge:()=>void;onMergeSelection:(id:string,selected:boolean)=>void;
  onSelect:(entry:LibraryEntry)=>void;onManage:(entry:LibraryEntry,action:Action)=>void;
  onEditDetails:(entry:LibraryEntry,name:string,driver:string,recordedAt:string)=>Promise<void>;
  onLap:(id:string)=>void;onCompare:(id:string|null)=>void;onImport:()=>void;
}

// Portaled popovers stay clear of the independently scrolling session region.
function ExplorerPopover({anchor,onClose,children,label,menu=false,container}:{anchor:HTMLButtonElement;onClose:()=>void;children:ReactNode;label:string;menu?:boolean;container:HTMLElement|null}){
  const ref=useRef<HTMLDivElement>(null);
  const present=useIsPresent();
  const [position,setPosition]=useState({left:0,top:0});
  useLayoutEffect(()=>{
    if(!present)return;
    const place=()=>{const rect=anchor.getBoundingClientRect(),height=ref.current?.offsetHeight??160,width=ref.current?.offsetWidth??220;setPosition({left:Math.max(8,Math.min(rect.right-width,window.innerWidth-width-8)),top:Math.max(8,Math.min(rect.bottom+5,window.innerHeight-height-8))});};
    place();const observer=new ResizeObserver(place);if(ref.current)observer.observe(ref.current);
    const outside=(event:PointerEvent)=>{if(!ref.current?.contains(event.target as Node)&&!anchor.contains(event.target as Node))onClose();};
    // A click can queue an ancestor scroll before mounting this menu. Ignore that
    // stale event; only scrolling after the menu opened should dismiss it.
    const scrollPositions=new Map<Element,{top:number;left:number}>();
    for(let ancestor:Element|null=anchor.parentElement;ancestor;ancestor=ancestor.parentElement)scrollPositions.set(ancestor,{top:ancestor.scrollTop,left:ancestor.scrollLeft});
    const resize=()=>onClose();const scroll=(event:Event)=>{
      if(ref.current?.contains(event.target as Node))return;
      const target=event.target as Element,initial=scrollPositions.get(target);
      if(initial&&target.scrollTop===initial.top&&target.scrollLeft===initial.left)return;
      onClose();
    };document.addEventListener('pointerdown',outside);document.addEventListener('scroll',scroll,true);window.addEventListener('resize',resize);
    ref.current?.querySelector<HTMLElement>('button:not(:disabled),select')?.focus({preventScroll:true});
    return()=>{
      const popup=ref.current,ownedFocus=popup?.contains(document.activeElement);
      observer.disconnect();document.removeEventListener('pointerdown',outside);document.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',resize);
      if(ownedFocus)requestAnimationFrame(()=>{
        if(document.activeElement!==document.body&&!popup?.contains(document.activeElement))return;
        const candidates=[anchor,document.querySelector<HTMLButtonElement>('.explorer-rail button'),container?.querySelector<HTMLButtonElement>('button:not(:disabled)')];
        candidates.find(el=>el?.isConnected&&el.getClientRects().length&&!el.closest('[inert]'))?.focus();
      });
    };
  },[anchor,onClose,container,present]);
  const close=()=>{onClose();anchor.focus();};
  return createPortal(<Surface ref={ref} className="explorer-popover" style={position} role={menu?'menu':'dialog'} aria-label={label} onKeyDown={e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}
    if(menu&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const buttons=Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]),index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
    if(e.key==='Tab'){const controls=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select')??[]);if(e.shiftKey&&document.activeElement===controls[0]||!e.shiftKey&&document.activeElement===controls.at(-1)){e.preventDefault();close();}}
  }}>{children}</Surface>,container??document.body);
}

export default function SessionExplorer(p:Props){
  const {preferences,narrow,drawerOpen,session,entries}=p;
  const [closedGroups,setClosedGroups]=useState<Set<string>>(()=>new Set());
  const [popover,setPopover]=useState<{key:string;anchor:HTMLButtonElement}|null>(null);
  const [details,setDetails]=useState<LibraryEntry|null>(null);
  const [sidebarWidth,setSidebarWidth]=useState(()=>{
    try{const saved=Number(localStorage.getItem('apex-telemetry:explorer-width'));return saved>=220&&saved<=360?saved:236;}catch{return 236;}
  });
  const resizeStart=useRef<{x:number;width:number}|null>(null);
  const resizeWidth=(width:number)=>setSidebarWidth(Math.max(220,Math.min(360,Math.round(width))));
  useEffect(()=>{try{localStorage.setItem('apex-telemetry:explorer-width',String(sidebarWidth));}catch{/* Width remains usable without storage. */}},[sidebarWidth]);
  const sidebar=useRef<HTMLElement>(null),opener=useRef<HTMLButtonElement>(null);
  const closePopover=useMemo(()=>()=>setPopover(null),[]);
  const visibleEntries=useMemo(()=>visibleSessionEntries(entries),[entries]);
  const recordingLabels=useMemo(()=>distinctRecordingLabels(visibleEntries),[visibleEntries]);
  const groups=useMemo(()=>organizeSessions(visibleEntries,preferences.sort,preferences.grouping),[visibleEntries,preferences.sort,preferences.grouping]);
  const collapsed=preferences.sidebarState==='collapsed';
  const visible=narrow?drawerOpen:!collapsed;
  const sessionsVisible=preferences.sidebarState==='expanded'||!session||p.mergeMode;
  const best=session?fastestLap(session.laps):null;
  const changeState=(sidebarState:ExplorerPreferences['sidebarState'])=>{setPopover(null);p.onPreferences({...preferences,sidebarState});if(sidebarState==='collapsed')requestAnimationFrame(()=>opener.current?.focus());};
  const togglePopover=(key:string,anchor:HTMLButtonElement)=>setPopover(current=>current?.key===key?null:{key,anchor});
  useEffect(()=>{if(!visible)setPopover(null);},[visible]);
  useEffect(()=>{
    if(!narrow||!drawerOpen)return;
    const previous=document.activeElement as HTMLElement|null;
    const containFocus=(event:FocusEvent)=>{if(sidebar.current&&!sidebar.current.closest('[inert]')&&!sidebar.current.contains(event.target as Node))sidebar.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();};
    document.addEventListener('focusin',containFocus);
    sidebar.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return()=>{document.removeEventListener('focusin',containFocus);if(previous?.isConnected&&previous.getClientRects().length)previous.focus();else opener.current?.focus();};
  },[narrow,drawerOpen]);
  const previousNarrow=useRef(narrow);
  useLayoutEffect(()=>{
    if(narrow&&!drawerOpen&&(document.activeElement===document.body||sidebar.current?.contains(document.activeElement)))opener.current?.focus();
    if(!narrow&&previousNarrow.current&&document.activeElement===document.body){if(collapsed)opener.current?.focus();else sidebar.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();}
    previousNarrow.current=narrow;
  },[narrow,drawerOpen,collapsed]);
  const cancel=()=>{setPopover(null);p.onCancelMerge();};
  const rowKeyboard=(e:React.KeyboardEvent)=>{
    if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
    const rows=Array.from(sidebar.current?.querySelectorAll<HTMLButtonElement>('.session-button:not(:disabled)')??[]).filter(el=>el.getClientRects().length);
    const i=rows.indexOf(document.activeElement as HTMLButtonElement);if(i<0)return;
    e.preventDefault();rows[e.key==='Home'?0:e.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,i+(e.key==='ArrowDown'?1:-1)))]?.focus();
  };
  return <div className="explorer-slot" data-visible={visible} data-drawer={narrow} style={{'--explorer-width':`${sidebarWidth}px`} as CSSProperties}>
    <div className="explorer-rail" hidden={visible&&!narrow} inert={narrow&&drawerOpen}>
      <button ref={opener} className="explorer-icon" aria-label={narrow?'Open session explorer':'Expand sidebar'} title={narrow?'Open sessions and laps':'Expand sidebar'} aria-expanded={visible} aria-controls="session-explorer" onClick={()=>{if(narrow)p.onDrawer(true);else changeState('analysis');}}><span aria-hidden="true">›</span></button>
    </div>
    {narrow&&drawerOpen&&<button className="explorer-backdrop" aria-label="Close session explorer" tabIndex={-1} onClick={()=>p.onDrawer(false)}/>}
    <aside ref={sidebar} id="session-explorer" className="sidebar" hidden={!visible} role={narrow&&drawerOpen?'dialog':undefined} aria-modal={narrow&&drawerOpen?true:undefined} aria-label="Session explorer" onKeyDown={e=>{
      if(e.key==='Escape'&&!popover){if(p.mergeMode&&!p.busy){e.stopPropagation();cancel();}else if(narrow){e.stopPropagation();p.onDrawer(false);}}
      if(narrow&&drawerOpen&&e.key==='Tab'&&!popover){const controls=Array.from(sidebar.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select')??[]).filter(el=>el.getClientRects().length),first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
    }}>
      <div className="explorer-heading">
        <button className="explorer-icon" aria-label={narrow?'Close session explorer':'Collapse sidebar'} title={narrow?'Close session explorer':'Collapse sidebar'} onClick={()=>{if(narrow)p.onDrawer(false);else changeState('collapsed');}}>{p.refined?<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 3 10 5-10 5L2 8Z"/><path d="m2 12 10 5 10-5M2 16l10 5 10-5"/></svg>:'‹'}</button>
        <button className="explorer-section-toggle" title={sessionsVisible?'Hide sessions':'Show sessions'} aria-expanded={sessionsVisible} disabled={p.mergeMode||!session} onClick={()=>changeState(sessionsVisible?'analysis':'expanded')}>Session library <span>{visibleEntries.length}</span><span aria-hidden="true">{sessionsVisible?'⌃':'⌄'}</span></button>
        <button className="explorer-icon" aria-label="Session explorer actions" aria-haspopup="menu" aria-expanded={popover?.key==='header'} onClick={e=>togglePopover('header',e.currentTarget)}>⋯</button>
      </div>
      {session&&!sessionsVisible&&<div className="explorer-current"><span>Current session</span><strong title={session.name||session.track}>{displaySessionName(session.name)||displayTrack(session.track)||'Untitled session'}</strong><small>{displayTrack(session.track)||'Circuit not recorded'}</small></div>}
      {sessionsVisible&&<section className="session-region" aria-label="Sessions">
        <div className="explorer-tools"><button aria-label="Sort & group sessions" aria-haspopup="dialog" aria-expanded={popover?.key==='organize'} onClick={e=>togglePopover('organize',e.currentTarget)}>Sort & group <span aria-hidden="true">⌄</span></button><button className="explorer-icon" aria-label="Import session" title="Import session" disabled={p.busy||p.restoring} onClick={p.onImport}>＋</button></div>
        {p.mergeMode&&<div className="merge-selection"><span>{p.selectedIds.length} selected</span><button disabled={p.busy||p.restoring||p.selectedIds.length<2} onClick={p.onMerge}>Merge Sessions</button><button disabled={p.busy} onClick={cancel}>Cancel</button></div>}
        {p.mergeMode&&p.mergeError&&<p className="merge-selection-error" role="alert" tabIndex={0}>{p.mergeError}</p>}
        <motion.div layoutScroll className="session-list" onKeyDown={rowKeyboard}>{groups.map(group=><div className="session-group" key={group.key}>
          {preferences.grouping!=='none'&&<button className="session-group-heading" aria-expanded={!closedGroups.has(group.key)} onClick={()=>setClosedGroups(current=>{const next=new Set(current);if(next.has(group.key))next.delete(group.key);else next.add(group.key);return next;})}><span aria-hidden="true">{closedGroups.has(group.key)?'›':'⌄'}</span><span>{preferences.grouping==='date'?formatRecordingDate(group.label):preferences.grouping==='driver'?displayDriver(group.label):preferences.grouping==='circuit'?displayTrack(group.label):group.label}</span><small>{group.entries.length}</small></button>}
          <div hidden={preferences.grouping!=='none'&&closedGroups.has(group.key)}>{group.entries.map(entry=>{
            const name=displaySessionName(entry.name)||displayTrack(entry.track)||'Untitled session';
            const detail=`${entry.name}\n${entry.driver||'Unknown driver'} · ${entry.recordedAt||'Unknown date'}\n${entry.track||'Unknown circuit'} · ${entry.lapCount} laps · ${entry.channelCount} channels\n${entry.source}`;
            const sourceLabel=entry.mergeSources?`${entry.mergeSources.length} source recordings`:recordingLabels.get(entry.id);
            return <motion.div key={entry.id} layout="position" layoutDependency={p.sessionId} transition={motionTokens.spring} className={`library-entry ${entry.id===p.sessionId?'active':''}`}>
              {entry.id===p.sessionId&&<><SelectionPlate group="session-plate" tone="session"/><SelectionRail group="session-selection" value={entry.id}/></>}<div className="session-row">{p.mergeMode&&<input className="merge-select" type="checkbox" aria-label={`Select ${name} for merging`} disabled={p.busy||p.restoring||entry.status!=='ready'} checked={p.selectedIds.includes(entry.id)} onChange={e=>p.onMergeSelection(entry.id,e.target.checked)}/>}
              <button className="session-button" aria-current={entry.id===p.sessionId?'true':undefined} title={detail} aria-description={p.refined?detail:undefined} disabled={p.busy||p.restoring||entry.status!=='ready'} onClick={()=>p.onSelect(entry)}><span className="session-track">{entry.mergeSources?'Merged · ':''}{name}</span><span className="session-meta">{displayDriver(entry.driver)||'Unknown driver'} · {formatRecordingDate(entry.recordedAt)}</span><span className="session-facts">{`${entry.lapCount} ${entry.lapCount===1?'lap':'laps'} · ${entry.channelCount} ${entry.channelCount===1?'channel':'channels'}`}</span><span className="session-source">{sourceLabel}</span></button>
              <button className="explorer-icon row-actions" aria-label="Session actions" title={`Actions for ${name}`} aria-haspopup="menu" aria-expanded={popover?.key===entry.id} disabled={p.busy} onClick={e=>togglePopover(entry.id,e.currentTarget)}>⋯</button></div>
              {entry.status!=='ready'&&<p className="file-status">{entry.mergeSources?'Source unavailable · repair original recording':entry.status==='missing'?'File missing · locate original':'File changed · refresh to reopen'}</p>}
            </motion.div>;
          })}</div>
        </div>)}{!visibleEntries.length&&<p className="sidebar-hint">Your sessions stay on this computer.<br/>Import an XRK file to begin.</p>}</motion.div>
      </section>}
      {session&&<section className="lap-region" aria-label="Laps"><div className="sidebar-label laps-heading">{p.refined&&<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 22 5-19 13 4-4 12L5 15M7 7l13 4M6 11l13 4M12 4 9 16m8-10-3 11"/></svg>}Laps <span>{session.laps.length}{p.refined?'':' total'}</span></div><div className="lap-table-head"><span>Lap</span><span>Time</span><span>Ref.</span></div><motion.div layoutScroll className="lap-list" inert={p.lifecycle}>{session.laps.map(l=><motion.div key={l.id} layout="position" layoutDependency={`${p.primary}|${p.comparison}`} transition={motionTokens.spring} className={`lap-row ${l.id===p.primary?'selected':''} ${l.id===p.comparison?'compared':''}`}>{l.id===p.primary&&<><SelectionPlate group="lap-plate"/><SelectionRail group="lap-selection" value={l.id}/></>}{l.id===p.comparison&&<SelectionPlate group="lap-reference-plate" tone="reference"/>}<button className="lap-select" onClick={()=>p.onLap(l.id)} title="Use as primary lap" aria-pressed={l.id===p.primary}><span className="lap-number">{lapName(lapDisplayNumber(session,l.id))}</span><span className="lap-time mono">{formatTime(l.duration)}{(!l.complete||l.id===best?.id)&&<small>{!l.complete?(p.refined?lapBoundaryLabel(session,l.id).toLowerCase().replace(/^./,c=>c.toUpperCase()):lapBoundaryLabel(session,l.id)):(p.refined?'Fastest':'FASTEST')}</small>}</span></button><button className={`compare-toggle ${l.id===p.comparison?'on':''}`} disabled={l.id===p.primary} aria-label={`Compare lap ${lapDisplayNumber(session,l.id)}`} aria-pressed={l.id===p.comparison} onClick={()=>p.onCompare(p.comparison===l.id?null:l.id)}>{l.id===p.comparison?<ReferenceMark/>:'＋'}</button></motion.div>)}</motion.div></section>}
      {session&&<div className="sidebar-footer" tabIndex={p.refined?0:undefined} aria-label={p.refined?`Recording source: ${session.source}`:undefined} data-tooltip={p.refined?session.source:undefined} onFocus={e=>delete e.currentTarget.dataset.tooltipDismissed} onMouseEnter={e=>delete e.currentTarget.dataset.tooltipDismissed} onKeyDown={e=>{if(e.key==='Escape')e.currentTarget.dataset.tooltipDismissed='true';}} title={session.source}><span className="dot"/><span>{session.merge?`${session.merge.sources.length} source recordings`:recordingLabel(session)}</span></div>}
      <AnimatePresence>{details&&<SessionDetails key={details.id} entry={details} onClose={()=>setDetails(null)} onSave={(name,driver,date)=>p.onEditDetails(details,name,driver,date)}/>}</AnimatePresence>
    </aside>
    {!narrow&&!collapsed&&<div className="explorer-resizer" role="separator" aria-label="Resize session explorer" aria-orientation="vertical" aria-controls="session-explorer" aria-valuemin={220} aria-valuemax={360} aria-valuenow={sidebarWidth} tabIndex={0} title="Drag to resize · arrow keys adjust width" onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();resizeStart.current={x:e.clientX,width:sidebarWidth};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(resizeStart.current)resizeWidth(resizeStart.current.width+e.clientX-resizeStart.current.x);}} onPointerUp={()=>{resizeStart.current=null;}} onPointerCancel={()=>{resizeStart.current=null;}} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();resizeWidth(sidebarWidth+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?32:8));}else if(e.key==='Home'||e.key==='End'){e.preventDefault();resizeWidth(e.key==='Home'?220:360);}}}/>}
    <AnimatePresence>{popover&&visible&&<ExplorerPopover key={popover.key} anchor={popover.anchor} container={sidebar.current} onClose={closePopover} label={popover.key==='organize'?'Organize sessions':'Session actions'} menu={popover.key!=='organize'}>
      {popover.key==='organize'?<><label>Sort sessions<select aria-label="Sort sessions" value={preferences.sort} onChange={e=>p.onPreferences({...preferences,sort:e.target.value as SessionSort})}><option value="date-desc">Date · Newest first</option><option value="date-asc">Date · Oldest first</option><option value="driver-asc">Driver · A–Z</option><option value="driver-desc">Driver · Z–A</option><option value="circuit-asc">Circuit · A–Z</option><option value="circuit-desc">Circuit · Z–A</option></select></label><label>Group sessions<select aria-label="Group sessions" value={preferences.grouping} onChange={e=>{setClosedGroups(new Set());p.onPreferences({...preferences,grouping:e.target.value as SessionGrouping});}}><option value="date">By date</option><option value="driver">By driver</option><option value="circuit">By circuit</option><option value="none">No grouping</option></select></label></>:popover.key==='header'?<button role="menuitem" disabled={p.busy||p.restoring} onClick={()=>{closePopover();p.onMergeMode();changeState('expanded');}}>Merge sessions</button>:<>{(()=>{const entry=entries.find(e=>e.id===popover.key);if(!entry)return null;const action=(kind:Action)=>{const anchor=popover.anchor;closePopover();anchor.focus();p.onManage(entry,kind);};return <><button role="menuitem" onClick={()=>{closePopover();popover.anchor.focus();setDetails(entry);}}>Edit details</button>{entry.mergeSources?<button role="menuitem" onClick={()=>action('unmerge')}>Unmerge</button>:<><button role="menuitem" onClick={()=>action(entry.status==='missing'?'locate':'refresh')}>{entry.status==='missing'?'Locate…':'Refresh'}</button><button role="menuitem" onClick={()=>action('remove')}>Remove</button></>}</>;})()}</>}
    </ExplorerPopover>}</AnimatePresence>
  </div>;
}
