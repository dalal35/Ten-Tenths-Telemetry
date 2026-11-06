import {describe,expect,it} from 'vitest';
import {glassCapability} from './materialCapabilities';

const capable={userAgent:'Mozilla/5.0 AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',blur:true,svgFilter:true,cores:8};
describe('desktop glass capability policy',()=>{
  it('allows bounded SVG refraction on capable Chromium',()=>expect(glassCapability(capable)).toBe('refracted'));
  it('uses diffused glass on WebKit even when it parses SVG filter syntax',()=>expect(glassCapability({...capable,userAgent:'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'})).toBe('diffused'));
  it('uses diffused glass on Firefox and on Chromium without SVG filtering',()=>{
    expect(glassCapability({...capable,userAgent:'Mozilla/5.0 Gecko/20100101 Firefox/132.0'})).toBe('diffused');
    expect(glassCapability({...capable,svgFilter:false})).toBe('diffused');
  });
  it('uses static materials when blur is unavailable or the device has four or fewer logical cores',()=>{
    expect(glassCapability({...capable,blur:false})).toBe('static');
    expect(glassCapability({...capable,cores:4})).toBe('static');
    expect(glassCapability({...capable,cores:2})).toBe('static');
  });
  it('uses diffused glass for an unidentified browser engine',()=>expect(glassCapability({...capable,userAgent:'',cores:undefined})).toBe('diffused'));
});
