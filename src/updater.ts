export interface DownloadProgress { downloaded:number; total:number|null }
export type DownloadEvent={event:'Started';data:{contentLength?:number}}|{event:'Progress';data:{chunkLength:number}}|{event:'Finished'};

export function advanceDownload(progress:DownloadProgress,event:DownloadEvent):DownloadProgress{
  if(event.event==='Started')return {downloaded:0,total:event.data.contentLength??null};
  if(event.event==='Progress')return {...progress,downloaded:progress.downloaded+event.data.chunkLength};
  return progress;
}
export function downloadFraction({downloaded,total}:DownloadProgress):number|null{
  return total?Math.min(downloaded/total,1):null;
}
export function formatDownload({downloaded,total}:DownloadProgress):string{
  const megabytes=(bytes:number)=>`${Math.round(bytes/1_048_576).toLocaleString()} MB`;
  return total?`${megabytes(downloaded)} of ${megabytes(total)}`:megabytes(downloaded);
}
