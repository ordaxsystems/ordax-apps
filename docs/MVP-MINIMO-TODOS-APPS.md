# MVP MÍNIMO — todos os aplicativos antes do polimento individual

**Decisão de execução (2026-10-08):** o próximo marco não é aperfeiçoar um app de cada vez; é permitir que **cada app first-party elegível tenha a menor unidade coerente com o OrdaX OS**, com importação pelo catálogo e atualizações versionadas posteriores. O escopo funcional inicial pode ser simples, mas cada funcionalidade anunciada precisa funcionar e falhar de modo seguro.

Este documento fixa a ordem de trabalho. **Não substitui** os SSOTs: `ordax-apps.workspace.json` (alvos e ownership), `apps/<id>/app.json` e metadados adjacentes (identidade), `platform-sdk.lock.json` (contratos publicados), `tools/app-package/catalog_inventory.py` (elegibilidade do catálogo), e a plataforma (lifecycle, trust, política MVP e verdade de instalação).

## Definição de mínimo comum por app

1. **Owner único:** há um `apps/<id>/app.json` canônico neste repositório somente **após** source cutover permitido e source antigo removido. Apps ainda platform-owned não recebem cópias ou skeletons fictícios.
2. **Identidade e metadados:** manifesto `ordax.component-manifest/1` com `owner`, id, semver, `component-slot` quando esta modalidade for suportada; AI manifest declarativo `authority:none`, action manifest `proposal-only` e provider manifest verificados. A declaração não autoriza ação.
3. **Compatibilidade pública:** um único `compatibility.json` local ou `migrations/<id>.compatibility.json`, conforme owner existente; os `requires` obrigatórios devem existir no App SDK pinado. Sem imports privados, grants improvisados ou host paralelo.
4. **Runtime mínimo real:** entrypoint canônico exporta `componentRuntime` com schema, identidade e versão do manifesto, aceita somente ports autorizadas; UI ou uma operação mínima útil, estado/erros claros, limpeza de subscriptions/URLs/listeners e destroy seguro. Não confundir teste Node com prova de host nativo.
**Ciclo de vida visual no MVP:** quando duas superfícies montam o mesmo app,
cada instância mantém e remove seu próprio `<link rel="stylesheet">`,
sem reivindicar o stylesheet de outra janela ou do host. O navegador pode
reutilizar os bytes em cache, mas a posse e o `destroy()` permanecem locais
ao mount. A Foundation verifica o comportamento real em duas janelas para
Calculator e Calendar e impede o retorno da reutilização global sem posse
nos outros runtimes, inclusive Notes. Isso não cria host, gerenciador paralelo de CSS ou
dependência entre pacotes.

5. **Empacotamento:** `tools/app-package/build.py` é o único builder; ZIP, compatibility e release sidecars têm identidade e hashes verificáveis, são determinísticos e entregam handoff não assinado. Testes de contrato e smoke fazem parte da Foundation.
6. **Entrada no catálogo:** `tools/app-package/catalog_inventory.py` deriva os apps elegíveis; `render_store_catalog_candidate.py` agrega somente handoffs comprovados do **mesmo commit**. Artefato não assinado é **entrada de catálogo**, não aplicativo instalável.
7. **Entrega efetiva:** somente o runtime/platform owner pode autenticar assinatura e catálogo v2, selecionar release verificada, instalar, verificar saúde, promover e fazer rollback preservando App Data. A Store apresenta e solicita, sem poder de instalar ou conceder permissões. Sem essas provas, manter `blocked`/não instalável — nunca habilitar flags como atalho.

**Regra de produto:** todos os 20 alvos devem aparecer na auditoria, inclusive os bloqueados. Não exigir para essa fase: funcionalidades avançadas, IA obrigatória, alarmes de background, edição de PDF, cloud/sync, desenho persistente ou suporte a todos os formatos. Essas extensões chegam por atualização do app ou Stable release oficial quando os contratos necessários existirem.

## Estado real — baseline de outubro/2026

A execução de `python3 tools/verify_mvp_app_minimum.py --minimum-candidates 13 --format markdown` deriva cada status a partir do inventário original e **não grava um segundo catálogo**.

| Situação | Alvos | Próxima ação |
| --- | --- | --- |
| **13 com source, metadados e descriptor para candidato não assinado** | `notes`, `calculator`, `clock`, `converter`, `text-viewer`, `image-viewer`, `calendar`, `colors`, `character-map`, `paint`, `media-player`, `pdf-viewer`, `toolbox` | Manter gates G0/G1/G2 e testar os candidatos na cadeia assinada oficial; não fazer polishing extra antes dos alvos bloqueados |
| **Distribuição especial** | `studio` | Source portátil canônico próprio OS/Windows; não aplicar descriptor ou runtime fictício só para aumentar a contagem |
| **Source ainda pertence à plataforma** | `files`, `projects`, `internet`, `assistant`, `activity`, `network` | Os seis têm source real em `ordaxsystems/prototipo-ordax-os/system/apps/<id>`; registrar o Gate A remove-first antes de transferir código ou autorizar distribuição |


A verificação de **13** é um piso de regressão, não uma contagem manual de identidades nem um compromisso de 13 releases em produção. Aumentar o piso conforme novos apps tornam-se elegíveis, nunca diminuí-lo para esconder regressões. Estado de instalação pública validada permanece **zero** nessa auditoria, porque o verificador não consulta a autoridade nativa.

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
