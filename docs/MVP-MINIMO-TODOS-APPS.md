# MVP MÍNIMO — todos os aplicativos antes do polimento individual

**Decisão de execução (2026-10-08):** o próximo marco não é aperfeiçoar um app de cada vez; é permitir que **cada app first-party elegível tenha a menor unidade coerente com o OrdaX OS**, com importação pelo catálogo e atualizações versionadas posteriores. O escopo funcional inicial pode ser simples, mas cada funcionalidade anunciada precisa funcionar e falhar de modo seguro.

Este documento fixa a ordem de trabalho. **Não substitui** os SSOTs: `ordax-apps.workspace.json` (alvos e ownership), `apps/<id>/app.json` e metadados adjacentes (identidade), `platform-sdk.lock.json` (contratos publicados), `tools/app-package/catalog_inventory.py` (elegibilidade do catálogo), e a plataforma (lifecycle, trust, política MVP e verdade de instalação).

## Definição de mínimo comum por app

1. **Owner único:** há um `apps/<id>/app.json` canônico neste repositório somente **após** source cutover permitido e source antigo removido. Apps ainda platform-owned não recebem cópias ou skeletons fictícios.
2. **Identidade e metadados:** manifesto `ordax.component-manifest/1` com `owner`, id, semver, `component-slot` quando esta modalidade for suportada; AI manifest declarativo `authority:none`, action manifest `proposal-only` e provider manifest verificados. A declaração não autoriza ação.
3. **Compatibilidade pública:** um único `compatibility.json` local ou `migrations/<id>.compatibility.json`, conforme owner existente; os `requires` obrigatórios devem existir no App SDK pinado. Sem imports privados, grants improvisados ou host paralelo.
4. **Runtime mínimo real:** entrypoint canônico exporta `componentRuntime` com schema, identidade e versão do manifesto, aceita somente ports autorizadas; UI ou uma operação mínima útil, estado/erros claros, limpeza de subscriptions/URLs/listeners e destroy seguro. Não confundir teste Node com prova de host nativo.
5. **Empacotamento:** `tools/app-package/build.py` é o único builder; ZIP, compatibility e release sidecars têm identidade e hashes verificáveis, são determinísticos e entregam handoff não assinado. Testes de contrato e smoke fazem parte da Foundation.
6. **Entrada no catálogo:** `tools/app-package/catalog_inventory.py` deriva os apps elegíveis; `render_store_catalog_candidate.py` agrega somente handoffs comprovados do **mesmo commit**. Artefato não assinado é **entrada de catálogo**, não aplicativo instalável.
7. **Entrega efetiva:** somente o runtime/platform owner pode autenticar assinatura e catálogo v2, selecionar release verificada, instalar, verificar saúde, promover e fazer rollback preservando App Data. A Store apresenta e solicita, sem poder de instalar ou conceder permissões. Sem essas provas, manter `blocked`/não instalável — nunca habilitar flags como atalho.

**Regra de produto:** todos os 20 alvos devem aparecer na auditoria, inclusive os bloqueados. Não exigir para essa fase: funcionalidades avançadas, IA obrigatória, alarmes de background, edição de PDF, cloud/sync, desenho persistente ou suporte a todos os formatos. Essas extensões chegam por atualização do app ou Stable release oficial quando os contratos necessários existirem.

## Política de entrega contínua — mínimo funcional, sem esperar o lançamento

**Diretriz:** `MVP` é uma versão distribuível da menor experiência **realmente funcional** de cada app incluído, não o ponto em que o desenvolvimento é interrompido. Correções, integrações, segurança, acessibilidade, desempenho e novas funcionalidades podem e devem ser integradas **antes do lançamento** quando estiverem validadas. Depois continuam chegando por novas versões assinadas, sem exigir a reinstalação do USB. Um recurso opcional não pronto fica fora do release; não bloqueia a publicação de outros apps prontos ou da Base saudável.

Para declarar um app **funcional no escopo anunciado** é necessário, além de manifest/ZIP/compatibilidade:

