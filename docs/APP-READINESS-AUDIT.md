# G0 — Auditoria automática de prontidão dos apps

Este incremento inicia a implementação do [roadmap urgente](../URGENTE-ROADMAP-ORDAX-APPS.md) **sem alterar o OrdaX OS**, que está em processo de migração de organização.

## Executar

```sh
python3 tools/audit_app_readiness.py --format markdown
python3 tools/audit_app_readiness.py --format json
# Prova opcional de candidatos não assinados: requer checkout Git canônico e limpo.
python3 tools/audit_app_readiness.py --format markdown --prove-package-candidates
python3 -m unittest tests/test_audit_app_readiness.py
```

O relatório JSON tem schema `ordax.app-readiness-audit/1` e `authority=none`. A etapa de CI Foundation executa testes e imprime a tabela no log do PR. O inventário é derivado de `ordax-apps.workspace.json`, `apps/*/app.json`, manifestos e migrations — **não** é uma lista de versões manual.

## O que a ferramenta prova

- A identidade e ownership de cada source first-party seguem o workspace.
- `app.json`, `ai/manifest.json`, `actions/manifest.json` e o manifesto/digest dos providers passam nos validadores canônicos do package builder.
- A compatibilidade é consistente com id/versão e não existe segundo descriptor.
- Um app ainda owned pela plataforma (por exemplo, Projects antes do cutover) não pode ganhar uma segunda implementação canônica em `ordax-apps`.
- Alvos sem source, candidatos bootstrap e blockers conhecidos são relatados sem tornar a CI vermelha apenas por ainda serem planejados.
- Gates de produção de Notes e de distribuição de Studio continuam visíveis como bloqueios conhecidos.

## G0 — prova de pacote determinístico por app (sem autoridade)

O modo opt-in `--prove-package-candidates` avança a auditoria além dos metadados, **sem confundir pacote com release**. Ele usa o **mesmo** builder canônico de `tools/app-package/build.py`, não um empacotador paralelo, e para cada app com source e compatibility descriptor:

1. Confirma checkout Git limpo, na raiz, com `origin` do repositório canônico e SHA exato do `HEAD` (não aceita SHA fornecido manualmente na CLI).
2. Constrói **duas vezes** o pacote ZIP e seus sidecars de release/compatibility em diretórios temporários separados.
3. Verifica cada pacote pelo verificador do builder e compara SHA-256 dos bytes de pacote, release e compatibility. Divergência ou source/import inválido faz a CI falhar.
4. Registra no relatório JSON o estado `verified-deterministic-candidate`, `source_commit`, hashes e tamanho; **não persiste** os artefatos no repositório.
5. Mantém `blocked-missing-compatibility` para source sem descriptor (por exemplo, Studio enquanto não existir um package boundary aplicável) e `not-assessed` para alvos sem source.

A Foundation CI executa esse modo, que produz **apenas evidência de candidatos não assinados**. A ferramenta não instala, publica, ativa, gera chaves ou modifica a plataforma. `production_releases_verified=0` continua por definição. O `origin` local e o SHA do `HEAD` não provam assinatura/identidade remota: a autenticação de checkout e as políticas de publicação pertencem à CI e aos owners de trust/lifecycle.

## G1 — contratos declarados versus SDK público pinado

A mesma etapa Foundation que já verifica o SHA-256 de `platform-sdk.lock.json` agora executa uma auditoria **offline sobre o bundle já verificado**, sem baixar uma segunda cópia e sem criar catálogo paralelo. `tools/verify_app_sdk_compatibility.py` reutiliza o inventário/ownership do auditor G0 e o validador de compatibilidade do builder canônico.

```sh
# Testes locais com bundle sintético: não acessam a rede.
python3 -m unittest tests/test_app_sdk_compatibility.py

# Gate real: verifica o bundle público do commit pinado e cruza todos os apps.
python3 tools/verify_platform_sdk.py
```

O gate compara cada requisito `requires` de `apps/<id>/compatibility.json` (ou descriptor canônico de migration) com os contratos `id/major` realmente publicados no **bundle pinado**:

- Requisito **obrigatório** sem major compatível: CI falha fechada e informa o app e contrato faltante.
- Requisito **opcional** ausente: fica explícito na matriz e na contagem de lacunas, sem converter opcional em obrigatório.
- App sem descriptor (Studio) e alvo sem source: `not-assessed`, não `pass`.
- `provides` do app não é interpretado como uma API da plataforma, nem usado para conceder permissões.
- O relatório `ordax.app-sdk-compatibility-audit/1` inclui o commit do lock e estados por app; nenhuma lista de apps ou majors foi copiada para o código de CI.

