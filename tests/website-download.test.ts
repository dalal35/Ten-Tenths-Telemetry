import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../website/index.html',import.meta.url),'utf8');
describe('homepage download markup without JavaScript',()=>{
 it('keeps the hero and header Download links pointed at the download section',()=>{
  expect(html).toMatch(/<a\b[^>]*id="hero-download"[^>]*href="#download"[^>]*>Download/);
  expect(html).toMatch(/<a\b[^>]*class="header-download"[^>]*href="#download"[^>]*>.*Download/);
 });
 it('provides working Mac and Windows beta fallback installers',()=>{
  expect(html).toMatch(/id="mac-download" href="https:\/\/github.com\/dalal35\/Ten-Tenths-Telemetry\/releases\/download\/v0\.1\.3\/Ten-Tenths-Telemetry_0\.1\.3_aarch64\.dmg"/);
  expect(html).toMatch(/id="windows-download" href="https:\/\/github.com\/dalal35\/Ten-Tenths-Telemetry\/releases\/download\/v0\.1\.3-windows-beta\.1\/Ten-Tenths-Telemetry_0\.1\.3_x64-setup\.exe"/);
 });
});
