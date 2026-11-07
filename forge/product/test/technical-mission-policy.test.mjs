import test from 'node:test';
import assert from 'node:assert/strict';
import {technicalMissionPolicy} from '../src/technical-mission-policy.mjs';

test('read-only runtime diagnosis receives one GPT send and a systems specialist',()=>{
  const p=technicalMissionPolicy('Diagnostique por que o runtime MCP perdeu conexão e explique as evidências.');
  assert.equal(p.maxGPTSends,1);
  assert.equal(p.specialist,'systems');
  assert.match(p.directive,/especialista em sistemas/u);
});
test('auditing with a correction retains the two-send ceiling',()=>{
  const p=technicalMissionPolicy('Audite e corrija o aplicativo conforme as evidências observadas.');
  assert.equal(p.maxGPTSends,2);
  assert.equal(p.specialist,'quality');
});
test('frontend, security and API tasks route within existing executor',()=>{
  assert.equal(technicalMissionPolicy('Corrija o layout do site e os componentes.').specialist,'interface');
  assert.equal(technicalMissionPolicy('Verifique permissões, login e credenciais sem segredos.').specialist,'security');
  assert.equal(technicalMissionPolicy('Implemente o endpoint da API com testes.').specialist,'systems');
});
test('ambiguous or mutating requests keep the conservative ceiling',()=>{
  assert.equal(technicalMissionPolicy('Trabalhe na próxima etapa.').maxGPTSends,2);
  assert.equal(technicalMissionPolicy('Verifique e atualize o projeto.').maxGPTSends,2);
  assert.throws(()=>technicalMissionPolicy(' '),/technical_mission_invalid/);
});
