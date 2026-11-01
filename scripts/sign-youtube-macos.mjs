// Tauri has no per-sidecar entitlements; runtime exceptions stay on their helpers.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const entitlements=fileURLToPath(new URL('../src-tauri/resources/youtube/deno-entitlements.plist',import.meta.url));
const ytDlpEntitlements=fileURLToPath(new URL('../src-tauri/resources/youtube/yt-dlp-entitlements.plist',import.meta.url));
const ytDlpVersion=JSON.parse(readFileSync(new URL('../src-tauri/resources/youtube/manifest.json',import.meta.url),'utf8')).toolVersions.ytDlp;
const configuration=JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json',import.meta.url),'utf8'));
export function signYoutubeMacOS(app){
 assert.equal(process.platform,'darwin','Sign macOS helpers on macOS');
 const run=(args,encoding='utf8')=>execFileSync('codesign',args,{encoding,stdio:['ignore','pipe','inherit']});
 const before=run(['--display','--entitlements','-',app]);
 const identity=process.env.APPLE_SIGNING_IDENTITY||configuration.bundle.macOS.signingIdentity||'-';
 const deno=join(app,'Contents/MacOS/deno');
 run(['--force','--sign',identity,'--options','runtime','--entitlements',entitlements,...(identity==='-'?['--timestamp=none']:['--timestamp']),deno]);
 const ytDlp=join(app,'Contents/MacOS/yt-dlp');
 // The one-file Python libraries retain upstream signatures after the outer helper is re-signed.
 run(['--force','--sign',identity,'--options','runtime','--entitlements',ytDlpEntitlements,...(identity==='-'?['--timestamp=none']:['--timestamp']),ytDlp]);
 run(['--force','--sign',identity,'--preserve-metadata=identifier,entitlements,flags',...(identity==='-'?['--timestamp=none']:['--timestamp']),app]);
 assert.equal(run(['--display','--entitlements','-',app]),before,'Main app entitlements changed');
 assert.match(run(['--display','--entitlements','-',deno]),/com\.apple\.security\.cs\.allow-jit/);
 assert.match(run(['--display','--entitlements','-',ytDlp]),/com\.apple\.security\.cs\.disable-library-validation/);
 run(['--verify','--deep','--strict',app]);
 assert.equal(execFileSync(deno,['eval','--no-config','console.log(6*7)'],{encoding:'utf8',env:{...process.env,DENO_NO_UPDATE_CHECK:'1'}}).trim(),'42','Signed Deno cannot execute JavaScript');
 assert.equal(execFileSync(ytDlp,['--version'],{encoding:'utf8'}).trim(),ytDlpVersion,'Signed yt-dlp cannot load its bundled Python');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))signYoutubeMacOS(resolve(process.argv[2]));
