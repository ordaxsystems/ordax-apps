// A background window is still the SAME verified Electron application and
// embedded GPT worker, not a separate service, executable or provider.
export function backgroundResidencyAllowed({
  optedIn=false,hostMode=false,quitting=false,trayReady=false,
  platform=process.platform,packaged=false
}={}) {
  return optedIn===true&&hostMode!==true&&quitting!==true&&
    trayReady===true&&platform==='win32'&&packaged===true;
}
export function backgroundStartupAllowed({
  optedIn=false,hostMode=false,trayReady=false,
  platform=process.platform,packaged=false,requestedHidden=false
}={}) {
  return requestedHidden===true&&backgroundResidencyAllowed({
    optedIn,hostMode,quitting:false,trayReady,platform,packaged
  });
}
export function backgroundModeRequested(value) {
  if(typeof value!=='boolean')throw Error('background_preference_invalid');
  return value;
}
