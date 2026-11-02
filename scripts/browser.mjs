import {chromium} from '@playwright/test';
import {existsSync,readdirSync} from 'node:fs';

// Keep the existing local Chrome preference; other hosts use Playwright Chromium.
export function launchBrowser() {
  const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return chromium.launch({headless:true,...(process.platform==='darwin'&&existsSync(chrome)?{executablePath:chrome}:{})});
}

// Literal entries keep Vite on its no-glob fast path. Mixing index.html with a
// glob otherwise crawls the project root, including large native build folders.
export const browserTestEntries=['index.html',...readdirSync(new URL('../tests/',import.meta.url)).filter(name=>name.endsWith('.html')).map(name=>`tests/${name}`)];

// Vite 6 drops a null inline watch override when merging vite.config.ts. Set it
// in the config hook so tests never crawl native build artifacts on Windows.
export const browserTestNoWatch={name:'browser-tests-no-watch',config(config){config.server??={};config.server.watch=null;}};
