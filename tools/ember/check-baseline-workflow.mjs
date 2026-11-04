// Re-run an existing regression against starting sources entirely in memory.
// This never edits production sources or recreates frozen baseline screenshots.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
const paths=['src/App.tsx','src/Plots.tsx','src/Track.tsx','src/Segments.tsx','src/SessionSidebar.tsx','src/design-system.css','src/plots.css','src/shell.css','src/telemetry-inspector.css'];
const sources=Object.fromEntries(paths.map(path=>[path,execFileSync('git',['show',`72786c8:${path}`],{encoding:'utf8'})]));
const plugin=`const baselineSources=${JSON.stringify(sources)};const baselinePlugin={name:'ember-starting-sources',enforce:'pre',transform(code,id){const path=id.replaceAll('\\\\','/').split('?')[0];const key=Object.keys(baselineSources).find(p=>path.endsWith('/'+p));if(key)return {code:baselineSources[key],map:null};}};\n`;
let script=readFileSync('scripts/verify-workflow.mjs','utf8').replace("from './browser.mjs'","from '../scripts/browser.mjs'").replace('plugins:[browserTestNoWatch]','plugins:[baselinePlugin,browserTestNoWatch]');
mkdirSync('.tools',{recursive:true});writeFileSync('.tools/ember-baseline-workflow.mjs',plugin+script);
const result=spawnSync(process.execPath,['.tools/ember-baseline-workflow.mjs'],{stdio:'inherit'});process.exitCode=result.status??1;
