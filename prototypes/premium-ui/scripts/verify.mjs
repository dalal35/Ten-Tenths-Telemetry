import {build,preview} from 'vite';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

// Run from the repository root. Only this isolated prototype is exercised.
const output=resolve('docs/ui-exploration/screenshots');
mkdirSync(output,{recursive:true});
const configFile=resolve('prototypes/premium-ui/vite.config.ts');
await build({configFile});
// Test the shipped bundle, without a dev client or HMR WebSocket.
const server=await preview({configFile,preview:{host:'127.0.0.1',port:0,strictPort:false}});
const results=[];
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 for(const direction of ['race','lab','cockpit']){
  const page=await browser.newPage({viewport:{width:1440,height:920}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(`${server.resolvedUrls.local[0]}?direction=${direction}`,{waitUntil:'networkidle'});
  await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('.chart')).toHaveCount(3);
  await expect(page.locator('.chart-speed .axis-text').first()).toHaveText('220');
  await expect(page.locator('.chart-speed .axis-text').nth(2)).toHaveText('60');
  await expect(page.locator('.track-visual')).toBeVisible();
  const initial=await page.locator('.chart-speed .trace-primary').getAttribute('d');
  await page.getByRole('button',{name:'Select lap 4',exact:true}).click();
  await expect(page.getByRole('button',{name:'Select lap 4',exact:true})).toHaveAttribute('aria-pressed','true');
  assert.notEqual(await page.locator('.chart-speed .trace-primary').getAttribute('d'),initial,'Lap changes plotted data');
  await page.getByRole('button',{name:'Use lap 4 as reference',exact:true}).click();
  await expect(page.locator('.finding b')).toHaveText('This lap is the reference.');
  await expect(page.locator('.chart-delta .chart-title>span')).toContainText('+0.000');
  await page.getByRole('button',{name:'Use lap 6 as reference',exact:true}).click();
  const marker=page.getByRole('button',{name:'Focus Turn 3',exact:true});
  await marker.focus();await page.keyboard.press('Enter');
  await expect(marker).toHaveAttribute('aria-pressed','true');
  const slider=page.getByRole('slider',{name:'Lap position',exact:true});
  await expect(slider).toHaveAttribute('min','420');
  await expect(slider).toHaveAttribute('max','510');
  await slider.focus();await page.keyboard.press('End');
  await expect(slider).toHaveValue('510');
  await expect(page.locator('.chart-speed .cursor-dot')).toHaveCount(1);
  await page.screenshot({path:resolve(output,`${direction}-focused.png`),animations:'disabled'});
  await page.getByRole('button',{name:/Turn 3 focused/}).click();
  await expect(slider).toHaveAttribute('max','1000');
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog',{name:'Find a workspace'})).toBeVisible();
  await page.getByRole('textbox',{name:'Search workspaces'}).fill('nonexistent');
  await expect(page.locator('.no-results')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button',{name:'Video',exact:true}).click();
  await expect(page.locator('.workspace-preview h2')).toHaveText('Video');
  await page.getByRole('button',{name:'Telemetry',exact:true}).click();
  await expect(page.getByRole('button',{name:'Select lap 4',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Select lap 3',exact:true}).click();
  await slider.fill('460');
  for(const [label,width,height] of [['desktop',1440,920],['medium',1024,768],['compact',600,500]]){
   await page.setViewportSize({width,height});
   await page.emulateMedia({reducedMotion:label==='compact'?'reduce':'no-preference'});
   await page.evaluate(()=>document.fonts.ready);
   await page.waitForTimeout(350);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${direction}/${label}: no page horizontal overflow`);
   if(direction==='race'&&label==='compact'){
    await page.getByRole('combobox',{name:'Selected lap',exact:true}).selectOption('5');
    await expect(page.locator('.lap-pair')).toContainText('Lap 05');
    await page.getByRole('combobox',{name:'Selected lap',exact:true}).selectOption('3');
    await expect(page.locator('.stats strong>[aria-hidden="true"]').first()).toHaveText('1:16.538');
   }
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.screenshot({path:resolve(output,`${direction}-${label}.png`),animations:'disabled'});
   const layout=await page.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},documentHeight:document.documentElement.scrollHeight}));
   results.push({direction,size:label,...layout,checks:'lap/reference, same-lap zero, corner keyboard focus, scoped slider, command empty/Escape, navigation preservation, no horizontal overflow'});
  }
  assert.deepEqual(errors,[],`${direction}: browser errors`);
  await page.close();
 }
 writeFileSync(resolve('docs/ui-exploration/validation.json'),JSON.stringify({scope:'Synthetic isolated prototypes, Chromium; no native IPC/media/inference',results},null,2)+'\n');
 console.log(`PASS: 3 directions × 3 window sizes; linked selection/cursor, keyboard, reduced motion, command and navigation checks. ${results.length+3} screenshots.`);
}finally{await browser?.close();await server.close();}
