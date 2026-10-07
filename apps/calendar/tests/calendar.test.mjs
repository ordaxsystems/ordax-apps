import assert from"node:assert/strict";import test from"node:test";import{monthMatrix,shiftMonth}from"../src/calendar.mjs";
test("builds leap-month grid",()=>{const cells=monthMatrix(2028,1);assert.equal(cells.filter(Boolean).length,29);assert.equal(cells.includes(29),true);});
test("shifts across year boundary",()=>{assert.deepEqual(shiftMonth(2026,0,-1),{year:2025,month:11});});
