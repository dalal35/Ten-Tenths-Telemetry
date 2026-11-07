import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,generateKeyPairSync,sign as edSign} from 'node:crypto';
import {verifyVersion} from './verify-release-version.mjs';
import {verifyArtifacts,verifyWindowsBinary} from './verify-release-artifacts.mjs';
import {publishRelease} from './publish-release.mjs';
import {buildUpdaterManifest,verifyUpdaterSignature,configuredPublicKey} from './updater-manifest.mjs';
import {detachDiskImage} from './macos-disk-image.mjs';

test('disk image detach succeeds without retry or forcing the volume',async()=>{
 let attempts=0;
 await detachDiskImage('/mounted', (command,args)=>{attempts++;assert.equal(command,'hdiutil');assert.deepEqual(args,['detach','/mounted']);});
 assert.equal(attempts,1);
});
test('disk image detach retries transient resource contention normally',async()=>{
 let attempts=0;
 await detachDiskImage('/mounted', (command,args)=>{assert.equal(command,'hdiutil');assert.deepEqual(args,['detach','/mounted']);if(++attempts===1)throw Object.assign(Error('busy'),{status:16,stderr:Buffer.from('hdiutil: detach failed - Resource busy')});});
 assert.equal(attempts,2);
});
test('disk image detach preserves unrelated failures without retry',async()=>{
 for(const [status,stderr] of [[1,'Resource busy'],[16,'permission denied']]){
  let attempts=0;const failure=Object.assign(Error('detach failed'),{status,stderr});
  await assert.rejects(detachDiskImage('/mounted',()=>{attempts++;throw failure;}),error=>error===failure);
  assert.equal(attempts,1);
 }
});
test('disk image detach stops after three busy attempts and reports the failure',async()=>{
 let attempts=0;const failure=Object.assign(Error('still busy'),{status:16,stderr:'Resource busy'});
 await assert.rejects(detachDiskImage('/mounted',()=>{attempts++;throw failure;}),error=>error===failure);
 assert.equal(attempts,3);
});

