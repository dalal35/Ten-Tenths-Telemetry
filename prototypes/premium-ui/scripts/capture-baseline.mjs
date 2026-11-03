import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';


// Use the real app, plots and video UI, with synthetic IPC data only.
const output = resolve('docs/ui-exploration/screenshots');
const bridge = resolve('website/demo/bridge.ts').replaceAll('\\','/');
const nativeBridge = resolve('src/bridge.ts').replaceAll('\\','/');
const demoExports = [...readFileSync(bridge,'utf8').matchAll(/export\s+(?:async\s+)?(?:const|function)\s+(\w+)/g)].map(match=>match[1]).filter(name=>name!=='librarySnapshot');
mkdirSync(output, {recursive:true});
const adapter = {
  name:'baseline-synthetic-bridge', enforce:'pre',
  resolveId(source, importer) {
    if (importer?.replaceAll('\\','/').includes('/src/') && (source === './bridge' || source === '../bridge')) return '\0baseline-bridge';
  },
  load(id) {
    if (id !== '\0baseline-bridge') return;
    // Remove the demo's fictitious onboard file so the real video UI starts unloaded.
    return `export * from ${JSON.stringify(nativeBridge)}; export {${demoExports.join(',')}} from ${JSON.stringify(bridge)}; import {librarySnapshot as snapshot} from ${JSON.stringify(bridge)}; export async function librarySnapshot(){const value=await snapshot(); return {...value,entries:value.entries.map(entry=>({...entry,workspace:entry.workspace?{...entry.workspace,video:undefined}:entry.workspace}))};}`;
  },
  config(config) { config.server ??= {}; config.server.watch = null; }
};
const server = await createServer({configFile:resolve('vite.config.ts'),plugins:[adapter],server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}});
let browser;
try {
  await server.listen();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
  browser = await chromium.launch({headless:true,...(executablePath ? {executablePath} : {})});
  for (const [size, viewport] of [['desktop',{width:1440,height:920}],['compact',{width:600,height:500}]]) {
    const page = await browser.newPage({viewport, reducedMotion:'reduce'});
    page.on('pageerror', error => console.error('Page error:', error));
    page.on('console', message => { if (message.type() === 'error') console.error('Browser:', message.text()); });
    await page.goto(server.resolvedUrls.local[0], {waitUntil:'networkidle'});
    await page.locator('.uplot').first().waitFor({state:'visible'});
    for (const [name, button, target] of [['telemetry','Telemetry','.uplot'],['video','Video','.video-workspace'],['advanced','Advanced','.advanced-workspace'],['coach','AI Driving Coach','.coach-workspace']]) {
      await page.getByRole('button',{name:button,exact:true}).click();
      await page.locator(target).first().waitFor({state:'visible'});
      if (name === 'advanced') await page.locator('.analysis-surface canvas').waitFor({state:'visible'});
      await page.screenshot({path:resolve(output,`baseline-${name}-${size}.png`),animations:'disabled'});
    }
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
