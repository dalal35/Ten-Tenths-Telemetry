// Explicit local acceptance. Never upload private recordings to hosted CI.
import assert from 'node:assert/strict';
import {statSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
for (const id of ['0361','0362']) {
  const path=`data/yash dalal_59_PURDUE GP IN_Warm-up_a_${id}.xrk`;
  assert(statSync(path).isFile() && statSync(path).size>0,`Private XRK required: ${path}`);
}
const args=['test','--locked','--manifest-path','src-tauri/Cargo.toml','--lib','private_recording_','--','--ignored'];
const listing=execFileSync('cargo',[...args,'--list'],{encoding:'utf8',stdio:['ignore','pipe','inherit']});
const names=listing.split(/\r?\n/).filter(line=>line.endsWith(': test'));
assert.equal(names.length,15,`Expected all 15 private-recording acceptance tests; discovered ${names.length}`);
const result=spawnSync('cargo',args,{stdio:'inherit'});
if(result.error)throw result.error;
process.exit(result.status??1);
