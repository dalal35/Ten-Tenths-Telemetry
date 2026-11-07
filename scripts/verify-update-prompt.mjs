import {launchBrowser,browserTestEntries,browserTestNoWatch} from './browser.mjs';
// Real React coverage of the update prompt; only the native updater IPC is simulated.
// This cannot prove the installer runs: that needs a real install on Windows.
import {expect} from '@playwright/test';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';

const shots='.tools/update-prompt';
mkdirSync(shots,{recursive:true});
let server,browser;
function mockNative(options){
  window.isTauri=true;window.__updateCalls=[];
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,convertFileSrc:path=>path,invoke:async(cmd,args={})=>{
    window.__updateCalls.push(cmd);
    if(cmd==='plugin:updater|check'){
      if(options.check==='offline')throw Error('offline');
      return options.check==='none'?null:{rid:1,currentVersion:'0.1.3',version:'0.1.4',date:null,body:'',rawJson:{}};
    }
    if(cmd==='plugin:updater|download'){
      if(options.failDownload&&!window.__retried){window.__retried=true;throw Error('connection lost');}
      args.onEvent.onmessage({event:'Started',data:{contentLength:838860800}});
      args.onEvent.onmessage({event:'Progress',data:{chunkLength:335544320}});
      await new Promise(resolve=>{window.__finishDownload=resolve;});
      args.onEvent.onmessage({event:'Finished'});
      return 2;
    }
    if(cmd==='plugin:updater|install'||cmd==='plugin:process|restart'||cmd==='plugin:resources|close')return null;
    if(cmd.startsWith('plugin:event'))return 1;
    if(cmd==='library_snapshot')return {entries:[],activeSessionId:null,warnings:[]};
    return null;
  }};
}
async function open(options,viewport={width:1280,height:800},theme='dark'){
  const page=await browser.newPage({viewport});
  page.setDefaultTimeout(6000);
  page.errors=[];page.on('pageerror',error=>page.errors.push(error.message));
  await page.addInitScript(mockNative,options);
  await page.addInitScript(value=>localStorage.setItem('apex-theme',value),theme);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  return page;
}
const prompt=page=>page.getByRole('dialog',{name:/updat|version/i});
// Capture settled pixels, not the entrance animation or the page's own reveal.
const shot=async(page,name)=>{await page.waitForTimeout(1600);await page.screenshot({path:`${shots}/${name}.png`});};
try{
  server=await createServer({configLoader:'runner',plugins:[browserTestNoWatch],optimizeDeps:{entries:browserTestEntries},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}});
  await server.listen();
  browser=await launchBrowser();

  // Nothing to install, or no connection: no interruption.
  for(const check of ['none','offline']){
    const page=await open({check});
    await expect.poll(()=>page.evaluate(()=>window.__updateCalls.filter(c=>c==='plugin:updater|check').length)).toBeGreaterThan(0);
    await page.waitForTimeout(200);
    assert.equal(await prompt(page).count(),0,`${check}: prompt must stay hidden`);
    assert.deepEqual(page.errors,[]);
    await page.close();
  }

  // The full path: offer, download with progress, hide, return when ready, restart.
  const page=await open({check:'available'});
  await expect(prompt(page)).toContainText('Ten Tenths Telemetry 0.1.4');
  await shot(page,`available-dark`);
  await page.getByRole('button',{name:'Update now'}).click();
  await expect(prompt(page)).toContainText('320 MB of 800 MB');
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','40');
  await shot(page,`downloading-dark`);
  await page.getByRole('button',{name:'Hide'}).click();
  await expect(prompt(page)).toHaveCount(0);
  await page.evaluate(()=>window.__finishDownload());
  await expect(prompt(page)).toContainText('Restart to finish installing');
  await shot(page,`ready-dark`);
  await page.getByRole('button',{name:'Restart now'}).click();
  await expect.poll(()=>page.evaluate(()=>window.__updateCalls.includes('plugin:process|restart'))).toBe(true);
  assert(await page.evaluate(()=>window.__updateCalls.indexOf('plugin:updater|install')<window.__updateCalls.indexOf('plugin:process|restart')));
  await page.close();

  // Later dismisses without downloading.
  const declined=await open({check:'available'});
  await declined.getByRole('button',{name:'Later'}).click();
  await expect(prompt(declined)).toHaveCount(0);
  assert.equal(await declined.evaluate(()=>window.__updateCalls.includes('plugin:updater|download')),false);
  await declined.close();

  // A failed download explains itself and can be retried.
  const failed=await open({check:'available',failDownload:true});
  await failed.getByRole('button',{name:'Update now'}).click();
  await expect(prompt(failed)).toContainText('connection lost');
  await shot(failed,`failed-dark`);
  await failed.getByRole('button',{name:'Try again'}).click();
  await expect(prompt(failed)).toContainText('320 MB of 800 MB');
  await failed.close();

  // Stays on screen and usable at the minimum window size, in both themes.
  for(const theme of ['dark','light']){
    const small=await open({check:'available'},{width:600,height:500},theme);
    await expect(prompt(small)).toBeVisible();
    assert.equal(await small.evaluate(()=>document.documentElement.dataset.theme),theme);
    const box=await prompt(small).boundingBox();
    assert(box.x>=0&&box.y>=0&&box.x+box.width<=600&&box.y+box.height<=500,'Prompt must fit the minimum window');
    await shot(small,`available-${theme}-600x500`);
    if(theme==='light'){
      const large=await open({check:'available'},{width:1280,height:800},'light');
      await large.getByRole('button',{name:'Update now'}).click();
      await expect(prompt(large)).toContainText('320 MB');
      await shot(large,`downloading-light`);
      await large.close();
    }
    await small.close();
  }
  console.log('Update prompt verification passed');
}finally{
  await browser?.close();
  await server?.close();
}
