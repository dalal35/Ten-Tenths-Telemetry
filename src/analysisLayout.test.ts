import {describe,expect,it} from 'vitest';
import {analysisPanelHeight,analysisPlotRect} from './analysisLayout';
describe('responsive analysis layout',()=>{
 it('clamps rendered height without replacing the preferred height',()=>{
  expect(analysisPanelHeight(900,500)).toBe(240);
  expect(analysisPanelHeight(900,1440)).toBe(900);
  expect(analysisPanelHeight(240,500)).toBe(240);
  expect(analysisPanelHeight(900,928,510)).toBe(418);
  expect(analysisPanelHeight(900,700,510)).toBe(240);
 });
 it('gives traction equal pixels per G on wide and narrow canvases',()=>{
  for(const [width,height] of [[1400,420],[320,700]]){
   const r=analysisPlotRect(width,height,[-2,2,-1,1],true);
   expect((r.right-r.left)/4).toBeCloseTo((r.bottom-r.top)/2);
   expect(r.left).toBeGreaterThanOrEqual(62);
   expect(r.right).toBeLessThanOrEqual(width-18);
  }
 });
 it('fills scatter plot space',()=>{
  expect(analysisPlotRect(700,420,[0,1,0,1],false)).toEqual({left:62,right:682,top:18,bottom:376});
 });
});
