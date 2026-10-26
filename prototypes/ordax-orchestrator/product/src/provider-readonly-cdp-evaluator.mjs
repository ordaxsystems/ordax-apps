// Single canonical read-only evaluator for Electron health and W3 DOM.
// Preserve Runtime-owned debugger sessions and never issue retries.
import {observeWithin} from './provider-observation-policy.mjs';

export async function evaluateProviderReadOnlyDom({
  debugger:devtools,expression,timeoutMs,timeoutCode
}={}) {
  if(!devtools||typeof expression!=='string'||!expression.length||
     typeof timeoutCode!=='string'||!/^provider_[a-z0-9_]+$/.test(timeoutCode))
    throw new Error('provider_readonly_observation_invalid');
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
}
