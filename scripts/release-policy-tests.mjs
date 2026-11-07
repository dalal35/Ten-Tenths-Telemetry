import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const workflow=readFileSync(new URL('../.github/workflows/release.yml',import.meta.url),'utf8');
test('Windows helper provisioning inherits the installed Node and Python PATH',()=>{
 for(const name of ['release.yml','windows-dev.yml']){
  const source=readFileSync(new URL(`../.github/workflows/${name}`,import.meta.url),'utf8');
  assert.match(source,/uses: msys2\/setup-msys2@[a-f0-9]{40} # v2\.[\s\S]*?msystem: UCRT64\n\s+path-type: inherit/);
 }
});
test('publication requires selected native builds and only a tag push',()=>{
 assert.match(workflow,/needs: \[macos, windows\]/);
 assert.match(workflow,/github\.event_name == 'push'/);
 assert.match(workflow,/startsWith\(github\.ref, 'refs\/tags\/'\)/);
 assert.match(workflow,/always\(\) && github\.event_name/);
 assert.match(workflow,/== 'windows' && needs\.windows\.result == 'success' && needs\.macos\.result == 'skipped'/);
 assert.match(workflow,/== 'macos' && needs\.macos\.result == 'success' && needs\.windows\.result == 'skipped'/);
 assert.match(workflow,/== 'all' && needs\.macos\.result == 'success' && needs\.windows\.result == 'success'/);
 assert.doesNotMatch(workflow,/releaseDraft: false/);
});
test('build jobs cannot publish and dispatch is available for validation',()=>{
 assert.match(workflow,/workflow_dispatch:/);
 assert.match(workflow,/permissions:\s*\n  contents: read/);
 assert.equal((workflow.match(/contents: write/g)||[]).length,1);
 assert.match(workflow,/runs-on: windows-latest/);
});
test('every command in multi-command steps must fail the step on error',()=>{
 assert(/defaults:\s*\n  run:\s*\n    shell: bash/.test(workflow),'Use fail-fast bash on both hosts; default PowerShell may mask an earlier native-command failure');
});
test('main pushes validate without publishing and macOS is opt-in',()=>{
 assert.match(workflow,/branches:\s*\n      - main/);
 assert.match(workflow,/RELEASE_PLATFORMS: \$\{\{ inputs\.platforms \|\| vars\.RELEASE_PLATFORMS \|\| 'windows' \}\}/);
 assert.match(workflow,/default: windows\n\s+options: \[windows, macos, all\]/);
 assert.match(workflow,/macos:\s*\n    if: \(inputs\.platforms \|\| vars\.RELEASE_PLATFORMS \|\| 'windows'\) != 'windows'/);
 assert.match(workflow,/windows:\s*\n    if: \(inputs\.platforms \|\| vars\.RELEASE_PLATFORMS \|\| 'windows'\) != 'macos'/);
 assert.match(workflow,/if: env\.RELEASE_PLATFORMS != 'windows'\n        with:\n          name: ttt-macos/);
 assert.match(workflow,/if: env\.RELEASE_PLATFORMS != 'macos'\n        with:\n          name: ttt-windows/);
 assert.doesNotMatch(workflow,/\|\| 'macos'/);
 const publish=workflow.slice(workflow.indexOf('  publish:'));
 assert.match(publish,/github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/'\)/);
 for(const ref of ['refs/heads/main','refs/heads/feature'])assert.equal(ref.startsWith('refs/tags/'),false);
});
test('only the tag-gated publisher can reach the update signing key',()=>{
 const publish=workflow.indexOf('  publish:');
 assert.equal(workflow.slice(0,publish).includes('TAURI_SIGNING_PRIVATE_KEY'),false);
 assert.match(workflow.slice(publish),/TAURI_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/);
 assert.match(workflow.slice(publish),/npm ci --ignore-scripts/);
});
