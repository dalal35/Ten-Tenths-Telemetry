import {describe,expect,it,vi} from 'vitest';
import {createWorkspaceNavigator} from './workspaceNavigation';

function setup(reduced=false){
  const updates:(()=>void)[]=[],handles:{skipTransition:ReturnType<typeof vi.fn>;ready:Promise<void>;finished:Promise<void>;finish:()=>void}[]=[];
  const commit=vi.fn((update:()=>void)=>update()),fallback=vi.fn();
  const start=vi.fn((update:()=>void)=>{updates.push(update);let finish!:()=>void;const finished=new Promise<void>(resolve=>finish=resolve);const handle={skipTransition:vi.fn(),ready:Promise.resolve(),finished,finish};handles.push(handle);return handle;});
  return {navigator:createWorkspaceNavigator({commit,start:()=>start,reduced:()=>reduced,fallback}),updates,handles,commit,start,fallback};
}

describe('workspace transition ownership',()=>{
  it('commits only the latest requested workspace when captures are interrupted',()=>{
    const s=setup(),first=vi.fn(),latest=vi.fn();
    s.navigator.navigate(first);s.navigator.navigate(latest);
    expect(s.handles[0].skipTransition).toHaveBeenCalledOnce();
    s.updates[0]();s.updates[1]();
    expect(first).not.toHaveBeenCalled();expect(latest).toHaveBeenCalledOnce();
    expect(s.navigator.pending()).toBe(false);
  });
  it('skips visual layers for chart input without dropping a pending navigation',()=>{
    const s=setup(),update=vi.fn();s.navigator.navigate(update);s.navigator.skip();s.updates[0]();
    expect(s.handles[0].skipTransition).toHaveBeenCalledOnce();expect(update).toHaveBeenCalledOnce();
  });
  it('commits a pending navigation the moment input arrives, exactly once',()=>{
    const s=setup(),update=vi.fn();s.navigator.navigate(update);
    expect(update).not.toHaveBeenCalled();
    s.navigator.flush();
    expect(update).toHaveBeenCalledOnce();expect(s.navigator.pending()).toBe(false);
    s.updates[0]();s.navigator.flush();
    expect(update).toHaveBeenCalledOnce();
  });
  it('flush cannot apply a superseded or disposed navigation',()=>{
    const s=setup(),first=vi.fn(),latest=vi.fn();
    s.navigator.navigate(first);s.navigator.navigate(latest);s.navigator.flush();
    expect(first).not.toHaveBeenCalled();expect(latest).toHaveBeenCalledOnce();
    const later=vi.fn();s.navigator.navigate(later);s.navigator.dispose();s.navigator.flush();
    expect(later).not.toHaveBeenCalled();
  });
  it('commits immediately under reduced motion without starting an animation',()=>{
    const s=setup(true),update=vi.fn();s.navigator.navigate(update);
    expect(update).toHaveBeenCalledOnce();expect(s.start).not.toHaveBeenCalled();expect(s.fallback).not.toHaveBeenCalled();
  });
  it('uses the immediate legacy path if native snapshots are unavailable',()=>{
    const update=vi.fn(),fallback=vi.fn();
    createWorkspaceNavigator({commit:fn=>fn(),start:()=>undefined,reduced:()=>false,fallback}).navigate(update);
    expect(update).toHaveBeenCalledOnce();expect(fallback).toHaveBeenCalledOnce();
  });
  it('cannot apply a delayed update after its owner is disposed',()=>{
    const s=setup(),update=vi.fn();s.navigator.navigate(update);s.navigator.dispose();s.updates[0]();
    expect(update).not.toHaveBeenCalled();expect(s.handles[0].skipTransition).toHaveBeenCalledOnce();
  });
  it('an older completion cannot clear ownership of a newer animation',async()=>{
    const s=setup();s.navigator.navigate(()=>{});s.updates[0]();s.navigator.navigate(()=>{});
    s.handles[0].finish();await Promise.resolve();s.navigator.skip();
    expect(s.handles[1].skipTransition).toHaveBeenCalledOnce();
  });
});
