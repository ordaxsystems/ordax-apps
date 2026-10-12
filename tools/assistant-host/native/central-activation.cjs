'use strict';

// Only a presentation signal. It cannot create a session, device grant or job.
function createCentralActivation(present) {
  if (typeof present !== 'function') throw new TypeError('present must be a function');
  let ready = false;
  let pending = false;
  return Object.freeze({
    request() {
      if (!ready) { pending = true; return; }
      present();
    },
    markReady() {
      if (ready) return;
      ready = true;
      if (pending) { pending = false; present(); }
    },
  });
}

module.exports = { createCentralActivation };
