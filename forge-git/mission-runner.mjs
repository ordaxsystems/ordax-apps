import { createHash } from 'node:crypto';
import { branchName } from './core.mjs';
import { MISSION_REPO, simplePrompt, continuePrompt, parseStep, loadMission, saveMission, archiveMission } from './mission.mjs';

export function createMissionRunner({directory, github, remoteFile, chat, notify, accessAllowed}) {
  let state = loadMission(directory);
  let executing = false;
  let chatReady = false;
  const snapshot = () => state && ({
    repo:state.repo, objective:state.objective, status:state.status, phase:state.phase,
    index:state.completed.length, total:null, completed:state.completed, branch:state.branch,
    prUrl:state.prUrl, lastError:state.lastError, pauseRequested:Boolean(state.pauseRequested),
    updatedAt:state.updatedAt
  });
  function store(message) {
    saveMission(directory,state);
    notify({message,mission:snapshot()});
  }
  function block(error) {
    state.status='blocked';
    state.lastError=String(error?.message || error).slice(0,320);
    store('Missão interrompida: '+state.lastError);
  }
  function branchRef(ref) {
    return '/repos/'+MISSION_REPO+'/git/ref/heads/'+ref.split('/').map(encodeURIComponent).join('/');
  }
  function contents(file) {
    return '/repos/'+MISSION_REPO+'/contents/'+file.split('/').map(encodeURIComponent).join('/');
  }
  async function requireAccess() {
    if(!accessAllowed())throw Error('Conecte o GitHub como ordaxos-admin.');
    const repo=await github('/repos/'+MISSION_REPO);
    if (repo?.permissions?.push !== true || repo.archived || repo.disabled)
      throw Error('Acesso GitHub ao repositório de testes indisponível.');
    return repo;
  }
  function matches(a,b) {
    const sha = str => createHash('sha256').update(str,'utf8').digest('hex');
    return sha(a)===sha(b);
  }
  function finishCommit(sha) {
    const pending=state.pending;
    if (!pending) throw Error('Checkpoint pendente não encontrado.');
    state.completed.push({path:pending.path,summary:pending.summary,commit:sha||null});
    state.pending=null;
    state.phase='request_ready';
    store('Commit confirmado: '+state.completed.length+' arquivos produzidos.');
  }
  async function reconcileCommit() {
    const pending=state.pending;
    if(!pending) throw Error('Commit incerto sem checkpoint.');
    const remote=await remoteFile(MISSION_REPO,pending.path,state.branch);
    if(remote.exists && matches(remote.content,pending.content))finishCommit(null);
    else throw Error('Resultado de commit desconhecido. Verifique a branch antes de prosseguir.');
  }
  async function reconcilePr() {
    const prs=await github('/repos/'+MISSION_REPO+'/pulls?state=all&head='+
      encodeURIComponent('ordaxos-admin:'+state.branch)+'&per_page=30');
    const matches=Array.isArray(prs)?prs.filter(p=>p.head?.ref===state.branch && p.base?.ref===state.base):[];
    if(matches.length!==1)throw Error('Resultado de PR desconhecido. Confira no GitHub.');
    state.prUrl=matches[0].html_url;state.phase='done';state.status='completed';
    store('Missão concluída: '+state.prUrl);
  }
  async function execute() {
    if(executing || !chatReady || !state || state.status!=='running' || !accessAllowed())return;
    executing=true;
    try {
      await requireAccess();
      while(state.status==='running') {
        if(state.pauseRequested) {
          state.pauseRequested=false;state.status='paused';
          store('Pausada após a operação confirmada.');break;
        }
        if(state.phase==='branch_ready') {
          const remote=await github(branchRef(state.branch),{allow404:true});
          if(remote && remote.object?.sha!==state.baseSha)
            throw Error('A branch já existe com alterações não reconhecidas.');
          if(!remote)await github('/repos/'+MISSION_REPO+'/git/refs',{
            method:'POST',body:{ref:'refs/heads/'+state.branch,sha:state.baseSha}
          });
          state.phase='request_ready';
          store('Branch isolada criada; missão enviada ao GPT Web.');
        } else if(state.phase==='request_ready') {
          if(state.completed.length>=30)throw Error('Limite de segurança de 30 arquivos alcançado. Revise o resultado.');
          state.phase='gpt_inflight';
          store('GPT trabalhando: '+(state.completed.length+1)+'ª entrega…');
          const response=await chat.sendPrompt({
            prompt:state.completed.length===0?simplePrompt(state.objective):continuePrompt(),
            chatUrl:state.chatUrl,newSession:!state.chatUrl,requiresMcp:false
          });
          const step=parseStep(response.text);
          state.chatUrl=response.chatUrl || state.chatUrl;
          if(step.done) {
            if(state.completed.length===0)throw Error('O GPT encerrou sem modificar arquivos.');
            state.phase='pr_ready';
            store('GPT declarou a missão concluída; criando PR.');
          } else {
            state.pending={path:step.path,content:step.content,summary:step.summary,originalSha:null};
            state.phase='commit_ready';
            store('GPT entregou '+step.path+'; publicando na branch de teste.');
          }
        } else if(state.phase==='commit_ready') {
          await requireAccess();
          const p=state.pending;
          if(!p)throw Error('Proposta de arquivo ausente.');
          const previous=await remoteFile(MISSION_REPO,p.path,state.branch);
          if(matches(previous.content,p.content))throw Error('O GPT repetiu o arquivo sem modificações.');
          p.originalSha=previous.sha;
          state.phase='commit_inflight';
          store('Gravando '+p.path+' no GitHub…');
          const result=await github(contents(p.path),{
            method:'PUT',body:{
              message:'feat(forge-git): '+p.summary.slice(0,70),
              content:Buffer.from(p.content,'utf8').toString('base64'),
              ...(p.originalSha?{sha:p.originalSha}:{}),
              branch:state.branch
            }
          });
          const confirmed=await remoteFile(MISSION_REPO,p.path,state.branch);
          if(!confirmed.exists || !matches(confirmed.content,p.content))
            throw Error('A gravação não pôde ser confirmada no GitHub.');
          finishCommit(result?.commit?.sha);
        } else if(state.phase==='commit_inflight') {
          await reconcileCommit();
        } else if(state.phase==='pr_ready') {
          await requireAccess();
          state.phase='pr_inflight';
          store('Abrindo Pull Request em rascunho…');
          const pr=await github('/repos/'+MISSION_REPO+'/pulls',{
            method:'POST',body:{
              title:'Forge Git: '+state.objective.slice(0,90),
              head:state.branch,base:state.base,draft:true,
              body:'Missão original do usuário:\n\n'+state.objective+
                '\n\nArquivos publicados:\n'+state.completed.map(x=>'- '+x.path).join('\n')+
                '\n\nSem merge automático.'
            }
          });
          state.prUrl=pr.html_url;
          state.status='completed';state.phase='done';
          store('Missão concluída: '+state.prUrl);
        } else if(state.phase==='pr_inflight') {
          await reconcilePr();
        } else {
          throw Error('Execução anterior ficou incerta ('+state.phase+'). Não repetirei uma resposta do GPT.');
        }
      }
    } catch(error) {block(error);}
    finally {executing=false;}
  }
  const schedule=()=>{if(state?.status==='running')void execute();};
  return {
    snapshot,
    isActive:()=>Boolean(executing || state?.status==='running'),
    setChatReady(value) {chatReady=Boolean(value);if(chatReady)schedule();},
    async start({repo,objective}) {
      if(executing || ['running','paused'].includes(state?.status))throw Error('Já existe uma missão ativa.');
      if(repo!==MISSION_REPO)throw Error('Execução autônoma autorizada somente no repositório TESTES-FORGE-GIT.');
      simplePrompt(objective);
      const info=await requireAccess();
      const base=info.default_branch;
      const ref=await github(branchRef(base));
      if(!ref?.object?.sha)throw Error('Branch principal não verificável.');
      if(state)archiveMission(directory);
      state={
        version:2,repo:MISSION_REPO,objective:String(objective).trim(),
        status:'running',phase:'branch_ready',branch:branchName(),
        base,baseSha:ref.object.sha,chatUrl:null,prUrl:null,
        completed:[],pending:null,pauseRequested:false,lastError:null
      };
      store('Missão recebida; o GPT decidirá as alterações.');
      schedule();
      return snapshot();
    },
    pause() {
      if(!state||state.status!=='running')throw Error('Nenhuma missão executando.');
      state.pauseRequested=true;store('Pausa solicitada.');
      if(!executing) {state.status='paused';state.pauseRequested=false;store('Missão pausada.');}
      return snapshot();
    },
    resume() {
      if(!state||state.status!=='paused')throw Error('Nenhuma missão pausada.');
      state.status='running';state.pauseRequested=false;
      store('Retomando do último checkpoint.');schedule();return snapshot();
    },
    autoResume:schedule,
    recoverState() {
      if(!state)return null;
      if(state.status==='running' && state.phase==='gpt_inflight')
        block(Error('Uma resposta do GPT estava em voo antes da reinicialização. Revise a conversa antes de reenviar.'));
      return snapshot();
    }
  };
}
