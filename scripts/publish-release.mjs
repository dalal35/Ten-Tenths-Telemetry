// Invoked only by the tag-gated publisher after all selected native builds succeed.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,statSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyArtifacts,writeChecksums,releasePlatforms} from './verify-release-artifacts.mjs';
import {verifyVersion} from './verify-release-version.mjs';
import {assertYoutubeRedistribution} from './check-youtube-redistribution.mjs';

export function publishRelease(root,version,env=process.env,run=args=>execFileSync('gh',args,{encoding:'utf8',stdio:['ignore','pipe','inherit']})){
 assert(env.GITHUB_EVENT_NAME==='push'&&env.GITHUB_REF===`refs/tags/v${version}`&&env.GITHUB_REF_NAME===`v${version}`,'Publication requires the matching tag push');
 assert.match(env.GITHUB_REPOSITORY??'',/^[\w.-]+\/[\w.-]+$/,'Missing repository');
 assert.match(env.GITHUB_SHA??'',/^[a-f0-9]{40}$/,'Missing workflow revision');
 assert(env.GITHUB_RUN_ID,'Missing workflow run');
 const platforms=releasePlatforms(env.RELEASE_PLATFORMS);
 const files=verifyArtifacts(root,version,{revision:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,platforms});
 const checksum=writeChecksums(root,files),notes=join(root,'release-notes.md');
 const sourceNotes=readFileSync(env.RELEASE_NOTES_FILE??resolve(`docs/release-notes-${version}.md`),'utf8');
 assert(sourceNotes.trim().length>0,'Release notes must not be empty');
 writeFileSync(notes,`${sourceNotes.trim()}\n\nBuild revision: ${env.GITHUB_SHA}\nWorkflow run: ${env.GITHUB_RUN_ID}\n`);
 const tag=env.GITHUB_REF_NAME,repo=['--repo',env.GITHUB_REPOSITORY];
 // Existing releases (including stale drafts) fail safely; never clobber assets.
 run(['release','create',tag,'--draft','--verify-tag','--title',`Ten Tenths Telemetry v${version}`,'--notes-file',notes,...repo]);
 const upload=[...files.map(f=>f.path),checksum];
 run(['release','upload',tag,...upload,...repo]);
 const remote=JSON.parse(run(['release','view',tag,'--json','isDraft,assets',...repo]));
 assert.equal(remote.isDraft,true,'Release must still be a draft before complete-set verification');
 const expected=[...files.map(f=>({name:f.name,size:f.size})),{name:'SHA256SUMS',size:statSync(checksum).size}].sort((a,b)=>a.name.localeCompare(b.name));
 const actual=remote.assets.map(a=>({name:a.name,size:a.size})).sort((a,b)=>a.name.localeCompare(b.name));
 assert.deepEqual(actual,expected,'Remote upload is incomplete; retaining draft');
 run(['release','edit',tag,'--draft=false','--prerelease=false','--latest=true',...repo]);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assertYoutubeRedistribution(JSON.parse(readFileSync(new URL('../src-tauri/resources/youtube/redistribution.json',import.meta.url),'utf8')));
 publishRelease(process.argv[2],verifyVersion());
}
