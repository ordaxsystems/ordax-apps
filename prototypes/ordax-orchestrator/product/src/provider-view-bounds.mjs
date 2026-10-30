/** Convert the trusted renderer's CSS slot to a clipped Electron DIP rectangle. */
export function normalizeProviderViewBounds(rect,{contentWidth,contentHeight,zoomFactor=1}={}) {
  const values=[rect?.x,rect?.y,rect?.width,rect?.height,contentWidth,contentHeight,zoomFactor].map(Number);
  if(values.some(value=>!Number.isFinite(value))||contentWidth<=0||contentHeight<=0||zoomFactor<0.5||zoomFactor>3)
    return null;
  const [rawX,rawY,rawWidth,rawHeight]=values;
  if(rawWidth<=0||rawHeight<=0)return null;
  const x=Math.round(rawX*zoomFactor),y=Math.round(rawY*zoomFactor);
  const width=Math.round(rawWidth*zoomFactor),height=Math.round(rawHeight*zoomFactor);
  const left=Math.max(0,x),top=Math.max(0,y);
  const right=Math.min(Math.trunc(contentWidth),x+width);
  const bottom=Math.min(Math.trunc(contentHeight),y+height);
  if(right-left<200||bottom-top<160)return null;
  return {x:left,y:top,width:right-left,height:bottom-top};
}
