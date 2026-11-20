import {ORCHESTRATOR_TOOLS} from './forge-contract.mjs';

// Renderer is a view and a narrow human-operated data editor, not an execution
// authority. Forge MCP remains the sole caller of model, task effect and
// terminal operations. These mutations only persist user-edited records.
export const PASSIVE_UI_STORAGE_OPERATIONS=Object.freeze([
  'project_create','project_quick_create','project_rename',
  'project_repository_set','orchestrator_create','orchestrator_pause',
  'work_create','work_batch_create','work_draft_set','work_dependency_set'
]);
const STORAGE=new Set(PASSIVE_UI_STORAGE_OPERATIONS);
const TOOL_BY_OPERATION=new Map(ORCHESTRATOR_TOOLS.map(tool=>[tool.operation,tool]));
const TOOL_BY_NAME=new Map(ORCHESTRATOR_TOOLS.map(tool=>[tool.name,tool]));

export function assertPassiveUiOperation(operation) {
  const tool=TOOL_BY_OPERATION.get(operation);
  if(!tool)throw Error('forge_passive_ui_operation_unknown');
  if(tool.readOnly||STORAGE.has(operation))return;
  throw Error('forge_passive_app_mcp_only');
}

export function assertPassiveUiMcpMessage(message) {
  // The renderer's protocol-conformance bridge may inspect MCP only. A
  // tools/call envelope must not bypass the native UI dispatch boundary.
  if(message?.method!=='tools/call')return;
  const tool=TOOL_BY_NAME.get(message?.params?.name);
  if(tool&&!tool.readOnly)throw Error('forge_passive_app_mcp_only');
}
