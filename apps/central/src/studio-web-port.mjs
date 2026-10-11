// Experimental Central -> existing Studio ChatGPT Web host port.
//
// This does NOT establish Product/OAuth authorization, select MCP targets,
// manage browser cookies or expose a public endpoint. Product-fresh mode can
// create one native Web chat but cannot mint plugin session authorization.
// The trusted Platform host must supply both independent assertions:
// (1) bindChat resolves a previously authorized PC + durable conversation.
// (2) authorizeTools confirms that the linked connector is server-restricted to
//     the SAME PC/subject/client. Visible @ORDAX selection alone is not proof.
// The existing Studio WebBridge remains the only owner of Web transport and
// delivery state. No queue, replays or silent provider/API substitution.
import {formatCentralWebTurn,CENTRAL_TURN_SCHEMA} from './turn-context.mjs';

// Schema validation is deliberately separate from Product authorization.
const isUuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const validDevice=(v,environment)=>typeof v==='string'&&(environment==='product'
  ?isUuid(v):environment==='loopback-laboratory'&&/^[a-z][a-z0-9-]{1,62}$/.test(v));
const validChat=v=>typeof v==='string'&&isUuid(v);
const validWeb=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(v);
export const CENTRAL_STUDIO_WEB_PORT='ordax.central-studio-web-port/1';

export class CentralWebPortError extends Error {
  constructor(code) {super(code);this.code=code;}
}

/**
 * @param {object} input
 * @param {object} input.host native Studio WebBridge with state(),
 *                          selectChat(), refresh() and respond(data, emit, signal)
 * @param {(turn:object)=>Promise<object>} input.bindChat trusted Platform
 *             resolver; must NOT use request/prompt/UI IDs as authorization.
 * @param {(binding:object,turn:object)=>Promise<boolean>} input.authorizeTools
 *             trusted Product proof of per-PC MCP scope. No implicit fallback.
 * @param {(binding:object,observation:object)=>Promise<boolean>} input.confirmChat
 *             trusted Product persistence check for a NEW conversation URL;
 *             never called before delivery is observed and never used as a grant.
 */
