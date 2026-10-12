'use strict';

// Product authentication belongs to the installed Runtime. This helper only
// guards the Electron main-process IPC boundary; it never holds credentials or
// supplies a second identity provider.
function createExclusiveSignIn() {
  let pending = false;
  return Object.freeze({
    isPending: () => pending,
    async run(action) {
      if (pending) throw Object.assign(
        new Error('Aguarde a autenticação ORDAX em andamento.'), { status: 409 },
      );
      if (typeof action !== 'function') throw new TypeError('Missing Product sign-in action');
      pending = true; // Synchronous before the first await: no double login.
      try {
        return await action();
      } finally {
        pending = false; // An unsuccessful attempt can be explicitly retried.
      }
    },
  });
}

module.exports = { createExclusiveSignIn };
