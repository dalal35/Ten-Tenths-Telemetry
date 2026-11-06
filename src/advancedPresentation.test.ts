import {describe,it,expect} from 'vitest';
import {defaultAdvanced} from './advancedState';
import {advancedComputationKey} from './advancedPresentation';

describe('Advanced computation identity',()=>{
 it('keeps results and plot view for rendering-only preferences',()=>{
  const c=defaultAdvanced().config;
  expect(advancedComputationKey({...c,panelHeight:620,grid:1,xScale:'log',xRange:[1,5],toolViews:{scatter:{xChannel:'rpm',yChannel:null,histChannel:null,colorChannel:null,xScale:'linear',yScale:'linear',xRange:null,yRange:null}}})).toBe(advancedComputationKey(c));
 });
 it('invalidates for every numerical analysis input',()=>{
  const c=defaultAdvanced().config;
  for(const patch of [{xChannel:'rpm'},{range:[1,4]},{cornerId:'turn-1'},{valueFilter:{channel:'rpm',min:8200,max:null}},{bins:42},{xOffset:.2},{excludedIds:['event-1']},{tool:'bog'}]){
   expect(advancedComputationKey({...c,...patch} as typeof c)).not.toBe(advancedComputationKey(c));
  }
 });
});
