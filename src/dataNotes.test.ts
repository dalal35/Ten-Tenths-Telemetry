import { describe, expect, it } from 'vitest';
import { dataNotes } from './dataNotes';
import type { Analysis, Session } from './types';

const session: Session = {id:'s',source:'run.xrk',name:'Run',driver:'',track:'',recordedAt:'',laps:[],channels:[{id:'speed',name:'GPS Speed',unit:'m/s',times:[],values:[]},{id:'temp',name:'Temperature',unit:'C',times:[],values:[]}],warnings:[]};
const analysis: Analysis = {primary:{lapId:'a',duration:10,length:100,mapping:[],series:[],track:[],warnings:[]},comparison:{lapId:'b',duration:11,length:100,mapping:[],series:[],track:[],warnings:[]},alignment:{method:'spatial',referenceLength:100,positionUncertaintyM:1,timingUncertaintyS:.1,coverage:1,notes:[]},segments:[],delta:{x:[],values:[],method:'spatial',uncertaintySeconds:.1},warnings:[]};

describe('driver data notes',()=>{
  it('consolidates repeated lap warnings and identifies both laps',()=>{
    const warning='GPS racing line unavailable for this lap.';
    const notes=dataNotes(session,{...analysis,primary:{...analysis.primary,warnings:[warning]},comparison:{...analysis.comparison!,warnings:[warning]}},['speed']);
    expect(notes).toEqual([{severity:'warning',title:'Racing line unavailable',text:'There are not enough usable GPS positions for the primary and comparison laps, so their racing lines cannot be shown.'}]);
  });
  it('shows only relevant channel issues and does not call cleaning harmless',()=>{
    const s={...session,warnings:['Temperature uses unsupported calibration type 3; values are the parser\'s decoded stream without a guessed transform.','GPS Speed: excluded 3 non-finite or non-increasing samples from analysis.']};
    const notes=dataNotes(s,analysis,['speed']);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({severity:'warning',title:'Some channel data is missing'});
    expect(notes[0].text).toContain('GPS Speed');
    expect(notes[0].text).not.toMatch(/unaffected|accurate/i);
  });
  it('explains estimated and unavailable comparisons without repeating them',()=>{
    const estimated={...analysis,alignment:{...analysis.alignment,method:'estimated' as const},delta:{...analysis.delta!,method:'estimated' as const},warnings:['Estimated delta compares equal normalized distance, not physical position; positive values mean the selected lap is slower.']};
    expect(dataNotes(session,estimated,['speed'])).toEqual([{severity:'warning',title:'Comparison is estimated',text:'The laps are matched by distance rather than track position, so the time difference may be misleading.'}]);
    const unavailable={...analysis,delta:null,warnings:['Delta unavailable: laps are partial or their measured lengths differ by more than 5%.']};
    expect(dataNotes(session,unavailable,['speed'])).toEqual([{severity:'warning',title:'Time comparison unavailable',text:'The selected laps are incomplete or differ too much in length to compare their time around the track.'}]);
  });
  it('treats duplicate laps as information and hides routine diagnostics',()=>{
    const s={...session,warnings:['Possible duplicate laps have matching start times and durations; both source identities are retained.','Recording times use the logger\'s local clock; timezone and clock accuracy are not independently verified.']};
    expect(dataNotes(s,{...analysis,alignment:{...analysis.alignment,notes:['Receiver position accuracy is missing or zero; a conservative 5 m per-fix floor is assumed.']}},[])).toEqual([{severity:'info',title:'Possible duplicate laps',text:'Some laps may appear twice because matching laps were kept from both recordings.'}]);
    expect(dataNotes(session,analysis,[])).toEqual([]);
  });
  it('tells users to update for newer video settings',()=>{
    const s={...session,warnings:['Import failed: race.xrk: unreadable']};
    const notes=dataNotes(s,analysis,[],['This video workspace uses a newer version. Update Ten Tenths Telemetry to edit it; its saved data is preserved.']);
    expect(notes.map(n=>n.text).join(' ')).toContain('Update Ten Tenths Telemetry');
  });
  it('does not report a missing context channel that is not visible',()=>{
    const a={...analysis,warnings:['Some selected channels are unavailable or ambiguous in a source; no samples were substituted.'],primary:{...analysis.primary,series:[{channelId:'speed',name:'GPS Speed',unit:'m/s',x:[1],values:[1]}]},comparison:{...analysis.comparison!,series:[{channelId:'speed',name:'GPS Speed',unit:'m/s',x:[1],values:[1]}]}};
    expect(dataNotes(session,a,['speed'])).toEqual([]);
  });

  it('limits missing lap crossings to the selected recording',()=>{
    const a={...session,id:'a',name:'Run A',warnings:[]};
    const b={...session,id:'b',name:'Run B',warnings:['No trustworthy lap crossings found; showing the recording as a partial lap.']};
    const merged={...session,warnings:['Run B: No trustworthy lap crossings found; showing the recording as a partial lap.'],merge:{sources:[{sessionId:'a',contentVersion:'1',session:a},{sessionId:'b',contentVersion:'1',session:b}],preview:{sources:[],day:'',previewVersion:'',warnings:[],channels:[],laps:[{id:'a',number:1,start:0,end:10,duration:10,complete:true,sourceSessionId:'a',sourceLapId:'1',displayNumber:1},{id:'b',number:2,start:0,end:10,duration:10,complete:false,sourceSessionId:'b',sourceLapId:'1',displayNumber:2}]}}};
    expect(dataNotes(merged,{...analysis,comparison:null},[])).toEqual([]);
    expect(dataNotes(merged,{...analysis,primary:{...analysis.primary,lapId:'b'},comparison:null},[])[0].text).toContain('Run B');
  });

  it('reports selected calculated channels with no data when inputs are missing',()=>{
    const a={...analysis,warnings:['Run B: formula dependency RPM is unavailable or ambiguous in this source.'],primary:{...analysis.primary,series:[{channelId:'calc',name:'Calculated',unit:'',x:[],values:[]}]},comparison:{...analysis.comparison!,series:[{channelId:'calc',name:'Calculated',unit:'',x:[],values:[]}]}};
    expect(dataNotes(session,a,['calc']).some(n=>n.title==='Channel data incomplete')).toBe(true);
  });

});
