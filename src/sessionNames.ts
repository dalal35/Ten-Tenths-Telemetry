/**
 * Presentation names for logger metadata. Loggers commonly store names in one case and tracks in
 * abbreviated form. These only change what is displayed: recordings, library data and persisted
 * identities keep the original values, which stay available in tooltips and session details.
 */
const US_STATES=new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));
const LOWERCASE_WORDS=new Set(['of','the','at','and','de','la','del']);

const squeeze=(value:string)=>value.trim().replace(/\s+/g,' ');
const hasCase=(value:string)=>value.toLowerCase()!==value.toUpperCase();
/** Mixed case is treated as deliberate; only single-case logger text is rewritten. */
const singleCase=(value:string)=>hasCase(value)&&(value===value.toLowerCase()||value===value.toUpperCase());
const capitalize=(value:string)=>value.toLowerCase().replace(/(^|[-'’])(\p{L})/gu,(_,mark:string,letter:string)=>mark+letter.toUpperCase());
const titleCase=(value:string)=>value.split(' ').map(capitalize).join(' ');

export const displayDriver=(raw:string)=>{const value=squeeze(raw);return singleCase(value)?titleCase(value):value;};
export const displaySessionName=displayDriver;

export function displayTrack(raw:string){
 const value=squeeze(raw);if(!value)return '';
 const words=value.split(' ');
 const last=words.at(-1)!;
 // A trailing state code is location metadata, unless it is the whole name.
 if(words.length>1&&US_STATES.has(last)&&last===last.toUpperCase())words.pop();
 const rewrite=singleCase(value);
 return words.flatMap((word,index)=>{
  if(/^gp$/i.test(word))return ['Grand','Prix'];
  if(!rewrite)return [word];
  // All-consonant words are acronyms such as NJMP.
  if(word===word.toUpperCase()&&word.length>1&&!/[aeiouy]/i.test(word))return [word];
  if(index>0&&LOWERCASE_WORDS.has(word.toLowerCase()))return [word.toLowerCase()];
  return [capitalize(word)];
 }).join(' ');
}

export const fileStem=(source:string)=>source.split(/[\\/]/).pop()?.replace(/\.[^.]+$/,'')??'';

export function recordingLabel(recording:{driver:string;track:string;name:string;source:string}){
 const driver=displayDriver(recording.driver),track=displayTrack(recording.track),name=displaySessionName(recording.name);
 const parts=[driver,track,name.toLowerCase()===track.toLowerCase()?'':name].filter(Boolean);
 if(parts.length)return parts.join(' · ');
 return squeeze(fileStem(recording.source).replace(/_+/g,' '))||'Source unavailable';
}

/** Detail line for session rows. Rows that would read the same also show the end of their file name, such as 0362. */
export function distinctRecordingLabels<T extends {id:string;driver:string;track:string;name:string;source:string}>(recordings:readonly T[]){
 const labels=recordings.map(recording=>recordingLabel(recording)),counts=new Map<string,number>();
 for(const label of labels)counts.set(label,(counts.get(label)??0)+1);
 return new Map(recordings.map((recording,index)=>{
  const label=labels[index],suffix=fileStem(recording.source).match(/[^_\s-]+$/)?.[0];
  // The row's title already shows the session name, and the row is narrow, so the detail line is the track alone.
  const detail=displayTrack(recording.track)||displayDriver(recording.driver)||label;
  return [recording.id,counts.get(label)!>1&&suffix?`${detail} · ${suffix}`:detail];
 }));
}

export const lapName=(number:number)=>`Lap ${number}`;