export function createCentralStudioWebPort({host,bindChat,authorizeTools,confirmChat}={}) {
  if(typeof host?.state!=='function'||typeof host?.selectChat!=='function'
    ||typeof host?.refresh!=='function'||typeof host?.respond!=='function'||typeof bindChat!=='function'
    ||typeof authorizeTools!=='function')
    throw new TypeError('central_web_port_dependencies_missing');
  let busy=false;
  const requireBinding=(turn,b)=>{
    const fresh=b?.mode==='fresh';
    if(!b||typeof b!=='object'||Array.isArray(b)
      ||b.deviceId!==turn.routing.device_id
      ||b.requestId!==turn.request_id
      ||!validDevice(b.deviceId,turn.routing.environment)||!isUuid(b.requestId)
      ||(fresh
        ? turn.routing.environment!=='product'||b.chatId!==undefined
          ||b.webId!==undefined||typeof host.createChat!=='function'
          ||typeof confirmChat!=='function'
        : !validChat(b.chatId)||!validWeb(b.webId))
      ||(b.mode!==undefined&&!fresh)
      ||!isUuid(b.subjectId)||typeof b.clientId!=='string'
      ||b.clientId.length<8||b.clientId.length>160
      ||typeof b.spaceId!=='string'||!isUuid(b.spaceId)
      ||(turn.routing.environment==='product'&&!isUuid(b.projectId)))
      throw new CentralWebPortError('central_web_binding_missing');
    return b;
  };
  const checkState=(state,binding)=>{
    const chat=state?.chats?.find(c=>c.id===binding.chatId);
    if(state?.activeId!==binding.chatId||chat?.webId!==binding.webId
      ||state?.web?.ready!==true||state?.web?.busy!==false
      ||state?.web?.conversationMode!=='chat'
      ||state?.web?.automatedSendAllowed!==true
      ||state?.web?.ordaxSelected!==true
      ||['prepared','submitted','accepted','uncertain'].includes(chat?.delivery?.status))
      throw new CentralWebPortError('central_web_not_ready');
    return chat;
  };
  return Object.freeze({
    schema:CENTRAL_STUDIO_WEB_PORT,
    // A single visible Studio Web surface can operate on only one chat at a
    // time. Reject concurrency rather than creating a second model queue.
    async dispatch(turn) {
      if(busy)throw new CentralWebPortError('central_web_port_busy');
      busy=true;
      let sending=false;
      try{
        if(!turn||turn.schema!==CENTRAL_TURN_SCHEMA)
          throw new CentralWebPortError('central_web_turn_invalid');
        const prompt=formatCentralWebTurn(turn);
        // The first resolver may look up routing, but is not enough to prove
        // MCP isolation. Verify the exact authorized binding before touching
        // the Studio host, including before selecting a ChatGPT conversation.
        const binding=requireBinding(turn,await bindChat(turn));
        if((await authorizeTools(binding,turn))!==true)
          throw new CentralWebPortError('central_web_plugin_scope_unverified');
        let current=await host.state();
        if(current?.web?.busy===true)
          throw new CentralWebPortError('central_web_port_busy');
        const fresh=binding.mode==='fresh';
        const priorChats=new Set((current?.chats||[]).map(c=>c.id));
        const priorWebIds=new Set((current?.chats||[]).map(c=>c.webId).filter(Boolean));
        let selected=binding;
        if(fresh){
          // Authorize first, then create exactly ONE native Studio conversation.
          // A previously used Web URL cannot be recycled for a new request.
          const chat=await host.createChat({projectId:null});
          if(!validChat(chat?.id)||priorChats.has(chat.id)
            ||chat.webId!==null||!Array.isArray(chat.messages)
            ||chat.messages.length!==0)
            throw new CentralWebPortError('central_web_not_ready');
          selected={...binding,chatId:chat.id,webId:null};
          await host.refresh();
          current=await host.state();
          if(current?.web?.url!=='https://chatgpt.com/')
            throw new CentralWebPortError('central_web_not_ready');
        }else if(current?.activeId!==binding.chatId){
          await host.selectChat(binding.chatId);
          // Native WebBridge.selectChat clears its page observation after
          // navigation. Read the new page before checking chat readiness.
          await host.refresh();
          current=await host.state();
        }
        const previous=checkState(current,selected);
        const oldAssistantIds=new Set((previous.messages||[])
          .filter(m=>m.role==='assistant').map(m=>m.id));
        const oldUserIds=new Set((previous.messages||[])
          .filter(m=>m.role==='user').map(m=>m.id));
        sending=true;
        let completion=null, invalidEvent=false;
        // WebBridge.respond(data, emit, AbortSignal) returns a Promise.
        // It does NOT return an AsyncIterable. Consume the real native
        // callback directly; no shadow event queue or second chat transport.
        await host.respond({
          chatId:selected.chatId,model:'chatgpt-web',
          retry:false,message:{text:prompt,attachments:[]}
        },event=>{
          if(event?.type==='error') invalidEvent=true;
          if(event?.type==='done'){
            if(completion||event.chat?.id!==selected.chatId
              ||(fresh
                ? !validWeb(event.chat?.webId)
                  ||priorWebIds.has(event.chat.webId)
                : event.chat?.webId!==selected.webId)
              ||event.chat?.delivery?.status!=='completed'){
              invalidEvent=true;return;
            }
            // Capture the observation at done, not a mutable live chat ref.
            completion={
              webId:event.chat.webId,
              delivery:{...event.chat.delivery},
              messages:(event.chat.messages||[]).map(m=>({
                id:m.id,role:m.role,status:m.status,text:m.text,
              })),
            };
          }
        },new AbortController().signal);
        if(invalidEvent||!completion)
          throw new CentralWebPortError('central_web_delivery_uncertain');
        // Native WebBridge already checks the exact user turn before done.
        // Recheck here: a prior response or a foreign chat's observed reply
        // must never be attached to this Central request.
        const users=completion.messages.filter(m=>m.role==='user'
          &&!oldUserIds.has(m.id));
        const normalize=text=>text.replace(/\s+/g,' ').trim();
        if(users.length!==1||users[0].id!==completion.delivery.userId
          ||typeof users[0].text!=='string'
          ||normalize(users[0].text)!==normalize(prompt))
          throw new CentralWebPortError('central_web_delivery_uncertain');
        const answers=completion.messages.filter(m=>
          m.role==='assistant'&&!oldAssistantIds.has(m.id)
          &&m.status==='completed'&&typeof m.text==='string'
          &&m.text.trim());
        if(answers.length!==1||answers[0].text.length>4096)
          throw new CentralWebPortError('central_web_delivery_uncertain');
        if(fresh){
          // Only observed completed delivery can identify a newly created
          // Web URL. This callback MUST check/persist the original Product
          // request and scope; its boolean is not tool authorization.
          if((await confirmChat(binding,Object.freeze({
            deviceId:binding.deviceId,requestId:binding.requestId,
            chatId:selected.chatId,webId:completion.webId,
          })))!==true)
            throw new CentralWebPortError('central_web_delivery_uncertain');
        }
        return Object.freeze({
          deviceId:binding.deviceId,
          requestId:binding.requestId,
          result:answers[0].text,
          source:'chatgpt-web-observed',
        });
      }catch(error){
        if(sending)throw new CentralWebPortError('central_web_delivery_uncertain');
        if(error instanceof CentralWebPortError)throw error;
        throw new CentralWebPortError('central_web_unavailable');
      }finally{busy=false;}
    },
  });
}
