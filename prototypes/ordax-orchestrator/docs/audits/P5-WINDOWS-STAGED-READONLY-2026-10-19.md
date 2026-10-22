# P5 — Evidência física Windows em perfil staged (somente leitura)

**Data:** 19/10/2026. **Situação:** W0 parcialmente validado; W1–W4 ainda **não executados**.

## Proveniência e isolamento

- O OrdaX MCP estava autenticado, mas `ordax_targets` retornou `product_targets_unavailable`. Isso **não** afirma que o computador estivesse offline.
- O Desktop Commander autorizado encontrou um computador Windows online. O GitHub CLI do Windows confirmou a conta canônica **`ordaxos-admin`**, não a antiga.
- Criado um checkout Git isolado para o Lab, do ramo `feat/orchestrator-lab-isolated-20261019`, commit `474090a`, com sparse checkout do `prototypes/ordax-orchestrator`. Esse commit já contém as correções do P5 anteriores às PRs #283–284; para novos testes, usar o binário CI mais recente.
- Instaladas dependências apenas no `product/node_modules` do checkout de testes. `npm run validate --prefix product` retornou **128/128 testes aprovados** na máquina autorizada. Os smoke scripts herdados que apontavam para o Grátis não foram executados.
- Iniciado `scripts/start-lab.mjs --staged` com `ORDAX_DESKTOP_DEBUG=1`. O staging preserva o perfil próprio do Lab e desabilita o supervisor/Groq. Não houve leitura ou alteração de AppData do Grátis.

## Diagnóstico da UI e sessão

- A interface Electron respondeu por `127.0.0.1:9445`; o endpoint de depuração expôs **um target** com título exato `OrdaX Orchestrator Lab` e URL local de `desktop/ui.html`.
- Consulta CDP **somente leitura** via `window.ordax.providerStatus()` e `window.ordax.providerDiagnostic()`, retornando apenas indicadores permitidos:

```json
{
  "labUi": true,
  "auth_state": "anonymous",
  "provider_active": false,
  "composer_ready": true,
  "verification_required": false,
  "diagnostic_schema": "ordax.lab.provider-dom-diagnostic.v1",
  "page_type": "provider_other",
  "authenticated_proven": "not_verified",
  "delivery_proven": "not_evaluated"
}
```

- Nenhum conteúdo de conversa, URL com identificador, captura de cookie, HTML bruto, credencial ou token foi registrado. **Nenhuma mensagem foi enviada**.
- **Resultado:** o Lab inicia e reconhece a página do provedor, mas a conta do ChatGPT está **anônima neste perfil separado**. Isso não é prova de envio nem de continuação.

## Próximo gate e artefato reproduzível

- [PR #283](https://github.com/ordaxsystems/ordax-apps/pull/283) foi integrada e corrige os scripts live E2E para que só possam alcançar o Lab staged, com porta 9445 e opt-in explícito.
- [PR #284](https://github.com/ordaxsystems/ordax-apps/pull/284) foi integrada. O [run 39330800343](https://github.com/ordaxsystems/ordax-apps/actions/runs/39330800343) publicou o artefato temporário `ordax-orchestrator-unsigned-e2e-359df053a3aaaf3d9e6a071b03135d5e304a46c6` (artifact ID `12224113468`), contendo .exe + manifesto SHA-256, com expiração prevista em 22/10/2026. **Não é release nem E2E.**
- [Procedimento de download e verificação](P5-UNSIGNED-E2E-CANDIDATE-2026-10-19.md). **Verificação física do artefato concluída:** o GitHub CLI da conta `ordaxos-admin` baixou o artefato em diretório próprio no Windows; schema, App ID, tipo `unsigned_test_only`, checkout `359df053a3aaaf3d9e6a071b03135d5e304a46c6` e nome seguro foram conferidos. O SHA-256 do executável foi comparado ao manifesto **com `.NET SHA256`**, pois o cmdlet `Get-FileHash` não estava disponível nessa sessão remota. Resultado: `p5_portable_checksum_verified=true`, tamanho **100.311.348 bytes**.
- **Teste do portátil de CI:** iniciou o launcher e cinco processos `OrdaX Orchestrator Lab.exe` em **outro** `candidate-userdata-v0.2.0-alpha.2`, com supervisor desligado. A pasta de perfil isolada foi criada; porém o endpoint esperado `127.0.0.1:9445/json/list` **não respondeu**. O mesmo resultado ocorreu em segunda tentativa, com a porta previamente livre, e ao fornecer explicitamente `--remote-debugging-port=9445`. **Não há prova de UI do portátil nem causa-raiz identificada**. A observação de UI/CDP e autenticação anônima acima pertencem à **versão staged de desenvolvimento**, não ao executável portátil.
- **Limpeza segura:** a instância de desenvolvimento foi encerrada apenas no caminho `product/node_modules/electron/dist/electron.exe`; as árvores do portátil foram encerradas por identidade exata do launcher e cadeia de PIDs, sem atingir o Grátis, Runtime ou Studio. O script temporário de diagnóstico somente leitura foi removido. Os diretórios isolados e o .exe verificado permanecem para continuidade do gate.
- **Inspeção final de arquivos, sem abrir conteúdo pessoal:** o perfil isolado criado pelo portátil contém `data/ordax-orchestrator-lab.sqlite`, WAL/SHM, a partição Electron `ordax-orchestrator-lab-chatgpt` e `DevToolsActivePort` com primeira linha `9445`. Isso demonstra que o núcleo do aplicativo inicializou seu armazenamento próprio e chegou a configurar a depuração, mas **não comprova que a interface principal ou o endpoint HTTP CDP estivessem acessíveis no momento das sondagens**. A segunda linha do arquivo DevTools não foi coletada ou publicada.
- **Próximo bloqueio técnico W0:** determinar por que o portátil abre processos, inicializa SQLite e registra `9445`, mas não disponibiliza o endpoint de depuração no ambiente testado. Não enfraquecer políticas do Windows, não atribuir a falha sem evidência e não promover uma release.
- W1 (login legítimo e envio único consentido), W2 (queda/reabertura), W3 (reconciliação da mesma thread) e W4 (prova sem replay) permanecem bloqueados por ausência de sessão autenticada **neste perfil**. Não copiar login do Grátis, não simular sucesso, não migrar cookie jar.
- Manter `0.2.0-alpha.2`, sem supervisor automático, multiusuário ou release até W1–W4 aprovados.
