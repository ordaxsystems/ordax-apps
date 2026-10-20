# P5 — Isolamento real do perfil staged no executável portátil

Data: 20/10/2026. OrdaX Orchestrator Lab `0.2.0-alpha.2`.

## Falha confirmada na interface física

A prova da PR #302 no Electron de desenvolvimento passou, porém o portátil da mesma CI podia abrir a janela com um perfil **diferente** daquele indicado ao processo pai por `LOCALAPPDATA`. Em diagnóstico com um perfil staged que continha **1 Task**, a janela real do portátil com CDP `9446` apresentou **6 Tasks**. O título, a URL local da UI e a porta estavam corretos: logo, **o contrato E2E anterior não confirmava o banco realmente utilizado**.

As seis Tasks também constam em outros perfis de teste anteriores. Não se pode identificar de forma definitiva qual desses perfis o portátil abriu somente pela contagem. Por segurança, a instância foi encerrada sem envio e a porta 9446 liberada. O Lab original permaneceu na porta 9445.

A execução inicial do portátil demorou até criar seu processo Electron: a segunda coleta mediu **38,8 segundos** entre o launcher e o filho, que então exibiu janela com CDP e passou no readiness. Não se deve diagnosticar falha de aplicativo apenas pela demora de extração, nem usar tempos fixos como prova de sucesso.

## Contrato implementado na raiz

- `src/lab-profile-binding.mjs` é o contrato canônico. O Lab normal preserva seu `userData` habitual. Para a porta staged de teste `9446`, a aplicação **recusa iniciar** sem **ambos** `--ordax-lab-staged-approved` e `--ordax-lab-staged-localappdata=<caminho absoluto>`.
- O diretório fornecido deve ter basename no formato canônico `candidate-userdata-vX.Y.Z-alpha.N`. A seleção é realizada **antes de abrir Store/SQLite** no processo Electron real, evitando confiar que o NSIS portátil propagou alterações locais de `LOCALAPPDATA`.
- Uma `ordax:lab:profile-proof` IPC read-only e permitida somente para o renderer OrdaX de confiança retorna apenas `schema` e SHA-256 determinístico do caminho de `app.getPath('userData')`, sem expor path, conta, cookie ou histórico.
- A biblioteca compartilhada `e2e-lab-target.cjs` agora verifica essa prova **antes de qualquer interação funcional**, incluindo os scripts existentes que chamam `waitForLabAppMode`. Mesmo um Lab legítimo mas com perfil errado falha com `lab_e2e_profile_mismatch`.
- O modo ChatGPT direto continua fallback do usuário, porém não certifica E2E. Sem autenticação artificial, sem requisições privadas, sem reenvio de mensagens ou migração de dados.

## Critérios

1. Unit tests rejeitam porta staged sem CLI de perfil e caminho inválido.
2. Unit tests confirmam que título/porta certos e perfil errado são recusados.
3. CI Linux e Windows/build portátil aprovados.
4. E2E físico em **portátil recém-compilado** deve abrir a Task sintética certa (1 Task) no perfil explicitado, não as Tasks antigas; `sendDisabled=true`, draft local persistido, zero Runs/mensagens/envios externos.
5. Lab original com dados existentes preservado.

**Status:** W3 (conversa histórica externa) e W4 (interrupção durante resposta real) continuam pendentes, mesmo depois de aprovado o isolamento de perfil.
