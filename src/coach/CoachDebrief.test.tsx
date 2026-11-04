import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import CoachDebrief from './CoachDebrief';
import type {CoachReport,Opportunity} from './types';

const finding:Opportunity={id:'a',lapId:'best',referenceLapId:'best',sectionId:'c1',label:'Corner 1',kind:'apex-recovery',status:'likely',priorityScore:1,startTime:12,endTime:15,startMeters:100,endMeters:150,observedLossSeconds:null,estimatedGainSeconds:null,fasterExampleCount:0,confidence:'medium',evidence:[{id:'e1',metric:'minimumSpeed',unit:'m/s',lapValue:10,referenceValue:null,channelIds:['gps-speed']}],observation:'Recorded low-speed recovery.',action:'Test earlier smooth recovery.',uncertainty:'No direct pedal evidence.'};
const report={bestLapId:'best',bestLapSeconds:60,validLapCount:3,sectionAssessments:[{sectionId:'c1',label:'Corner 1',kind:'corner',startTime:12,endTime:15,startMeters:100,endMeters:150,evidence:finding.evidence,notes:['Measured GPS interval.']}],opportunities:[finding]} as CoachReport;
describe('premium coach debrief',()=>{
 it('shows the real ranked experiment, evidence and unavailable sensors without invented gains',()=>{
  const html=renderToStaticMarkup(<CoachDebrief report={report} findings={[finding]} explanations={[]} channels={[{id:'gps-speed',name:'GPS Speed',unit:'m/s'}]} onInspect={()=>{}} lapLabel={()=> 'Lap 1'}/>);
  expect(html).toContain('Ranked opportunities');
  expect(html).toContain('Test earlier smooth recovery.');
  expect(html).toContain('Gain not yet quantifiable');
  expect(html).toContain('No direct brake channel');
  expect(html).toContain('No direct throttle channel');
  expect(html).toContain('Corner 1');
  expect(html).toContain('22.369');
  expect(html).toContain('Inspect minimum Speed telemetry');
  expect(html).not.toContain('NaN');
 });
 it('preserves an honest empty report',()=>{
  const html=renderToStaticMarkup(<CoachDebrief report={{...report,sectionAssessments:[]}} findings={[]} explanations={[]} channels={[]} onInspect={()=>{}} lapLabel={()=> 'Lap 1'}/>);
  expect(html).toContain('No supported opportunity');
  expect(html).not.toContain('Inspect telemetry');
 });
 it('does not treat GPS speed as racing-line evidence or a brake pedal as throttle',()=>{
  const html=renderToStaticMarkup(<CoachDebrief report={report} findings={[finding]} explanations={[]} channels={[{id:'gps-speed',name:'GPS Speed',unit:'m/s'},{id:'brake-pedal',name:'Brake pedal',unit:'%'}]} onInspect={()=>{}} lapLabel={()=> 'Lap 1'}/>);
  expect(html).toContain('No direct throttle channel');
  expect(html).toContain('GPS coordinates are unavailable');
  expect(html).not.toContain('Available signals: GPS Speed');
 });
});
