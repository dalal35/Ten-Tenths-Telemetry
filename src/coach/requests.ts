export class CoachRequests {
 private current:{id:string;generation:number}|null=null;
 private generation=0;
 begin(id:string){const token={id,generation:++this.generation};this.current=token;return token;}
 accepts(token:{id:string;generation:number}){return this.current?.id===token.id&&this.current.generation===token.generation;}
 clear(){const id=this.current?.id??null;this.current=null;++this.generation;return id;}
}

interface QueuedCoach<T>{id:string;operation:()=>Promise<T>;cancel:()=>void;cancelled:boolean;resolve:(value:T|undefined)=>void;reject:(error:unknown)=>void}
/** Native cancellation is cooperative; a replacement must wait for the old worker. */
export class CoachQueue<T>{
 private active:QueuedCoach<T>|null=null;
 private pending:QueuedCoach<T>|null=null;
 run(id:string,operation:()=>Promise<T>,cancel:()=>void):Promise<T|undefined>{
  if(this.pending){this.pending.resolve(undefined);this.pending=null;}
  return new Promise((resolve,reject)=>{
   this.pending={id,operation,cancel,cancelled:false,resolve,reject};
   if(this.active)this.cancel(this.active.id);
   else this.start();
  });
 }
 cancel(id:string){
  if(this.pending?.id===id){this.pending.resolve(undefined);this.pending=null;}
  if(this.active?.id===id&&!this.active.cancelled){this.active.cancelled=true;this.active.cancel();}
 }
 private start(){
  const job=this.pending;if(!job)return;
  this.pending=null;this.active=job;
  void (async()=>{
   try{const result=await job.operation();job.resolve(job.cancelled?undefined:result);}
   catch(error){job.reject(error);}
   finally{this.active=null;this.start();}
  })();
 }
}