1. **Fluxo útil concluído:** ao menos uma tarefa principal de produto funciona do início ao fim, com entrada, resultado verificável e erros reais comunicados. Omitir/desabilitar capacidades ainda não suportadas; não simular sucesso nem exibir um app apenas com placeholder/ícone.
2. **Contrato e isolamento comprovados:** runtime monta e desmonta sem vazamentos, usa apenas as portas públicas do App SDK pinado, valida entradas, respeita grants/limites e falha fechado na ausência de serviços Native.
3. **Provas automatizadas por candidato:** CI deriva a lista de `component-slot` do mesmo `tools/app-package/catalog_inventory.py`, executa pelo menos uma suíte de comportamento `apps/<id>/tests/*.test.mjs`, confere a sintaxe do runtime e constrói/verifica o pacote determinístico do commit exato. Isso inclui novos candidatos automaticamente e elimina a lista manual dos utilitários no workflow Foundation. Suites especializadas de Notes, Studio e integrações continuam como provas adicionais.
4. **Prova de host e distribuição em separado:** os testes Node/package não demonstram que o app montou no host OrdaX, que foi instalado de verdade ou que pode ser anunciado publicamente. Para ser **disponível no MVP**, o owner de release deve provar a interação essencial no host alvo, saúde, compatibilidade e o caminho de entrega realmente autorizado (Stable assinado ou componente independente com trust/lifecycle).
5. **Atualizações pequenas e reversíveis:** cada correção/melhoria evolui a mesma fonte de app, com SemVer, CI e provas proporcionais ao risco. Atualização independente por app só quando o `component-slot` houver sido comprovado; até lá, distribuir pelo canal Stable assinado do `system/supervisor`. Não duplicar updater, Store ou inventário instalado.
6. **Lançamento possível a qualquer momento:** manter sempre um candidato Stable coerente e testável, com funções fundamentais confiáveis e trabalho incompleto isolado em branches/flags de disponibilidade legítimas. Não rebaixar critérios de segurança para acelerar; não reter correções prontas artificialmente para o pós-lançamento.

**Distinção de relatórios:** `unsigned-store-catalog-input` na auditoria G0 indica **elegibilidade técnica do pacote**, não o estado `functional`, `installed` ou `production-ready`. A existência de suíte de teste também não substitui a prova de host e o aceite funcional pelo owner. Os seis alvos ainda platform-owned e a rota especial Studio mantêm seus gates de ownership e seus testes no owner correto, sem skeleton paralelo no `ordax-apps`.

## Estado real — baseline de outubro/2026

A execução de `python3 tools/verify_mvp_app_minimum.py --minimum-candidates 13 --format markdown` deriva cada status a partir do inventário original e **não grava um segundo catálogo**.

| Situação | Alvos | Próxima ação |
| --- | --- | --- |
| **13 com source, metadados e descriptor para candidato não assinado** | `notes`, `calculator`, `clock`, `converter`, `text-viewer`, `image-viewer`, `calendar`, `colors`, `character-map`, `paint`, `media-player`, `pdf-viewer`, `toolbox` | Manter gates G0/G1/G2 e testar os candidatos na cadeia assinada oficial; não fazer polishing extra antes dos alvos bloqueados |
| **Distribuição especial** | `studio` | Source portátil canônico próprio OS/Windows; não aplicar descriptor ou runtime fictício só para aumentar a contagem |
| **Source ainda pertence à plataforma** | `files`, `projects`, `internet`, `assistant`, `activity`, `network` | Os seis têm source real em `ordaxsystems/ordax-os/system/apps/<id>`; registrar o Gate A remove-first antes de transferir código ou autorizar distribuição |


A verificação de **13** é um piso de regressão, não uma contagem manual de identidades nem um compromisso de 13 releases em produção. Aumentar o piso conforme novos apps tornam-se elegíveis, nunca diminuí-lo para esconder regressões. Estado de instalação pública validada permanece **zero** nessa auditoria, porque o verificador não consulta a autoridade nativa.

**Nota de ownership do Internet:** a migração é governada exclusivamente por `migrations/internet.externalization.json`; o produto futuro é `apps/internet`, mas o motor WebKitGTK e os adaptadores nativos permanecem no owner do OS. Criar uma pasta provisória `apps/internet` antes do Gate A também é duplicação proibida. O auditor G0 recusa inclusive skeletons vazios ou runtimes sem `app.json`.

**Nova prova de ownership:** `migrations/{internet,assistant,activity,network}.externalization.json` registra `platform-until-cutover`, `source_cutover_allowed=false`, `distribution_activation_allowed=false` e o caminho exato do source no owner OS. `tools/verify_mvp_app_minimum.py` já deriva os estados dessas migrations (sem copiar serviços). `tests/test_mvp_platform_ownership.py` impede que seis fontes platform-owned sejam tratadas como candidatos ou apps publicados. O OS está preparando a extensão separada de política de Loja para os 12 utilitários pela PR `ordaxsystems/prototipo-ordax-os#1372`; registro de policy **não** autoriza instalação.