**Limite de evidência:** contrato *publicado no SDK* não significa host que o implementa, grant efetivo, execução do runtime, assinatura, instalação, rollback ou ativação. Essas provas continuam com seus owners e testes específicos. A compatibilidade histórica do Notes não é reescrita: o gate avalia somente seu descriptor de distribuição canônico.

## G2 — smoke dos runtimes reais dentro dos candidatos de pacote

O incremento G2 não cria outro runtime do OrdaX: reutiliza o **builder/verificador oficial** de `tools/app-package/build.py` e o inventário/ownership do auditor G0. A verificação `tools/verify_packaged_runtimes.py` constrói candidatos locais a partir do checkout Git canônico e limpo, valida seus bytes e extrai o `entrypoint` **do ZIP verificado**, não do source solto.

Em subprocessos Node com timeout, `tools/probes/packaged-runtime-probe.mjs` importa cada módulo real e exige `componentRuntime` público com `schema=ordax.component-runtime/1`, `componentId` e `version` iguais aos do manifesto do pacote, além de `mount()` presente e **rejeição da montagem quando não existe host/ports**. Qualquer drift ou montagem indevida faz a CI falhar; o relatório é derivado em tempo de execução, sem gravar uma segunda lista de apps ou SSOT persistente.

```sh
python3 -m unittest tests/test_packaged_runtime_smoke.py
python3 tools/verify_packaged_runtimes.py --format markdown
```

O check revelou e corrigiu 12 versões de runtime desatualizadas em relação a `app.json`. Notes já declarava a versão correta; Studio continua `not-assessed-no-package-boundary` e alvos sem source continuam `not-assessed-no-canonical-source`.

**Limite de evidência:** importar o módulo em Node e rejeitar `mount({})` **não constitui sandbox de segurança**, prova de host com portas válidas, renderização de UI, acesso a grants, funcionamento de timer de background, instalação, atualização, rollback, trust ou release de produção. Os testes de comportamento e lifecycle do Notes continuam provas separadas. O probe não executa nenhuma operação de instalação/publicação ou contato com a Store.

## G2.1 — montagem pública e desmontagem do aplicativo Calculator

Como primeiro teste comportamental de montagem (distinto do smoke G2 dos pacotes), `apps/calculator/tests/mount_contract.test.mjs` executa o `componentRuntime.mount` real com uma implementação **de teste e mínima** da porta pública `ordax.surface-render-lifecycle/5` e dos elementos DOM que a Calculadora utiliza. Não duplica um runtime, host nativo ou serviço de grants.

O teste verifica: interface montada e operações por evento de usuário; expressão em edição preservada na mudança de idioma; resultado sem recomputação implícita; inscrição única em eventos de localização; `destroy()` idempotente; remoção de listeners/DOM/stylesheet; recusa de host inválido; erro na folha de estilos sem montagem parcial; e rollback de recursos quando a inscrição de localização falha.

```sh
node --test apps/calculator/tests/*.test.mjs
```

**Limite:** a porta e o DOM usados nesses testes são fixtures estritas locais, não um browser real nem um host instalado no OrdaX OS. O teste não comprova isolamento de sandbox, pipeline de render real, grants, gerenciamento de processo, install, update, rollback, Store ou ativação em produção. Não se soma como `host_mounts_verified` no relatório de candidatos de pacote; a validação em host real continua pendente.

## G2.2 — Relógio: sessão de primeiro plano independente da interface

O runtime do `clock` anteriormente declarava `stopwatchElapsed`/`timerRemaining` dentro de `mountView()`. Alterar o idioma destruía e recriava a view, reiniciando o cronômetro e o temporizador. A implementação agora mantém uma **única sessão app-owned** em `apps/clock/src/clock-session.mjs` durante toda a montagem do aplicativo. Vistas podem ser destruídas e reconstruídas pela porta pública `ordax.surface-render-lifecycle/5` sem reiniciar o tempo, estado de execução, duração configurada ou indicação de conclusão.

A sessão usa `performance.now()` monotônico apenas para medir passagem de tempo durante a vida do app, sem serviço de background ou novo contrato de sistema. Ela é a única fonte do estado de tempo do app; a UI não mantém uma segunda contagem. Ao desmontar, o runtime libera o intervalo de renderização de 100 ms, os listeners e a inscrição de localização. A inicialização faz cleanup caso o `subscribe` falhe.

