// Authenticated GitHub metadata can only enter through an owner-supplied,
// project-scoped authorization port. The App never owns credentials or calls
// the GitHub network directly. This is not a public-API fallback.
import {normalizeGitHubRepositoryUrl} from './remote-repository-context.mjs';

const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,180}$/.test(value);
const branch=value=>typeof value==='string'&&value.length<=140&&
  /^[A-Za-z0-9_.\/-]+$/.test(value)&&!value.includes('..')&&!value.startsWith('/')&&!value.endsWith('/');
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const grant=value=>typeof value==='string'&&/^grant_[A-Za-z0-9_-]{8,160}$/.test(value);
function subject(context,projectId) {
  if(!identifier(projectId)||!identifier(context?.actorId)||
    !identifier(context?.clientId)||!identifier(context?.workspaceSessionId))
    throw Error('orchestrator_repository_identity_invalid');
  return {actorId:context.actorId,clientId:context.clientId,
    workspaceSessionId:context.workspaceSessionId,projectId};
}
function verifyGrant(proof,who,repositoryUrl,now) {
  if(proof?.authorized!==true||proof?.provider!=='github'||
    proof.repositoryUrl!==repositoryUrl||!grant(proof.grantId)||
    !Number.isSafeInteger(proof.expiresAt)||proof.expiresAt<=now||
    Object.entries(who).some(([key,value])=>proof[key]!==value))
    throw Error('orchestrator_repository_grant_unverified');
}
function boundedObservation(snapshot,repositoryUrl,now) {
  if(snapshot?.source!=='github_rest_authenticated'||snapshot.repositoryUrl!==repositoryUrl||
    snapshot.authenticated!==true||!Number.isSafeInteger(snapshot.repositoryId)||
    snapshot.repositoryId<=0||!branch(snapshot.defaultBranch)||!sha(snapshot.headSha)||
    typeof snapshot.observedAt!=='string'||snapshot.observedAt.length>40||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(snapshot.observedAt))
    throw Error('orchestrator_repository_observation_unverified');
  const observed=Date.parse(snapshot.observedAt);
  if(!Number.isFinite(observed)||observed>now+30000||now-observed>300000)
    throw Error('orchestrator_repository_observation_stale');
  return Object.freeze({
    schema:'ordax.orchestrator.repository-observation/1',
    repositoryUrl,repositoryId:snapshot.repositoryId,
    defaultBranch:snapshot.defaultBranch,headSha:snapshot.headSha,
    observedAt:snapshot.observedAt,
    provenance:{source:'github_rest_authenticated',grantRechecked:true,
      headObserved:true,contentsRead:false,prsRead:false,checksRead:false},
    providerMessagesSent:0,filesWritten:0
  });
}
export class ProjectRepository {
  constructor({port=null,clock=Date.now}={}) {
    this.port=port;this.clock=clock;
  }
  available() {
    return typeof this.port?.authorizeRead==='function'&&
      typeof this.port?.readSnapshot==='function';
  }
  async observe(context,{projectId,repositoryUrl},recheckAccess) {
    const who=subject(context,projectId);
    const repository=normalizeGitHubRepositoryUrl(repositoryUrl);
    if(!repository)throw Error('orchestrator_repository_not_configured');
    if(!this.available())throw Error('orchestrator_repository_capability_unavailable');
    const request=Object.freeze({context:Object.freeze(who),repositoryUrl:repository});
    // Grant verification is on BOTH sides of awaited network observation.
    const initial=await this.port.authorizeRead(request);
    verifyGrant(initial,who,repository,this.clock());
    recheckAccess?.();
    const snapshot=await this.port.readSnapshot({...request,grantId:initial.grantId});
    recheckAccess?.();
    const final=await this.port.authorizeRead(request);
    verifyGrant(final,who,repository,this.clock());
    if(final.grantId!==initial.grantId)throw Error('orchestrator_repository_grant_changed');
    recheckAccess?.();
    return boundedObservation(snapshot,repository,this.clock());
  }
}
