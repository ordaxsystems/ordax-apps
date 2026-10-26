// SSOT: bound explicit W3 historical DOM inspection and transactional import.
// A larger response is permitted only after exact prompt digest, conversation,
// completion, receipt and final UI confirmation; never infer delivery.
export const W3_MAX_USER_CHARS=12000;
export const W3_MAX_ASSISTANT_CHARS=100000;

// The outer hydration gate must not expire before its own canonical CDP read.
// Both clocks are bounded; a timeout remains UNKNOWN and is never retried.
export const W3_CDP_READ_TIMEOUT_MS=6000;
export const W3_OBSERVER_READ_TIMEOUT_MS=7000;
