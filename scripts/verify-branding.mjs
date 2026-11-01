import {launchBrowser} from './browser.mjs';
import {expect} from '@playwright/test';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
let server,browser;
try{
 mkdirSync('.tools/branding',{recursive:true});
 server=await createServer({optimizeDeps:{entries:['index.html']},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});await server.listen();
 browser=await launchBrowser();const page=await browser.newPage({viewport:{width:1440,height:920}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('apex-theme','light');localStorage.setItem('apex-telemetry:session-explorer',JSON.stringify({sidebarState:'collapsed',sort:'driver-desc',grouping:'circuit'}));});
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
 await expect(page).toHaveTitle('Ten Tenths Telemetry');
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await expect(page.locator('.shell')).toHaveAttribute('data-sidebar-state','collapsed');
 await expect(page.getByRole('button',{name:'Expand sidebar',exact:true})).toBeVisible();
 await expect(page.locator('.ttt-brand:visible')).toHaveCount(1);
 await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();
 await expect(page.locator('.ttt-brand:visible')).toHaveCount(1);
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('apex-telemetry:session-explorer'))),{sidebarState:'analysis',sort:'driver-desc',grouping:'circuit'});
 await page.getByRole('button',{name:'Switch to dark theme'}).click();
 for(const [width,height] of [[1440,920],[1024,768],[900,600],[600,500]]){
  await page.setViewportSize({width,height});
  await expect(page.locator('.titlebar .ttt-brand')).toBeVisible();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page horizontal overflow');
  assert(await page.locator('.titlebar .ttt-brand').evaluate(el=>el.scrollWidth<=el.clientWidth),'Header name fits');
  if(width<900){await page.getByRole('button',{name:'Open session explorer',exact:true}).click();}
  await expect(page.locator('.ttt-brand:visible')).toHaveCount(1);
  await page.screenshot({path:`.tools/branding/app-${width}.png`});
  if(width<900){await page.locator('#session-explorer').getByRole('button',{name:'Close session explorer',exact:true}).click();}
 }
 const response=await page.request.get(new URL('/brand/ttt-compact.svg',page.url()).href);assert(response.ok());assert.match(await response.text(),/<svg/);
 assert.deepEqual(errors,[]);console.log('Branding, theme and legacy preferences verified at 1440, 1024, 900 and 600px.');
}finally{await browser?.close();await server?.close();}
