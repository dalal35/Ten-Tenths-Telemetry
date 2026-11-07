// Signs release installers for the in-app updater and writes the manifest it reads.
// Installed apps reject anything that does not verify against the configured public key.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {readFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';

export const UPDATER_TARGETS={
 macos:{target:'darwin-aarch64',suffix:'_aarch64.app.tar.gz'},
 windows:{target:'windows-x86_64',suffix:'_x64-setup.exe'},
};
export const configuredPublicKey=(root='.')=>JSON.parse(readFileSync(resolve(root,'src-tauri/tauri.conf.json'),'utf8')).plugins.updater.pubkey;

const minisignLine=(encoded,kind)=>{
 const line=Buffer.from(encoded,'base64').toString('utf8').split('\n')[1];
 assert(line,`Malformed updater ${kind}`);
 return Buffer.from(line,'base64');
};
export function verifyUpdaterSignature(bytes,signature,publicKey){
 const key=minisignLine(publicKey,'public key'),signed=minisignLine(signature,'signature');
 assert.equal(key.length,42,'Malformed updater public key');
 assert.equal(signed.length,74,'Malformed updater signature');
 assert(key.subarray(2,10).equals(signed.subarray(2,10)),'Updater signature was made with a different key than the app trusts');
 const algorithm=signed.toString('ascii',0,2);
 assert(['Ed','ED'].includes(algorithm),'Unknown updater signature algorithm');
 const message=algorithm==='ED'?createHash('blake2b512').update(bytes).digest():bytes;
 const der=Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),key.subarray(10)]);
 assert(verify(null,message,createPublicKey({key:der,format:'der',type:'spki'}),signed.subarray(10)),'Updater signature does not verify');
}
export function tauriSigner(env=process.env){
 assert(env.TAURI_SIGNING_PRIVATE_KEY,'Missing TAURI_SIGNING_PRIVATE_KEY; installed apps could not accept this release');
 return path=>{
  execFileSync(process.execPath,[resolve('node_modules/@tauri-apps/cli/tauri.js'),'signer','sign',path],{env:{...process.env,TAURI_SIGNING_PRIVATE_KEY:env.TAURI_SIGNING_PRIVATE_KEY,TAURI_SIGNING_PRIVATE_KEY_PASSWORD:env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD??''},stdio:['ignore','ignore','inherit']});
  const output=`${path}.sig`,signature=readFileSync(output,'utf8').trim();
  rmSync(output);
  return signature;
 };
}
export function buildUpdaterManifest({files,platforms,version,repository,tag,notes,sign,publicKey,now=new Date()}){
 const entries=platforms.map(platform=>{
  const {target,suffix}=UPDATER_TARGETS[platform],name=`Ten-Tenths-Telemetry_${version}${suffix}`,file=files.find(f=>f.name===name);
  assert(file,`Missing updater asset ${name}`);
  const signature=sign(file.path);
  verifyUpdaterSignature(readFileSync(file.path),signature,publicKey);
  return [target,{signature,url:`https://github.com/${repository}/releases/download/${tag}/${name}`}];
 });
 return {version,notes,pub_date:now.toISOString(),platforms:Object.fromEntries(entries)};
}
