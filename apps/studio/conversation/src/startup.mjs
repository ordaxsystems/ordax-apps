// Failed bootstrap never grants readiness. Explicit retries initialize the
// existing host rather than creating a second session or a parallel app state.
export function createStartup({ load, changed }) {
  let pending = null, ready = false;
  return Object.freeze({
    start() {
      if (pending) return pending;
      if (ready) return Promise.resolve();
      changed({ state: 'loading' });
      pending = Promise.resolve().then(load).then(() => {
        ready = true;
        changed({ state: 'ready' });
      }, error => {
        changed({ state: 'unavailable', message: error?.message || 'Não foi possível conectar ao host do Studio.' });
      }).finally(() => { pending = null; });
      return pending;
    },
  });
}
