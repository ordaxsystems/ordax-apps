'use strict';
function createAudioPermission({ contents, confirm, now = Date.now }) {
  let until = 0, accepted = false, request, epoch = 0;
  const origin = value => { try { return new URL(value).origin === 'https://chatgpt.com'; } catch { return false; } };
  function valid(sender, permission, url, details = {}) {
    return sender === contents && !contents.isDestroyed() && permission === 'media' && origin(url) && origin(contents.getURL()) && details.isMainFrame === true;
  }
  const armed = () => accepted || now() < until;
  return {
    arm() { epoch++; until = now() + 30000; accepted = false; },
    revoke() { epoch++; until = 0; accepted = false; },
    check(sender, permission, url, details) { return valid(sender, permission, url, details) && accepted && armed() && details?.mediaType === 'audio'; },
    request(sender, permission, callback, details = {}) {
      const types = details.mediaTypes;
      if (!valid(sender, permission, details.securityOrigin || details.requestingUrl, details) || !armed() || !Array.isArray(types) || types.length !== 1 || types[0] !== 'audio') { callback(false); return; }
      if (accepted) { callback(true); return; }
      const ticket = epoch;
      if (!request) request = Promise.resolve().then(confirm).then(value => { accepted = value === true && ticket === epoch && armed() && origin(contents.getURL()); return accepted; }).catch(() => false).finally(() => { request = null; });
      request.then(value => callback(value));
    },
  };
}
module.exports = { createAudioPermission };
