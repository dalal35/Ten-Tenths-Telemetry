import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,readFileSync,symlinkSync,rmSync,openSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import {verifyFile,extractZip,extractSourceTar,toolFiles,verifyToolchain,publishExecutable} from './prepare-youtube-tools.mjs';
import {executableArchitecture} from './verify-youtube-tools.mjs';
import {assertYoutubeRedistribution} from './check-youtube-redistribution.mjs';

const root=()=>mkdtempSync(join(tmpdir(),'ttt-tools-test-'));
const sha='2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

test('verification rejects a missing, modified or symlinked executable',async()=>{
 const dir=root();try{
  const file=join(dir,'helper');
  await assert.rejects(verifyFile(file,{sha256:sha,bytes:5}),/missing/i);
  writeFileSync(file,'hello');await verifyFile(file,{sha256:sha,bytes:5});
  writeFileSync(file,'jello');await assert.rejects(verifyFile(file,{sha256:sha,bytes:5}),/checksum/i);
  if(process.platform!=='win32'){symlinkSync(file,join(dir,'link'));await assert.rejects(verifyFile(join(dir,'link'),{sha256:sha,bytes:5}),/regular file/i);}
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('target naming is explicit and unsupported hosts cannot use a different helper',()=>{
 assert.deepEqual(toolFiles('aarch64-apple-darwin'),['yt-dlp-aarch64-apple-darwin','deno-aarch64-apple-darwin','ffmpeg-aarch64-apple-darwin','ffprobe-aarch64-apple-darwin']);
 assert.deepEqual(toolFiles('x86_64-pc-windows-msvc'),['yt-dlp-x86_64-pc-windows-msvc.exe','deno-x86_64-pc-windows-msvc.exe','ffmpeg-x86_64-pc-windows-msvc.exe','ffprobe-x86_64-pc-windows-msvc.exe']);
 assert.throws(()=>toolFiles('x86_64-apple-darwin'),/unsupported/i);
});

test('ZIP extraction rejects traversal and symlinks before creating any file',()=>{
 const dir=root();try{
  for(const [kind,name] of [['file','../escape'],['symlink','deno']]){
   const archive=join(dir,`${kind}.zip`),destination=join(dir,kind);
   execFileSync(process.platform==='win32'?'python':'python3',['-c',`import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1],'w')\ni=zipfile.ZipInfo(sys.argv[2])\ni.create_system=3\ni.external_attr=(0o120777 if sys.argv[3]=='symlink' else 0o100644)<<16\nz.writestr(i,'outside')\nz.close()`,archive,name,kind]);
   assert.throws(()=>extractZip(archive,destination,'deno'),/unsafe|symlink|traversal/i);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a corrupt installed helper cannot pass using its recorded size alone',async()=>{
 const dir=root();try{
  mkdirSync(join(dir,'binaries'));
  const directory=join(dir,'binaries');
  const files=toolFiles('aarch64-apple-darwin');
  for(const file of files)writeFileSync(join(directory,file),'hello');
  const receipt={schema:1,target:'aarch64-apple-darwin',manifestSha256:'a'.repeat(64),files:Object.fromEntries(files.map(name=>[name,{bytes:5,sha256:sha}]))};
  writeFileSync(join(directory,'toolchain-aarch64-apple-darwin.json'),JSON.stringify(receipt));
  await verifyToolchain(directory,'aarch64-apple-darwin','a'.repeat(64));
  writeFileSync(join(directory,files[2]),'jello');
  await assert.rejects(verifyToolchain(directory,'aarch64-apple-darwin','a'.repeat(64)),/checksum/i);
  await assert.rejects(verifyToolchain(directory,'aarch64-apple-darwin','b'.repeat(64)),/manifest/i);
  assert.equal(readFileSync(join(directory,files[0]),'utf8'),'hello');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('architecture inspection rejects valid binaries for the wrong processor',()=>{
 const mach=Buffer.alloc(32);mach.writeUInt32LE(0xfeedfacf);mach.writeUInt32LE(0x01000007,4);
 assert.throws(()=>executableArchitecture(mach,'aarch64-apple-darwin'),/arm64/);
 mach.writeUInt32LE(0x0100000c,4);executableArchitecture(mach,'aarch64-apple-darwin');
 const pe=Buffer.alloc(256);pe.write('MZ');pe.writeUInt32LE(128,0x3c);pe.write('PE\0\0',128);pe.writeUInt16LE(0xaa64,132);
 assert.throws(()=>executableArchitecture(pe,'x86_64-pc-windows-msvc'),/x64/);
 pe.writeUInt16LE(0x8664,132);executableArchitecture(pe,'x86_64-pc-windows-msvc');
});

test('publication stays blocked while the corresponding source audit is incomplete',()=>{
 assert.throws(()=>assertYoutubeRedistribution({schema:1,releaseReady:false,unresolved:['missing corresponding source']}),/publication blocked.*missing corresponding source/);
 assert.throws(()=>assertYoutubeRedistribution({schema:1,releaseReady:true,unresolved:['missing notices']}),/publication blocked/);
 assertYoutubeRedistribution({schema:1,releaseReady:true,unresolved:[]});
});

test('provisioning replaces the executable atomically without changing an open old file',()=>{
 const dir=root();let fd;try{
  const source=join(dir,'new'),destination=join(dir,'current');
  writeFileSync(source,'new helper');writeFileSync(destination,'old helper');fd=openSync(destination,'r');
  publishExecutable(source,destination);
  assert.equal(readFileSync(fd,'utf8'),'old helper');
  assert.equal(readFileSync(destination,'utf8'),'new helper');
 }finally{if(fd!==undefined)closeSync(fd);rmSync(dir,{recursive:true,force:true});}
});

test('source extraction rejects a tar symlink instead of writing through it',()=>{
 const dir=root();try{
  const archive=join(dir,'source.tar');
  execFileSync(process.platform==='win32'?'python':'python3',['-c',`import tarfile,sys\nt=tarfile.open(sys.argv[1],'w')\ni=tarfile.TarInfo('ffmpeg/link');i.type=tarfile.SYMTYPE;i.linkname='../outside';t.addfile(i);t.close()`,archive]);
  assert.throws(()=>extractSourceTar(archive,join(dir,'unpacked'),'ffmpeg'),/unsafe/i);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
