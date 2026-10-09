export const previewPresets = Object.freeze({ fit: null, desktop: Object.freeze({width:1280,height:800}), tablet: Object.freeze({width:768,height:1024}), mobile: Object.freeze({width:390,height:844}) });
export function previewDisplay(preset, rotated, area) {
  if (!Object.hasOwn(previewPresets,preset) || typeof rotated !== 'boolean') throw new Error('Dispositivo de preview inválido.');
  const selected = previewPresets[preset];
  if (!selected) return { bounds:area, width:area.width, height:area.height, scale:1, emulation:null };
  const width = rotated ? selected.height : selected.width, height = rotated ? selected.width : selected.height;
  const scale = Math.min(1,area.width/width,area.height/height);
  const bounds = { x:area.x+Math.floor((area.width-width*scale)/2), y:area.y+Math.floor((area.height-height*scale)/2), width:Math.max(1,Math.floor(width*scale)), height:Math.max(1,Math.floor(height*scale)) };
  return {bounds,width,height,scale,emulation:{screenPosition:'desktop',viewSize:{width,height},deviceScaleFactor:0,scale}};
}
