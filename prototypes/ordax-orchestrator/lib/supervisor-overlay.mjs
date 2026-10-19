import assert from 'node:assert/strict';

function once(source, target, insert, position = 'before') {
  const n = source.split(target).length - 1;
  assert.equal(n, 1, 'Pinned Flow surface drifted: ' + target.slice(0, 70));
  return source.replace(target, position === 'replace' ? insert : position === 'after' ? target + insert : insert + target);
}

const imports = [
  "import { SupervisorCoordinator } from '../supervisor/coordinator.mjs';",
  "import { createGroqSupervisorPlanner } from '../supervisor/groq-planner.mjs';",
  ''
].join('\n');

const supervisorBackend = [
  '',
  '// LAB ONLY. No automatic model or chat execution while disabled.',
  'let labSupervisor = null;',
  'function requireLabSupervisor() {',
  "  if (process.env.ORDAX_LAB_SUPERVISOR_ENABLE !== '1') throw new Error('supervisor_disabled');",
  "  if (!process.env.GROQ_API_KEY) throw new Error('supervisor_api_key_missing');",
  '  if (!labSupervisor) {',
  '    labSupervisor = new SupervisorCoordinator({',
  '      store, enabled:true, environment:"internal", actorId:"lab-owner",',
  '      planner:createGroqSupervisorPlanner({ apiKey:process.env.GROQ_API_KEY }),',
  '      authorizeTask:({ actorId,tenantId,environment,taskId }) =>',
  '        actorId === "lab-owner" && tenantId == null && environment === "internal" &&',
  '        Boolean(store.getTaskExecutionSnapshot(taskId)),',
  '      chat:{ send:async ({ taskId,content }) => {',
  '        const reply = await enqueueExecution(() => runTask(taskId,content,{newSession:false}));',
  '        return { confirmed:Boolean(reply?.result?.observedAt), runId:reply?.result?.runId || null };',
  '      } }',
  '    });',
  '  }',
  '  return labSupervisor;',
  '}',
  '',
  "ipcMain.handle('ordax:supervisor:status', () => ({",
  "  enabled:process.env.ORDAX_LAB_SUPERVISOR_ENABLE === '1' && Boolean(process.env.GROQ_API_KEY),",
  "  configured:Boolean(process.env.GROQ_API_KEY),",
  '  environment:"internal", requires_owner_approval:true',
  '}));',
  "ipcMain.handle('ordax:supervisor:plan', (_event,payload) => requireLabSupervisor().plan({",
  '  taskId:payload?.taskId,requestId:payload?.requestId,objective:payload?.objective',
  '}));',
  "ipcMain.handle('ordax:supervisor:approve', async (_event,payload) => {",
  '  const controller = requireLabSupervisor();',
  '  const row = store.db.prepare(',
  "    'SELECT result,status FROM action_ledger WHERE id=? AND task_id=? AND action_type=?'",
  "  ).get(payload?.actionId,payload?.taskId,'supervisor.plan');",
  "  if (row?.status !== 'pending_approval') throw new Error('approval_not_pending');",
  '  const decision = JSON.parse(row.result).decision;',
  "  if (decision?.type !== 'send_message') throw new Error('not_a_message_plan');",
  '  const choice = await dialog.showMessageBox(win,{',
  "    type:'question',buttons:['Aprovar mensagem','Cancelar'],defaultId:1,cancelId:1,",
  "    title:'OrdaX Lab — aprovação humana',",
  "    message:'Autoriza enviar esta mensagem ao ChatGPT?',",
  '    detail:decision.content',
  '  });',
  '  if (choice.response !== 0) return {approved:false};',
  '  return { approved:true, ...(controller.approve({',
  '    taskId:payload?.taskId,actionId:payload?.actionId,',
  '    approvalId:payload?.approvalId,explicitOwnerApproval:true',
  '  })) };',
  '});',
  "ipcMain.handle('ordax:supervisor:dispatch', (_event,payload) =>",
  '  requireLabSupervisor().dispatch({taskId:payload?.taskId,actionId:payload?.actionId}));',
  ''
].join('\n');

const preloadAddition = [
  '  supervisorStatus: () => ipcRenderer.invoke("ordax:supervisor:status"),',
  '  supervisorPlan: payload => ipcRenderer.invoke("ordax:supervisor:plan", payload),',
  '  supervisorApprove: payload => ipcRenderer.invoke("ordax:supervisor:approve", payload),',
  '  supervisorDispatch: payload => ipcRenderer.invoke("ordax:supervisor:dispatch", payload),',
  ''
].join('\n');

const labPanel = [
  '      <details class="context-section" id="labSupervisorPanel">',
  '        <summary class="section-title-row"><span>Supervisor OrdaX Lab</span></summary>',
  '        <p id="labSupervisorState" class="diagnostics-hint">Verificando supervisor...</p>',
  '        <label for="labSupervisorObjective">Objetivo do próximo passo</label>',
  '        <textarea id="labSupervisorObjective" rows="3" maxlength="4000" style="width:100%" placeholder="Descreva uma tarefa objetiva para os agentes"></textarea>',
  '        <div class="memory-editor-actions">',
  '          <button type="button" class="mini-secondary" id="labSupervisorPlan">Planejar um passo</button>',
  '          <button type="button" class="mini-secondary" id="labSupervisorApprove" hidden>Aprovar</button>',
  '          <button type="button" class="mini-primary" id="labSupervisorSend" hidden>Enviar passo aprovado</button>',
  '        </div>',
  '        <pre id="labSupervisorProposal" role="status" aria-live="polite" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>',
  '      </details>',
  ''
].join('\n');

