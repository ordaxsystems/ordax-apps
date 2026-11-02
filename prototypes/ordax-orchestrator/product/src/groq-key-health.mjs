const GROQ_MODELS_ENDPOINT='https://api.groq.com/openai/v1/models';

// A credential check must not generate a completion or return provider bodies.
// GET /models validates access without sending project data or consuming model tokens.
export async function testGroqApiKey({apiKey,fetchImpl=globalThis.fetch,timeoutMs=8000}={}) {
  if(typeof apiKey!=='string'||!apiKey.trim())return {ok:false,code:'api_key_missing'};
  if(typeof fetchImpl!=='function')return {ok:false,code:'network_unavailable'};
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.max(1000,Math.min(15000,Number(timeoutMs)||8000)));
  try {
    const response=await fetchImpl(GROQ_MODELS_ENDPOINT,{
      method:'GET',headers:{authorization:`Bearer ${apiKey.trim()}`,accept:'application/json'},
      signal:controller.signal,redirect:'error'
    });
    if(response?.ok===true)return {ok:true,code:'connected'};
    if(response?.status===401||response?.status===403)return {ok:false,code:'invalid_api_key'};
    if(response?.status===429)return {ok:false,code:'rate_limited'};
    return {ok:false,code:'provider_unavailable'};
  } catch(error) {
    return {ok:false,code:controller.signal.aborted?'request_timeout':'network_unavailable'};
  } finally {clearTimeout(timer);}
}
