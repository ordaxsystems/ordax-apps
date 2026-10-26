import { WebContentsView, session } from 'electron';
import { assertProviderDraftAllowed, ensureEmptyNewComposer } from '../src/provider-composer-transition.mjs';
import { submitExactlyOnce, waitForSubmitControl } from '../src/provider-submit-receipt.mjs';
import { createResponseObservationBudget, responseObservationComplete, requireObservedCompletion } from '../src/provider-response-completion.mjs';
import { providerGenerationStopProbeExpression, providerResponseControlStateExpression } from '../src/provider-generation-stop-probe.mjs';
import { canReuseFreshProviderHome } from '../src/provider-home-readiness.mjs';
import { canonicalProviderChatUrl } from '../src/conversation-policy.mjs';
import { createProviderDeliveryRecorder } from '../src/provider-delivery-recorder.mjs';
import { providerUserMessageMatchesPrompt, providerUserMessageIsCollapsedPromptPrefix, shouldExpandCollapsedProviderPromptForResponse } from '../src/provider-user-message.mjs';
import { providerResponseFailureSignalsExpression, classifyProviderResponseFailure } from '../src/provider-response-failure.mjs';
import providerDomSelectors from '../src/provider-dom-selectors.cjs';
import { waitForHistoricalThreadDom } from '../src/provider-historical-thread-observation.mjs';
import { evaluateProviderReadOnlyDom } from '../src/provider-readonly-cdp-evaluator.mjs';
import {W3_MAX_USER_CHARS,W3_MAX_ASSISTANT_CHARS,W3_CDP_READ_TIMEOUT_MS} from '../src/provider-recovery-bounds.mjs';
import { awaitHistoricalSessionPreflight, classifyHistoricalThreadPostNavigation, mayReturnFromFailedProviderConversation } from '../src/provider-historical-thread-preflight.mjs';
import { preserveProviderWhitespace } from '../src/provider-code-format.mjs';
import { observeWithin, classifyProviderAuthObservation, assertProviderSendReadiness, canAcceptObservedNavigationAfterTimeout, classifyProviderAccessRestriction, canInspectHistoricalThreadAfterNavigationTimeout, safeHistoricalThreadFailure, normalizeProviderFailure } from '../src/provider-observation-policy.mjs';
import { toSafeProviderDiagnostic } from '../src/provider-diagnostic-fixture.mjs';
import { classifyProviderPageAvailability } from '../src/provider-page-availability.mjs';
import { providerAuthControlProbeExpression } from '../src/provider-auth-control-probe.mjs';
import { providerVerificationNoticeProbeBootstrap } from '../src/provider-verification-notice.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { classifyProviderContextAttachmentObservation, selectProviderContextFileInput, PROVIDER_CONTEXT_FILE_INPUT_SELECTOR, validateProviderContextAttachment } from '../src/provider-context-attachment.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const { providerMessageSelectors, providerMessageQueryBootstrap, providerHistoricalUserTextBootstrap } = providerDomSelectors;
const CHAT_ORIGINS = /^https:\/\/(chatgpt\.com|auth\.openai\.com|accounts\.google\.com)\//i;
const here = path.dirname(fileURLToPath(import.meta.url));

const selectors = {
  composer: [
    '#prompt-textarea',
    '#pending-home-input',
    '#mobile-composer-prompt',
    'textarea[placeholder="Pergunte ao ChatGPT"]',
    'textarea[aria-label*="ChatGPT"]',
    '[contenteditable="true"][data-composer-markdown]',
    '[contenteditable="true"][data-lexical-editor="true"]',
    '[contenteditable="true"][role="textbox"]'
  ],
  send: [
    'button[data-testid="send-button"]',
    'button[aria-label="Enviar"]',
    'button[aria-label="Send"]',
    'button[aria-label*="Enviar"]',
    'button[aria-label*="Send"]'
  ]
};

