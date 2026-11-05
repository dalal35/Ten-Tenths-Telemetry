export type GlassCapability='static'|'diffused'|'refracted';

/** Parsing url() is insufficient in WebKit/Firefox. Keep their CSS fallback;
 * a small explicit Chromium allowlist avoids claiming unsupported refraction. */
export function glassCapability({userAgent,blur,svgFilter,cores}:{userAgent:string;blur:boolean;svgFilter:boolean;cores:number|undefined}):GlassCapability {
  if(!blur||(cores!==undefined&&cores>0&&cores<=4))return 'static';
  return /(?:Chrome|Chromium|Edg)\//.test(userAgent)&&svgFilter?'refracted':'diffused';
}