## Sequência acelerada de implementação

1. **P0: mínimo e catalogação para o conjunto.** Proteger as 13 entradas de catálogo já comprovadas, resolver a rota especial do Studio e os cutovers de Files/Projects com seus owners. Para os outros seis, usar exclusivamente as implementações já existentes no owner da plataforma e seguir os gates remove-first; **não criar uma segunda fonte** só para aumentar a contagem. Após o cutover, portar a menor capacidade autorizada e documentar cada grant/port, sem um segundo runtime.
2. **P0: entrega inicial viável.** O owner da plataforma define quais apps entram no **MVP Stable assinado**; os opcionais podem ser acrescentados por atualizações oficiais de Stable, sem recriar USB. Manter Store UI instalada como superfície estrutural, mas não alegar instalação independente enquanto o executor/verificador não estiver pronto.
3. **P0: contrato de catálogo/install independente.** Reutilizar o pipeline **já existente** de candidate/Store publication v2/envelopes; obter os gates reais de trust, monotonicidade de catálogo, inventory da ativação, install, reinstall offline, failed update, rollback e uninstall preservando dados. Não implantar segundo updater.
4. **P1: melhorias individuais após baseline.** Ajustar UI, idioma, performance, funcionalidades extras e novas versões dos aplicativos; bug de segurança/corrupção de dados continua P0 e não é adiado.
5. **P1: aceite global.** CI verde, nenhuma fonte duplicada, todos os 20 alvos classificados sem falso positivo, release assinado somente por operador autorizado, e testes de integração no host da plataforma dos aplicativos que serão anunciados como disponíveis.

## Entrega dos pacotes de CI — candidato público não assinado

O workflow \`Store Catalog Candidate\` agora materializa uma **única pasta de handoff público somente-leitura**. A ferramenta \`tools/app-package/materialize_unsigned_store_handoff.py\` usa o próprio candidato de catálogo e os sidecars já verificados (SSOT), revalida SHA-256/tamanho de cada artefato e entrega, por aplicativo elegível, o ZIP não assinado, release/compatibility e o handoff \`unsigned-candidate\`. Também entrega o candidato de catálogo e a publicação **v1 não assinada**. O artefato de CI é retido por 14 dias no GitHub Actions.

O material de prova com chaves efêmeras, trust de CI, envelopes temporários de assinatura e publicação v2 de protocolo continua removido **antes** dessa cópia. O exportador copia somente uma allowlist positiva de arquivos e falha em qualquer identidade ou digest divergente; não faz glob de todos os arquivos de build. Nenhum artefato de CI concede confiança canônica, autoridade de Store, instalação, promoção ou rollback.

**Uso:** reproduzir e conferir os artefatos mínimos dos 13 candidatos no mesmo commit; a cadeia oficial de assinatura, verificação de catálogo v2 e lifecycle de produção pertence à plataforma e permanece um gate separado. A existência de ZIP ou handoff público não coloca automaticamente o app na Loja e não altera o status do Studio ou dos seis alvos com source platform-owned.

\`\`\`sh
python3 -m unittest tests/test_unsigned_store_handoff.py
\`\`\`

## Gates que não podem ser confundidos

- **Alvo planejado**: id existe no workspace — não significa código.
- **Source canônico**: código pertence ao repo correto — não significa pacote.
- **Candidato de catálogo não assinado**: metadados/compatibility/ZIP verificáveis — não significa publicidade ou instalação.
- **Catálogo verificado**: assinatura, sequência e proveniência conferidas pela plataforma — não significa já instalado.
- **Instalado**: estado de ativação `current` verificado pelo runtime owner — não é apenas cache/slot staged.
- **Stable/MVP disponível**: release assinado, aprovado pelo owner da plataforma com saúde/recovery/rollback; nenhum relatório de CI local pode se autodeclarar produção.

A política atual da plataforma distingue o primeiro **Stable MVP** (superfícies estruturais + Files/Internet bootstrap, opcionais adicionáveis em update assinado) da instalação modular da Store (posterior). Alterar essa política requer PR separada no owner do OrdaX OS; **não** mudar silenciosamente as responsabilidades no repositório de apps.

O MVP pode ser simples. Não pode afirmar funcionalidade que não existe, expor dados sem grants, quebrar update/rollback ou promover catálogo não assinado.
