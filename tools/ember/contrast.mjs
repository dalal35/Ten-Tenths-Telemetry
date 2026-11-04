// WCAG 2 relative luminance and contrast. Inputs must be opaque sRGB colors.
export function rgb(color){
 const c=color.trim().toLowerCase();
 const hex=c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
 if(hex){const h=hex[1].length===3?[...hex[1]].map(v=>v+v).join(''):hex[1];return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16));}
 const m=c.match(/^rgb\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*\)$/);
 if(m)return m.slice(1).map(Number);
 throw new Error(`Expected opaque sRGB hex or rgb(): ${color}`);
}
export function luminance(color){return rgb(color).map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);}
export function contrast(foreground,background){const a=luminance(foreground),b=luminance(background);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);}
