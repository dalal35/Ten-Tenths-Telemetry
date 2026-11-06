import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function verifyWindowsBinary(bytes){
 assert(bytes.length>=256&&bytes.toString('ascii',0,2)==='MZ','Invalid Windows executable');
 const pe=bytes.readUInt32LE(0x3c);
 assert(pe+94<=bytes.length&&bytes.toString('ascii',pe,pe+4)==='PE\0\0','Invalid PE header');
 assert.equal(bytes.readUInt16LE(pe+4),0x8664,'Windows binary must be x64');
 assert.equal(bytes.readUInt16LE(pe+24),0x20b,'Windows binary must be PE32+');
 assert.equal(bytes.readUInt16LE(pe+24+68),2,'Release binary must use GUI subsystem (no console)');
}
export function releasePlatforms(mode='all'){
 assert(['windows','macos','all'].includes(mode),'Unknown release platform selection');
 return mode==='all'?['macos','windows']:[mode];
}
export function releaseAssetNames(platform,version){
 assert(['macos','windows'].includes(platform),'Unknown release platform');
 const suffixes=platform==='macos'?['_aarch64.dmg','_aarch64.app.tar.gz']:['_x64-setup.exe'];
 return suffixes.map(suffix=>`Ten-Tenths-Telemetry_${version}${suffix}`);
}
export function verifyArtifacts(root,version,expected={}){
 const platforms=expected.platforms??releasePlatforms();
 assert(Array.isArray(platforms)&&platforms.length>0&&new Set(platforms).size===platforms.length&&platforms.every(p=>['macos','windows'].includes(p)),'Invalid release platforms');
 const files=[],identities=[];
 for(const platform of platforms){
  const dir=join(root,platform),manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));
  assert.equal(manifest.schema,1,'Unknown artifact manifest');
  assert.equal(manifest.platform,platform);
  assert.equal(manifest.target,platform==='macos'?'aarch64-apple-darwin':'x86_64-pc-windows-msvc','Wrong artifact architecture');
  assert.equal(manifest.version,version,'Artifact version differs');
  assert.match(manifest.revision,/^[a-f0-9]{40}$/,'Missing build revision');
  assert.equal(typeof manifest.runId,'string','Missing workflow run');
  assert(manifest.runId.length>0,'Missing workflow run');
  if(expected.revision)assert.equal(manifest.revision,expected.revision,'Wrong build revision');
  if(expected.runId)assert.equal(manifest.runId,expected.runId,'Wrong workflow run');
  identities.push(`${manifest.revision}/${manifest.runId}`);
  const required=releaseAssetNames(platform,version);
  assert.equal(manifest.assets?.length,required.length,'Incomplete platform artifact set');
  assert.deepEqual(manifest.assets.map(a=>a.name).sort(),required.sort(),'Wrong artifact names/architecture');
  assert.deepEqual(readdirSync(dir).sort(),['manifest.json',...required].sort(),'Unexpected staged files');
  for(const asset of manifest.assets){
   assert.equal(basename(asset.name),asset.name,'Unsafe artifact path');
   const path=join(dir,asset.name),bytes=readFileSync(path);
   assert(statSync(path).isFile()&&bytes.length>0,'Empty artifact');
   assert.equal(bytes.length,asset.size,'Artifact size differs');
   assert.equal(sha256(bytes),asset.sha256,'Artifact checksum differs');
   files.push({path,name:asset.name,size:asset.size,sha256:asset.sha256});
  }
 }
 assert(identities.every(identity=>identity===identities[0]),'Artifacts came from different builds/runs');
 return files;
}
export function writeChecksums(root,files){
 const path=join(root,'SHA256SUMS');
 writeFileSync(path,files.map(f=>`${f.sha256}  ${f.name}\n`).join(''));
 return path;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const files=verifyArtifacts(process.argv[2],process.argv[3],{revision:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,platforms:releasePlatforms(process.env.RELEASE_PLATFORMS)});
 writeChecksums(process.argv[2],files);
 console.log(`Verified ${files.length} release artifacts with SHA-256 checksums.`);
}
