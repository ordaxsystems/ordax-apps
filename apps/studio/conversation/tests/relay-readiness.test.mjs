import test from 'node:test';
import assert from 'node:assert/strict';
import { relayAdminReadiness, relayReadinessText } from '../src/relay-readiness.mjs';

test('central Studio only shows counts from canonical Product; never names, files, results or credentials', () => {
  const source = {
    connected: true, catalogAvailable: true,
    targets: [
      { deviceId:'pc-um', name:'Nome privado', online:true, secret:'nao-exibir' },
      { deviceId:'pc-dois', name:'Outro', online:false, privatePath:'C:/privado' },
      { deviceId:'pc-tres', online:null, result:'texto secreto' },
    ],
    operations: [
      { status:'running', result:{token:'secret'}, deviceId:'pc-um' },
      { status:'uncertain', error:'conteúdo de outro usuário' },
      { status:'succeeded', result:'arquivo particular' },
    ]
  };
  const projected=relayAdminReadiness(source);
  assert.deepEqual(projected,{state:'product-connected',deviceCount:3,reportedOnline:1,uncertain:2});
  const text=relayReadinessText(projected);
  assert.match(text,/Product conectado/);
  assert.match(text,/Nenhum destes números confirma um cliente Relay conectado/);
  for(const secret of ['Nome privado','nao-exibir','C:/privado','texto secreto','conteúdo de outro usuário','arquivo particular']){
    assert.ok(!JSON.stringify(projected).includes(secret));
    assert.ok(!text.includes(secret));
  }
});
test('unavailable, corrupt, spoofed or duplicated catalogs cannot claim connected Relay',()=>{
  const base={connected:true,catalogAvailable:true,targets:[{deviceId:'pc-um',online:true}],operations:[]};
  for(const value of [
    undefined,{},[],{...base,connected:false},{...base,catalogAvailable:false},
    {...base,targets:null},{...base,targets:[null]},
    {...base,targets:[{deviceId:'pc-um',online:true},{deviceId:'pc-um',online:false}]},
    {...base,targets:[{deviceId:'pc-um',online:'true'}]},
    {...base,targets:[{deviceId:'../escape',online:true}]},
    {...base,operations:[{status:123}]},
    {...base,targets:Array.from({length:101},(_,i)=>({deviceId:`pc-${i}`,online:true}))},
  ]){
    const projected=relayAdminReadiness(value);
    assert.equal(projected.state,'unavailable');
    assert.equal(projected.deviceCount,0);
    assert.doesNotMatch(relayReadinessText(projected),/Product conectado/);
  }
});
