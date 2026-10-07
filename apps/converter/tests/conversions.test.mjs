import assert from "node:assert/strict";import test from "node:test";import{convert,formatConversion}from"../src/conversions.mjs";
test("converts compatible units",()=>{assert.equal(formatConversion(convert(5,"km","m")),"5000");assert.equal(formatConversion(convert(32,"f","c")),"0");});
test("rejects incompatible units",()=>assert.throws(()=>convert(1,"kg","km"),TypeError));
