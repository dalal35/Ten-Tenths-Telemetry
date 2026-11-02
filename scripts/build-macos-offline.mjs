// Build a self-contained installer without HFS Finder metadata entering the signed app.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,renameSync,symlinkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {signYoutubeMacOS} from './sign-youtube-macos.mjs';
import {detachDiskImage} from './macos-disk-image.mjs';
if(process.platform!=='darwin')throw new Error('Build macOS installers on macOS.');
const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
const run=(command,args)=>execFileSync(command,args,{stdio:'inherit'});
run(resolve('node_modules/.bin/tauri'),['build','--target','aarch64-apple-darwin','--bundles','app','--','--locked',...(process.argv.includes('--offline')?['--offline']:[])]);
const bundle=resolve('src-tauri/target/aarch64-apple-darwin/release/bundle');
const sourceApp=join(bundle,'macos/Ten Tenths Telemetry.app');
const temporary=mkdtempSync(join(tmpdir(),'ttt-offline-installer-'));
let mayBeMounted=false;
try{
 const stage=join(temporary,'stage');mkdirSync(stage);
 const app=join(stage,'Ten Tenths Telemetry.app');
 run('ditto',['--norsrc','--noextattr','--noacl',sourceApp,app]);
 signYoutubeMacOS(app);
 run('codesign',['--verify','--deep','--strict',app]);
 symlinkSync('/Applications',join(stage,'Applications'));
 const image=join(temporary,'installer.dmg');
 run('hdiutil',['create','-fs','APFS','-format','UDZO','-volname','Ten Tenths Telemetry','-srcfolder',stage,image]);
 const mounted=join(temporary,'mounted');mkdirSync(mounted);
 let failure;
 mayBeMounted=true; // A failed attach may still have mounted a volume.
 try{
  run('hdiutil',['attach','-readonly','-nobrowse','-mountpoint',mounted,image]);
  run('codesign',['--verify','--deep','--strict',join(mounted,'Ten Tenths Telemetry.app')]);
 }catch(error){failure=error;}
 try{await detachDiskImage(mounted);mayBeMounted=false;}
 catch(error){failure??=error;}
 if(failure)throw failure;
 const output=join(bundle,'dmg');mkdirSync(output,{recursive:true});
 const destination=join(output,`Ten Tenths Telemetry_${version}_aarch64.dmg`);
 renameSync(image,destination);console.log(`Verified offline macOS installer: ${destination}`);
}finally{
 if(mayBeMounted)console.error(`Installer cleanup deferred: detach the volume at ${join(temporary,'mounted')} before removing ${temporary}.`);
 else rmSync(temporary,{recursive:true,force:true});
}
