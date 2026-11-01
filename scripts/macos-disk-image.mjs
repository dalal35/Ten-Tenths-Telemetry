import {execFileSync} from 'node:child_process';
import {setTimeout} from 'node:timers/promises';

export async function detachDiskImage(mounted,run=execFileSync){
 for(let attempt=0;attempt<3;attempt++){
  try{return run('hdiutil',['detach',mounted],{stdio:['ignore','inherit','pipe']});}
  catch(error){
   if(attempt===2||error.status!==16||!/resource busy/i.test(String(error.stderr)))throw error;
   await setTimeout(1000);
  }
 }
}
