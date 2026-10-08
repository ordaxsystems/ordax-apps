# Auditoria de topologia híbrida — aplicativos oficiais e OrdaX Studio

**Data:** 2026-10-08  
**Tipo:** evidência arquitetural e decisão de consolidação do MVP, **não** autorização de migração ou publicação.  
**Base auditada:** `ordaxsystems/ordax-apps` `main@2c9c3d10497a3a5757819533258b9794967f4291`. Repositórios relacionados examinados nas respectivas `main`: `ordaxsystems/ordax-os`, `ordaxsystems/ordax-runtime` e `ordaxsystems/ordax-platform`. Há mudanças simultâneas: atualizar a evidência ao iniciar uma implementação.

## Decisão executiva

**Preservar `ordax-apps` como monorepo oficial de aplicativos comuns. NÃO extrair agora o Studio, o Notes nem qualquer outro app como pré-requisito do MVP.** A topologia híbrida já permite separar ownership e pipelines de distribuição: aplicativo portátil em `ordax-apps`, Windows host/instalador em `ordax-runtime`, lifecycle/trust/Store em `ordax-os` e Control Plane/conectores em `ordax-platform`.

**A unidade de instalação, versão e rollback é o componente assinado, não o repositório Git.** O aplicativo não ganha autoridade por ser oficial, estar em catálogo ou possuir fonte separada. Uma extração de código não pode alterar App SDK, trust, catálogo, permissões, app-data, updater, grants ou identidade da release.

A decisão é **reversível**: reavaliar uma extração somente quando autonomia de release, risco operacional ou gargalo de CI forem demonstrados com métricas e quando existir capacidade de preservar a cadeia assinada e o histórico sem source duplo. Até lá, priorizar consolidação, homologação, revisão das PRs existentes e estabilidade da `main`.

## Evidências verificadas (snapshot)

1. `ordax-apps.workspace.json` define 20 alvos first-party, contratos públicos e `single-repository-per-app`, com `ordaxsystems/ordax-os` como owner da plataforma e proibição de mirror, dual authority ou dependência de redirects.
2. O conjunto possui 13 candidatos a pacote não assinado, Studio com distribuição especial e seis alvos que permanecem platform-owned até cutover: Files, Internet, Assistant, Projects, Activity e Network. Contagem derivada do inventário e documentada em `docs/MVP-MINIMO-TODOS-APPS.md` — não indica 13 instalações possíveis ou releases publicadas.
3. `apps/studio`: 28 blobs, aproximadamente 200 KB de arquivos versionados na árvore auditada; `apps/notes`: 38 blobs, aproximadamente 316 KB. Tamanho do Studio **não é**, sozinho, argumento para fragmentação. O workspace contém 331 blobs no total.
4. `apps/studio/app.json` é a identidade portátil com `id=studio`, versão `0.5.8` e `releaseMode=component-slot`. `migrations/studio.distribution.json` exige mesma fonte para OS/Windows, proíbe forks por host/provider, fixa instalador `ORDAX-Studio-Setup-<version>-x64.exe` e ainda registra `cutover_allowed=false`.
5. `ordax-runtime/studio-source.lock.json` fixa `ordax-apps@4aee269e5167f5522d84ae635579abb0fc6be184`, pasta `apps/studio`, versão `0.5.8`. O workflow `windows-product-build.yml` obtém a revisão fixada, constrói Windows e executa smoke de instalação/upgrade. O owner do instalador já está fisicamente separado, sem exigir novo repositório do app.
6. `ordax-os/system/apps/studio/component.mjs` ainda declara `id=studio`, `version=0.1.0`, `releaseMode=git-app` e `owner=system/apps/studio`; `runtime.mjs` monta uma superfície de status de Device Agent. **Isso é risco de identidade/ownership e potencial caminho funcional paralelo**, mas NÃO prova por si que ambas as versões são executadas. O owner do OS deve demonstrar, com teste de composição e catálogo, se isso é somente um adapter/placeholder de bootstrap e eliminar qualquer segunda autoridade real antes da ativação do Studio externo. Não remover `system/apps/studio` às cegas.
7. `platform-sdk.lock.json`: App SDK 1.12.0; `contracts/README.md` afirma que contratos públicos são consumidos e não copiados. Notes mantém baseline próprio quando necessário. `tools/app-package/build.py` e `catalog_inventory.py` concentram embalagem/inventário; a Store não assina nem instala.
8. Em `main@2c9c3d1`, os três workflows de push consultados estavam verdes: Foundation (`37836581352`), Notes Unsigned Candidate (`37836581040`) e Store Catalog Candidate (`37836581286`). **CI verde não equivale a disponibilidade Native, segurança de produção ou assinatura de release**. A API de Releases do repositório de apps não listou releases publicadas.
9. PR concorrente em `ordax-apps`: #181 (domínios de Sales/Inventory). PR concorrente do OS: #1386 (gate de leitura Native de módulos). Não sobrepor esses owners em um esforço de topologia.
10. Documentação histórica em `docs/ARCHITECTURE.md`, `contracts/README.md`, `HANDOFF.md` e trechos do roadmap ainda se refere a aliases antigos como `prototipo-ordax-os` e `ordax-control-plane`. O SSOT de repositórios é o workspace e as migrations atuais. Corrigir links textuais stale em mudança separada e revisada, sem alterar IDs de contratos nem introduzir novo SSOT.

## Matriz de decisão (MVP)

