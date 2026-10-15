const FINAL_STATES = new Set(['passed', 'failed', 'blocked', 'uncertain']);
const OBSERVATION_KINDS = new Set(['semantic-snapshot', 'browser-snapshot', 'target-surface-screenshot']);

function boundedString(value, label, max = 240) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error(`${label} invalid`);
  return value.trim();
}

function semanticIndex(snapshot) {
  if (!snapshot || snapshot.schema !== 'ordax.studio-semantic-ui-snapshot/1' || snapshot.authority !== 'none' || snapshot.execution !== 'read-only' || snapshot.capturedInputValues !== false || !Array.isArray(snapshot.elements)) throw new Error('semantic snapshot is not trustworthy');
  const index = new Map();
  for (const item of snapshot.elements) { if (!item || typeof item.id !== 'string' || index.has(item.id)) throw new Error('semantic snapshot contains invalid or duplicate elements'); index.set(item.id, item); }
  return index;
}

function successCriterion(criterion, evidence) {
  if (!criterion || typeof criterion !== 'object') return { ok: false, reason: 'invalid-success-criterion' };
  if (criterion.kind === 'element-present' || criterion.kind === 'element-visible') {
    const element = evidence.semanticIndex?.get(criterion.element);
    if (!element) return { ok: false, reason: `missing:${criterion.element}` };
    if (criterion.kind === 'element-present' && element.present === true) return { ok: true };
    if (criterion.kind === 'element-visible' && element.present === true && element.visible === true) return { ok: true };
    return { ok: false, reason: `${criterion.kind}:${criterion.element}` };
  }
  if (criterion.kind === 'target-surface-evidence') {
    const screenshot = evidence.targetSurfaceScreenshot;
    if (screenshot?.surface === criterion.surface && screenshot?.verifiedTarget === true && typeof screenshot?.digest === 'string' && screenshot.digest.length >= 32) return { ok: true };
    return { ok: false, reason: `target-surface:${criterion.surface}` };
  }
  return { ok: false, reason: `unsupported:${String(criterion.kind || '')}` };
}

export async function runAgenticObservationScenario(scenario, adapter, defaults = {}) {
  if (!scenario || typeof scenario !== 'object') throw new Error('scenario invalid');
  const scenarioId = boundedString(scenario.id, 'scenario id', 80);
  boundedString(scenario.goal, 'scenario goal', 640);
  if (!adapter || typeof adapter.semanticSnapshot !== 'function' || typeof adapter.readCapability !== 'function') throw new Error('agentic observation adapter invalid');
  const maxSteps = Number.isInteger(defaults.maxSteps) ? defaults.maxSteps : 24;
  if (maxSteps < 1 || maxSteps > 100) throw new Error('maxSteps invalid');
  if (defaults.repeatUncertainEffects !== false || defaults.coordinateFallback !== false) throw new Error('unsafe agentic defaults');
  const evidence = { capabilities: Object.create(null), semanticIndex: null, browserSnapshot: null, targetSurfaceScreenshot: null };
  const receipts = []; let used = 0; const consume = () => { if (++used > maxSteps) throw new Error('agentic step budget exceeded'); };
  try {
    const allowedCapabilities = new Set((scenario.allowedCapabilities || []).map(item => boundedString(item, 'capability', 120)));
    for (const capability of scenario.probeCapabilities || []) {
      consume(); const name = boundedString(capability, 'probe capability', 120);
      if (!allowedCapabilities.has(name)) throw new Error(`probe outside allowlist:${name}`);
      const result = await adapter.readCapability(name);
      if (!result || result.ok !== true) return Object.freeze({ schema: 'ordax.agentic-test-result/1', scenarioId, state: 'blocked', reason: `capability:${name}`, receipts: Object.freeze(receipts), criteria: Object.freeze([]) });
      evidence.capabilities[name] = result.data ?? null; receipts.push(Object.freeze({ kind: 'capability-read', name, ok: true }));
    }
    for (const kind of scenario.evidence || []) {
      consume();
      if (!OBSERVATION_KINDS.has(kind)) return Object.freeze({ schema: 'ordax.agentic-test-result/1', scenarioId, state: 'blocked', reason: `evidence:${kind}`, receipts: Object.freeze(receipts), criteria: Object.freeze([]) });
      if (kind === 'semantic-snapshot') { const snapshot = await adapter.semanticSnapshot(); evidence.semanticIndex = semanticIndex(snapshot); receipts.push(Object.freeze({ kind, elements: evidence.semanticIndex.size })); }
      else if (kind === 'browser-snapshot') { if (typeof adapter.browserSnapshot !== 'function') return Object.freeze({ schema: 'ordax.agentic-test-result/1', scenarioId, state: 'blocked', reason: 'browser-snapshot-unavailable', receipts: Object.freeze(receipts), criteria: Object.freeze([]) }); evidence.browserSnapshot = await adapter.browserSnapshot(); receipts.push(Object.freeze({ kind, ok: Boolean(evidence.browserSnapshot) })); }
      else { if (typeof adapter.targetSurfaceScreenshot !== 'function') return Object.freeze({ schema: 'ordax.agentic-test-result/1', scenarioId, state: 'blocked', reason: 'target-surface-screenshot-unavailable', receipts: Object.freeze(receipts), criteria: Object.freeze([]) }); evidence.targetSurfaceScreenshot = await adapter.targetSurfaceScreenshot(); receipts.push(Object.freeze({ kind, surface: evidence.targetSurfaceScreenshot?.surface || null, verifiedTarget: evidence.targetSurfaceScreenshot?.verifiedTarget === true })); }
    }
    const criteria = Object.freeze((scenario.success || []).map(item => Object.freeze(successCriterion(item, evidence))));
    if (!criteria.length) return Object.freeze({ schema: 'ordax.agentic-test-result/1', scenarioId, state: 'blocked', reason: 'no-success-criteria', receipts: Object.freeze(receipts), criteria });
    const failed = criteria.find(item => !item.ok);
    return Object.freeze({ schema: 'ordax.agentic-test-result/1', scenarioId, state: failed ? 'failed' : 'passed', reason: failed?.reason || null, receipts: Object.freeze(receipts), criteria });
  } catch (error) {
    const result = Object.freeze({ schema: 'ordax.agentic-test-result/1', scenarioId, state: 'uncertain', reason: String(error?.message || error).slice(0, 240), receipts: Object.freeze(receipts), criteria: Object.freeze([]) });
    if (!FINAL_STATES.has(result.state)) throw new Error('invalid agentic result state');
    return result;
  }
}
