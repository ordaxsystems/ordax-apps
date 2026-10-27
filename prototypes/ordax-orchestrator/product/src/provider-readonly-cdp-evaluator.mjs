// Single canonical read-only evaluator for Electron health and W3 DOM.
// Preserve Runtime-owned debugger sessions and never issue retries.
import {observeWithin} from './provider-observation-policy.mjs';

// Electron exposes one Debugger session per WebContents. Health polling, W3
// recovery and diagnostics all use it; concurrent evaluators must not let one
// caller detach a session while another command is still in flight.
const debuggerTails=new WeakMap();

function serializeDebugger(debuggerApi,operation) {
  const previous=debuggerTails.get(debuggerApi)||Promise.resolve();
  const current=previous.then(operation,operation);
  debuggerTails.set(debuggerApi,current.then(()=>undefined,()=>undefined));
  return current;
}

export async function evaluateProviderReadOnlyDom({
  debugger:devtools,expression,timeoutMs,timeoutCode
}={}) {
  if(!devtools||typeof expression!=='string'||!expression.length||
     typeof timeoutCode!=='string'||!/^provider_[a-z0-9_]+$/.test(timeoutCode))
    throw new Error('provider_readonly_observation_invalid');
  return serializeDebugger(devtools,async()=>{
  let attachedHere=false;
  try {
    if(!devtools.isAttached()) {
      devtools.attach('1.3');
      attachedHere=true;
    }
  } catch {
    throw new Error('provider_readonly_debugger_unavailable');
  }
  try {
    const result=await observeWithin(()=>devtools.sendCommand('Runtime.evaluate',{
      expression,awaitPromise:false,returnByValue:true
    }),{timeoutMs,code:timeoutCode});
    if(result?.exceptionDetails || !result?.result ||
       !Object.hasOwn(result.result,'value'))
      throw new Error('provider_readonly_dom_evaluation_rejected');
    return result.result.value;
  } catch(error) {
    // No raw provider exceptions, URL, account data or prompt contents leak.
    if(error?.message===timeoutCode)throw new Error(timeoutCode);
    throw new Error('provider_readonly_dom_evaluation_rejected');
  } finally {
    if(attachedHere) {
      try {if(devtools.isAttached())devtools.detach();}
      catch { /* do not detach another observer */ }
    }
  }
  });
}
