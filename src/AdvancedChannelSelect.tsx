import {useEffect,useId,useState} from 'react';
import type {Channel} from './types';
import {displaySpeedUnit} from './speedDisplay';

// Native selection keeps platform keyboard/type-ahead behavior. Search narrows
// long sensor lists without replacing their accessible combobox semantics.
export default function AdvancedChannelSelect({label,value,channels,nameFor,onSelect,optional=false}:{label:string;value:string|null;channels:Channel[];nameFor:(id:string,name:string)=>string;onSelect:(id:string)=>void;optional?:boolean}) {
 const selectId=useId();
 const [searching,setSearching]=useState(false),[query,setQuery]=useState('');
 useEffect(()=>{setSearching(false);setQuery('');},[label]);
 const matches=channels.filter(c=>c.id===value||`${c.name} ${c.id} ${c.unit}`.toLowerCase().includes(query.toLowerCase()));
 return <div className="advanced-channel-select"><div className="channel-select-heading"><label htmlFor={selectId}>{label}</label><button type="button" aria-label={`Search ${label}`} aria-expanded={searching} onClick={()=>{setSearching(!searching);setQuery('');}}><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="8" cy="8" r="5"/><path d="m12 12 5 5"/></svg></button></div>
 {searching&&<input autoFocus aria-label={`Find ${label}`} type="search" placeholder="Name, ID or unit…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){setSearching(false);setQuery('');}}}/>}
 <select id={selectId} aria-label={label} value={value??''} onChange={e=>onSelect(e.target.value)}>
 {!optional&&!value&&<option value="">Select a channel</option>}{optional&&<option value="">Lap colors</option>}
 {value&&!channels.some(c=>c.id===value)&&<option value={value}>Unavailable · {value}</option>}
 {matches.map(c=><option key={c.id} value={c.id}>{nameFor(c.id,c.name)}{c.unit?` · ${displaySpeedUnit(c.unit)}`:''}</option>)}
 </select>{searching&&<small className="channel-search-count">{matches.length} channels · selected channel retained</small>}</div>;
}