| Produto / grupo | Fonte recomendada agora | Justificativa | Estado de extração |
| --- | --- | --- | --- |
| Calculadora, Relógio, Conversor, Viewers, Paint, Cores, Mapa de Caracteres, Toolbox, Calendário | `ordax-apps` | Contratos, verificações, empacotador e segurança de release compartilhados; CI discovery evita listas paralelas | **Não extrair** |
| Notes | `ordax-apps/apps/notes` | Piloto externo canônico com workflow próprio e lifecycle provado em teste, porém trust de produção ainda bloqueado | **Não extrair** no MVP |
| Studio | `ordax-apps/apps/studio`; instalador/host em `ordax-runtime` | Já possui fonte portátil, lock de versão, workflow Windows e portas públicas; diferencial de autonomia do novo repo ainda não provado | **Candidato futuro condicional**, sem migração agora |
| Files, Internet, Assistant, Projects, Activity, Network | Owner vigente no OrdaX OS até cutover específico | Impedir source duplo e candidato falso; seguir remove-first/ownership gates existentes | **Não duplicar** |
| Finance, Sales, Inventory | Domínios existentes/preparatórios em `ordax-apps` | Não há app instalável autorizado, pois App Data empresarial multi-Space/grants estão pendentes | **Não criar repos/apps fictícios** |

## Regra de Store independente do repositório

- SSOT por aplicativo: `appId`, `version`, compatibilidade pública e source commit exato no manifest/handoff de release. Source provenance indica origem; não é seletor de autoridade.
- O builder produz artefato determinístico, hashes e descriptors. O canal de publicação comprova identidade, provenance, assinatura e monotonicidade antes de disponibilizar blobs content-addressed. Repositório Git não é endpoint de execução ou de instalação no dispositivo.
- Catálogo assinado/verificado expõe disponibilidade; Runtime/lifecycle Native decide `install`, `update`, `uninstall`, `health`, `promote`, `rollback` e inventário instalado. A UI Store apenas solicita. `uninstall` não implica apagar dados do usuário.
- Independentemente de `owner/repo`, um pacote deve passar os **mesmos** contratos, policy/trust, gates de compatibilidade, health, rollback e reinstalação offline. Quando houver vários repos fontes, CI agregadora recebe handoffs verificados por `appId+version+sourceCommit+SHA256`, não descobre apps por hardcode de paths.
- Não criar segundo SDK, package builder, catálogo, updater, assinatura, Runtime, Memory, Identity, Intelligence router ou permissões ao separar uma aplicação.
- Corrigir a integração de módulos Native da Store **no owner do OS**. Não anunciar instalação independente enquanto o host não lê/monta a release e não consegue provar lifecycle real.

## Gatilhos para reconsiderar extração do Studio

Somente abrir decisão técnica separada quando houver evidência mensurável, por exemplo: CI comum atrasa releases independentes de Studio de modo recorrente; segurança/permissões de release exigem owners e approvals diferentes; branch/review/cadência de produto demanda governança própria; checkout/testes dos apps comuns sofrem regressão sistemática pelo Studio; ou manutenção de instaladores cross-host requer versionamento autônomo *do produto*, não só do host Windows. Comparar o custo do novo repo, matriz cross-repo, proteção de branch, testes e tracing de provenance.

**Não basta:** contagem de linhas, complexidade percebida, aparência de organização ou possibilidade técnica de `git filter-repo`.

## Se aprovada no futuro: migração sem paralelismo funcional

1. Registrar ADR específico com métricas, owners, dependências, revisão das PRs/branches, risco de rollback e evidência de CI. Não iniciar durante freeze de MVP.
2. Congelar o boundary portátil exato, version/lock/SDK e hashes do Studio no commit selecionado; preservar histórico Git por split filtrado auditável (sem reescrever o repositório de origem).
3. Criar repo destino com proteções e CI equivalentes, sem copiar serviços de plataforma; portar somente `apps/studio` e ferramentas de build por dependência **publicada** (não por clone/cópia de SDK); testar Windows e OS.
4. Temporariamente manter o path antigo somente para verificação/rollback controlado, **nunca** como segunda fonte de desenvolvimento ou release. Nenhum dual-write ou builds divergentes.
5. Atualizar locks de consumo no Windows e no OS, manifest/provenance e catálogo de modo atômico por revisão, com teste de upgrades, assinatura, health, rollback, reinstalação e preservação de dados; comparar artefatos semantically equivalentes e versions.
6. Publicar o novo source somente após CI e provas em host; fechar PRs antigas por merge/rebase explícito sem perder alterações. Remover o path antigo do build e bloquear import/release residual. Arquivar eventual histórico sem mantê-lo como mirror autoritativo.
7. Ter caminho comprovado de rollback do cutover sem reativar source antigo e sem invalidar instalações existentes. Somente então aposentar rastros/aliases que não sejam necessários a upgrades suportados.

## Próximos gates — sem bloquear MVP

**P0 / agora:** (a) reconciliar PRs/branches e manter `main` verde; (b) confirmar identidade e fluxo de carregamento Studio 0.5.8 versus superfície 0.1.0 no OS; (c) completar os testes de instalação efetiva/host dos apps essenciais com os owners Native; (d) verificar releases assinadas, trust, Store, recuperação e atualização sem false positives; (e) registrar aliases obsoletos em docs para correção incremental.

**P1 / depois:** CI seletiva por paths para reduzir tempo de feedback **sem enfraquecer os gates globais**; telemetria de duração/falhas por aplicativo; reconsideração formal de extração quando os gatilhos acima surgirem.

**Critério de conclusão desta auditoria:** decisão documentada, referências verificáveis, riscos enumerados, nenhuma mudança de app/version/pipeline de produção e nenhum requisito novo bloqueando Stable/MVP. Evidência de CI desta PR deve ser conferida separadamente; este documento não afirma ter executado testes em hosts Windows/OS.
