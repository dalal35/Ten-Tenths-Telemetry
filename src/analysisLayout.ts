// Viewport constraints affect rendering only; the saved resize preference stays intact.
export function analysisPanelHeight(preferred:number,viewportHeight:number,reserved=260){
 return Math.min(preferred,Math.max(240,viewportHeight-reserved));
}
export function analysisPlotRect(width:number,height:number,bounds:readonly number[],equalScale:boolean){
 let left=62,right=width-18,top=18,bottom=height-44;
 if(equalScale){
  const scale=Math.min((right-left)/(bounds[1]-bounds[0]),(bottom-top)/(bounds[3]-bounds[2]));
  const plotWidth=(bounds[1]-bounds[0])*scale,plotHeight=(bounds[3]-bounds[2])*scale;
  left+=(right-left-plotWidth)/2;right=left+plotWidth;
  top+=(bottom-top-plotHeight)/2;bottom=top+plotHeight;
 }
 return {left,right,top,bottom};
}
