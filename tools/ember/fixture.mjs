// Test-only IPC simulation backed by cached real 0361 diagnostics.
export const fixed = {primary:'lap-8', comparison:'lap-9', axis:'distance', channels:['gps-speed','channel-23'], zoom:{min:30,max:350}};
export async function settleCursor(page){
 await page.locator('.plot-row .uplot').first().waitFor();
 await page.waitForFunction(()=>document.querySelectorAll('.plot-row .uplot').length>=3);
 await page.evaluate(()=>document.fonts.ready);
 await page.locator('[data-plot]').first().focus();
 await page.keyboard.press('Home');
 for(let i=0;i<40;i++)await page.keyboard.press('ArrowRight');
 await page.evaluate(()=>document.activeElement?.blur());
}
export const initFixture=({data,coach,fixed,theme})=>{
   localStorage.setItem('apex-theme',theme);
   // React development build exposes commits through the DevTools integration hook.
   window.__emberCommits=[];window.__emberCanvasFonts=[];window.__emberCanvasColors=[];
   const fillText=CanvasRenderingContext2D.prototype.fillText;
   CanvasRenderingContext2D.prototype.fillText=function(...args){if(!window.__emberCanvasFonts.includes(this.font))window.__emberCanvasFonts.push(this.font);if(!window.__emberCanvasColors.includes(String(this.fillStyle)))window.__emberCanvasColors.push(String(this.fillStyle));return fillText.apply(this,args);};
   window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,inject:()=>1,onCommitFiberRoot:(_id,root)=>{const counts={};const walk=f=>{if(!f)return;const name=typeof f.type==='function'?(f.type.displayName||f.type.name):null;if(name && (!f.alternate || f.memoizedProps!==f.alternate.memoizedProps || f.memoizedState!==f.alternate.memoizedState))counts[name]=(counts[name]||0)+1;walk(f.child);walk(f.sibling);};walk(root.current);window.__emberCommits.push(counts);},onCommitFiberUnmount:()=>{}};
   const entry=structuredClone(data.snapshot.entries[0]);
   entry.workspace={contentVersion:entry.contentVersion,primary:fixed.primary,comparison:fixed.comparison,axis:fixed.axis,channels:fixed.channels,layout:'comfortable',view:'telemetry',zoom:{...fixed.zoom,primary:fixed.primary,comparison:fixed.comparison,axis:fixed.axis}};
   const snapshot={entries:[entry],activeSessionId:entry.id,warnings:[]};
   window.isTauri=true;window.__emberCalls=[];window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,invoke:async(cmd,args={})=>{
    window.__emberCalls.push({cmd,args});
    if(cmd.startsWith('plugin:event'))return 1;
    if(cmd==='library_snapshot')return snapshot;
    if(cmd==='load_library_session')return structuredClone(data.session);
    if(cmd==='save_workspace'){entry.workspace=args.workspace;return;}
    if(cmd==='analyze_session'){
     if(args.primaryId!==fixed.primary || args.comparisonId!==fixed.comparison || args.axis!==fixed.axis)throw Error('No cached real 0361 analysis for this combination');
     const result=structuredClone(data.analysis);
     for(const view of [result.primary,result.comparison])view.series=view.series.filter(s=>args.channelIds.includes(s.channelId));
     return result;
    }
    if(cmd==='analyze_advanced')return structuredClone(data.variants[args.request.tool]||data.variants.scatter);
    if(cmd==='validate_formulas')return [];
    if(cmd==='driving_coach_model_terms')return {version:'test-model',terms:'',policy:''};
    if(cmd==='driving_coach_status')return {phase:'Generating local explanations'};
    if(cmd==='analyze_driving_coach')return {report:coach.report,explanations:[],mode:'deterministic',modelVersion:'test-model',notice:'Showing computed telemetry evidence.',cached:false,elapsedMs:12,targetLapSeconds:args.targetLapSeconds??null,inferenceMetrics:null};
    if(cmd==='youtube_cache_status')return {limitBytes:10737418240,usedBytes:0,entries:[]};
    if(cmd==='youtube_download_status'||cmd==='resolve_cached_youtube_video'||cmd==='plugin:dialog|open')return null;
    throw Error(`Unsupported simulated IPC: ${cmd}`);
   }};
  };
