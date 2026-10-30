import test from 'node:test';
import assert from 'node:assert/strict';
import {assessStoryQuality,storyWordCount} from '../src/story-quality.mjs';

const scene=(token)=>Array.from({length:85},(_,i)=>i===0?token:'palavra').join(' ');
const final=Array.from({length:350},(_,i)=>i===0?'Conclusão':'história').join(' ');
const base=()=>['Caio','Amara','Lúcio','Marta'].map(scene);

test('four independent valid scenes pass structural review, not semantic certification',()=>{
 const result=assessStoryQuality(base(),final);
 assert.equal(result.passed,true);
 assert.equal(result.semanticStatus,'not_evaluated');
 assert.equal(result.qualityLevel,'structural_only');
 assert.equal(result.sceneWords.length,4);
});
test('a replayed scene is rejected even with four independent delivery receipts',()=>{
 const scenes=base();scenes[3]=scenes[1].toUpperCase().replaceAll(' ','   ');
 const result=assessStoryQuality(scenes,final);
 assert.equal(result.passed,false);
 assert.ok(result.violations.includes('scene_4_duplicates_scene_2'));
});
test('invalid payloads and missing evidence cannot silently become valid prose',()=>{
 for(const bad of [null,undefined,23,{},'  ']){
   const scenes=base();scenes[0]=bad;
   assert.throws(()=>assessStoryQuality(scenes,final),/story_quality_invalid_scene/);
   assert.throws(()=>assessStoryQuality(base(),bad),/story_quality_invalid_synthesis/);
 }
 assert.throws(()=>assessStoryQuality(base().slice(1),final),/story_quality_missing_four_scenes/);
});
test('boundary word limits are exact, independently for scenes and final synthesis',()=>{
 assert.equal(storyWordCount(scene('Limite')),85);
 for(const n of [74,111]){
   const scenes=base();scenes[2]=Array.from({length:n},()=>'texto').join(' ');
   assert.ok(assessStoryQuality(scenes,final).violations.includes('scene_3_word_limit'));
 }
 for(const n of [319,451]){
   const synthesis=Array.from({length:n},()=>'texto').join(' ');
   assert.ok(assessStoryQuality(base(),synthesis).violations.includes('synthesis_word_limit'));
 }
});
test('a causal contradiction cannot be certified by a structural evaluator',()=>{
 const result=assessStoryQuality(base(),
   Array.from({length:350},(_,i)=>i===0?'O tempo foi reescrito apesar da escolha de preservar o passado.':'texto').join(' '));
 assert.equal(result.passed,true,'structural result is not semantic approval');
 assert.equal(result.semanticStatus,'not_evaluated');
});
