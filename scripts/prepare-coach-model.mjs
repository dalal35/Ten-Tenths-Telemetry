#!/usr/bin/env node
// Explicit build-time provisioning only. The installed application has no downloader.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { readFile, rename, rm, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
const directory = new URL('../src-tauri/resources/coach/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
const target = fileURLToPath(new URL(manifest.file, directory));
async function verify(path) {
  if ((await stat(path)).size !== manifest.bytes) throw new Error('Coach model size mismatch');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest('hex') !== manifest.sha256) throw new Error('Coach model checksum mismatch');
}
if (process.argv.includes('--download')) {
  if (!existsSync(target)) {
    const partial = `${target}.partial`;
    try {
      const response = await fetch(manifest.source);
      if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
      await verify(partial);
      await rename(partial, target);
    } catch (error) { await rm(partial, { force: true }); throw error; }
  }
}
if (!existsSync(target)) throw new Error('Offline coach weights missing. Run node scripts/prepare-coach-model.mjs --download on the build host before packaging.');
await verify(target);
for (const file of ['NOTICE', 'GEMMA_TERMS.txt', 'GEMMA_PROHIBITED_USE_POLICY.txt', 'LLAMA_CPP_LICENSE', 'LLAMA_CPP_RS_LICENSE']) await stat(new URL(file, directory));
console.log(`Verified ${manifest.modelVersion}: ${manifest.bytes} bytes, SHA-256 and redistribution files present.`);