function createView(partition) {
  return new WebContentsView({
    webPreferences: {
      partition,
      preload: path.join(here, 'worker-preload.bundle.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
}

function composerExpression() {
  return `(() => {
    const sels = ${JSON.stringify(selectors.composer)};
    const all = sels.flatMap(selector => Array.from(document.querySelectorAll(selector)));
    const usable = element => {
      if (!element || element.disabled || element.getAttribute('aria-disabled') === 'true') return false;
      const hasSubmitContext = Boolean(element.closest('form')) || element.id === 'pending-home-input';
      if (!hasSubmitContext) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    return all.find(usable) || all.find(element => element && (element.closest('form') || element.id === 'pending-home-input')) || null;
  })()`;
}

function normalizeComposerText(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanBodyCandidate(raw) {
  const noise = [
    /^\d+(?:\.\d+)?\s+(?:Medium|High|Low)$/i,
    /^(?:Medium|High|Low)$/i,
    /^(?:Copiar|Copy|Gostei|Like|Não gostei|Dislike|Regenerar|Retry|Compartilhar|Share|Editar|Edit|Resposta concluída|Response completed|ChatGPT está respondendo|ChatGPT is responding)$/i,
    /^(?:Pergunte ao ChatGPT|Message ChatGPT)$/i,
    /^(?:Você gosta dessa personalidade\??|Do you like this personality\??)$/i,
    /^(?:Conte-nos mais|Tell us more)$/i
  ];
  return preserveProviderWhitespace(raw,noise);
}

export class EmbeddedChatWorker {
  constructor() {
    this.partition = 'persist:ordax-orchestrator-lab-chatgpt';
    this.session = session.fromPartition(this.partition);
    this.view = createView(this.partition);
    this.active = false;
    this.lastError = null;
    this.lastFailureMetrics = null;
    this.stageSink = null;
    this.ready = false;
    this.chain = Promise.resolve();
    this.streamContext = null;
    this.seenAssistantMessageIds = new Set();
    this.stage = 'idle';
    this.observerMode = 'auto';
    this.fastNetwork = { enabled:false, streamCapable:false, firstByteAt:null, activeRequestId:null, text:'', requests:new Map() };
    this.fastStreamSink = null;
    this.#configureView();
    this.#configureFastNetworkObserver();
  }

  setStageSink(fn) {
    this.stageSink = typeof fn === 'function' ? fn : null;
  }

  #setStage(stage) {
    if (this.stage === stage) return;
    this.stage = stage;
    try { this.stageSink?.({ stage, at:Date.now() }); } catch { /* observability never blocks an execution */ }
  }

  setObserverMode(mode = 'auto') {
    if (!['auto', 'fast', 'beta'].includes(mode)) throw new Error('invalid_observer_mode');
    this.observerMode = mode;
    return this.observerMode;
  }

  setFastStreamSink(fn) {
    this.fastStreamSink = typeof fn === 'function' ? fn : null;
  }

  #applyFastFragment(fragment) {
    const value = String(fragment || '');
    if (!value || value.length > 20000 || !this.streamContext) return;
    const current = this.fastNetwork.text;
    this.fastNetwork.text = value.startsWith(current) ? value : current + value;
    const text = this.fastNetwork.text.trim();
    if (!text) return;
    const ctx = this.streamContext;
    ctx.fastSeen = true;
    const internalKeys = /(?:transparent_background|referenced_image_ids|is_style_transfer|tool_call|tool_calls|recipient|arguments)/i;
    const structuredPayload = /^(?:null\s*,|[\[{])/.test(text) && /["']?[A-Za-z_][A-Za-z0-9_]*["']?\s*:/.test(text);
    if (internalKeys.test(text) || structuredPayload) {
      ctx.fastSuppressed = true;
      ctx.fastSuppressionReason = internalKeys.test(text) ? 'internal_tool_payload' : 'structured_payload';
      return;
    }
    if (ctx.fastSuppressed || text.length < 2) return;
    const at = Date.now();
    if (!ctx.fastFirstDeltaAt) ctx.fastFirstDeltaAt = at;
    if (!ctx.firstDeltaAt) { ctx.firstDeltaAt = at; ctx.firstObserver = 'fast'; }
    const previous = String(ctx.lastDeliveredText || '');
    if (previous) {
      if (previous === text || previous.startsWith(text)) return;
      if (ctx.lastDeliveredSource === 'beta' && !text.startsWith(previous)) return;
      if (!text.startsWith(previous) && text.length < previous.length) return;
    }
    ctx.lastDeliveredText = text;
    ctx.lastDeliveredSource = 'fast';
    ctx.fastDelivered = true;
    this.fastStreamSink?.({ text, generating:true, complete:false, source:'fast', at, firstDeltaAt:ctx.firstDeltaAt, submitAttemptAt:ctx.submitAttemptAt, submittedAt:ctx.submittedAt });
  }

  #consumeFastPayload(payload) {
    if (!payload || typeof payload !== 'object') return;
    const v = payload.v;
    if (Array.isArray(v)) {
      for (const patch of v) {
        if (!patch || typeof patch !== 'object' || !['append','add'].includes(String(patch.o || patch.op || '').toLowerCase())) continue;
        const value = patch.v ?? patch.value;
        if (typeof value === 'string') this.#applyFastFragment(value);
      }
    } else if (typeof v === 'string') {
      this.#applyFastFragment(v);
    }
    if (typeof payload.delta === 'string') this.#applyFastFragment(payload.delta);
  }

  #consumeFastData(requestId, encoded) {
    const req = this.fastNetwork.requests.get(requestId);
    if (!req || !encoded) return;
    let chunk = '';
    try { chunk = Buffer.from(encoded, 'base64').toString('utf8'); } catch { return; }
    req.buffer += chunk;
    const lines = req.buffer.split(/\r?\n/);
    req.buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const raw = trimmed.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      try { this.#consumeFastPayload(JSON.parse(raw)); } catch {}
    }
  }

  #configureFastNetworkObserver() {
    const wc = this.view.webContents;
    wc.debugger.on('message', (_event, method, params = {}) => {
      if (!this.streamContext || this.observerMode === 'beta') return;
      if (method === 'Network.requestWillBeSent') {
        const request = params.request || {};
        const armedAt = this.streamContext.submitAttemptAt;
        if (!armedAt || String(request.method || '').toUpperCase() !== 'POST' || !['Fetch','XHR'].includes(String(params.type || ''))) return;
        try { if (new URL(request.url).origin !== 'https://chatgpt.com') return; } catch { return; }
        const postData = String(request.postData || '');
        if (!postData || !postData.includes(this.streamContext.promptText)) return;
        const seenAt = Date.now();
        this.streamContext.providerRequestSeenAt = seenAt;
        this.fastNetwork.requests.set(params.requestId, { url:request.url, startedAt:seenAt, buffer:'', streaming:false });
        return;
      }
      if (method === 'Network.responseReceived') {
        const req = this.fastNetwork.requests.get(params.requestId);
        if (!req) return;
        const mime = String(params.response?.mimeType || '');
        if (!/event-stream|json|octet-stream/i.test(mime)) return;
        wc.debugger.sendCommand('Network.streamResourceContent', { requestId:params.requestId }).then(result => {
          req.streaming = true;
          this.fastNetwork.streamCapable = true;
          this.fastNetwork.activeRequestId = params.requestId;
          if (!this.fastNetwork.firstByteAt) { this.fastNetwork.firstByteAt = Date.now(); this.streamContext.networkFirstByteAt = this.fastNetwork.firstByteAt; }
          if (result?.bufferedData) this.#consumeFastData(params.requestId, result.bufferedData);
        }).catch(() => {});
        return;
      }
      if (method === 'Network.dataReceived') {
        const req = this.fastNetwork.requests.get(params.requestId);
        if (!req?.streaming || !params.data) return;
        if (!this.fastNetwork.firstByteAt) { this.fastNetwork.firstByteAt = Date.now(); this.streamContext.networkFirstByteAt = this.fastNetwork.firstByteAt; }
        this.#consumeFastData(params.requestId, params.data);
      }
    });
  }

  async #ensureNetworkObserver() {
    if (this.observerMode === 'beta') return false;
    const wc = this.view.webContents;
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      if (!this.fastNetwork.enabled) {
        await wc.debugger.sendCommand('Network.enable');
        this.fastNetwork.enabled = true;
      }
      return true;
    } catch {
      this.fastNetwork.enabled = false;
      return false;
    }
  }

  #configureView() {
    this.view.webContents.setWindowOpenHandler(({ url }) => {
      if (CHAT_ORIGINS.test(url)) this.view.webContents.loadURL(url).catch(() => {});
      return { action: 'deny' };
    });
    this.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    this.session.setPermissionCheckHandler(() => false);
    this.view.webContents.on('will-navigate', (event, url) => {
      if (!CHAT_ORIGINS.test(url)) { event.preventDefault(); this.lastError = 'navigation_blocked'; }
    });
    this.view.webContents.on('did-finish-load', () => { this.ready = true; });
    this.view.webContents.on('did-fail-load', (_event, code, description) => {
      if (code !== -3) this.lastError = `load_failed:${code}:${description}`;
    });
  }

  async load(url = 'https://chatgpt.com/') {
    try {
      await this.#safeLoad(url, { requireComposer: false });
    } catch (error) {
      // Preserve a bounded, local diagnostic when the provider navigation
      // times out before Chromium emits did-fail-load. Never store page text.
      if (!this.lastError) {
        const code = String(error?.message || '');
        this.lastError = code === 'provider_navigation_timeout'
          ? code
          : 'provider_initial_load_failed';
      }
      throw error;
    }
  }

  status() {
    return {
      connected: !this.view.webContents.isDestroyed(),
      active: this.active,
      ready: this.ready,
      url: this.view.webContents.getURL(),
      title: this.view.webContents.getTitle(),
      backend: 'electron-embedded-chatgpt',
      persistent_session: true,
      single_visual_session: true,
      api_used: false,
      private_endpoint_used: false,
      last_error: this.lastError,
      stage: this.stage,
      observer_mode: this.observerMode,
      fast_observer_ready: this.fastNetwork.enabled,
      fast_stream_capable: this.fastNetwork.streamCapable,
      can_go_back:!this.view.webContents.isDestroyed()&&this.view.webContents.navigationHistory.canGoBack(),
      can_go_forward:!this.view.webContents.isDestroyed()&&this.view.webContents.navigationHistory.canGoForward()
    };
  }

  async #assertManualNavigationSafe({allowReturnFromFailedThread=false}={}) {
    const wc=this.view.webContents;
    const state=await this.#composerState().catch(()=>null);
    if(!state)throw new Error('provider_navigation_state_unknown');
    if(state.text?.trim())throw new Error('chatgpt_draft_present');
    if(!state.found) {
      const url=wc.getURL();
      // Manual Back may leave an explicitly failed, empty linked thread.
      // This never authorizes Reload, Forward, login, or a provider send.
      if(allowReturnFromFailedThread) {
        const health=await this.health().catch(()=>null);
        if(mayReturnFromFailedProviderConversation({
          url,health,composerState:state
        })) return;
      }
      const authPage=url.startsWith('https://chatgpt.com/auth/login')||
        url.startsWith('https://auth.openai.com/')||url.startsWith('https://accounts.google.com/');
      if(!authPage)throw new Error('provider_navigation_state_unknown');
    }
  }

  async navigateHistory(direction) {
    if(!['back','forward'].includes(direction))throw new Error('provider_navigation_invalid');
    if(this.active)throw new Error('provider_navigation_during_run_blocked');
    await this.#assertManualNavigationSafe({
      allowReturnFromFailedThread:direction==='back'
    });
    const wc=this.view.webContents;
    const history=wc.navigationHistory;
    const canNavigate=direction==='back'?history.canGoBack():history.canGoForward();
    if(!canNavigate)return {started:false,canGoBack:history.canGoBack(),canGoForward:history.canGoForward()};
    if(direction==='back')history.goBack();else history.goForward();
    return {started:true,canGoBack:history.canGoBack(),canGoForward:history.canGoForward()};
  }

  async reloadCurrentPage() {
    if(this.active)throw new Error('provider_reload_during_run_blocked');
    await this.#assertManualNavigationSafe();
    this.view.webContents.reload();
    return {started:true};
  }

  async health() {
    const base = this.status();
    if (!base.connected) return { ...base, verification_required:false, auth_state:'unavailable' };
    const page = await evaluateProviderReadOnlyDom({
      debugger:this.view.webContents.debugger,expression:`(() => {
      const composer=${composerExpression()};
      ${providerMessageQueryBootstrap}
      ${providerVerificationNoticeProbeBootstrap}
      const authControls=${providerAuthControlProbeExpression};
      const messageNodes=queryProviderMessageNodes(document,'user',providerMessageSelectors).length +
        queryProviderMessageNodes(document,'assistant',providerMessageSelectors).length;
      // Reading full document.innerText forces layout on huge code replies.
      // Page-error text matters only when neither composer nor chat turns exist.
      const body=!composer && messageNodes===0
        ? String(document.body?.innerText||'').slice(-5000) : '';
      const visibleNotice=node=>{
        if(!node)return false;
        const style=getComputedStyle(node),rect=node.getBoundingClientRect();
        return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;
      };
      const verificationAlert=!composer&&messageNodes===0&&
        Array.from(document.querySelectorAll('[role="alert"],h1,h2')).filter(visibleNotice).some(node=>
          isProviderVerificationNotice(String(node.innerText||node.textContent||''))
        );
      // Only count status codes of first-party requests. Never export URLs,
      // response payloads, query parameters, user data, or cookies.
      let backendForbiddenCount=0,backendRateLimitedCount=0;
      let backendForbiddenRecentCount=0,backendRateLimitedRecentCount=0;
      // Resource timing persists for the whole document, so total historical
      // errors cannot certify a CURRENT restriction. Recent is two minutes.
      const backendRecentWindowMs=120000;
      const observedAtMs=performance.now();
      for (const entry of performance.getEntriesByType('resource')) {
        if (entry.responseStatus !== 403 && entry.responseStatus !== 429) continue;
        try {
          const requestUrl=new URL(entry.name);
          if (requestUrl.origin==='https://chatgpt.com' &&
              requestUrl.pathname.startsWith('/backend-api/')) {
            const start=entry.startTime;
            const recent=Number.isFinite(start)&&start>=0&&start<=observedAtMs&&
              observedAtMs-start<=backendRecentWindowMs;
            if (entry.responseStatus===403) {
              backendForbiddenCount++;
              if(recent)backendForbiddenRecentCount++;
            }
            if (entry.responseStatus===429) {
              backendRateLimitedCount++;
              if(recent)backendRateLimitedRecentCount++;
            }
          }
        } catch {}
      }
      return {
        backendForbiddenCount:Math.min(100,backendForbiddenCount),
        backendRateLimitedCount:Math.min(100,backendRateLimitedCount),
        backendForbiddenRecentCount:Math.min(100,backendForbiddenRecentCount),
        backendRateLimitedRecentCount:Math.min(100,backendRateLimitedRecentCount),
        body:body.slice(-5000),
        composer:Boolean(composer),
        messageNodes,
        hasLogin:authControls.hasLogin,
        hasSignup:authControls.hasSignup,
        verification:verificationAlert,
        generationStopVisible:${providerGenerationStopProbeExpression},
        responseFailureSignals:${providerResponseFailureSignalsExpression}
      };
    })()`,timeoutMs:5000,timeoutCode:'provider_health_observation_timeout'
    }).catch(() => null);
    const url = this.view.webContents.getURL();
    const authState=classifyProviderAuthObservation({url,page});
    const availability=classifyProviderPageAvailability({
      body:page?.body,messageNodes:page?.messageNodes,composerPresent:page?.composer,
      verificationAlert:page?.verification===true
    });
    const providerAccessProblem=classifyProviderAccessRestriction({
      forbiddenCount:page?.backendForbiddenRecentCount||0,
      rateLimitedCount:page?.backendRateLimitedRecentCount||0,
      composerReady:page?.composer===true
    });
    return { ...base, composer_ready:page?.composer===true,
      verification_required:page?.verification===true,
      health_observed:page!==null,auth_state:authState,
      page_state:availability.page_state,
      history_unavailable:availability.history_unavailable,
      provider_access_problem:providerAccessProblem,
      response_generation_active:page?.generationStopVisible===true,
      provider_response_failure:classifyProviderResponseFailure(page?.responseFailureSignals),
      backend_api_403_count:page?.backendForbiddenCount||0,
      backend_api_429_count:page?.backendRateLimitedCount||0,
      backend_api_403_recent_count:page?.backendForbiddenRecentCount||0,
      backend_api_429_recent_count:page?.backendRateLimitedRecentCount||0 };
  }

  enqueue(fn) {
    const run = async () => {
      this.active = true;
      try { return await fn(); }
      finally { this.active = false; }
    };
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => {});
    return result;
  }

  async login() {
    await this.#safeLoad('https://chatgpt.com/auth/login', { requireComposer: false });
    return this.status();
  }

  async #clearNewChatComposer() {
    // This is called ONLY for an explicit new provider conversation. A hidden
    // WebContentsView may ignore Chromium keyboard events, even with focus.
    // execCommand('delete') dispatches a real editing transaction recognized
    // by the ProseMirror/contenteditable composer. The caller verifies emptiness.
    const cleared = await this.view.webContents.executeJavaScript(`(() => {
      const input = ${composerExpression()};
      if (!input) return false;
      input.focus();
      if ('value' in input) {
        if (typeof input.setSelectionRange === 'function') {
          input.setSelectionRange(0, String(input.value || '').length);
        } else if (typeof input.select === 'function') {
          input.select();
        }
      } else {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      return document.execCommand('delete');
    })()`).catch(() => false);
    if (!cleared) throw new Error('new_chat_composer_clear_failed');
  }

  async #confirmFreshComposer() {
    return ensureEmptyNewComposer({
      readComposer: () => this.#waitForComposer(),
      clearComposer: () => this.#clearNewChatComposer()
    });
  }

  async #startNewChat() {
    const wc = this.view.webContents;
    const currentUrl = wc.getURL();
    const homeComposer = await this.#composerState(); // refuse unknown drafts before new chat
    // A ready provider home already IS a fresh conversation. Avoid an
    // unnecessary DOM click or reload for every new Task.
    if (canReuseFreshProviderHome({ url:currentUrl, composer:homeComposer })) {
      await this.#confirmFreshComposer();
      return true;
    }
    try {
      const current = new URL(currentUrl);
      if (current.origin === 'https://chatgpt.com') {
        const clicked = await wc.executeJavaScript(`(() => {
          const visible = node => Boolean(node && node.getClientRects().length);
          const controls = [...document.querySelectorAll('button,a')].filter(visible);
          const semantic = controls.find(node => /^(Novo chat|New chat)$/i.test((node.innerText || node.textContent || '').trim()));
          const selectors = [
            '[data-testid=\"create-new-chat-button\"]',
            'button[aria-label*=\"Novo chat\" i]',
            'a[aria-label*=\"Novo chat\" i]',
            'button[aria-label*=\"New chat\" i]',
            'a[aria-label*=\"New chat\" i]'
          ];
          const structural = selectors.map(s => document.querySelector(s)).find(visible);
          const el = semantic || structural;
          if (!el) return false;
          el.click();
          return true;
        })()`).catch(() => false);
        if (clicked) {
          const started = Date.now();
          while (Date.now() - started < 2500) {
            await sleep(50);
            const url = wc.getURL();
            const state = await this.#composerState().catch(() => ({ found:false, formReady:false, text:'' }));
            try {
              const parsed = new URL(url);
              const contextChanged = url !== currentUrl || parsed.pathname === '/';
              if (parsed.origin === 'https://chatgpt.com' && contextChanged && state.found && state.formReady) {
                await this.#confirmFreshComposer();
                return true;
              }
            } catch {}
          }
        }
      }
    } catch {}
    // This path is reached only after an explicit new-conversation action.
    // Navigation may discard the old transient ChatGPT draft; the OrdaX Task
    // draft stays in its own store. A same-URL home page must be reloaded.
    await this.#safeLoad('https://chatgpt.com/', { requireComposer:true, protectDraft:false, forceReload:true });
    await this.#confirmFreshComposer();
    return false;
  }

  async newChat() {
    return this.enqueue(async () => {
      await this.#startNewChat();
      return this.status();
    });
  }

  async showConversation(url, { force = false, requireComposer = true, readOnlyThread = false } = {}) {
    if (!/^https:\/\/chatgpt\.com\//i.test(String(url || ''))) throw new Error('invalid_chat_url');
    const current = this.view.webContents.getURL();
    if (!force && current !== url) {
      // If the composer is unreadable, its draft state is unknown.
      const state = await this.#composerState();
      if (state.text?.trim()) return { ...this.status(), navigated:false, reason:'visible_draft_present' };
    }
    if (current !== url) await this.#safeLoad(url, { requireComposer, protectDraft: !force, readOnlyThread });
    return { ...this.status(), navigated:true };
  }

  // Inspect the currently visible provider page; never navigate or submit.
  // The only returned values are allowlisted flags and bounded counts.
  async inspectDiagnosticReadOnly() {
    return this.enqueue(async () => {
      const url=this.view.webContents.getURL();
      let observation={};
      try {
        observation=await evaluateProviderReadOnlyDom({
          debugger:this.view.webContents.debugger,expression:`(() => {
          const $ = selector => document.querySelector(selector);
          ${providerMessageQueryBootstrap}
          const userNodes=queryProviderMessageNodes(document,'user',providerMessageSelectors);
          const assistantNodes=queryProviderMessageNodes(document,'assistant',providerMessageSelectors);
          const hasContent = nodes => Array.from(nodes).some(node =>
            Boolean(String(node.textContent || '').trim()));
          return {
            composerPresent:Boolean($('#prompt-textarea,[contenteditable="true"][role="textbox"]')),
            sendControlPresent:Boolean($('button[data-testid="send-button"],button[aria-label="Enviar"],button[aria-label="Send"]')),
            stopControlPresent:${providerGenerationStopProbeExpression},
            assistantContentPresent:hasContent(assistantNodes),
            userContentPresent:hasContent(userNodes),
            assistantNodes:assistantNodes.length,
            userNodes:userNodes.length
          };
        })()`,timeoutMs:5000,timeoutCode:'provider_diagnostic_observation_timeout'
        });
      } catch { /* unavailable signals are not success */ }
      return toSafeProviderDiagnostic({url,observation});
    });
  }

  // W3 uses the same bounded CDP evaluation contract as provider health and
  // diagnostic. Uncertain observations never trigger retries or navigation.
  async #readHistoricalThreadDOM() {
    // One read-only evaluator shared with health; never retry an unknown CDP call.
    const snapshot=await evaluateProviderReadOnlyDom({
      debugger:this.view.webContents.debugger,
      expression:`(() => {
          ${providerMessageQueryBootstrap}
          ${providerHistoricalUserTextBootstrap}
          const entries = [
            ...queryProviderMessageNodes(document,'user',providerMessageSelectors).map(node=>({node,role:'user'})),
            ...queryProviderMessageNodes(document,'assistant',providerMessageSelectors).map(node=>({node,role:'assistant'}))
          ].sort((left,right)=>{
            const position=left.node.compareDocumentPosition(right.node);
            return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : position & Node.DOCUMENT_POSITION_PRECEDING ? 1 : 0;
          });
          const tail = entries.slice(-50);
          const messages = tail.map(({node,role}) => {
            // Exact W3 digest applies to the authored user payload, not the
            // surrounding copy button. A missing/ambiguous user content node
            // is incomplete and MUST NOT create a recovery preview.
            const user=role==='user' ? readProviderHistoricalUserText(node) : null;
            const text=role==='user' ? user.text
              : String(node.innerText || node.textContent || '');
            const maxChars=role==='assistant' ? ${W3_MAX_ASSISTANT_CHARS} : ${W3_MAX_USER_CHARS};
            return {
              role,
              text:text.slice(0,maxChars+1),
              textTruncated:(role==='user' && user.complete!==true) || text.length>maxChars
            };
          });
          // A visible assistant bubble can still be streaming. Capture the
          // first-party stop control in the same bounded read-only snapshot.
          const responseControlState=${providerResponseControlStateExpression};
          const hasComposer=Boolean(document.querySelector(
            '#prompt-textarea,[contenteditable="true"][role="textbox"]'
          ));
          // Read diagnostic copy only when there is no chat DOM or composer.
          // Never export page text, prompt content or errors to the App IPC.
          const loadFailureText=entries.length===0 && !hasComposer
            ? String(document.body?.innerText||'').slice(-5000) : '';
          return {
            available:true, url:location.href, domReliable:entries.length>0,
            truncated:entries.length>50,
            generationStopVisible:responseControlState.generationStopVisible,
            responseCompletionObserved:responseControlState.responseCompletionObserved,
            loadFailureText, messages
          };
        })()`,
      timeoutMs:W3_CDP_READ_TIMEOUT_MS,timeoutCode:'provider_readonly_dom_evaluation_timeout'
    });
    if(snapshot?.available!==true)
      throw new Error('provider_readonly_dom_evaluation_rejected');
    const {loadFailureText,...safeSnapshot}=snapshot;
    const availability=classifyProviderPageAvailability({
      body:loadFailureText,messageNodes:safeSnapshot.messages.length,
      composerPresent:false
    });
    return {...safeSnapshot,page_state:availability.page_state};
  }

  // Explicit, read-only inspection of an existing, canonical conversation.
  // The only navigation is an ordinary authorized GET to the linked thread.
  // This never types, submits, retries, creates a chat or writes any Task.
  async inspectConversationReadOnly(chatUrl) {
    const expected=canonicalProviderChatUrl(chatUrl);
    if (!expected) throw new Error('invalid_chat_url');
    return this.enqueue(async () => {
      // Read-only health first. Never navigate if no usable session, verified
      // login is required, verification is pending or 429/403 is observed.
      // The already-open linked thread can be read despite absent composer.
      const preflight=await awaitHistoricalSessionPreflight({
        expectedUrl:expected,readHealth:()=>this.health().catch(()=>null)
      });
      if(!preflight.allowed)
        return {available:false,url:expected,reason:preflight.reason};
      // Historical read-only inspection is not an attempt to send. The provider
      // editor may be absent even when the old thread is readable. Draft
      // protection and canonical URL verification still apply.
      let result;
      try {
        result=await this.showConversation(expected, {force:false,requireComposer:false,readOnlyThread:true});
      } catch (error) {
        return {available:false,url:expected,reason:safeHistoricalThreadFailure(error?.message)};
      }
      if (result.navigated === false ||
          canonicalProviderChatUrl(this.view.webContents.getURL()) !== expected) {
        return {available:false,url:expected,reason:result.navigated===false?'navigation_or_draft_blocked':'provider_url_mismatch'};
      }
      const observation=await waitForHistoricalThreadDom({
        expectedUrl:expected,
        read:()=>this.#readHistoricalThreadDOM()
      });
      if(observation?.reason!=='thread_dom_not_ready') return observation;
      // A 403/429 can be observed only after the authorized historical GET.
      // One fresh, bounded first-party health read; no second navigation, DOM
      // retry, submission, authentication or speculative status inference.
      const postHealth=await this.health().catch(()=>null);
      return classifyHistoricalThreadPostNavigation({observation,health:postHealth});
    });
  }

  async #composerState() {
    return observeWithin(() => this.view.webContents.executeJavaScript(`(() => {
      const sels = ${JSON.stringify(selectors.composer)};
      const el = ${composerExpression()};
      if (!el) return { found:false, text:'' };
      const text = 'value' in el ? el.value : (el.innerText || el.textContent || '');
      return { found:true, formReady:Boolean(el.closest('form')) || el.id === 'pending-home-input', text:String(text || ''), tag:el.tagName, id:el.id || '' };
    })()`), {timeoutMs:4000,code:'provider_composer_observation_timeout'});
  }

  async #waitForComposer(timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const state = await this.#composerState().catch(() => ({ found:false, text:'' }));
      if (state.found && state.formReady) return state;
      await sleep(250);
    }
    throw new Error('composer_not_found');
  }

  async #safeLoad(url, { requireComposer = false, protectDraft = false, forceReload = false, readOnlyThread = false } = {}) {
    const wc = this.view.webContents;
    if (protectDraft) {
      const state = await this.#composerState(); // throw if draft cannot be observed
      if (state.text?.trim()) throw new Error('chatgpt_draft_present');
    }
    const target = new URL(url);
    const currentUrl = wc.getURL();
    let alreadyAtTarget = false;
    if (currentUrl) {
      try {
        const current = new URL(currentUrl);
        alreadyAtTarget = current.origin === target.origin &&
          current.pathname === target.pathname && current.search === target.search;
      } catch { /* only malformed URL parsing is ignored */ }
    }
    if (alreadyAtTarget && !forceReload) {
      // Never reload an already-targeted provider page merely because its
      // editor is absent (hydrating, failed or in an uncertain generation).
      // The operator may request an explicit reload separately, but no
      // automatic navigation may erase a live/unknown provider state.
      if (!requireComposer) return;
      const state = await this.#composerState();
      if (state.found && state.formReady) return;
      const observed = await this.health().catch(() => null);
      if (observed?.page_state==='conversation_load_failed')
        throw new Error('chatgpt_conversation_load_failed');
      await this.#waitForComposer();
      return;
    }
    try {
      await observeWithin(() => wc.loadURL(url), {
        timeoutMs:30000,code:'provider_navigation_timeout'
      });
    } catch (error) {
      const message = String(error?.message || error);
      const aborted = error?.code === -3 || /\(-3\)|ERR_ABORTED/i.test(message);
      if (!aborted && message === 'provider_navigation_timeout' && readOnlyThread &&
          canInspectHistoricalThreadAfterNavigationTimeout({
            expectedUrl:url,actualUrl:wc.getURL(),mainFrameLoading:wc.isLoadingMainFrame()
          })) {
        // This permits only the bounded historical DOM observer below.
        // It does not certify message delivery, authentication or a successful load.
      } else if (!aborted && message === 'provider_navigation_timeout' && requireComposer) {
        // loadURL might not settle even after the destination became interactive.
        // Never re-navigate or infer a stale/in-flight page was loaded.
        const state=await observeWithin(() => this.#composerState(), {
          timeoutMs:5000,code:'navigation_composer_observation_timeout'
        }).catch(() => null);
        const health=await this.health().catch(() => null);
        const confirmed=canAcceptObservedNavigationAfterTimeout({
          expectedUrl:url,actualUrl:wc.getURL(),requireComposer,
          mainFrameLoading:wc.isLoadingMainFrame(),
          composerFound:state?.found,composerFormReady:state?.formReady,
          authState:health?.auth_state,healthObserved:health?.health_observed
        });
        if (!confirmed) throw error;
      } else if (!aborted) throw error;
    }
    if (requireComposer) await this.#waitForComposer();
  }

  async #assistantSnapshot() {
    return this.view.webContents.executeJavaScript(`(() => {
      ${providerMessageQueryBootstrap}
      const nodes = queryProviderMessageNodes(document,'assistant',providerMessageSelectors);
      const userNodes = queryProviderMessageNodes(document,'user',providerMessageSelectors);
      const latestUserNode = userNodes.at(-1) || null;
      const latestUserExpandControlPresent = Boolean(latestUserNode && Array.from(latestUserNode.querySelectorAll('button,[role="button"]')).some(control =>
        /^(Mostrar mais|Show more|Mostrar menos|Show less)$/i.test(String(control.innerText || control.textContent || control.getAttribute('aria-label') || '').trim())
      ));
      const latestUserText = String(latestUserNode?.innerText || latestUserNode?.textContent || '').trim();
      const imageData = img => ({ src: img.currentSrc || img.src || '', alt: img.alt || '', width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
      const validImage = (img, min) => Boolean(img.src) && (img.width >= min || img.height >= min || img.src.includes('images.openai.com'));
      const generatedImages = Array.from(document.querySelectorAll('[data-testid="generated-image-preview"] img')).map(imageData).filter(img => validImage(img, 64));
      const responseControlState = ${providerResponseControlStateExpression};
      const generationStopVisible = responseControlState.generationStopVisible;
      const responseFailureSignals = ${providerResponseFailureSignalsExpression};
      const preserveWhitespace = ${preserveProviderWhitespace.toString()};
      const readNode = node => {
        const id = node.getAttribute('data-chatgpt-selection-message-id') || node.getAttribute('data-message-id') || '';
        const markdown = node.querySelector('[data-assistant-markdown], [data-message-content]');
        let text = String((markdown && markdown.innerText) || node.innerText || '').trim();
        text = text.replace(/^O ChatGPT disse:\\s*/i, '').replace(/^ChatGPT disse:\\s*/i, '').replace(/^ChatGPT said:\\s*/i, '').trim();
        text = preserveWhitespace(text, [/^(Editar|Edit|Resposta concluída|Response completed|Copiar|Copy|Compartilhar|Share|Você gosta dessa personalidade\??|Do you like this personality\??|Conte-nos mais|Tell us more)$/i]);
        const images = Array.from(node.querySelectorAll('img')).map(imageData).filter(img => validImage(img, 64));
        return { id, text, images, complete: responseControlState.responseCompletionObserved || node.hasAttribute('data-message-complete') || Boolean(node.querySelector('[data-message-complete]')) };
      };
      if (nodes.length) return { mode:'direct', messages:nodes.map(readNode), rawBody:'', images:generatedImages, latestUserText, latestUserExpandControlPresent, generationStopVisible, responseCompletionObserved:responseControlState.responseCompletionObserved, responseFailureSignals };
      const conversationRoot = document.querySelector('main,[role="main"]');
      const body = (conversationRoot && conversationRoot.innerText) || '';
      const images = Array.from((conversationRoot || document).querySelectorAll('img')).map(imageData).filter(img => validImage(img, 128));
      return { mode:'body', messages:[], rawBody:body, images:[...images, ...generatedImages].filter((image,index,all) => all.findIndex(other => other.src === image.src) === index), latestUserText, latestUserExpandControlPresent, generationStopVisible, responseCompletionObserved:responseControlState.responseCompletionObserved, responseFailureSignals };
    })()`);
  }

  async #setComposerAndSend(prompt) {
    const wc = this.view.webContents;
    const initial = await this.#waitForComposer();
    if (initial.text.trim()) throw new Error('chatgpt_draft_present');

    const baseline = await this.#submissionState();
    // A web editor can remain mounted and visible after the app loses native
    // page focus. Focus the existing embedded WebContents before routing the
    // single CDP text insertion, then require the intended composer itself to
    // own DOM focus. This prevents a silent insertion into the page body.
    this.view.webContents.focus();
    const prepared = await wc.executeJavaScript(`(() => {
      const sels = ${JSON.stringify(selectors.composer)};
      const input = ${composerExpression()};
      if (!input || typeof input.focus !== 'function') return false;
      input.focus();
      return document.activeElement === input || input.contains(document.activeElement);
    })()`).catch(() => false);
    if (!prepared) throw new Error('composer_focus_not_observed');

    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    } catch (error) {
      if (!wc.debugger.isAttached()) throw new Error('chromium_input_channel_unavailable');
    }

    await wc.debugger.sendCommand('Input.insertText', { text: prompt });
    let recognized = false;
    for (let i = 0; i < 50; i++) {
      const state = await this.#composerState().catch(() => ({ found:false, text:'' }));
      if (normalizeComposerText(state.text) === normalizeComposerText(prompt)) { recognized = true; break; }
      await sleep(80);
    }
    if (!recognized) throw new Error('composer_input_not_recognized');

    // Wait until React renders a usable submit control before attempting
    // exactly one standards-based form submission. No fallback clicks.
    const target = await waitForSubmitControl({
      read: () => wc.executeJavaScript(`(() => {
      const input = ${composerExpression()};
      const form = input?.closest('form');
      const scope = form || document;
      const selectors = ${JSON.stringify(selectors.send)};
      const matches = selectors.flatMap(selector => Array.from(scope.querySelectorAll(selector)));
      const button = matches.find(el => el && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && el.getClientRects().length)
        || form?.querySelector('button[type="submit"]:not([disabled])') || null;
      const rect = button?.getBoundingClientRect();
      return { button:!!button, form:!!form, x:rect?.left + rect?.width / 2, y:rect?.top + rect?.height / 2 };
    })()`).catch(() => ({button:false,form:false})),
      wait: () => sleep(150),
      maxChecks:40
    });

    const fire = async () => {
      if (this.streamContext) this.streamContext.submitAttemptAt = Date.now();
      // The hidden Chromium view can accept text while discarding synthetic
      // pointer events. Use the browser's standardized form-submission API
      // instead of a simulated click. Exactly one requestSubmit invocation
      // is made for this Run; the receipt watcher still fails closed.
      const submitted = await wc.executeJavaScript(`(() => {
        const input = ${composerExpression()};
        const form = input?.closest('form');
        if (!form || typeof form.requestSubmit !== 'function') return false;
        const selectors = ${JSON.stringify(selectors.send)};
        const matches = selectors.flatMap(selector => Array.from(form.querySelectorAll(selector)));
        const button = matches.find(el =>
          el?.type === 'submit' && !el.disabled &&
          el.getAttribute('aria-disabled') !== 'true' &&
          el.getClientRects().length
        ) || form.querySelector('button[type="submit"]:not([disabled])');
        if (!button || button.type !== 'submit' || button.disabled ||
            button.getAttribute('aria-disabled') === 'true' || !button.getClientRects().length) return false;
        form.requestSubmit(button);
        return true;
      })()`);
      if (!submitted) throw new Error('send_control_unavailable');
    };

    let promptExpansionAttempted=false;
    try {
      await submitExactlyOnce({
        fire,
        readState: async () => {
          let state=await this.#submissionState();
          if (!promptExpansionAttempted&&providerUserMessageIsCollapsedPromptPrefix(state.latestUserText,prompt,{
            expandControlPresent:Boolean(state.latestUserExpandControlPresent)
          })) {
            promptExpansionAttempted=true;
            const expanded=await this.#expandLatestUserMessageForVerification();
            if(expanded)state=await this.#submissionState();
          }
          return state;
        },
        wait: () => sleep(250),
        baseline,
        prompt,
        maxChecks:80
      });
    } catch (error) {
      // A provider verification/login gate supersedes a generic lack of receipt.
      // Never retry after any submit attempt, even when the result is uncertain.
      const health = await this.health().catch(() => null);
      if (health?.verification_required) throw new Error('chatgpt_verification_required');
      if (health?.auth_state === 'authenticating') throw new Error('chatgpt_authentication_in_progress');
      if (health?.auth_state === 'anonymous') throw new Error('chatgpt_login_required');
      throw error;
    }
    if (this.streamContext) this.streamContext.submittedAt = Date.now();
  }

  async #submissionState() {
    return this.view.webContents.executeJavaScript(`(() => {
      const composer = ${composerExpression()};
      const text = composer ? ('value' in composer ? composer.value : (composer.innerText || composer.textContent || '')) : '';
      ${providerMessageQueryBootstrap}
      const userNodes = queryProviderMessageNodes(document,'user',providerMessageSelectors);
      const latestUserNode = userNodes.at(-1) || null;
      const latestUserExpandControlPresent = Boolean(latestUserNode && [...latestUserNode.querySelectorAll('button,[role="button"]')].some(control =>
        /^(Mostrar mais|Show more|Mostrar menos|Show less)$/i.test(String(control.innerText || control.textContent || control.getAttribute('aria-label') || '').trim())
      ));
      return {
        composerText:String(text || ''),
        userCount:userNodes.length,
        latestUserText:String(latestUserNode?.innerText || latestUserNode?.textContent || ''),
        latestUserExpandControlPresent,
        url:location.href
      };
    })()`);
  }

  async #expandLatestUserMessageForVerification() {
    return this.view.webContents.executeJavaScript(`(() => {
      ${providerMessageQueryBootstrap}
      const user=queryProviderMessageNodes(document,'user',providerMessageSelectors).at(-1)||null;
      if(!user)return false;
      const control=Array.from(user.querySelectorAll('button,[role="button"]')).find(node=>{
        const label=String(node.innerText||node.textContent||node.getAttribute('aria-label')||'').trim();
        if(!/^(Mostrar mais|Show more)$/i.test(label))return false;
        const style=getComputedStyle(node),rect=node.getBoundingClientRect();
        return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0&&
          node.getAttribute('aria-disabled')!=='true'&&!node.disabled;
      });
      if(!control)return false;
      control.click();
      return true;
    })()`).catch(()=>false);
  }

  async #fetchImages(images = []) {
    const out = [];
    for (const image of images) {
      try {
        const data = await this.view.webContents.executeJavaScript(`(async () => {
          const response=await fetch(${JSON.stringify(image.src)}); if(!response.ok)return null;
          const blob=await response.blob(),buffer=await blob.arrayBuffer(),bytes=new Uint8Array(buffer);
          let binary=''; for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
          return {mimeType:blob.type||'image/png',base64:btoa(binary)};
        })()`);
        if (data?.base64) out.push({ ...image, ...data });
      } catch {}
    }
    return out;
  }

  acceptStreamSnapshot(snapshot) {
    const ctx = this.streamContext;
    if (!ctx || !snapshot) return null;
    const latestUserText = String(snapshot.latestUserText || '').trim();
    if (snapshot.mode === 'direct' && latestUserText && !providerUserMessageMatchesPrompt(
      latestUserText, ctx.promptText,
      { expandControlPresent:Boolean(snapshot.latestUserExpandControlPresent) }
    )) return null;
    const messageId = String(snapshot.messageId || '').trim();
    const freshVisualImages = (snapshot.images || []).filter(image => image?.src && !ctx.beforeImageSources.has(image.src));
    let staleAssistantMessage = false;
    if (snapshot.mode === 'direct' && messageId) {
      staleAssistantMessage = this.seenAssistantMessageIds.has(messageId) && messageId !== ctx.currentAssistantMessageId;
      if (!staleAssistantMessage) {
        if (!ctx.currentAssistantMessageId) ctx.currentAssistantMessageId = messageId;
        else if (ctx.currentAssistantMessageId !== messageId && !freshVisualImages.length) return null;
      }
      if (staleAssistantMessage && !freshVisualImages.length) return null;
    }

    let text = '';
    let images = freshVisualImages;
    if (snapshot.mode === 'body') {
      const raw = String(snapshot.rawBody || '');
      const index = raw.lastIndexOf(ctx.promptText);
      if (index < 0) return null;
      let scoped = raw.slice(index + ctx.promptText.length);
      const assistantBoundary = scoped.search(/(?:O ChatGPT disse:|ChatGPT disse:|ChatGPT said:)/i);
      if (assistantBoundary < 0) return null;
      scoped = scoped.slice(assistantBoundary);
      for (const footer of ['O ChatGPT pode cometer erros','ChatGPT é uma IA','ChatGPT can make mistakes','Pergunte ao ChatGPT','Message ChatGPT','Esta conversa está sendo útil até agora?','Has this conversation been helpful so far?']) {
        const boundary = scoped.indexOf(footer);
        if (boundary >= 0) scoped = scoped.slice(0, boundary);
      }
      text = cleanBodyCandidate(scoped.replace(/^\s*(O ChatGPT disse:|ChatGPT disse:|ChatGPT said:)\s*/i, ''));
      images = images.filter(image => !ctx.beforeImageSources.has(image.src));
    } else {
      text = staleAssistantMessage ? '' : String(snapshot.text || '').trim();
      images = freshVisualImages.length ? freshVisualImages : (staleAssistantMessage ? [] : (snapshot.images || []));
    }

    const activityAt = Number(snapshot.at || Date.now());
    if (!ctx.firstActivityAt && (snapshot.generating || text || images.length)) ctx.firstActivityAt = activityAt;
    const imageSources = images.map(image => image.src).filter(Boolean);
    const signature = JSON.stringify([text, imageSources]);
    const isNew = snapshot.mode === 'body'
      ? Boolean(text || imageSources.length)
      : (Number(snapshot.assistantCount || 0) > ctx.beforeCount || signature !== ctx.baseline);
    if (!isNew || (!text && !imageSources.length) || signature === ctx.lastSignature) return null;
    if (!ctx.betaFirstDeltaAt) ctx.betaFirstDeltaAt = Number(snapshot.at || Date.now());
    ctx.betaSeen = true;
    if (!ctx.firstDeltaAt) { ctx.firstDeltaAt = ctx.betaFirstDeltaAt; ctx.firstObserver = 'beta'; }
    const previous = String(ctx.lastDeliveredText || '');
    let deliveryText = text;
    if (text && previous) {
      const wouldRegress = previous.startsWith(text) || (!text.startsWith(previous) && text.length < previous.length);
      if (wouldRegress) {
        ctx.lastSignature = signature;
        if (!imageSources.length) return null;
        deliveryText = previous;
      }
    }
    if (deliveryText && deliveryText !== previous) {
      ctx.lastDeliveredText = deliveryText;
      ctx.lastDeliveredSource = 'beta';
    }
    ctx.lastSignature = signature;
    return {
      text: deliveryText,
      images,
      generating: Boolean(snapshot.generating),
      complete: Boolean(snapshot.complete),
      at: Number(snapshot.at || Date.now()),
      firstActivityAt: ctx.firstActivityAt,
      firstDeltaAt: ctx.firstDeltaAt,
      submitAttemptAt: ctx.submitAttemptAt || null,
      submittedAt: ctx.submittedAt || null
    };
  }

  async #observeContextAttachment(filename) {
    const expected=JSON.stringify(filename);
    return this.view.webContents.executeJavaScript(`(() => {
      const expected=${expected};
      const visible=element=>{
        if(!element)return false;
        const style=getComputedStyle(element),rect=element.getBoundingClientRect();
        return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;
      };
      const composer=${composerExpression()};
      const activeForm=composer?.closest('form')||null;
      const fileInputs=Array.from(activeForm?.querySelectorAll('input[type="file"]')||[]);
      const selectedFileNames=fileInputs.flatMap(input=>Array.from(input.files||[]).map(file=>String(file.name||'')));
      const expectedInputFileSelected=selectedFileNames.includes(expected);
      let filenameTextVisible=false;
      const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()){
        if(!String(walker.currentNode.nodeValue||'').includes(expected))continue;
        if(visible(walker.currentNode.parentElement)){filenameTextVisible=true;break;}
      }
      const filenameAttributeVisible=Array.from(document.querySelectorAll('[aria-label],[title]'))
        .some(element=>visible(element)&&[
          element.getAttribute('aria-label'),element.getAttribute('title')
        ].some(value=>String(value||'').includes(expected)));
      const filenameVisible=filenameTextVisible||filenameAttributeVisible;
      const progressVisible=Array.from(document.querySelectorAll('progress,[role="progressbar"],[aria-busy="true"]'))
        .some(element=>visible(element));
      const uploadErrorVisible=Array.from(document.querySelectorAll('[role="alert"]'))
        .filter(visible).some(element=>/upload|anex|arquivo|file/i.test(String(element.innerText||'')));
      return {filenameVisible,filenameTextVisible,filenameAttributeVisible,progressVisible,uploadErrorVisible,
        fileInputCount:fileInputs.length,selectedFileCount:selectedFileNames.length,expectedInputFileSelected};
    })()`).catch(()=>({filenameVisible:false,filenameTextVisible:false,filenameAttributeVisible:false,
      progressVisible:false,uploadErrorVisible:false,fileInputCount:0,selectedFileCount:0,expectedInputFileSelected:false}));
  }

  async #attachContextFile(rawAttachment,onContextAttachmentObserved) {
    const attachment=validateProviderContextAttachment(rawAttachment);
    const bytes=fs.readFileSync(attachment.filePath);
    if(bytes.byteLength!==attachment.byteLength||
       createHash('sha256').update(bytes).digest('hex')!==attachment.sha256)
      throw new Error('provider_context_attachment_integrity_failed');
    const wc=this.view.webContents;
    try { if(!wc.debugger.isAttached())wc.debugger.attach('1.3'); }
    catch { if(!wc.debugger.isAttached())throw new Error('provider_context_file_input_unavailable'); }
    this.#setStage('context-attachment');
    let activeFormNodeId;
    let activeFormObjectId;
    try {
      await wc.debugger.sendCommand('DOM.enable');
      const document=await wc.debugger.sendCommand('DOM.getDocument',{depth:-1,pierce:true});
      if(!Number.isSafeInteger(document?.root?.nodeId)||document.root.nodeId<1)
        throw new Error('provider_context_file_input_unavailable');
      const activeFormResult=await wc.debugger.sendCommand('Runtime.evaluate',{
        expression:`(() => { const composer=${composerExpression()}; return composer?.closest('form')||null; })()`,
        returnByValue:false,awaitPromise:false
      });
      activeFormObjectId=activeFormResult?.result?.objectId;
      if(!activeFormObjectId||activeFormResult?.result?.subtype==='null')
        throw new Error('provider_context_file_input_unavailable');
      const requested=await wc.debugger.sendCommand('DOM.requestNode',{objectId:activeFormObjectId});
      activeFormNodeId=requested?.nodeId;
      if(!Number.isSafeInteger(activeFormNodeId)||activeFormNodeId<1)
        throw new Error('provider_context_file_input_unavailable');
    } catch { throw new Error('provider_context_file_input_unavailable'); }
    finally {
      if(activeFormObjectId)await wc.debugger.sendCommand('Runtime.releaseObject',{objectId:activeFormObjectId}).catch(()=>{});
    }
    const matches=await wc.debugger.sendCommand('DOM.querySelectorAll',{
      nodeId:activeFormNodeId,selector:'input[type="file"]'
    }).catch(()=>null);
    const nodeIds=matches?.nodeIds;
    if(!Array.isArray(nodeIds))throw new Error('provider_context_file_input_unavailable');
    const inputs=[];
    for(let index=0;index<nodeIds.length;index++){
      const described=await wc.debugger.sendCommand('DOM.describeNode',{nodeId:nodeIds[index],depth:0}).catch(()=>null);
      const attributes=described?.node?.attributes;
      if(!Array.isArray(attributes)||attributes.length%2!==0)
        throw new Error('provider_context_file_input_unavailable');
      const pairs=[];
      for(let offset=0;offset<attributes.length;offset+=2)pairs.push([attributes[offset],attributes[offset+1]]);
      const attrs=new Map(pairs);
      inputs.push({index,type:attrs.get('type')||'',ariaLabel:attrs.get('aria-label')||null,
        accept:attrs.has('accept')?attrs.get('accept'):null,multiple:attrs.has('multiple')});
    }
    const selected=selectProviderContextFileInput(inputs);
    if(!nodeIds[selected.index])
      throw new Error('provider_context_file_input_ambiguous');
    this.streamContext.contextAttachmentAttemptAt=Date.now();
    this.streamContext.contextAttachmentSha256=attachment.sha256;
    this.streamContext.contextAttachmentFilename=attachment.filename;
    this.streamContext.contextAttachmentByteLength=attachment.byteLength;
    this.streamContext.contextAttachmentState='uploading';
    try {
      await wc.debugger.sendCommand('DOM.setFileInputFiles',{files:[attachment.filePath],nodeId:nodeIds[selected.index]});
    } catch { throw new Error('provider_context_attachment_start_failed'); }
    this.streamContext.contextAttachmentSelectionConfirmed=true;
    // ChatGPT may clear or replace its file input as soon as the selected file
    // enters its upload queue. The successful CDP assignment confirms selection;
    // durable upload confirmation still requires the exact generated filename
    // to be visible and stable in the provider UI.
    let stable=0;
    const started=Date.now();
    while(Date.now()-started<45000){
      const observation=await this.#observeContextAttachment(attachment.filename);
      this.streamContext.contextAttachmentObservationCount=(this.streamContext.contextAttachmentObservationCount||0)+1;
      this.streamContext.contextAttachmentFileInputCount=observation.fileInputCount;
      this.streamContext.contextAttachmentSelectedFileCount=observation.selectedFileCount;
      this.streamContext.contextAttachmentExpectedFileSelected=observation.expectedInputFileSelected;
      this.streamContext.contextAttachmentFilenameTextVisible=observation.filenameTextVisible;
      this.streamContext.contextAttachmentFilenameAttributeVisible=observation.filenameAttributeVisible;
      this.streamContext.contextAttachmentProgressVisible=observation.progressVisible;
      this.streamContext.contextAttachmentErrorVisible=observation.uploadErrorVisible;
      if(observation.filenameVisible&&!observation.progressVisible)
        this.streamContext.contextAttachmentVisibleStableObservations=
          (this.streamContext.contextAttachmentVisibleStableObservations||0)+1;
      else this.streamContext.contextAttachmentVisibleStableObservations=0;
      if(observation.filenameVisible&&!observation.progressVisible)stable++;
      else stable=0;
      const uploadState=classifyProviderContextAttachmentObservation({
        filename:attachment.filename,selectionConfirmed:true,
        visibleFilename:observation.filenameVisible,progressVisible:observation.progressVisible,
        uploadErrorVisible:observation.uploadErrorVisible,stableObservations:stable
      });
      if(uploadState.state==='failed')throw new Error('provider_context_attachment_upload_failed');
      if(uploadState.state==='confirmed'){
        const uploadedAt=Date.now();
        const receipt={filename:attachment.filename,sha256:attachment.sha256,
          byteLength:attachment.byteLength,taskId:attachment.taskId,
          checkpointVersion:attachment.checkpointVersion,uploadedAt};
        this.streamContext.contextAttachmentState='confirmed';
        this.streamContext.contextAttachmentUploadedAt=uploadedAt;
        if(typeof onContextAttachmentObserved==='function')await onContextAttachmentObserved(receipt);
        return receipt;
      }
      await sleep(400);
    }
    throw new Error('provider_context_attachment_upload_unconfirmed');
  }

  async sendPrompt({ prompt, chatUrl = null, newSession = false, contextAttachment = null,
    onContextAttachmentObserved = null, onDeliveryObserved = null, onProvisionalProgress = null }) {
    return this.enqueue(async () => {
      const wc = this.view.webContents;
      this.lastFailureMetrics = null;
      const prepareStartedAt = Date.now();
      this.#setStage('health');
      const health = await this.health();
      const healthCompletedAt = Date.now();
      // Safety gate before preparing any draft or touching the provider UI.
      assertProviderSendReadiness(health);
      this.#setStage('prepare');
      const currentDraft = await this.#composerState(); // fail closed before any send
      const draftCheckedAt = Date.now();
      const startsFresh = Boolean(newSession || !chatUrl);
      assertProviderDraftAllowed({ newConversation: startsFresh, draftText: currentDraft.text });
      const previousSnapshot = await this.#assistantSnapshot().catch(() => ({ messages:[] }));
      for (const message of previousSnapshot.messages || []) {
        if (message?.id) this.seenAssistantMessageIds.add(String(message.id));
      }

      if (startsFresh) await this.#startNewChat();
      else if (wc.getURL() !== chatUrl) await this.#safeLoad(chatUrl, { requireComposer:true, protectDraft:true });
      else await this.#waitForComposer();
      // A persisted conversation is never allowed to overwrite a visible draft.
      if (!startsFresh) {
        const preparedComposer = await this.#composerState();
        assertProviderDraftAllowed({ newConversation: false, draftText: preparedComposer.text });
      }
      const conversationReadyAt = Date.now();

      if(contextAttachment&&!startsFresh)
        throw new Error('provider_context_attachment_requires_new_conversation');

      this.#setStage('baseline');
      this.fastNetwork.firstByteAt = null;
      this.fastNetwork.activeRequestId = null;
      this.fastNetwork.text = '';
      this.fastNetwork.requests.clear();
      await this.#ensureNetworkObserver();
      const observerReadyAt = Date.now();
      const before = await this.#assistantSnapshot();
      const beforeCount = before.messages.length;
      const beforeLast = before.messages.at(-1) || { text:'', images:[] };
      const beforeImages = new Set((before.images || beforeLast.images || []).map(image => image.src));
      const signatureFor = message => JSON.stringify({ text:String(message?.text||'').trim(), images:(message?.images||[]).map(i=>i.src).filter(Boolean) });
      const baseline = signatureFor(beforeLast);
      const baselineReadyAt = Date.now();
      const promptText = String(prompt || '').trim();
      this.streamContext = { beforeCount, baseline, promptText, beforeImageSources:new Set(beforeImages), currentAssistantMessageId:null, lastSignature:'', firstActivityAt:null, firstDeltaAt:null, firstObserver:null, fastFirstDeltaAt:null, betaFirstDeltaAt:null, submitAttemptAt:null, providerRequestSeenAt:null, submittedAt:null, networkFirstByteAt:null, fastSeen:false, betaSeen:false, fastDelivered:false, fastSuppressed:false, fastSuppressionReason:null, lastDeliveredText:'', lastDeliveredSource:null, prepareStartedAt, healthCompletedAt, draftCheckedAt, conversationReadyAt, observerReadyAt, baselineReadyAt };

      if(contextAttachment)await this.#attachContextFile(contextAttachment,onContextAttachmentObserved);
      this.#setStage('submit');
      await this.#setComposerAndSend(promptText);
      if (!this.streamContext.submittedAt) this.streamContext.submittedAt = Date.now();

      // New chats may need time to acquire a canonical permalink. Existing
      // conversations also need a receipt, but only at their expected URL.
      // One canonical recorder handles both paths after the UI submit receipt.
      const recordDelivery=createProviderDeliveryRecorder({
        startsFresh,expectedChatUrl:chatUrl,onDeliveryObserved
      });
      const retainSubmittedConversation=()=>recordDelivery({
        currentUrl:wc.getURL(),submittedAt:this.streamContext?.submittedAt
      });
      await retainSubmittedConversation();

      this.#setStage('await-response');
      const responseBudget = createResponseObservationBudget();
      let responsePromptExpansionAttempted = false;
      let responsePromptExpanded = false;
      let latest = null, latestSignature = '', stable = 0, completionConfirmed = false;
      while (responseBudget.active()) {
        await sleep(300);
        await retainSubmittedConversation();
        const snap = await this.#assistantSnapshot().catch(() => ({ mode:'unknown', messages:[], rawBody:'', images:[] }));
        const responseFailure=classifyProviderResponseFailure(snap.responseFailureSignals);
        if(responseFailure)throw new Error(responseFailure);
        if (snap.mode === 'direct' && snap.latestUserText && !providerUserMessageMatchesPrompt(
          snap.latestUserText, promptText,
          { expandControlPresent:Boolean(snap.latestUserExpandControlPresent) }
        )) {
          // ChatGPT can collapse a long user bubble again while rendering the
          // answer. Expand only when the visible text is a substantial prefix
          // of this exact submitted prompt; never click a neighboring message
          // or treat the prefix itself as proof of delivery.
          if (shouldExpandCollapsedProviderPromptForResponse({
            observed:snap.latestUserText,prompt:promptText,
            expandControlPresent:Boolean(snap.latestUserExpandControlPresent),
            alreadyAttempted:responsePromptExpansionAttempted
          })) {
            responsePromptExpansionAttempted = true;
            if (this.streamContext) this.streamContext.responsePromptExpansionAttempted = true;
            responsePromptExpanded = await this.#expandLatestUserMessageForVerification();
            if (this.streamContext) this.streamContext.responsePromptExpanded = responsePromptExpanded;
          }
          continue;
        }
        let candidate = snap.messages.at(-1) || null;
        const freshVisualImages = (snap.images || []).filter(image => image?.src && !beforeImages.has(image.src));
        if (snap.mode === 'direct' && candidate?.id) {
          const messageId = String(candidate.id);
          const stale = this.seenAssistantMessageIds.has(messageId) && messageId !== this.streamContext.currentAssistantMessageId;
          if (stale && !freshVisualImages.length) continue;
          if (stale) candidate = { text:'', images:freshVisualImages, complete:true };
          else if (!this.streamContext.currentAssistantMessageId) this.streamContext.currentAssistantMessageId = messageId;
          else if (this.streamContext.currentAssistantMessageId !== messageId && !freshVisualImages.length) continue;
        }
        if (snap.mode === 'direct' && freshVisualImages.length && candidate) candidate = { ...candidate, images:[...(candidate.images || []), ...freshVisualImages].filter((image,index,all) => all.findIndex(other => other.src === image.src) === index) };
        if (snap.mode === 'body') {
          const index = String(snap.rawBody || '').lastIndexOf(promptText);
          let scoped = index >= 0 ? String(snap.rawBody).slice(index + promptText.length) : '';
          const assistantBoundary = scoped.search(/(?:O ChatGPT disse:|ChatGPT disse:|ChatGPT said:)/i);
          if (assistantBoundary < 0) continue;
          scoped = scoped.slice(assistantBoundary);
          for (const footer of ['O ChatGPT pode cometer erros','ChatGPT é uma IA','ChatGPT can make mistakes','Pergunte ao ChatGPT','Message ChatGPT','Esta conversa está sendo útil até agora?','Has this conversation been helpful so far?']) {
            const boundary = scoped.indexOf(footer); if (boundary >= 0) scoped = scoped.slice(0,boundary);
          }
          scoped = cleanBodyCandidate(scoped.replace(/^\s*(O ChatGPT disse:|ChatGPT disse:|ChatGPT said:)\s*/i,''));
          const newImages = (snap.images || []).filter(image => !beforeImages.has(image.src));
          candidate = scoped || newImages.length ? { text:scoped, images:newImages, complete:true } : null;
        }
        if (!candidate || (!candidate.text && !candidate.images?.length)) continue;
        const signature = signatureFor(candidate);
        const isNew = snap.mode === 'body' ? signature !== baseline : (snap.messages.length > beforeCount || signature !== baseline);
        if (!isNew) continue;
        responseBudget.observe(signature);
        // A candidate is an UNVERIFIED observation, not a completed reply.
        // Never make optional local progress persistence affect delivery.
        if (candidate.text?.trim() && typeof onProvisionalProgress==='function') {
          try { onProvisionalProgress({text:candidate.text,source:snap.mode==='body'?'dom':'beta'}); }
          catch { /* A local observation cannot trigger another submission. */ }
        }
        if (signature === latestSignature) stable++; else stable = 0;
        latest = candidate; latestSignature = signature;
        const transient = /^(criando|gerando)\s+imagem/i.test(candidate.text||'') || /^(creating|generating)\s+image/i.test(candidate.text||'');
        const generating = snap.generationStopVisible === true ? true :
          snap.responseCompletionObserved === true ? false : null;
        if (responseObservationComplete({ candidate, stable, transient, generating })) {
          completionConfirmed = true;
          break;
        }
      }
      // A partial or actively generating response at timeout is NOT complete,
      // even if it contains text. Leave the Run uncertain for reconciliation.
      await retainSubmittedConversation();
      requireObservedCompletion({ candidate:latest, completed:completionConfirmed });
      this.#setStage('assets');
      const images = await this.#fetchImages(latest.images || []);
      this.lastError = null;
      if (this.streamContext?.currentAssistantMessageId) this.seenAssistantMessageIds.add(this.streamContext.currentAssistantMessageId);
      const metrics=this.streamContext?{
        prepareStartedAt:this.streamContext.prepareStartedAt,
        healthCompletedAt:this.streamContext.healthCompletedAt,
        draftCheckedAt:this.streamContext.draftCheckedAt,
        conversationReadyAt:this.streamContext.conversationReadyAt,
        observerReadyAt:this.streamContext.observerReadyAt,
        baselineReadyAt:this.streamContext.baselineReadyAt,
        submitAttemptAt:this.streamContext.submitAttemptAt,
        providerRequestSeenAt:this.streamContext.providerRequestSeenAt,
        submittedAt:this.streamContext.submittedAt,
        firstActivityAt:this.streamContext.firstActivityAt,
        firstDeltaAt:this.streamContext.firstDeltaAt,
        fastFirstDeltaAt:this.streamContext.fastFirstDeltaAt,
        betaFirstDeltaAt:this.streamContext.betaFirstDeltaAt,
        networkFirstByteAt:this.streamContext.networkFirstByteAt,
        completedAt:Date.now(),providerDeliveryState:'submitted',
        contextAttachmentState:this.streamContext.contextAttachmentState||null,
        contextAttachmentSha256:this.streamContext.contextAttachmentSha256||null,
        contextAttachmentFilename:this.streamContext.contextAttachmentFilename||null,
        contextAttachmentByteLength:this.streamContext.contextAttachmentByteLength||null,
        contextAttachmentUploadedAt:this.streamContext.contextAttachmentUploadedAt||null,
        contextAttachmentSelectionConfirmed:Boolean(this.streamContext.contextAttachmentSelectionConfirmed),
        contextAttachmentObservationCount:this.streamContext.contextAttachmentObservationCount||0,
        contextAttachmentFileInputCount:this.streamContext.contextAttachmentFileInputCount||0,
        contextAttachmentSelectedFileCount:this.streamContext.contextAttachmentSelectedFileCount||0,
        contextAttachmentExpectedFileSelected:Boolean(this.streamContext.contextAttachmentExpectedFileSelected),
        contextAttachmentFilenameTextVisible:Boolean(this.streamContext.contextAttachmentFilenameTextVisible),
        contextAttachmentFilenameAttributeVisible:Boolean(this.streamContext.contextAttachmentFilenameAttributeVisible),
        contextAttachmentProgressVisible:Boolean(this.streamContext.contextAttachmentProgressVisible),
        contextAttachmentErrorVisible:Boolean(this.streamContext.contextAttachmentErrorVisible),
        contextAttachmentVisibleStableObservations:this.streamContext.contextAttachmentVisibleStableObservations||0,
        observerUsed:this.streamContext.firstObserver||(this.streamContext.fastDelivered?'fast':'beta'),
        firstObserver:this.streamContext.firstObserver||null,
        fastSeen:Boolean(this.streamContext.fastSeen),betaSeen:Boolean(this.streamContext.betaSeen),
        fastDelivered:Boolean(this.streamContext.fastDelivered),
        fastSuppressed:Boolean(this.streamContext.fastSuppressed),
        fastSuppressionReason:this.streamContext.fastSuppressionReason||null,
        responsePromptExpansionAttempted,responsePromptExpanded
      }:null;
      this.streamContext = null;
      this.#setStage('idle');
      return { text:String(latest.text||'').trim(), images, chatUrl:wc.getURL(), observedAt:new Date().toISOString(), metrics };
    }).catch(error => {
      const stage = this.stage || 'unknown';
      const ctx = this.streamContext;
      // Persist timings on failed runs too: successful-only metrics mask
      // the long waits the user actually experiences.
      this.lastFailureMetrics = ctx ? {
        prepareStartedAt:ctx.prepareStartedAt,
        healthCompletedAt:ctx.healthCompletedAt,
        draftCheckedAt:ctx.draftCheckedAt,
        conversationReadyAt:ctx.conversationReadyAt,
        observerReadyAt:ctx.observerReadyAt,
        baselineReadyAt:ctx.baselineReadyAt,
        submitAttemptAt:ctx.submitAttemptAt,
        providerRequestSeenAt:ctx.providerRequestSeenAt,
        submittedAt:ctx.submittedAt,
        firstDeltaAt:ctx.firstDeltaAt,
        completedAt:Date.now(),
        failedStage:stage,
        responsePromptExpansionAttempted:Boolean(ctx.responsePromptExpansionAttempted),
        responsePromptExpanded:Boolean(ctx.responsePromptExpanded),
        providerDeliveryState:ctx.submittedAt?'submitted':ctx.submitAttemptAt||ctx.contextAttachmentAttemptAt?'uncertain':'not_submitted',
        contextAttachmentState:ctx.contextAttachmentState||null,
        contextAttachmentSha256:ctx.contextAttachmentSha256||null,
        contextAttachmentFilename:ctx.contextAttachmentFilename||null,
        contextAttachmentByteLength:ctx.contextAttachmentByteLength||null,
        contextAttachmentUploadedAt:ctx.contextAttachmentUploadedAt||null,
        contextAttachmentSelectionConfirmed:Boolean(ctx.contextAttachmentSelectionConfirmed),
        contextAttachmentObservationCount:ctx.contextAttachmentObservationCount||0,
        contextAttachmentFileInputCount:ctx.contextAttachmentFileInputCount||0,
        contextAttachmentSelectedFileCount:ctx.contextAttachmentSelectedFileCount||0,
        contextAttachmentExpectedFileSelected:Boolean(ctx.contextAttachmentExpectedFileSelected),
        contextAttachmentFilenameTextVisible:Boolean(ctx.contextAttachmentFilenameTextVisible),
        contextAttachmentFilenameAttributeVisible:Boolean(ctx.contextAttachmentFilenameAttributeVisible),
        contextAttachmentProgressVisible:Boolean(ctx.contextAttachmentProgressVisible),
        contextAttachmentErrorVisible:Boolean(ctx.contextAttachmentErrorVisible),
        contextAttachmentVisibleStableObservations:ctx.contextAttachmentVisibleStableObservations||0
      } : { prepareStartedAt:Date.now(), completedAt:Date.now(), failedStage:stage, providerDeliveryState:'not_submitted' };
      this.streamContext = null;
      this.#setStage('idle');
      const failure=normalizeProviderFailure(error,{
        stage,submitAttemptAt:ctx?.submitAttemptAt||null,
        submissionConfirmedAt:ctx?.submittedAt??null
      });
      this.lastError = failure.message;
      throw failure;
    });
  }
}
