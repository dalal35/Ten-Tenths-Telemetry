// Native smoke check for the exact managed helpers, using original CC0 media fixtures.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {prepare,toolFiles} from './prepare-youtube-tools.mjs';

export function executableArchitecture(bytes,target){
 if(target==='x86_64-pc-windows-msvc'){
  assert(bytes.length>=256&&bytes.toString('ascii',0,2)==='MZ','Invalid helper PE');
  const offset=bytes.readUInt32LE(0x3c);assert(offset+26<=bytes.length,'Truncated helper PE');
  assert.equal(bytes.toString('ascii',offset,offset+4),'PE\0\0','Invalid helper PE header');
  assert.equal(bytes.readUInt16LE(offset+4),0x8664,'Expected x64 helper');return;
 }
 assert.equal(target,'aarch64-apple-darwin','Unsupported helper target');
 assert(bytes.length>=32,'Truncated helper Mach-O');
 if(bytes.readUInt32LE(0)===0xfeedfacf){assert.equal(bytes.readUInt32LE(4),0x0100000c,'Expected arm64 helper');return;}
 assert.equal(bytes.readUInt32BE(0),0xcafebabe,'Expected Mach-O or universal helper');
 const count=bytes.readUInt32BE(4);assert(count>0&&count<=8&&bytes.length>=8+count*20,'Invalid universal helper');
 assert(Array.from({length:count},(_,i)=>bytes.readUInt32BE(8+i*20)).includes(0x0100000c),'Universal helper has no arm64 slice');
}
export function smokeTools(directory,target,installed=false){
 const files=installed?['yt-dlp','deno','ffmpeg','ffprobe'].map(name=>`${name}${target.includes('windows')?'.exe':''}`):toolFiles(target);
 const paths=Object.fromEntries(['yt-dlp','deno','ffmpeg','ffprobe'].map((name,i)=>[name,join(directory,files[i])]));
 for(const file of files)executableArchitecture(readFileSync(join(directory,file)),target);
 const run=(name,args)=>execFileSync(paths[name],args,{encoding:'utf8',env:{...process.env,DENO_NO_UPDATE_CHECK:'1',NO_COLOR:'1'},stdio:['ignore','pipe','pipe']});
 assert.equal(run('yt-dlp',['--ignore-config','--no-plugin-dirs','--version']).trim(),'2026.10.26');
 assert.match(run('deno',['--version']),/^deno 2\.9\.8 /);
 assert.equal(run('deno',['eval','--no-config','console.log(6*7)']).trim(),'42');
 for(const name of ['ffmpeg','ffprobe'])assert.match(run(name,['-version']),new RegExp(`^${name} version 9\\.0\\.2 `));
 assert.match(run('ffmpeg',['-L']),/GNU Lesser General Public\s+License/);
 const protocols=run('ffmpeg',['-hide_banner','-protocols']);
 assert(!/https?|ftp|tcp|tls|udp|crypto/.test(protocols),'Managed FFmpeg must have no network/decryption protocols');
 const directoryFixture=resolve('src-tauri/tests/fixtures/windows'),fixture=join(directoryFixture,'vfr.mp4');
 const temporary=mkdtempSync(join(tmpdir(),'ttt-youtube-tools-'));
 try{
  const merged=join(temporary,'merged.mp4');
  run('ffmpeg',['-nostdin','-v','error','-i',fixture,'-i',fixture,'-map','0:v:0','-map','1:a:0','-c','copy','-movflags','+faststart',merged]);
  const probe=JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',merged]));
  assert.deepEqual(probe.streams.map(stream=>stream.codec_name).sort(),['aac','h264']);
  assert(Number(probe.format.duration)>=3.3&&Number(probe.format.duration)<=3.5,'Unexpected remux duration');
  const frames=JSON.parse(run('ffprobe',['-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=pts_time','-of','json',merged]));
  assert.deepEqual(frames.frames.map(frame=>Number(frame.pts_time)),[2,2.1,2.4,2.9],'Stream copy changed actual VFR timestamps');
  run('ffmpeg',['-nostdin','-v','error','-xerror','-i',merged,'-an','-f','null','-']);
  const broken=join(temporary,'broken.mp4');writeFileSync(broken,readFileSync(merged).subarray(0,32));
  assert.throws(()=>run('ffprobe',['-v','error','-show_format',broken]),/failed|invalid|moov|error/i);
  console.log(`Managed helper smoke passed: ${target}; H.264/AAC merge, VFR PTS [2,2.1,2.4,2.9], decode, corrupt media rejection and Deno JIT.`);
 }finally{rmSync(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const receipt=await prepare();smokeTools(resolve('src-tauri/binaries'),receipt.target);
}
