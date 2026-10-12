import test from 'node:test';
import assert from 'node:assert/strict';
import { speechChunks, createSpeech } from '../src/speech.mjs';
test('spoken prose is bounded and skips code and link targets', () => {
  assert.deepEqual(speechChunks('# Olá **mundo**. [Site](https://secret.example)\n```js\nsecret()\n```'), ['Olá mundo. Site Trecho de código.']);
  assert.ok(speechChunks('x'.repeat(1000)).every(chunk => chunk.length <= 240));
  assert.throws(() => speechChunks('x'.repeat(30001)));
});
test('speech uses local voices, supports pause and ignores callbacks from an older reading', () => {
  const calls = [], synthesis = { getVoices: () => [{name:'PT',lang:'pt-BR',voiceURI:'pt',localService:true},{name:'Remote',voiceURI:'remote',localService:false}], speak: item => calls.push(item), cancel(){},pause(){},resume(){} };
  const speech = createSpeech({synthesis,Utterance:class {constructor(text){this.text=text;}}});
  assert.equal(speech.state().voices.length,1); speech.play('Uma resposta.', 'a'); const old = calls[0];
  assert.equal(old.voice.voiceURI,'pt'); speech.togglePause(); assert.equal(speech.state().status,'paused'); speech.togglePause();
  speech.play('Outra resposta.', 'b'); old.onend(); old.onerror(); assert.equal(speech.state().key,'b');
  calls.at(-1).onend(); assert.equal(speech.state().status,'idle');
});
test('unavailable or remote-only synthesis never pretends to speak', () => {
  const speech = createSpeech({synthesis:{getVoices:()=>[{localService:false}],cancel(){}},Utterance:class{}});
  assert.equal(speech.state().available,false); assert.throws(()=>speech.play('Olá','a'),/voz local/);
});
