import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import FullLapProfile from './FullLapProfile';
import type {FullLapDiagnostics,SimulatedProfile} from './types';

const diagnostics:FullLapDiagnostics={modeledLapSeconds:{lowerSeconds:58.1,upperSeconds:59.4},gainRange:null,coverageFraction:0.95,coveredMeters:950,totalMeters:1000,baselineIntegratedSeconds:60,sections:[{sectionId:'turn-2',label:'Corner 2',startMeters:100,endMeters:180,baselineSeconds:5,conservativeSeconds:5.1,nominalSeconds:4.9,gainRange:null,excludedReasons:[]},{sectionId:'gap',label:'Straight 3',startMeters:600,endMeters:650,baselineSeconds:null,conservativeSeconds:null,nominalSeconds:null,gainRange:null,excludedReasons:['GPS alignment unavailable']}],validation:{trainingLapIds:['lap-1'],withheldLapIds:['lap-2'],speedRmseMps:1.2,sectionTimeMaeSeconds:0.04,envelopeExceedanceFraction:0.02,feasibilityViolations:0,testedCells:100,maximumConstraintExcess:0,target:'Recorded control replay',notes:['Capacity is not independently validated.']},assumptions:['Recorded demand is not absolute capacity.'],rejectionReasons:[]};
const profile:SimulatedProfile={opportunityId:'full-lap',strategy:'full-lap',startMeters:0,endMeters:1000,baselineSeconds:60,recordedSeconds:60,conservativeSeconds:59.4,nominalSeconds:58.1,points:[{meters:0,baselineSpeedMps:10,conservativeSpeedMps:11,nominalSpeedMps:12,curvaturePerMeter:0},{meters:500,baselineSpeedMps:20,conservativeSpeedMps:21,nominalSpeedMps:22,curvaturePerMeter:0},{meters:1000,baselineSpeedMps:10,conservativeSpeedMps:11,nominalSpeedMps:12,curvaturePerMeter:0}],assumptions:[]};

describe('full-lap physics diagnostics',()=>{
 it('overlays actual and both physical scenarios in display speed units',()=>{
  const html=renderToStaticMarkup(<FullLapProfile diagnostics={diagnostics} profile={profile}/>);
  expect(html).toContain('Actual versus optimized speed');
  expect(html).toContain('role="img"');
  expect(html).toContain('Conservative');
  expect(html).toContain('Nominal');
  expect(html).toContain('mph');
  expect(html).toContain('95.0%');
  expect(html).toContain('950 / 1000 m');
  expect(html).toContain('0.100 s slower');
  expect(html).toContain('0.100 s faster');
  expect(html).toContain('GPS alignment unavailable');
  expect(html).toContain('Withheld validation');
  expect(html).toContain('2.7 mph');
  expect(html).toContain('0.040 s');
  expect(html).toContain('Capacity is not independently validated.');
 });
 it('explains an unavailable profile without drawing invalid coordinates',()=>{
  const html=renderToStaticMarkup(<FullLapProfile diagnostics={{...diagnostics,modeledLapSeconds:null,rejectionReasons:['Insufficient curvature coverage']}} profile={{...profile,points:[{...profile.points[0],baselineSpeedMps:NaN}]}}/>);
  expect(html).not.toContain('<svg');
  expect(html).toContain('Insufficient curvature coverage');
  expect(html).toContain('Speed overlay unavailable');
  expect(html).not.toContain('NaN');
 });
});
