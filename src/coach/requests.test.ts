import {describe,it,expect} from 'vitest';
import {CoachQueue,CoachRequests} from './requests';
describe('coach request ownership',()=>{
 it('ignores old completion after session changes or cancellation',()=>{
  const requests=new CoachRequests();
  const first=requests.begin('a');expect(requests.accepts(first)).toBe(true);
  requests.clear();expect(requests.accepts(first)).toBe(false);
  const second=requests.begin('b');expect(requests.accepts(second)).toBe(true);
  expect(requests.accepts(first)).toBe(false);
 });
 it('returns only the owned request to cancel',()=>{
  const requests=new CoachRequests();expect(requests.clear()).toBeNull();
  requests.begin('a');expect(requests.clear()).toBe('a');expect(requests.clear()).toBeNull();
 });
});

function deferred<T>(){let resolve!:(value:T)=>void, reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
describe('native coach request handoff',()=>{
 it('waits for cancellation to settle before a retry from another component starts',async()=>{
  const queue=new CoachQueue<number>(),old=deferred<number>();let active=0,cancels=0;
  const first=queue.run('old',()=>{active++;return old.promise.finally(()=>{active--;});},()=>{cancels++;});
  queue.cancel('old');
  const second=queue.run('new',async()=>{expect(active).toBe(0);return 2;},()=>{});
  expect(cancels).toBe(1);expect(active).toBe(1);
  old.resolve(1);expect(await first).toBeUndefined();expect(await second).toBe(2);
 });
 it('runs only the latest queued recording and removes an unmounted queued owner',async()=>{
  const queue=new CoachQueue<number>(),old=deferred<number>();const started:string[]=[];
  const first=queue.run('old',()=>old.promise,()=>{});
  const superseded=queue.run('middle',async()=>{started.push('middle');return 2;},()=>{});
  const unmounted=queue.run('unmounted',async()=>{started.push('unmounted');return 3;},()=>{});
  queue.cancel('unmounted');
  expect(await superseded).toBeUndefined();expect(await unmounted).toBeUndefined();
  const latest=queue.run('latest',async()=>{started.push('latest');return 4;},()=>{});
  old.resolve(1);await first;expect(await latest).toBe(4);expect(started).toEqual(['latest']);
 });
 it('releases the running slot after native rejection',async()=>{
  const queue=new CoachQueue<number>(),old=deferred<number>();
  const first=queue.run('old',()=>old.promise,()=>{});
  const failure=expect(first).rejects.toThrow('native failed');
  const second=queue.run('new',async()=>2,()=>{});
  old.reject(new Error('native failed'));await failure;expect(await second).toBe(2);
 });
});
