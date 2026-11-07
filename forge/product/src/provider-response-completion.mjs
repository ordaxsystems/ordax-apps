// Pure observation policy. The browser's DOM signals are heuristic, not a
// receipt of a filesystem effect. Unknown generating state must fail closed.
// Long code replies can stream for more than three minutes. Fresh observed
// content extends the idle budget, never the absolute bound or completion gate.
export function createResponseObservationBudget({now=()=>performance.now()}={}) {
  const started=now();
  let lastProgress=started,signature=null;
  const active=()=>{
    const current=now();
    return Number.isFinite(started)&&Number.isFinite(current)&&
      current>=lastProgress&&current-started<900000&&current-lastProgress<180000;
  };
  return Object.freeze({
    observe(nextSignature) {
      if(active()&&typeof nextSignature==='string'&&nextSignature&&nextSignature!==signature) {
        lastProgress=now();signature=nextSignature;
      }
    },
    active
  });
}

export function responseObservationComplete({ candidate, stable, transient, generating }) {
  if (!candidate || (!candidate.text && !candidate.images?.length)) return false;
  if (transient || generating !== false || candidate.complete !== true) return false;
  return stable >= 2;
}

export function requireObservedCompletion({ candidate, completed }) {
  if (!candidate || (!candidate.text && !candidate.images?.length)) throw new Error('response_not_observed');
  if (candidate.complete !== true || completed !== true) throw new Error('response_completion_unconfirmed');
}