const uiAddition = [
  '',
  '// LAB-ONLY supervisor UX. Browser content never supplies execution authority.',
  'let labProposal = null;',
  'const labPanel = document.getElementById("labSupervisorPanel");',
  'const labState = document.getElementById("labSupervisorState");',
  'const labMessage = document.getElementById("labSupervisorProposal");',
  'const labPlanButton = document.getElementById("labSupervisorPlan");',
  'const labApproveButton = document.getElementById("labSupervisorApprove");',
  'const labSendButton = document.getElementById("labSupervisorSend");',
  'const labStatus = await window.ordax.supervisorStatus().catch(() => ({enabled:false}));',
  'labState.textContent = labStatus.enabled',
  '  ? "Ativo: cada mensagem proposta exige aprovação humana."',
  '  : "Desativado. Requer GROQ_API_KEY e ORDAX_LAB_SUPERVISOR_ENABLE=1 no Lab."; ',
  'labPlanButton.disabled = !labStatus.enabled;',
  'labPlanButton.addEventListener("click", async () => {',
  '  const taskId = currentTaskId;',
  '  const objective = document.getElementById("labSupervisorObjective").value.trim();',
  '  if (!taskId || !objective) {labMessage.textContent="Selecione uma tarefa e informe um objetivo.";return;}',
  '  labPlanButton.disabled = true;',
  '  labApproveButton.hidden = true;',
  '  labSendButton.hidden = true;',
  '  labProposal = null;',
  '  labMessage.textContent = "Consultando supervisor...";',
  '  try {',
  '    const plan = await window.ordax.supervisorPlan({ taskId,requestId:crypto.randomUUID(),objective });',
  '    labProposal = {...plan,taskId};',
  '    const decision = plan.decision;',
  '    labMessage.textContent = decision',
  '      ? [decision.reason,decision.content || "", "Estado: "+plan.status].filter(Boolean).join("\\n\\n")',
  '      : "Plano pendente de reconciliação; não reenviar automaticamente."; ',
  '    labApproveButton.hidden = !(plan.status==="pending_approval" && plan.approvalId);',
  '  } catch (error) {labMessage.textContent = error?.message || "Falha de planejamento";}',
  '  finally {labPlanButton.disabled = !labStatus.enabled;}',
  '});',
  'labApproveButton.addEventListener("click", async () => {',
  '  if (!labProposal || currentTaskId !== labProposal.taskId) {labMessage.textContent="Tarefa mudou; reprograme o passo.";return;}',
  '  labApproveButton.disabled = true;',
  '  try {',
  '    const result=await window.ordax.supervisorApprove({taskId:labProposal.taskId,actionId:labProposal.actionId,approvalId:labProposal.approvalId});',
  '    if(result.approved){labApproveButton.hidden=true;labSendButton.hidden=false;}',
  '  } catch(error){labMessage.textContent = error?.message || "Falha de aprovação";}',
  '  finally{labApproveButton.disabled=false;}',
  '});',
  'labSendButton.addEventListener("click",async()=>{',
  '  if (!labProposal || currentTaskId !== labProposal.taskId) {labMessage.textContent="Tarefa mudou; envio bloqueado.";return;}',
  '  labSendButton.disabled = true;',
  '  labSendButton.hidden = true;',
  '  try {',
  '    const result=await window.ordax.supervisorDispatch({taskId:labProposal.taskId,actionId:labProposal.actionId});',
  '    labMessage.textContent = "Estado do envio: "+result.status+(result.status==="indeterminate" ? " — não reenviar automaticamente.":"");',
  '    if(result.status==="succeeded") {await openTask(labProposal.taskId);await loadTasks();}',
  '  } catch(error){labMessage.textContent = error?.message || "Falha de envio";}',
  '  finally {labProposal=null;labSendButton.disabled=false;}',
  '});',
  ''
].join('\n');

export function applySupervisorOverlay(relative, source) {
  if (!['desktop/main.mjs','desktop/preload.cjs','desktop/ui.html',
    'desktop/ui.js'].includes(relative)) return source;
  let text=Buffer.isBuffer(source)?source.toString('utf8'):String(source);
  if(relative==='desktop/main.mjs'){
    // In the original snapshot, requestSingleInstanceLock is called BEFORE
    // userData is configured. Move the derived userData block ahead of lock;
    // otherwise a staged instance may attach to the already-running Lab.
    const labDataBlock = [
      "const here = path.dirname(fileURLToPath(import.meta.url));",
      "const root = path.resolve(here, '..');",
      "const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || root, 'AppData', 'Local');",
      "const userRoot = path.join(localAppData, 'OrdaX', 'OrchestratorLab');",
      "app.setPath('userData', userRoot);",
      ''
    ].join('\n');
    assert.equal(text.split(labDataBlock).length - 1, 1, 'Pinned Lab userData block drifted');
    text = text.replace(labDataBlock, '');
    text = once(text, "app.setName('OrdaX Orchestrator Lab');",
      "app.setName('OrdaX Orchestrator Lab');\n" + labDataBlock, 'replace');
    text=once(text, "import { app, BrowserWindow, ipcMain, protocol, net } from 'electron';",
      "import { app, BrowserWindow, ipcMain, protocol, net, dialog } from 'electron';", 'replace');
    text=once(text,"import path from 'node:path';", imports, 'after');
    text=once(text,'app.whenReady().then(async () => {',supervisorBackend);
  }
  if(relative==='desktop/preload.cjs'){
    text=once(text,'  workspace: () => ipcRenderer.invoke(\'ordax:workspace:get\'),',
      preloadAddition);
  }
  if(relative==='desktop/ui.html'){
    text=once(text,'    </aside>\n  </main>',labPanel);
  }
  if(relative==='desktop/ui.js'){
    text+=uiAddition;
  }
  return Buffer.from(text);
}
