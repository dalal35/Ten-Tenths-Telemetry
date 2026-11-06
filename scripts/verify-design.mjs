import {createServer} from 'vite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {launchBrowser} from './browser.mjs';
import {installWorkspaceFixture} from '../tests/workspace-transition-fixture.mjs';
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

const output=`test-results/design/${process.env.DESIGN_PHASE??'current'}`;
mkdirSync(output,{recursive:true});
let server,browser;
try{
  server=await createServer({plugins:[{name:'design-audit',config(config){config.server??={};config.server.watch=null;}}],optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime','motion/react']},server:{host:'127.0.0.1',port:0,hmr:false}});
  await server.listen();browser=await launchBrowser();
  const page=await browser.newPage({viewport:{width:1440,height:920}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(installWorkspaceFixture);
  await page.goto(`${server.resolvedUrls.local[0]}tests/advanced.html`);
  await page.locator('.uplot').first().waitFor();
  for(const [view,label] of [['telemetry','Telemetry'],['advanced','Advanced'],['video','Video'],['coach','AI Driving Coach']]){
    await page.getByRole('button',{name:label,exact:true}).click();
    await page.waitForTimeout(500);
    await page.screenshot({path:`${output}/${view}-dark.png`});
  }
  await page.getByRole('button',{name:'Telemetry',exact:true}).click();
  await page.getByRole('button',{name:'Switch to light theme',exact:true}).click();
  await page.waitForTimeout(300);await page.screenshot({path:`${output}/telemetry-light.png`});
  for(const [width,height] of [[1100,760],[600,500]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(300);
    await page.screenshot({path:`${output}/telemetry-${width}.png`});
  }
  await page.setViewportSize({width:1440,height:920});
  await page.waitForTimeout(300);
  const rapid=await page.evaluate(()=>{
    const before=window.auditTransitions.length,tabs=[...document.querySelectorAll('.workspace-switch button')];
    for(let i=0;i<32;i++)tabs[i%4].click();
    return {captures:window.auditTransitions.length-before,selected:document.querySelector('.workspace-switch button[aria-pressed=true]')?.textContent};
  });
  assert(rapid.captures<=1,`A rapid navigation burst must not recapture the screen ${rapid.captures} times`);
  assert.equal(rapid.selected,'AI Driving Coach','Latest burst navigation commits synchronously');
  await page.getByRole('button',{name:'Telemetry',exact:true}).click();
  await page.waitForTimeout(300);
  const organize=page.getByRole('button',{name:'Sort & group sessions',exact:true});
  await organize.click();
  await expect(page.getByRole('dialog',{name:'Organize sessions'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(organize).toBeFocused();
  const exiting=page.locator('.explorer-popover[inert]');
  if(await exiting.count())assert.equal(await exiting.getAttribute('aria-hidden'),'true','Exiting menus release accessible input immediately');
  await organize.click();await expect(page.getByRole('dialog',{name:'Organize sessions'})).toBeVisible();
  await page.keyboard.press('Escape');
  await page.emulateMedia({reducedMotion:'reduce'});
  await organize.click();await page.keyboard.press('Escape');
  await expect(page.locator('.explorer-popover')).toHaveCount(0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('button',{name:'Video',exact:true}).click();await page.waitForTimeout(350);
  await page.locator('.chart-toolbar').scrollIntoViewIfNeeded();
  await page.getByRole('button',{name:'Time',exact:true}).click();await page.waitForTimeout(350);
  const highlight=await page.locator('.axis-switch button.active').evaluate(button=>{
    const outer=button.getBoundingClientRect(),inner=button.querySelector('.control-selection').getBoundingClientRect();
    const style=getComputedStyle(button),left=parseFloat(style.borderLeftWidth),right=parseFloat(style.borderRightWidth),top=parseFloat(style.borderTopWidth),bottom=parseFloat(style.borderBottomWidth);
    return {dx:Math.abs(inner.x-outer.x-left),dy:Math.abs(inner.y-outer.y-top),dw:Math.abs(inner.width-outer.width+left+right),dh:Math.abs(inner.height-outer.height+top+bottom)};
  });
  await page.screenshot({path:`${output}/scrolled-axis.png`});
  console.log('Scrolled axis selection:',highlight);
  assert(Object.values(highlight).every(delta=>delta<1),`Shared axis selection stays inside its button after workspace scrolling: ${JSON.stringify(highlight)}`);
  const stress=await browser.newPage({viewport:{width:1440,height:920}});
  stress.on('pageerror',error=>errors.push(error.message));
  await stress.addInitScript(installWorkspaceFixture,{seriesSamples:100001});
  await stress.goto(`${server.resolvedUrls.local[0]}tests/advanced.html`);await stress.locator('.uplot').first().waitFor();
  await stress.evaluate(()=>window.designOriginalPlot=document.querySelector('.uplot'));
  await stress.evaluate(async()=>{const tabs=[...document.querySelectorAll('.workspace-switch button')];for(let i=0;i<24;i++){tabs[i%4].click();await new Promise(resolve=>setTimeout(resolve,35));}});
  await expect(stress.locator('.workspace-switch button[aria-pressed=true]')).toHaveText('AI Driving Coach');
  await stress.getByRole('button',{name:'Telemetry',exact:true}).click();await stress.waitForTimeout(300);
  await stress.setViewportSize({width:600,height:500});await stress.waitForTimeout(300);
  assert(await stress.evaluate(()=>window.designOriginalPlot===document.querySelector('.uplot')),'Large-series navigation and resize retain the existing plot');
  assert(await stress.locator('.workspace-viewport').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Large recordings remain bounded after resizing');
  await stress.screenshot({path:`${output}/large-recording-600.png`});await stress.close();
  writeFileSync(`${output}/report.json`,JSON.stringify({environment:'Production React app; controlled synthetic IPC and media fixture, not native playback',rapid,highlight,stress:{samplesPerSeries:100001,comparedSeries:4,totalSamples:400004,rapidRequests:24,retainedPlot:true},errors},null,2));
  if(errors.length)throw Error(errors.join('\n'));
  console.log(`PASS: four workspace screenshots, light theme, two window sizes: ${output}`);
}finally{await browser?.close();await server?.close();}
