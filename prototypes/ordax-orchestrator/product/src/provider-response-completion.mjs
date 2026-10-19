// Pure observation policy. The browser's DOM signals are heuristic, not a
// receipt of a filesystem effect. Unknown generating state must fail closed.
export function responseObservationComplete({ candidate, stable, transient, generating }) {
  if (!candidate || (!candidate.text && !candidate.images?.length)) return false;
  if (transient || generating !== false) return false;
  return (candidate.complete === true && stable >= 2) || stable >= 4;
}

export function requireObservedCompletion({ candidate, completed }) {
  if (!candidate) throw new Error('response_not_observed');
  if (completed !== true) throw new Error('response_completion_unconfirmed');
}
