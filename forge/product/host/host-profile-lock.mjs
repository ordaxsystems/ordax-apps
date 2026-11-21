// Compatibility import only: the process ownership policy is canonical in src/
// and is shared by the packaged Electron App and the existing Node Host.
export {acquireHostProfileLock,resolveHostProfileRoot} from '../src/forge-core-profile-lock.mjs';
