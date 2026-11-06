import type {AdvancedConfig} from './advancedState';

// Rust consumes these numerical inputs. Plot geometry and scales are local view
// preferences: changing them must not invalidate results or unmount the canvas.
export function advancedComputationKey(config:AdvancedConfig):string {
 const {panelHeight,grid,xScale,yScale,xRange,yRange,toolViews,...computation}=config;
 return JSON.stringify(computation);
}
