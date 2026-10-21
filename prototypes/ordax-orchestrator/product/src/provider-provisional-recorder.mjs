// A single bounded SQLite sink, not a second conversation archive.
// Never calls the provider or treats partial output as completed.
export function createProviderProvisionalRecorder({
  save, now=Date.now, intervalMs=2000
}={}) {
  if(typeof save!=='function'||typeof now!=='function'||
    !Number.isSafeInteger(intervalMs)||intervalMs<1000||intervalMs>10000)
    throw new Error('invalid_provisional_recorder');
  let pending=null, lastWritten=null, lastWrittenAt=-Infinity, failures=0;
  function flush() {
    if(!pending || pending.text===lastWritten)return false;
    try {
      const saved=save(pending.text,pending.source);
      if(saved!==false) lastWritten=pending.text;
      else if(pending.text.length<=Number(lastWritten?.length||0))lastWritten=pending.text;
      lastWrittenAt=now();
      return saved!==false;
    }catch {
      // The transport has already begun. A failed local snapshot must
      // NEVER cancel the provider response or trigger a duplicate send.
      failures++;
      lastWrittenAt=now();
      return false;
    }
  }
  return {
    capture(text,source='beta') {
      if(typeof text!=='string'||!text.trim()||text.length>262144||
        !['beta','dom'].includes(source))return false;
      if(pending && text.length<pending.text.length)return false;
      if(pending?.text===text)return false;
      pending={text,source};
      if(now()-lastWrittenAt>=intervalMs)return flush();
      return false;
    },
    flush,
    get failures(){return failures;}
  };
}