```sh
node --test apps/clock/tests/*.test.mjs
```

Os testes do modelo usam um clock injetável e determinístico para verificar cronômetro rodando/pausado, temporizador configurado e expirado, troca de view sem perda de progresso, retomada, reset e validação de duração. A Foundation já executa essa suite por descoberta de testes. **Limites:** esses testes não constituem prova de renderização real com host OrdaX, instalação, notifications ou agendamento em segundo plano; esses gates continuam separados.

## G2.3 — Visualizador de Texto: leituras concorrentes, identidade e desmontagem

O Visualizador de Texto recebia ativações de `ordax.app-activation/1` e chamava `ordax.file-space/11.readTextFile()` sem distinguir respostas antigas de novas. Como o File Space é assíncrono, um resultado atrasado podia sobrescrever o arquivo mais recente ou modificar uma view já desmontada.

A correção no **runtime canônico** `apps/text-viewer/src/runtime.mjs` mantém uma sequência de abertura local à montagem: só a última ativação válida pode aplicar sucesso ou erro; `destroy()` é idempotente e invalida todas as leituras em andamento, mesmo que o broker ainda as conclua. O resultado precisa corresponder ao caminho lógico requisitado e conter texto; resposta divergente falha fechada com mensagem localizada. Eventos de outro app e caminhos lógicos inválidos não acessam o File Space. Erros de assinatura da porta pública fazem limpeza de subscriptions, view e stylesheet.

```sh
node --test apps/text-viewer/tests/*.test.mjs
```

Os testes provocam respostas fora de ordem, rejeições antigas, resposta de caminho divergente, tipo de conteúdo malformado, mudança de idioma durante leitura, unmount antes da resolução, recusa de portas públicas inválidas e cleanup após falha de subscribe. A CI já usa descoberta dos testes deste app, sem inventário separado.

**Escopo:** esta prova é uma fixture mínima de DOM e portas públicas, não um host de produção ou mecanismo de revogação do File Space. Os grants, isolamento, sandbox, install, rollback, signing e ativação continuam no owner da plataforma. O app não tenta cancelar ou substituir a autoridade do broker: apenas ignora resultados obsoletos.

## G2.4 — Visualizador de Imagens: concorrência de leituras, URLs temporárias e desmontagem

O `image-viewer` recebia duas respostas independentes do File Space: `list()` para navegação e `readImagePreview()` para bytes. Apenas o preview era parcialmente protegido por sequência, permitindo que uma listagem antiga sobrescrevesse a navegação da imagem atual. A desmontagem também não impedia atualizações da lista, e falhas depois de `URL.createObjectURL()` podiam deixar uma URL temporária viva até uma futura abertura.

O runtime canônico agora guarda a mesma sequência da ativação para **ambas** as operações assíncronas, não aplica resultados depois do `destroy()` e invalida leituras pendentes. Há revogação imediata de URL em falhas após sua criação; `destroy()` é idempotente e remove callbacks, listeners, imagem/URL, DOM e stylesheet inclusive quando a subscrição do host falha. O retorno do File Space precisa preservar `preview.path`, bytes e MIME de imagem suportada, rejeitando previews incorretos. A lista de irmãos ignora nomes de arquivo que tentariam atravessar diretórios.

```sh
node --test apps/image-viewer/tests/*.test.mjs
```

Testes do runtime real com **fixture estreita local** cobrem respostas de listagens fora de ordem, falha de preview antigo, fechamento durante leitura, revogação de URLs antigas e em falhas da UI, MIME/identidade inválidos e rollback de subscriptions. Eles já são descobertos pela etapa atual de utilitários da Foundation CI.

**Limite de evidência:** o File Space continua sendo a autoridade exclusiva de grants e de validação de dados. Estes testes não implementam outro broker ou sandbox, não substituem um navegador/host real e não autorizam assinatura, Store, install, rollback ou produção.

## G2.5 — PDF e Media Player: prevenção de leituras obsoletas e liberação de recursos

O runtime canônico do `pdf-viewer` já protegia parte dos previews por contador de requisição, mas não marcava a instância como destruída e não revogava imediatamente uma URL temporária se a construção do elemento `<embed>` falhasse após `createObjectURL()`. O `media-player` tinha o mesmo risco de URL, acrescido de `fileSpace.list()` assíncrono **sem guard de geração**, permitindo que resultados de diretórios antigos alterassem a navegação da mídia aberta mais recentemente.

