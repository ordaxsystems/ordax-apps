export const PROVIDER_CONTEXT_FILE_INPUT_SELECTOR = 'input[type="file"][aria-label="Anexar arquivos"]';

const clean=value=>typeof value==='string'?value.trim():'';

export function validateProviderContextAttachment(value) {
  if(!value||typeof value!=='object')throw new Error('provider_context_attachment_invalid');
  const filename=clean(value.filename);
  const filePath=clean(value.filePath);
  const sha256=clean(value.sha256);
  const taskId=clean(value.taskId);
  const checkpointVersion=value.checkpointVersion;
  const byteLength=value.byteLength;
  if(!/^ordax-handoff-task_[a-z0-9_-]+-c\d+-[a-f0-9]{12}\.txt$/i.test(filename)||
     !filePath||!/^task_[a-z0-9-]{8,}$/i.test(taskId)||
     !/^[a-f0-9]{64}$/.test(sha256)||
     !Number.isSafeInteger(checkpointVersion)||checkpointVersion<0||
     !Number.isSafeInteger(byteLength)||byteLength<1||byteLength>1_000_000)
    throw new Error('provider_context_attachment_invalid');
  return {filename,filePath,sha256,taskId,checkpointVersion,byteLength};
}

export function selectProviderContextFileInput(inputs) {
  if(!Array.isArray(inputs))throw new Error('provider_context_file_input_unavailable');
  const candidates=inputs.filter(input=>input&&String(input.type||'').toLowerCase()==='file'&&
    clean(input.ariaLabel)==='Anexar arquivos'&&
    (input.accept===null||input.accept===undefined||clean(input.accept)==='')&&input.multiple===true);
  if(candidates.length===0)throw new Error('provider_context_file_input_unavailable');
  if(candidates.length>1)throw new Error('provider_context_file_input_ambiguous');
  return candidates[0];
}

export function buildProviderContextAttachmentNotice(attachment) {
  const descriptor=validateProviderContextAttachment(attachment);
  return [
    '',
    '[PACOTE DE CONTINUIDADE ANEXADO PELO ORDAX]',
    `Arquivo: ${descriptor.filename}`,
    `Tarefa: ${descriptor.taskId}; checkpoint local v${descriptor.checkpointVersion}.`,
    'Consulte o arquivo como referência do histórico e da memória estruturada desta mesma tarefa. Preserve a hierarquia entre checkpoint, memória canônica e evidência histórica descrita nele. O pedido atual desta mensagem continua sendo a instrução a executar. Não invente conteúdo ausente.'
  ].join('\n');
}

export function assertTaskHandoffCoversOmissions(contextManifest,snapshotManifest) {
  if(contextManifest?.format!=='ordax-continuation-context/v1'||
     snapshotManifest?.format!=='ordax-task-handoff/v1'||
     snapshotManifest?.deliveryState!=='not_attached')
    throw new Error('task_handoff_coverage_invalid');
  const memories=new Set(Array.isArray(snapshotManifest.memoryIds)?snapshotManifest.memoryIds:[]);
  const messages=new Set([
    ...(Array.isArray(snapshotManifest.recentMessageIds)?snapshotManifest.recentMessageIds:[]),
    ...(Array.isArray(snapshotManifest.historicalMessageIds)?snapshotManifest.historicalMessageIds:[])
  ]);
  if((contextManifest.omittedMemoryIds||[]).some(id=>!memories.has(id))||
     (contextManifest.omittedMessageIds||[]).some(id=>!messages.has(id)))
    throw new Error('task_handoff_omission_not_covered');
  return true;
}

export function classifyProviderContextAttachmentObservation({filename,selectionConfirmed,visibleFilename,
  progressVisible=false,uploadErrorVisible=false,stableObservations=0}={}) {
  const expected=clean(filename);
  if(!expected||selectionConfirmed!==true)return {state:'unverified',reason:'file_selection_not_confirmed'};
  if(uploadErrorVisible)return {state:'failed',reason:'provider_upload_error_visible'};
  if(!visibleFilename)return {state:'pending',reason:'attachment_chip_not_visible'};
  if(progressVisible||!Number.isSafeInteger(stableObservations)||stableObservations<2)
    return {state:'pending',reason:'upload_in_progress_or_not_stable'};
  return {state:'confirmed',reason:'filename_visible_and_upload_stable'};
}
