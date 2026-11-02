import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretGPTWorkReview} from '../src/gpt-work-review.mjs';

const answer='A alteração da interface foi proposta, mas nenhum arquivo foi editado e os testes não foram executados. A diferença entre innerText e textContent é uma hipótese de serialização a comprovar.';
const base={
  runId:'run_real_123',decision:'verify_external_effect',
  summary:'O executor propôs uma correção, mas não comprovou modificações nos arquivos.',
  reason:'A resposta confirma que o patch não foi aplicado e os testes permanecem pendentes.',
  observedExcerpt:'nenhum arquivo foi editado e os testes não foram executados',
  nextPrompt:null
};
test('review interprets substantive GPT output without fixed reply or invented execution',()=>{
  const a=interpretGPTWorkReview(JSON.stringify(base),{runId:base.runId,observedAnswer:answer});
  assert.equal(a.decision,'verify_external_effect');
  assert.equal(a.externalEffectVerified,false);
  assert.equal(a.automaticGPTSendAuthorized,false);
  assert.equal(a.nextPrompt,null);
});
test('different valid GPT result may propose same-thread correction, never auto send',()=>{
  const v={...base,decision:'request_correction',nextPrompt:
    'Revise a proposta: explique como comparar os digests sem alterar a política fail-closed.'};
  const d=interpretGPTWorkReview(JSON.stringify(v),{runId:base.runId,observedAnswer:answer});
  assert.equal(d.decision,'request_correction');
  assert.match(d.nextPrompt,/digests/);
  assert.equal(d.automaticGPTSendAuthorized,false);
});
test('model cannot forge quote, source Run, permission or completion evidence',()=>{
  for(const v of [
    {...base,runId:'run_different'},
    {...base,observedExcerpt:'O código foi compilado e implantado em produção'},
    {...base,automaticGPTSendAuthorized:true},
    {...base,decision:'run_shell_command'},
    {...base,decision:'candidate_complete',nextPrompt:'envie ao GPT sem aprovação'}
  ])assert.throws(()=>interpretGPTWorkReview(JSON.stringify(v),{runId:base.runId,observedAnswer:answer}));
});
test('a single fenced JSON review is accepted, but surrounding commentary is not',()=>{
  const fenced='\`\`\`json\n'+JSON.stringify(base,null,2)+'\n\`\`\`';
  const r=interpretGPTWorkReview(fenced,{runId:base.runId,observedAnswer:answer});
  assert.equal(r.decision,'verify_external_effect');
  assert.throws(()=>interpretGPTWorkReview('Revisão: '+fenced,{runId:base.runId,observedAnswer:answer}));
  assert.throws(()=>interpretGPTWorkReview(fenced+'\nOutros dados',{runId:base.runId,observedAnswer:answer}));
});

test('malformed model output or omitted next instruction remains unverified',()=>{
  assert.throws(()=>interpretGPTWorkReview('Feito com sucesso',{runId:base.runId,observedAnswer:answer}));
  assert.throws(()=>interpretGPTWorkReview(JSON.stringify({...base,decision:'new_work',nextPrompt:null}),{runId:base.runId,observedAnswer:answer}));
});
