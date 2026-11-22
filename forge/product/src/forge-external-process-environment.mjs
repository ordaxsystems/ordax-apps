// One bounded environment policy for Forge-owned external processes.
// Never inherit OAuth, MCP bridge, Electron, Git override or test credentials.
const KEYS=Object.freeze(['PATH','Path','PATHEXT','SystemRoot','SYSTEMROOT','WINDIR',
  'COMSPEC','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH',
  'APPDATA','LOCALAPPDATA','PROGRAMFILES','PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS','LANG','HOME']);
export function forgeExternalProcessEnvironment(source=process.env){
  return Object.fromEntries(KEYS.filter(key=>typeof source[key]==='string')
    .map(key=>[key,source[key]]));
}
