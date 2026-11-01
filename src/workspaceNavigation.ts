export interface WorkspaceTransition {
  ready:Promise<unknown>;
  finished:Promise<unknown>;
  skipTransition:()=>void;
}
type StartTransition=(update:()=>void)=>WorkspaceTransition;

/** One visual owner, no queued navigation, and no animation-gated application state. */
export function createWorkspaceNavigator({commit,start,reduced,fallback}:{
  commit:(update:()=>void)=>void;
  start:()=>StartTransition|undefined;
  reduced:()=>boolean;
  fallback:()=>void;
}){
  let generation=0,disposed=false,pending=false;
  let active:WorkspaceTransition|null=null;
  const skip=()=>{active?.skipTransition();active=null;};
  return {
    navigate(update:()=>void){
      if(disposed)return;
      const ticket=++generation;
      skip();pending=true;
      const apply=()=>{if(disposed||ticket!==generation)return;pending=false;commit(update);};
      const native=start();
      if(reduced()||!native){apply();if(!reduced())fallback();return;}
      try{
        const transition=native(apply);active=transition;
        // skipTransition rejects ready, but still runs the update callback.
        void transition.ready.catch(()=>{});
        void transition.finished.then(()=>{if(active===transition)active=null;},()=>{if(active===transition)active=null;});
      }catch{apply();fallback();}
    },
    skip,
    animating:()=>active!==null,
    pending:()=>pending,
    dispose(){disposed=true;++generation;pending=false;skip();},
  };
}