// A real minisign-format key, so tests exercise the same check that guards publication.
function testUpdater(id=1){
 const {publicKey,privateKey}=generateKeyPairSync('ed25519'),keyId=Buffer.alloc(8,id);
 const raw=publicKey.export({format:'der',type:'spki'}).subarray(-32);
 const encoded=(comment,bytes)=>Buffer.from(`untrusted comment: ${comment}\n${bytes.toString('base64')}\n`).toString('base64');
 return {publicKey:encoded('public key',Buffer.concat([Buffer.from('Ed'),keyId,raw])),sign:path=>encoded('signature',Buffer.concat([Buffer.from('ED'),keyId,edSign(null,createHash('blake2b512').update(readFileSync(path)).digest(),privateKey)]))};
}
const latestAsset=root=>({name:'latest.json',size:statSync(join(root,'latest.json')).size});
function sandbox(t){const root=mkdtempSync(join(tmpdir(),'apex-release-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
function seedVersion(root){mkdirSync(join(root,'src-tauri'));writeFileSync(join(root,'package.json'),JSON.stringify({version:'0.1.0'}));writeFileSync(join(root,'package-lock.json'),JSON.stringify({version:'0.1.0',packages:{'':{version:'0.1.0'}}}));writeFileSync(join(root,'src-tauri/tauri.conf.json'),JSON.stringify({version:'0.1.0'}));writeFileSync(join(root,'src-tauri/Cargo.toml'),'[package]\nname = "apex-telemetry"\nversion = "0.1.0"\n');}
function seedArtifacts(root){writeFileSync(join(root,'source-notes.md'),'Complete platform release notes.\n');for(const platform of ['macos','windows']){const dir=join(root,platform);mkdirSync(dir);const names=platform==='macos'?['Ten-Tenths-Telemetry_0.1.0_aarch64.dmg','Ten-Tenths-Telemetry_0.1.0_aarch64.app.tar.gz']:['Ten-Tenths-Telemetry_0.1.0_x64-setup.exe'];const assets=names.map(name=>{const bytes=Buffer.from(`synthetic ${name}`);writeFileSync(join(dir,name),bytes);return {name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});writeFileSync(join(dir,'manifest.json'),JSON.stringify({schema:1,platform,target:platform==='macos'?'aarch64-apple-darwin':'x86_64-pc-windows-msvc',version:'0.1.0',revision:'a'.repeat(40),runId:'42',assets}));}}
test('version checks include lockfile and tag equality, dispatch permits a branch',t=>{const root=sandbox(t);seedVersion(root);assert.equal(verifyVersion(root,{GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF_NAME:'feature'}),'0.1.0');assert.throws(()=>verifyVersion(root,{GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/tags/v0.2.0',GITHUB_REF_NAME:'v0.2.0'}),/Tag/);writeFileSync(join(root,'package-lock.json'),'{"version":"0.2.0","packages":{"":{"version":"0.2.0"}}}');assert.throws(()=>verifyVersion(root,{}),/lockfile/);});
test('partial or tampered artifact sets cannot publish',t=>{const root=sandbox(t);mkdirSync(join(root,'macos'));assert.throws(()=>verifyArtifacts(root,'0.1.0'));rmSync(join(root,'macos'),{recursive:true});seedArtifacts(root);assert.equal(verifyArtifacts(root,'0.1.0').length,3);writeFileSync(join(root,'windows/Ten-Tenths-Telemetry_0.1.0_x64-setup.exe'),'changed');assert.throws(()=>verifyArtifacts(root,'0.1.0'),/checksum|size/);});
test('empty, wrong-architecture, traversal and mixed-run manifests are rejected',t=>{for(const mutation of ['empty','architecture','traversal','run']){const root=join(sandbox(t),mutation);mkdirSync(root);seedArtifacts(root);const p=join(root,'windows/manifest.json'),manifest=JSON.parse(readFileSync(p));if(mutation==='empty')manifest.assets=[];if(mutation==='architecture')manifest.target='aarch64-pc-windows-msvc';if(mutation==='traversal')manifest.assets[0].name='../outside.exe';if(mutation==='run')manifest.runId='43';writeFileSync(p,JSON.stringify(manifest));assert.throws(()=>verifyArtifacts(root,'0.1.0'),mutation);}});
test('Windows PE must be x64 GUI subsystem',()=>{const pe=Buffer.alloc(512);pe.write('MZ');pe.writeUInt32LE(128,0x3c);pe.write('PE\0\0',128);pe.writeUInt16LE(0x8664,132);pe.writeUInt16LE(0x20b,152);pe.writeUInt16LE(2,220);verifyWindowsBinary(pe);pe.writeUInt16LE(3,220);assert.throws(()=>verifyWindowsBinary(pe),/console/);pe.writeUInt16LE(2,220);pe.writeUInt16LE(0x14c,132);assert.throws(()=>verifyWindowsBinary(pe),/x64/);});
const tagEnv={GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/tags/v0.1.0',GITHUB_REF_NAME:'v0.1.0',GITHUB_REPOSITORY:'test/repo',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'42'};
function releaseEnv(root,overrides={}){return {...tagEnv,RELEASE_NOTES_FILE:join(root,'source-notes.md'),...overrides};}
test('dispatch and partial artifacts never call release operations',t=>{const root=sandbox(t),calls=[];assert.throws(()=>publishRelease(root,'0.1.0',releaseEnv(root,{GITHUB_EVENT_NAME:'workflow_dispatch'}),args=>calls.push(args)),/tag push/);assert.throws(()=>publishRelease(root,'0.1.0',releaseEnv(root),args=>calls.push(args)));assert.equal(calls.length,0);});
test('failed upload leaves a draft, and publication follows complete upload',t=>{const root=sandbox(t);seedArtifacts(root);const calls=[];assert.throws(()=>publishRelease(root,'0.1.0',releaseEnv(root),args=>{calls.push(args);if(args[1]==='upload')throw Error('upload failed');},testUpdater()),/upload failed/);assert.equal(calls.length,2);assert(calls[0].includes('--draft'));assert(!calls.some(c=>c[1]==='edit'));calls.length=0;publishRelease(root,'0.1.0',releaseEnv(root),args=>{calls.push(args);if(args[1]==='view')return JSON.stringify({isDraft:true,assets:[...verifyArtifacts(root,'0.1.0').map(f=>({name:f.name,size:f.size})),{name:'SHA256SUMS',size:statSync(join(root,'SHA256SUMS')).size},latestAsset(root)]});},testUpdater());assert.deepEqual(calls.map(c=>c[1]),['create','upload','view','edit']);assert(calls[3].includes('--draft=false'));});
test('remote incomplete upload is not published even if upload command succeeds',t=>{const root=sandbox(t);seedArtifacts(root);const calls=[];assert.throws(()=>publishRelease(root,'0.1.0',releaseEnv(root),args=>{calls.push(args);if(args[1]==='view')return JSON.stringify({isDraft:true,assets:[]});},testUpdater()),/incomplete/);assert(!calls.some(c=>c[1]==='edit'));});
test('existing release creation failure never uploads or overwrites',t=>{const root=sandbox(t);seedArtifacts(root);const calls=[];assert.throws(()=>publishRelease(root,'0.1.0',releaseEnv(root),args=>{calls.push(args);throw Error('already exists');},testUpdater()),/already exists/);assert.equal(calls.length,1);assert(!calls.flat().includes('--clobber'));});

test('branch push validates package versions without requiring a release tag',t=>{
 const root=sandbox(t);seedVersion(root);
 assert.equal(verifyVersion(root,{GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/fix/dedicated-advanced-workspace',GITHUB_REF_NAME:'fix/dedicated-advanced-workspace'}),'0.1.0');
 assert.equal(verifyVersion(root,tagEnv),'0.1.0');
 assert.throws(()=>verifyVersion(root,{...tagEnv,GITHUB_REF_NAME:'v0.2.0'}),/Tag/);
});

test('macOS-only artifact verification requires both Mac assets without Windows',t=>{
 const root=sandbox(t);seedArtifacts(root);rmSync(join(root,'windows'),{recursive:true});
 assert.equal(verifyArtifacts(root,'0.1.0',{platforms:['macos']}).length,2);
 assert.throws(()=>verifyArtifacts(root,'0.1.0'),/ENOENT/);
 rmSync(join(root,'macos/Ten-Tenths-Telemetry_0.1.0_aarch64.app.tar.gz'));
 assert.throws(()=>verifyArtifacts(root,'0.1.0',{platforms:['macos']}),/ENOENT|Unexpected staged files/);
});
test('macOS-only publisher uploads only verified Mac assets and describes the selected platform',t=>{
 const root=sandbox(t);seedArtifacts(root);rmSync(join(root,'windows'),{recursive:true});const calls=[];
 writeFileSync(join(root,'source-notes.md'),'Complete Apple Silicon feature release.\n');
 publishRelease(root,'0.1.0',releaseEnv(root,{RELEASE_PLATFORMS:'macos'}),args=>{
  calls.push(args);
  if(args[1]==='view')return JSON.stringify({isDraft:true,assets:[...verifyArtifacts(root,'0.1.0',{platforms:['macos']}).map(f=>({name:f.name,size:f.size})),{name:'SHA256SUMS',size:statSync(join(root,'SHA256SUMS')).size},latestAsset(root)]});
 },testUpdater());
 assert.deepEqual(calls.map(c=>c[1]),['create','upload','view','edit']);
 assert.doesNotMatch(readFileSync(join(root,'release-notes.md'),'utf8'),/Download the x64|Windows releases/);
 assert.match(readFileSync(join(root,'release-notes.md'),'utf8'),/Complete Apple Silicon feature release/);
 assert.match(readFileSync(join(root,'release-notes.md'),'utf8'),/Build revision:/);
 assert(!calls[0].includes('--prerelease'));
 assert(!calls[0].some(arg=>arg.endsWith(' Beta')));
 assert(calls.at(-1).includes('--prerelease=false'));
 assert(calls.at(-1).includes('--latest=true'));
});
test('unknown or empty platform sets cannot weaken release verification',t=>{
 const root=sandbox(t);seedArtifacts(root);
 for(const platforms of [[],['linux'],['macos','macos']])assert.throws(()=>verifyArtifacts(root,'0.1.0',{platforms}),/platform/i);
 assert.throws(()=>publishRelease(root,'0.1.0',releaseEnv(root,{RELEASE_PLATFORMS:'invalid'}),()=>assert.fail('must not publish')),/platform/i);
});

test('publication fails before remote operations when checked-in release notes are missing',t=>{
 const root=sandbox(t);seedArtifacts(root);
 assert.throws(()=>publishRelease(root,'0.1.0',releaseEnv(root,{RELEASE_NOTES_FILE:join(root,'missing-notes.md')}),()=>assert.fail('must not publish')),/ENOENT/);
});

test('GitHub filename sanitization leaves portable release assets and checksums unchanged',t=>{
 const root=sandbox(t);seedArtifacts(root);const calls=[];
 // GitHub replaces spaces with dots in uploaded asset names. Feed back that
 // server-side result rather than simply echoing the local upload names.
 publishRelease(root,'0.1.0',releaseEnv(root),args=>{
  calls.push(args);
  if(args[1]==='view')return JSON.stringify({isDraft:true,assets:[...verifyArtifacts(root,'0.1.0').map(f=>({name:f.name.replaceAll(' ','.'),size:f.size})),{name:'SHA256SUMS',size:statSync(join(root,'SHA256SUMS')).size},latestAsset(root)]});
 },testUpdater());
 const files=verifyArtifacts(root,'0.1.0');
 for(const file of files)assert.match(file.name,/^Ten-Tenths-Telemetry_0\.1\.0_[a-z0-9.\-]+$/);
 assert(readFileSync(join(root,'SHA256SUMS'),'utf8').includes('Ten-Tenths-Telemetry_0.1.0_aarch64.dmg'));
 assert(calls.at(-1).includes('--draft=false'));
});

test('published update manifest points each platform at its signed installer',t=>{
 const root=sandbox(t);seedArtifacts(root);const updater=testUpdater(),calls=[];
 publishRelease(root,'0.1.0',releaseEnv(root),args=>{calls.push(args);if(args[1]==='view')return JSON.stringify({isDraft:true,assets:[...verifyArtifacts(root,'0.1.0').map(f=>({name:f.name,size:f.size})),{name:'SHA256SUMS',size:statSync(join(root,'SHA256SUMS')).size},latestAsset(root)]});},updater);
 const latest=JSON.parse(readFileSync(join(root,'latest.json'),'utf8')),repository=releaseEnv(root).GITHUB_REPOSITORY;
 assert.equal(latest.version,'0.1.0');
 assert.match(latest.notes,/release notes/);
 assert(!Number.isNaN(Date.parse(latest.pub_date)));
 assert.deepEqual(Object.keys(latest.platforms).sort(),['darwin-aarch64','windows-x86_64']);
 assert.equal(latest.platforms['windows-x86_64'].url,`https://github.com/${repository}/releases/download/v0.1.0/Ten-Tenths-Telemetry_0.1.0_x64-setup.exe`);
 verifyUpdaterSignature(readFileSync(join(root,'windows/Ten-Tenths-Telemetry_0.1.0_x64-setup.exe')),latest.platforms['windows-x86_64'].signature,updater.publicKey);
 assert(calls.find(c=>c[1]==='upload').includes(join(root,'latest.json')));
});
test('a signing key the app does not trust stops publication before any remote operation',t=>{
 const root=sandbox(t);seedArtifacts(root);
 assert.throws(()=>publishRelease(root,'0.1.0',releaseEnv(root),()=>assert.fail('must not publish'),{sign:testUpdater(1).sign,publicKey:testUpdater(2).publicKey}),/different key/);
});
test('a tampered installer fails signature verification',t=>{
 const root=sandbox(t),file=join(root,'installer.exe'),updater=testUpdater();
 writeFileSync(file,'original');const signature=updater.sign(file);
 verifyUpdaterSignature(readFileSync(file),signature,updater.publicKey);
 assert.throws(()=>verifyUpdaterSignature(Buffer.from('tampered'),signature,updater.publicKey),/does not verify/);
});
test('a missing signing key stops publication before any remote operation',t=>{
 const root=sandbox(t);seedArtifacts(root);
 assert.throws(()=>publishRelease(root,'0.1.0',releaseEnv(root,{TAURI_SIGNING_PRIVATE_KEY:''}),()=>assert.fail('must not publish')),/TAURI_SIGNING_PRIVATE_KEY/);
});
test('the app is configured to read signed updates from this repository',()=>{
 const config=JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json',import.meta.url),'utf8')),capability=JSON.parse(readFileSync(new URL('../src-tauri/capabilities/default.json',import.meta.url),'utf8'));
 assert.deepEqual(config.plugins.updater.endpoints,['https://github.com/dalal35/ten-tenths-telemetry/releases/latest/download/latest.json']);
 assert.equal(config.plugins.updater.windows.installMode,'passive');
 assert.equal(Buffer.from(Buffer.from(configuredPublicKey(),'base64').toString().split('\n')[1],'base64').length,42);
 assert.notEqual(config.bundle.createUpdaterArtifacts,true,'Signing belongs to the publisher, so ordinary builds need no private key');
 for(const permission of ['updater:default','process:allow-restart'])assert(capability.permissions.includes(permission));
});
