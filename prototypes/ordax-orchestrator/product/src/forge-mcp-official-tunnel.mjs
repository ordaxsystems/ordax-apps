import path from 'node:path';

// The official OpenAI tunnel-client is the ONLY supported outbound bridge.
// This adapter never creates a public ingress, an MCP server or another Forge.
// Credentials must come from a trusted, Owner-approved Electron context.
const ID=/^project_[a-zA-Z0-9-]{1,100}$/;
const TUNNEL=/^tunnel__?[a-z0-9]{32}$/;
const BEARER=/^[A-Za-z0-9_-]{43}$/;
const HEADER_REF='Authorization: env:FORGE_TUNNEL_LOCAL_BEARER';
const SAFE_ENV=['PATH','Path','SYSTEMROOT','SystemRoot','TEMP','TMP',
  'USERPROFILE','LOCALAPPDATA','APPDATA','PROGRAMDATA','HOMEDRIVE','HOMEPATH'];

export function validateForgeTunnelTarget({projectId,endpoint,tunnelId}={}){
  if(typeof projectId!=='string'||!ID.test(projectId))
    throw Error('forge_tunnel_project_invalid');
  if(typeof tunnelId!=='string'||!TUNNEL.test(tunnelId))
    throw Error('forge_tunnel_identifier_invalid');
  if(typeof endpoint!=='string')throw Error('forge_tunnel_endpoint_invalid');
  let parsed;
  try{parsed=new URL(endpoint);}catch{throw Error('forge_tunnel_endpoint_invalid');}
  const port=Number(parsed.port);
  if(parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1'||
    parsed.pathname!=='/mcp'||parsed.username||parsed.password||
    parsed.search||parsed.hash||!Number.isInteger(port)||port<1024||port>65535||
    parsed.href!==endpoint)throw Error('forge_tunnel_endpoint_invalid');
  return Object.freeze({projectId,tunnelId,endpoint});
}

export function makeForgeOfficialTunnelLaunch({
  projectId,endpoint,tunnelId,bearerToken,controlPlaneKey,
  executablePath,ownerApproved=false,platform=process.platform,
  inheritedEnv=process.env
}={}){
  const target=validateForgeTunnelTarget({projectId,endpoint,tunnelId});
  if(!ownerApproved)throw Error('forge_tunnel_owner_approval_required');
  if(platform!=='win32')throw Error('forge_tunnel_windows_only');
  if(typeof executablePath!=='string'||!path.win32.isAbsolute(executablePath)||
    path.win32.basename(executablePath).toLowerCase()!=='tunnel-client.exe')
    throw Error('forge_tunnel_official_executable_required');
  if(typeof bearerToken!=='string'||!BEARER.test(bearerToken)||
    typeof controlPlaneKey!=='string'||controlPlaneKey.length<20||
    controlPlaneKey.length>512||/\s|[\x00-\x1f\x7f]/.test(controlPlaneKey))
    throw Error('forge_tunnel_credentials_unavailable');
  // Isolate the child environment: never inherit unrelated MCP channels or
  // another tunnel ID, API credential, proxy override or stale header values.
  const env={};
  for(const name of SAFE_ENV)
    if(typeof inheritedEnv?.[name]==='string')env[name]=inheritedEnv[name];
  env.CONTROL_PLANE_API_KEY=controlPlaneKey;
  env.FORGE_TUNNEL_LOCAL_BEARER='Bearer '+bearerToken;
  // Both runtime calls AND discovery probes need the same scoped bearer.
  // env: is resolved by tunnel-client; the secret never enters argv or YAML.
  const args=[
    'run',
    '--control-plane.tunnel-id='+tunnelId,
    '--mcp.server-url='+endpoint,
    '--mcp.extra-headers='+HEADER_REF,
    '--mcp.discovery-extra-headers='+HEADER_REF,
    '--health.listen-addr=127.0.0.1:0'
  ];
  const publicStatus=Object.freeze({
    projectId:target.projectId,tunnelId:target.tunnelId,
    endpoint:target.endpoint,transport:'openai_secure_mcp_tunnel',
    outgoingOnly:true,credentialsInArguments:false,
    runtimeReady:false,remoteChatGptConnected:false
  });
  return {command:executablePath,args,env,publicStatus,
    spawnOptions:{shell:false,windowsHide:true,stdio:'ignore',detached:false}};
}
