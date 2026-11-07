import {describe,expect,it} from 'vitest';
import {advanceDownload,downloadFraction,formatDownload} from './updater';

describe('update download progress',()=>{
  it('accumulates chunks against the announced size',()=>{
    let progress=advanceDownload({downloaded:0,total:null},{event:'Started',data:{contentLength:10_485_760}});
    progress=advanceDownload(progress,{event:'Progress',data:{chunkLength:5_242_880}});
    progress=advanceDownload(progress,{event:'Finished'});
    expect(downloadFraction(progress)).toBe(.5);
    expect(formatDownload(progress)).toBe('5 MB of 10 MB');
  });
  it('reports no percentage when the server omits the size',()=>{
    const progress=advanceDownload(advanceDownload({downloaded:0,total:null},{event:'Started',data:{}}),{event:'Progress',data:{chunkLength:1_048_576}});
    expect(downloadFraction(progress)).toBeNull();
    expect(formatDownload(progress)).toBe('1 MB');
  });
  it('restarts the count when a retry begins',()=>{
    expect(advanceDownload({downloaded:9,total:10},{event:'Started',data:{contentLength:20}})).toEqual({downloaded:0,total:20});
  });
});
