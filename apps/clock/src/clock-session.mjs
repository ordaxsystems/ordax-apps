/**
 * Foreground-only Clock session. State belongs to the mounted app, not the DOM.
 * No background alarm/notification/scheduling authority is created here.
 */
const INITIAL_TIMER_MS = 60_000;
const MAX_TIMER_MS = (999 * 60 + 59) * 1_000;

function validDuration(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMER_MS) {
    throw new RangeError("Timer duration must be an allowed nonnegative integer in milliseconds");
  }
  return value;
}

export function formatStopwatch(ms) {
  const elapsed = Math.max(0, ms);
  const minutes = Math.floor(elapsed / 60_000);
  const seconds = Math.floor((elapsed % 60_000) / 1_000);
  const tenths = Math.floor((elapsed % 1_000) / 100);
  return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0") + "." + tenths;
}

export function formatTimer(ms) {
  const total = Math.max(0, Math.ceil(ms / 1_000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
}

export function createClockSession({ now = () => performance.now() } = {}) {
  if (typeof now !== "function") throw new TypeError("A monotonic clock function is required");

  let stopwatchRunning = false;
  let stopwatchElapsedMs = 0;
  let stopwatchStartedAt = 0;
  let timerRunning = false;
  let timerConfiguredMs = INITIAL_TIMER_MS;
  let timerRemainingMs = INITIAL_TIMER_MS;
  let timerStartedAt = 0;
  let timerFinished = false;

  function timestamp() {
    const current = now();
    if (typeof current !== "number" || !Number.isFinite(current)) {
      throw new TypeError("Monotonic time must be finite");
    }
    return current;
  }

  function currentTimerMs(at) {
    if (!timerRunning) return timerRemainingMs;
    return Math.max(0, timerRemainingMs - Math.max(0, at - timerStartedAt));
  }

  function snapshot() {
    const at = timestamp();
    const remaining = currentTimerMs(at);
    if (timerRunning && remaining === 0) {
      timerRunning = false;
      timerRemainingMs = 0;
      timerFinished = true;
    }
    return Object.freeze({
      stopwatchRunning,
      stopwatchElapsedMs: stopwatchElapsedMs + (stopwatchRunning ? Math.max(0, at - stopwatchStartedAt) : 0),
      timerRunning,
      timerRemainingMs: remaining,
      timerConfiguredMs,
      timerFinished,
    });
  }

  return Object.freeze({
    snapshot,
    toggleStopwatch() {
      const at = timestamp();
      if (stopwatchRunning) {
        stopwatchElapsedMs += Math.max(0, at - stopwatchStartedAt);
        stopwatchRunning = false;
      } else {
        stopwatchStartedAt = at;
        stopwatchRunning = true;
      }
      return snapshot();
    },
    resetStopwatch() {
      stopwatchElapsedMs = 0;
      stopwatchStartedAt = timestamp();
      return snapshot();
    },
    setTimerDuration(milliseconds) {
      validDuration(milliseconds);
      if (!timerRunning) {
        timerConfiguredMs = milliseconds;
        timerRemainingMs = milliseconds;
        timerFinished = false;
      }
      return snapshot();
    },
    resetTimer() {
      timerRemainingMs = timerConfiguredMs;
      timerStartedAt = timestamp();
      timerRunning = false;
      timerFinished = false;
      return snapshot();
    },
    toggleTimer() {
      const at = timestamp();
      const remaining = currentTimerMs(at);
      if (timerRunning) {
        timerRunning = false;
        timerRemainingMs = remaining;
        timerFinished = remaining === 0;
      } else {
        timerRemainingMs = remaining || timerConfiguredMs;
        if (timerRemainingMs > 0) {
          timerStartedAt = at;
          timerRunning = true;
          timerFinished = false;
        }
      }
      return snapshot();
    },
  });
}
