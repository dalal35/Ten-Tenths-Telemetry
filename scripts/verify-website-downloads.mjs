import {expect} from '@playwright/test';

// Exercise the production module and DOM, including its animation imports.
export async function verifyDownloads({browser,url}) {
  for (const [platform,userAgent] of [['Win32','Windows NT'],['MacIntel','Macintosh'],['MacIntel','iPad'],['Linux','Linux'],['iPhone','iPhone'],['','']]) {
    const context=await browser.newContext({userAgent});
    await context.addInitScript(({platform,userAgent})=>{
      Object.defineProperty(navigator,'platform',{value:platform});
      Object.defineProperty(navigator,'maxTouchPoints',{value:userAgent==='iPad'?5:0});
    },{platform,userAgent});
    const page=await context.newPage();
    try {
      for(const outcome of ['online','offline','http-error','no-mac-asset']) {
        await page.route('https://api.github.com/**',route=>outcome==='offline'?route.abort():route.fulfill({
          status:outcome==='http-error'?503:200,contentType:'application/json',body:JSON.stringify({tag_name:'v9.0.0',assets:outcome==='no-mac-asset'?[]:[{name:'app_aarch64.dmg',browser_download_url:'https://example.com/latest.dmg'}]})
        }));
        await page.goto(url,{waitUntil:'networkidle'});
        for(const selector of ['#hero-download','.header-download']) {
          await expect(page.locator(selector)).toHaveAttribute('href','#download');
          await expect(page.locator(selector)).toContainText('Download');
        }
        await expect(page.locator('#mac-download')).toHaveAttribute('href',outcome==='online'?'https://example.com/latest.dmg':'https://github.com/dalal35/Ten-Tenths-Telemetry/releases/download/v0.1.3/Ten-Tenths-Telemetry_0.1.3_aarch64.dmg');
        await expect(page.locator('#hero-version')).toHaveText(outcome==='online'?'v9.0.0 available':'v0.1.3 available');
        await expect(page.locator('#mac-version')).toHaveText(outcome==='online'?'Version 9.0.0 · DMG installer':'Version 0.1.3 · DMG installer');
        await expect(page.locator('#windows-download')).toHaveAttribute('href','https://github.com/dalal35/Ten-Tenths-Telemetry/releases/download/v0.1.3-windows-beta.1/Ten-Tenths-Telemetry_0.1.3_x64-setup.exe');
        await page.unroute('https://api.github.com/**');
      }
    } finally {await context.close();}
  }
  console.log('Download navigation and release/fallback installers passed on six platform identities, online and with failed or incomplete release lookup.');
}
