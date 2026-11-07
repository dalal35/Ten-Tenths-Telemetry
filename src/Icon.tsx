// One outline set for small interface glyphs: 16px box, 1.5px stroke, currentColor.
const glyphs={
 chevron:<path d="m4 6 4 4 4-4"/>,
 more:<path d="M3.25 8h.01M8 8h.01M12.75 8h.01" strokeWidth="2.25"/>,
 plus:<path d="M8 3.25v9.5M3.25 8h9.5"/>,
 close:<path d="m4 4 8 8m0-8-8 8"/>,
} as const;

export default function Icon({name,className='ui-icon'}:{name:keyof typeof glyphs;className?:string}){
 return <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{glyphs[name]}</svg>;
}
