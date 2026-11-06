import {glassCapability} from './materialCapabilities';

/** Desktop entry only. No render state, pointer listeners, per-control canvas,
 * resize work, or animation loop: the compositor owns these static filters. */
export function initializeGlassMaterials(){
  const mode=glassCapability({userAgent:navigator.userAgent,cores:navigator.hardwareConcurrency,
    blur:CSS.supports('backdrop-filter','blur(1px)')||CSS.supports('-webkit-backdrop-filter','blur(1px)'),
    svgFilter:CSS.supports('backdrop-filter','url("#ember-glass-refraction")')});
  document.documentElement.dataset.glassQuality=mode==='static'?'static':'full';
  document.documentElement.dataset.glassRefraction=mode==='refracted'?'supported':'fallback';
}

// Two neutral-centered edge ramps form a fixed lens vector field. Only the
// outer 13% bends the backdrop; foreground text/icons are never filtered.
const edgeMap=(axis:'x'|'y')=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="r" x2="${axis==='x'?'100%':'0%'}" y2="${axis==='y'?'100%':'0%'}"><stop stop-color="#000000"/><stop offset=".13" stop-color="${axis==='x'?'#800000':'#008000'}"/><stop offset=".87" stop-color="${axis==='x'?'#800000':'#008000'}"/><stop offset="1" stop-color="${axis==='x'?'#ff0000':'#00ff00'}"/></linearGradient></defs><path fill="url(#r)" d="M0 0h100v100H0z"/></svg>`);

export function GlassDefinitions(){
  return <svg className="glass-filter-definitions" width="0" height="0" aria-hidden="true" focusable="false"><defs>
    <filter id="ember-glass-refraction" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feImage href={edgeMap('x')} preserveAspectRatio="none" result="edge-x"/>
      <feImage href={edgeMap('y')} preserveAspectRatio="none" result="edge-y"/>
      <feBlend in="edge-x" in2="edge-y" mode="screen" result="lens"/>
      <feDisplacementMap in="SourceGraphic" in2="lens" scale="3" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs></svg>;
}
