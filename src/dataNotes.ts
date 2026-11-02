import type { Analysis, Session } from './types';

type Note = { severity:'warning'|'info'; title:string; text:string };

export function dataNotes(session:Session, analysis:Analysis|null, selectedChannels:string[], videoWarnings:string[]=[]):Note[] {
  const notes:Note[]=[];
  const add=(severity:Note['severity'],title:string,text:string)=>notes.push({severity,title,text});
  const names=new Set(session.channels.filter(c=>selectedChannels.includes(c.id)).map(c=>c.name));
  const sources=session.merge?.sources.map(s=>s.session)??[session];
  const selectedLaps=new Set([analysis?.primary.lapId,analysis?.comparison?.lapId]);
  const selectedSources=session.merge ? new Set(session.merge.preview.laps.filter(l=>selectedLaps.has(l.id)).map(l=>l.sourceSessionId)) : null;
  const relevantSources=selectedSources?.size ? sources.filter(s=>selectedSources.has(s.id)) : sources;
  for(const source of relevantSources){
    const speed=source.channels.find(c=>c.id==='gps-speed'&&['m/s','km/h','kph','mph'].includes(c.unit.toLowerCase()))??source.channels.find(c=>c.name.toLowerCase().includes('speed')&&['m/s','km/h','kph','mph'].includes(c.unit.toLowerCase()));
    if(speed) names.add(speed.name);
  }
  const affected=(items:string[])=>[...new Set(items)].join(', ');
  const channelIssues:{missing:string[];calibration:string[];unit:string[];unavailable:string[]}={missing:[],calibration:[],unit:[],unavailable:[]};
  for(const source of relevantSources){
    for(const warning of source.warnings){
      for(const name of names){
        if(!warning.startsWith(`${name}:`)&&!warning.startsWith(`${name} uses `)&&!warning.startsWith(`${name} has `)) continue;
        const label=session.merge?`${name} (${source.name})`:name;
        if(warning.includes('excluded ')&&warning.includes('samples')) channelIssues.missing.push(label);
        else if(warning.includes('unsupported calibration')) channelIssues.calibration.push(label);
        else if(warning.includes('unknown unit')) channelIssues.unit.push(label);
        else if(warning.includes('unsupported channel decoder')) channelIssues.unavailable.push(label);
      }
    }
  }
  if(channelIssues.unavailable.length) add('warning','Channel unavailable',`${affected(channelIssues.unavailable)} could not be read, so its data cannot be shown.`);
  if(channelIssues.calibration.length) add('warning','Channel readings may be wrong',`${affected(channelIssues.calibration)} uses an unsupported calibration, so its readings may be inaccurate.`);
  if(channelIssues.unit.length) add('warning','Channel units unknown',`${affected(channelIssues.unit)} has unknown units, so its values cannot be converted.`);
  if(channelIssues.missing.length) add('warning','Some channel data is missing',`Some readings were removed from ${affected(channelIssues.missing)}; check the affected traces for gaps or unusual values.`);
  const allWarnings=session.warnings;
  const noCrossings=relevantSources.filter(s=>s.warnings.some(w=>w.includes('No trustworthy lap crossings found'))).map(s=>s.name);
  if(noCrossings.length) add('warning','Lap times unavailable',`${session.merge?affected(noCrossings):'This recording'} has no reliable lap crossings, so it is shown as one partial lap.`);
  if(allWarnings.some(w=>w.includes('Possible duplicate laps'))) add('info','Possible duplicate laps','Some laps may appear twice because matching laps were kept from both recordings.');
  if(analysis){
    const lapNotes=[{label:'primary',warnings:analysis.primary.warnings},...(analysis.comparison?[{label:'comparison',warnings:analysis.comparison.warnings}]:[])];
    const laps=(needle:string)=>lapNotes.filter(l=>l.warnings.some(w=>w.includes(needle))).map(l=>l.label);
    const lapLabel=(labels:string[])=>labels.length===2?'the primary and comparison laps':`the ${labels[0]} lap`;
    let labels=laps('GPS racing line unavailable');
    if(labels.length) add('warning','Racing line unavailable',`There are not enough usable GPS positions for ${lapLabel(labels)}, so ${labels.length===2?'their racing lines cannot':'its racing line cannot'} be shown.`);
    labels=laps('GPS source timestamp gaps');
    if(labels.length) add('warning','Racing line has gaps',`GPS positions are missing in ${lapLabel(labels)}, so parts of the racing line are uncertain.`);
    labels=laps('Reliable speed coverage unavailable');
    if(labels.length) add('warning','Distance unavailable',`Reliable speed data is missing in ${lapLabel(labels)}, so distance and time comparisons may be unavailable.`);
    labels=laps('Partial lap:');
    if(labels.length) add('info','Incomplete lap',`${lapLabel(labels)} ${labels.length===2?'are':'is'} incomplete and excluded from the fastest-lap ranking.`);
    const gapNames=new Set<string>();
    for(const lap of lapNotes) for(const warning of lap.warnings){
      const match=warning.match(/^(.*): \d+ source timestamp gap\(s\)/);
      if(match&&names.has(match[1])) gapNames.add(match[1]);
    }
    if(gapNames.size) add('warning','Gaps in channel data',`${affected([...gapNames])} has missing readings in the selected laps, so parts of the trace are unavailable.`);
    const w=analysis.warnings;
    if(analysis.comparison&&!analysis.delta){
      const text=w.some(x=>x.includes('laps are partial or their measured lengths'))?'The selected laps are incomplete or differ too much in length to compare their time around the track.':w.some(x=>x.includes('Conflicting track metadata'))?'The recordings may be from different tracks, so their time and corner comparisons are unavailable.':'The selected laps cannot be matched reliably, so the time difference around the track is unavailable.';
      add('warning','Time comparison unavailable',text);
    } else if(analysis.comparison&&analysis.delta?.method==='estimated') add('warning','Comparison is estimated','The laps are matched by distance rather than track position, so the time difference may be misleading.');
    if(w.some(x=>x.includes('Manual boundaries are saved but temporarily omitted'))) add('info','Custom sections unavailable','Your saved sections cannot be used for this comparison; choose a compatible complete lap.');
    const missingSelected=selectedChannels.some(id=>!analysis.primary.series.some(s=>s.channelId===id)||(analysis.comparison&&!analysis.comparison.series.some(s=>s.channelId===id)));
    const emptySelected=selectedChannels.some(id=>[analysis.primary,analysis.comparison].some(lap=>lap?.series.some(s=>s.channelId===id&&!s.x.length)));
    if((missingSelected&&w.some(x=>x.includes('selected channels are unavailable or ambiguous')))||(emptySelected&&w.some(x=>x.includes('formula dependency')))) add('warning','Channel data incomplete','Some selected channels have no data in the selected laps; check their inputs and recordings.');
  }
  if(videoWarnings.some(w=>w.includes('newer version'))) add('warning','Video settings need an update','Update Ten Tenths Telemetry to edit these saved video settings.');
  else if(videoWarnings.some(w=>!w.startsWith('Invalid video preference')&&!w.startsWith('The saved video segment selection'))) add('warning','Video settings unavailable','Saved video settings could not be restored; check or set up the video again.');
  return notes.sort((a,b)=>Number(a.severity==='info')-Number(b.severity==='info'));
}
