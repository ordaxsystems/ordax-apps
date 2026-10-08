import assert from "node:assert/strict";
import test from "node:test";
import { createClockSession, formatStopwatch, formatTimer } from "../src/clock-session.mjs";

function clockFixture() {
  let elapsed = 0;
  const session = createClockSession({now: () => elapsed});
  return { session, advance(milliseconds) { elapsed += milliseconds; } };
}

test("stopwatch preserves elapsed time when a foreground view is rebuilt", () => {
  const {session, advance} = clockFixture();
  assert.equal(formatStopwatch(session.snapshot().stopwatchElapsedMs), "00:00.0");
  session.toggleStopwatch();
  advance(2_450);
  const beforeLocaleChange = session.snapshot();
  assert.equal(beforeLocaleChange.stopwatchRunning, true);
  assert.equal(formatStopwatch(beforeLocaleChange.stopwatchElapsedMs), "00:02.4");
  // The view can be destroyed/recreated, while the app-owned session stays alive.
  const newView = session.snapshot();
  assert.equal(newView.stopwatchElapsedMs, beforeLocaleChange.stopwatchElapsedMs);
  advance(550);
  assert.equal(formatStopwatch(session.snapshot().stopwatchElapsedMs), "00:03.0");
  session.toggleStopwatch();
  advance(8_000);
  assert.equal(session.snapshot().stopwatchElapsedMs, 3_000);
  session.toggleStopwatch();
  advance(1_500);
  assert.equal(session.snapshot().stopwatchElapsedMs, 4_500);
  session.resetStopwatch();
  assert.equal(session.snapshot().stopwatchElapsedMs, 0);
  assert.equal(session.snapshot().stopwatchRunning, true);
});

test("foreground timer remains armed and running across view rebuild, pause and resume", () => {
  const {session, advance} = clockFixture();
  session.setTimerDuration(90_000);
  assert.equal(session.snapshot().timerConfiguredMs, 90_000);
  session.toggleTimer();
  advance(21_500);
  const beforeLocaleChange = session.snapshot();
  assert.equal(beforeLocaleChange.timerRemainingMs, 68_500);
  assert.equal(beforeLocaleChange.timerRunning, true);
  const afterLocaleChange = session.snapshot();
  assert.equal(afterLocaleChange.timerRemainingMs, 68_500);
  assert.equal(afterLocaleChange.timerConfiguredMs, 90_000);
  assert.equal(formatTimer(afterLocaleChange.timerRemainingMs), "01:09");
  session.toggleTimer();
  advance(50_000);
  assert.equal(session.snapshot().timerRemainingMs, 68_500);
  session.toggleTimer();
  advance(68_500);
  const finished = session.snapshot();
  assert.equal(finished.timerRemainingMs, 0);
  assert.equal(finished.timerRunning, false);
  assert.equal(finished.timerFinished, true);
  session.toggleTimer();
  assert.equal(session.snapshot().timerRemainingMs, 90_000);
  assert.equal(session.snapshot().timerFinished, false);
  session.resetTimer();
  assert.equal(session.snapshot().timerRemainingMs, 90_000);
  assert.equal(session.snapshot().timerRunning, false);
});

test("timer duration changes only while stopped and never restarts unexpectedly", () => {
  const {session, advance} = clockFixture();
  session.setTimerDuration(12_000);
  session.toggleTimer();
  advance(2_000);
  session.setTimerDuration(40_000);
  assert.equal(session.snapshot().timerConfiguredMs, 12_000);
  assert.equal(session.snapshot().timerRemainingMs, 10_000);
  session.toggleTimer();
  session.setTimerDuration(40_000);
  assert.equal(session.snapshot().timerRemainingMs, 40_000);
  assert.equal(session.snapshot().timerConfiguredMs, 40_000);
  session.setTimerDuration(0);
  session.toggleTimer();
  assert.equal(session.snapshot().timerRunning, false);
  assert.equal(session.snapshot().timerRemainingMs, 0);
});

test("duration guards reject invalid values and do not mutate prior session state", () => {
  const {session} = clockFixture();
  const previous = session.snapshot();
  for (const duration of [-1, NaN, Infinity, 1.2, 60_000_000, "100"]) {
    assert.throws(() => session.setTimerDuration(duration), RangeError);
  }
  assert.deepEqual(session.snapshot(), previous);
  assert.throws(() => createClockSession({now: null}), TypeError);
});

test("monotonic clock validation fails closed", () => {
  const session = createClockSession({now: () => Infinity});
  assert.throws(() => session.snapshot(), TypeError);
  assert.equal(formatStopwatch(-100), "00:00.0");
  assert.equal(formatTimer(-100), "00:00");
});
