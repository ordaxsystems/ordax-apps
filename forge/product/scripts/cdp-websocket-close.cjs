const OPEN=1;
const CLOSING=2;
const CLOSED=3;

function closeCdpWebSocket(socket,{timeoutMs=3000}={}) {
  if(!socket||typeof socket.addEventListener!=='function'||typeof socket.removeEventListener!=='function')
    return Promise.reject(Error('cdp_websocket_close_unavailable'));
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)
    return Promise.reject(Error('cdp_websocket_close_timeout_invalid'));
  if(socket.readyState===CLOSED)return Promise.resolve();
  if(socket.readyState!==OPEN&&socket.readyState!==CLOSING)
    return Promise.reject(Error('cdp_websocket_close_invalid_state'));

  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error)=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      socket.removeEventListener('close',onClose);
      if(error)reject(error);
      else resolve();
    };
    const onClose=()=>finish();
    const timer=setTimeout(()=>finish(Error('cdp_websocket_close_timeout')),timeoutMs);
    try {
      socket.addEventListener('close',onClose,{once:true});
      if(socket.readyState===OPEN) {
        try{socket.close();}
        catch{
          // A peer close can arrive between the last CDP reply and close().
          // Wait for the actual close event; a socket that stays open times out.
        }
      }
      if(socket.readyState===CLOSED)finish();
    } catch {
      finish(Error('cdp_websocket_close_failed'));
    }
  });
}

module.exports={closeCdpWebSocket};
