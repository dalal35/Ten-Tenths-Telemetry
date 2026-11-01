import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export function assertYoutubeRedistribution(record){
 assert(record?.schema===1&&record.releaseReady===true&&Array.isArray(record.unresolved)&&record.unresolved.length===0,
  `YouTube tool publication blocked: ${(record?.unresolved??['Redistribution audit missing']).join(' ')}`);
 return record;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))assertYoutubeRedistribution(JSON.parse(readFileSync(new URL('../src-tauri/resources/youtube/redistribution.json',import.meta.url),'utf8')));