Agora ambos exigem portas públicas tipadas (`ordax.app-activation/1`, `ordax.file-space/11`, `ordax.surface-render-lifecycle/5`), ignoram respostas obsoletas ou posteriores ao unmount, rejeitam identidade/categoria de preview incompatíveis e liberam subscriptions, elementos, object URLs e stylesheet mesmo no caminho de erro. O Media Player descarta listagens antigas, ignora entradas que cruzariam diretórios e pausa a mídia antes de removê-la.

Apenas os aplicativos são donos do estado visual. Os bytes e grants continuam controlados pelo File Space; não há novo servidor de arquivos, instalador, API privada, assinatura ou autoridade de Store. A fixture DOM/portas foi consolidada em `tests/support/preview_mount_fixture.mjs` para os dois aplicativos sem reproduzir runtime ou host de produção.

```sh
node --test apps/pdf-viewer/tests/*.test.mjs
node --test apps/media-player/tests/*.test.mjs
```

Regressões cobrem leitura concorrente fora de ordem, lista obsoleta, resposta de identidade/MIME divergente, bytes vazios, fechamento com preview pendente, mudança de locale, URL revogada ao erro, pausa e revogação na substituição, rollback de subscrição e caminhos de ativação inválidos.

**Limites:** sucesso com fixture não equivale à montagem em um host/browser real nem prova grants, sandbox, instalação, atualização, rollback, assinatura, trust ou release de produção. Esses gates continuam separados e fechados até evidência do owner da plataforma.

## SSOT também na Foundation CI

A CI **não mantém uma segunda lista de apps ou de providers**. A sintaxe dos arquivos JSON é verificada por descoberta do filesystem (árvores `apps/` e `migrations/`), enquanto a identidade e os contratos são validados pelo workspace, pelo package builder e pelos manifests canônicos. O verificador de Application Actions agora executa `node --check` exclusivamente nos módulos declarados em `actions/providers/manifest.json` e rejeita módulos `.mjs` extras ou symlinks no diretório de providers.

```sh
python3 -m unittest tests/test_provider_syntax_ssot.py
python3 tools/verify_app_actions.py --check-provider-syntax
```

A descoberta dinâmica **não substitui** os gates de assinatura, instalação, rollback e produção. A origem autoritativa dos alvos é `ordax-apps.workspace.json`; a origem autoritativa dos módulos de provider é o manifesto de cada app, e não o YAML de CI.

## O que a ferramenta NÃO prova

A auditoria **sem flags** não prova execução de runtime, integração com host, build determinístico, assinatura, trust, publicação, install, rollback, reinstall offline, ativação de produção nem disponibilidade na Store. Os modos G0/G1 específicos provam apenas determinismo local dos candidatos e presença estática dos contratos declarados no SDK pinado, respectivamente. O campo `production_releases_verified` fica em zero **por desenho**: essa evidência pertence aos gates de lifecycle e ao operador.

**Estados importantes:**

- `canonical-source`: source de produto neste repo, **não** release.
- `metadata_verified=true`: manifests/compatibility validados, **não** pacote ou distribuição.
- `platform-until-cutover`: source ainda pertencente à plataforma; não copiar.
- `bootstrap-candidate`: alvo futuro que exige prova de extração.
- `blocked-by-known-gate`: bloqueio de trust/distribuição documentado.
- `not-assessed`: falta avaliação, **não** significa sucesso ou falha.

## Próximos incrementos

1. Após G0 de pacote, G1 de presença de contratos e G2 de importação/identidade/negação sem host, ampliar os testes de **montagem com host real** e lifecycle de instalação/rollback por app, sem supor publicação ou disponibilidade.
2. Especificar os contratos de acesso autorizado a recursos do Files e o caminho de cutover da implementação bootstrap, sem duplicar o source da plataforma.
3. Abrir MVPs de Internet e Assistant somente após confirmar host isolation e Action Gateway/permissions públicos.
4. Avançar Projects apenas quando o owner da plataforma registrar `source_cutover_allowed=true` e a ausência do source antigo for comprovada.

Qualquer divergência com `HANDOFF.md`, migrations, locks e CI deve ser resolvida consultando os owners canônicos, nunca relaxando as validações.
