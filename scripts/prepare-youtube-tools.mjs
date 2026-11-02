// Build-host provisioning only. Installed apps execute their bundled, immutable tools.
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,createWriteStream,existsSync,readFileSync,writeFileSync,mkdirSync,renameSync,rmSync,copyFileSync,chmodSync} from 'node:fs';
import {lstat} from 'node:fs/promises';
import {join,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const root=fileURLToPath(new URL('../',import.meta.url));
const resource=join(root,'src-tauri/resources/youtube');
const manifestPath=join(resource,'manifest.json');
export const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
export const manifestHash=createHash('sha256').update(readFileSync(manifestPath)).digest('hex');
const targets={'darwin-arm64':'aarch64-apple-darwin','win32-x64':'x86_64-pc-windows-msvc'};
const names=['yt-dlp','deno','ffmpeg','ffprobe'];
export function toolFiles(target){
 if(!Object.values(targets).includes(target))throw new Error(`Unsupported YouTube tool target: ${target}`);
 return names.map(name=>`${name}-${target}${target.includes('windows')?'.exe':''}`);
}
export async function fileIdentity(path){
 const info=await lstat(path).catch(()=>{throw new Error(`YouTube tool input missing: ${path}`);});
 if(!info.isFile())throw new Error(`YouTube tool input must be a regular file: ${path}`);
 const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);
 return {bytes:info.size,sha256:hash.digest('hex')};
}
export async function verifyFile(path,expected){
 const actual=await fileIdentity(path);
 if(expected.bytes!==undefined&&actual.bytes!==expected.bytes)throw new Error(`YouTube tool size mismatch: ${path}`);
 if(actual.sha256!==expected.sha256)throw new Error(`YouTube tool checksum mismatch: ${path}`);
 return actual;
}
export function publishExecutable(source,destination){
 const temporary=`${destination}.${randomUUID()}.partial`;
 try{
  copyFileSync(source,temporary);chmodSync(temporary,0o755);
  try{renameSync(temporary,destination);}
  catch(error){
   if(process.platform!=='win32'||error.code!=='EPERM')throw error;
   // ReplaceFileW preserves open handles to the old file when Windows rename cannot.
   execFileSync('python',['-c',`import ctypes,sys\nk=ctypes.WinDLL('kernel32',use_last_error=True)\nf=k.ReplaceFileW;f.argtypes=[ctypes.c_wchar_p,ctypes.c_wchar_p,ctypes.c_wchar_p,ctypes.c_uint32,ctypes.c_void_p,ctypes.c_void_p];f.restype=ctypes.c_int\nif not f(sys.argv[1],sys.argv[2],None,0,None,None): raise ctypes.WinError(ctypes.get_last_error())`,destination,temporary],{stdio:['ignore','pipe','pipe']});
  }
 }
 finally{rmSync(temporary,{force:true});}
}
export function extractZip(path,directory,expectedName){
 // Validate the entire archive before extracting the single expected executable.
 const script=`import pathlib,stat,sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nfor i in z.infolist():\n p=pathlib.PurePosixPath(i.filename.replace('\\\\','/'))\n if p.is_absolute() or '..' in p.parts or ':' in i.filename or stat.S_ISLNK(i.external_attr>>16): raise ValueError('Unsafe ZIP traversal or symlink')\ni=z.getinfo(sys.argv[3])\nif i.is_dir() or i.file_size>300000000: raise ValueError('Unsafe executable entry')\nd=pathlib.Path(sys.argv[2]);d.mkdir(parents=True,exist_ok=True)\nwith z.open(i) as src,open(d/sys.argv[3],'xb') as dst:\n import shutil\n shutil.copyfileobj(src,dst)\n`;
 execFileSync(process.platform==='win32'?'python':'python3',['-c',script,path,directory,expectedName],{stdio:['ignore','pipe','pipe']});
}
export function extractSourceTar(path,directory,rootName){
 const script=`import pathlib,sys,tarfile\nt=tarfile.open(sys.argv[1],'r:*')\nitems=t.getmembers()\nfor i in items:\n p=pathlib.PurePosixPath(i.name.replace('\\\\','/'))\n if p.is_absolute() or '..' in p.parts or ':' in i.name or not p.parts or p.parts[0]!=sys.argv[3] or not (i.isfile() or i.isdir()): raise ValueError('Unsafe source tar entry')\nt.extractall(sys.argv[2],members=items)\n`;
 execFileSync(process.platform==='win32'?'python':'python3',['-c',script,path,directory,rootName],{stdio:['ignore','pipe','pipe']});
}
export async function verifyToolchain(directory,target,expectedManifest=manifestHash){
 const receipt=JSON.parse(readFileSync(join(directory,`toolchain-${target}.json`),'utf8'));
 if(receipt.schema!==1||receipt.target!==target||receipt.manifestSha256!==expectedManifest)throw new Error('YouTube tool manifest changed; reprovision the toolchain.');
 for(const name of toolFiles(target)){
  const expected=receipt.files?.[name];
  if(!expected||!Number.isSafeInteger(expected.bytes)||expected.bytes<=0||!/^[a-f0-9]{64}$/.test(expected.sha256))throw new Error(`Invalid tool identity: ${name}`);
  await verifyFile(join(directory,name),expected);
 }
 return receipt;
}
async function download(input,destination){
 if(existsSync(destination)){await verifyFile(destination,input);return;}
 const partial=`${destination}.partial`;rmSync(partial,{force:true});
 try{
  const response=await fetch(input.url,{signal:AbortSignal.timeout(300000)});
  if(!response.ok||!response.body)throw new Error(`Tool download failed: HTTP ${response.status} (${input.url})`);
  await pipeline(Readable.fromWeb(response.body),createWriteStream(partial,{flags:'wx'}));
  await verifyFile(partial,input);renameSync(partial,destination);
 }catch(error){rmSync(partial,{force:true});throw error;}
}
function run(command,args,cwd){return execFileSync(command,args,{cwd,stdio:'inherit'});}
export async function prepare({downloadTools=false,target=targets[`${process.platform}-${process.arch}`]}={}){
 const files=toolFiles(target),directory=join(root,'src-tauri/binaries');
 if(!downloadTools){
  const receipt=await verifyToolchain(directory,target);
  for(const file of ['NOTICE.md','YT_DLP_THIRD_PARTY_LICENSES.txt','DENO_LICENSE.md','FFMPEG_COPYING.LGPLv2.1','FFMPEG_SOURCE.md','redistribution.json','deno-entitlements.plist','ffmpeg-9.0.2.tar.xz.asc','ffmpeg-devel.asc'])if(!existsSync(join(resource,file)))throw new Error(`YouTube redistribution file missing: ${file}`);
  for(const input of manifest.sourceArchives)await verifyFile(join(resource,'sources',input.file),input);
  console.log(`Verified bundled YouTube tools: ${target}; ${Object.values(receipt.files).reduce((sum,file)=>sum+file.bytes,0)} executable bytes; pinned sources and notices present.`);return receipt;
 }
 if(target!==targets[`${process.platform}-${process.arch}`])throw new Error('Provision YouTube tools on their native build host.');
 mkdirSync(directory,{recursive:true});
 const cache=join(root,'.tools/youtube-downloads');mkdirSync(cache,{recursive:true});
 const sourceDir=join(resource,'sources');mkdirSync(sourceDir,{recursive:true});
 for(const input of manifest.sourceArchives){const archive=join(cache,input.file);await download(input,archive);copyFileSync(archive,join(sourceDir,input.file));}
 const work=join(root,'.tools/youtube-build',target);mkdirSync(work,{recursive:true});
 for(const [key,name] of [['ytDlp','yt-dlp'],['deno','deno']]){
  const input=manifest.tools[key].targets[target],archive=join(cache,basename(new URL(input.url).pathname));await download(input,archive);
  const destination=join(directory,files[names.indexOf(name)]);
  if(key==='deno'){
   const extracted=join(work,'deno');rmSync(extracted,{force:true,recursive:true});
   const executable=target.includes('windows')?'deno.exe':'deno';extractZip(archive,extracted,executable);publishExecutable(join(extracted,executable),destination);
  }else publishExecutable(archive,destination);
 }
 const ff=manifest.tools.ffmpeg,archive=join(cache,basename(new URL(ff.url).pathname));await download(ff,archive);
 const source=join(work,`ffmpeg-${ff.version}`);
 if(!existsSync(source))extractSourceTar(archive,work,`ffmpeg-${ff.version}`);
 const flags=[...ff.configure,...(process.platform==='darwin'?['--arch=aarch64','--cc=clang','--extra-cflags=-mmacosx-version-min=13.0','--extra-ldflags=-mmacosx-version-min=13.0']:['--arch=x86_64','--target-os=mingw32','--cc=gcc','--disable-x86asm','--extra-ldflags=-static'])];
 const previous=existsSync(join(directory,`toolchain-${target}.json`))?JSON.parse(readFileSync(join(directory,`toolchain-${target}.json`),'utf8')):null;
 const extension=target.includes('windows')?'.exe':'';
 if(JSON.stringify(previous?.configure)!==JSON.stringify(flags)||!['ffmpeg','ffprobe'].every(name=>existsSync(join(source,`${name}${extension}`)))){
  run(process.platform==='win32'?'bash':'sh',['./configure',...flags],source);
  const jobs=Math.max(1,Math.min(8,Number(process.env.NUMBER_OF_PROCESSORS)||8));
  run('make',[`-j${jobs}`,`ffmpeg${extension}`,`ffprobe${extension}`],source);
 }
 for(const name of ['ffmpeg','ffprobe']){
  const destination=join(directory,files[names.indexOf(name)]);publishExecutable(join(source,`${name}${extension}`),destination);
 }
 copyFileSync(join(source,'COPYING.LGPLv2.1'),join(resource,'FFMPEG_COPYING.LGPLv2.1'));
 const identities={};for(const file of files)identities[file]=await fileIdentity(join(directory,file));
 const versions={};for(let i=0;i<names.length;i++)versions[names[i]]=execFileSync(join(directory,files[i]),[i===0?'--version':i===1?'--version':'-version'],{encoding:'utf8'}).trim().split('\n')[0];
 const receipt={schema:1,target,manifestSha256:manifestHash,versions,configure:flags,files:identities};
 const receiptPath=join(directory,`toolchain-${target}.json`);writeFileSync(`${receiptPath}.partial`,JSON.stringify(receipt,null,2)+'\n');renameSync(`${receiptPath}.partial`,receiptPath);
 console.log(JSON.stringify(receipt,null,2));return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await prepare({downloadTools:process.argv.includes('--download')});
