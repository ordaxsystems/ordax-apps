# AGENTS.md — Instruções para agentes e assistentes no ordax-apps

## Leitura obrigatória antes de analisar ou modificar este repositório

1. Ler primeiro [URGENTE-ROADMAP-ORDAX-APPS.md](URGENTE-ROADMAP-ORDAX-APPS.md) para prioridades, ordem de implementação, escopo e riscos.
2. Ler [README.md](README.md), [HANDOFF.md](HANDOFF.md) e [apps/README.md](apps/README.md) para ownership, estado real e regras de distribuição.
3. Para ações/IA, ler [docs/APP-INTELLIGENCE.md](docs/APP-INTELLIGENCE.md). Para Studio, ler [docs/STUDIO-BOUNDARY.md](docs/STUDIO-BOUNDARY.md). Para utilitários, ler [docs/BASIC-APPS.md](docs/BASIC-APPS.md).
4. Conferir manifests, locks, migrations, contratos públicos e CI **atuais** antes de propor ou executar mudanças. O roadmap é planejamento, não substitui a fonte de verdade do código nem autoriza produção.

## Intelligence global, ChatGPT e plugin MCP

Antes de alterar chat Studio, catálogo dos apps, provider adapters ou integração Web, consultar [INTELLIGENCE-HANDOFF.md no owner OS](https://github.com/ordaxsystems/ordax-os/blob/main/INTELLIGENCE-HANDOFF.md), [docs/STUDIO-CHATGPT-THREE-SURFACES.md](docs/STUDIO-CHATGPT-THREE-SURFACES.md) e [docs/APP-INTELLIGENCE.md](docs/APP-INTELLIGENCE.md). Intelligence é do OS; Studio é consumidor; conector MCP é do Platform. Não confundir ChatGPT como provedor da UI com ChatGPT externo controlando OrdaX. PRs experimentais não são release.

## Regras que não podem ser contornadas

- `ordaxsystems/ordax-apps` é owner dos produtos first-party; plataforma, Runtime e Control Plane mantêm seus próprios serviços e autoridade.
- Não duplicar Identity, Memory global, Intelligence router, permissões/grants, sync, trust, signing, updater, pairing ou execução de dispositivos.
- Apps usam contratos públicos/versionados; manifests de IA/actions descrevem intenções/propostas e **não concedem execução**.
- Não usar raw filesystem paths, shell, segredos ou APIs privadas para contornar grants.
- Store não tem autoridade de instalação. Source cutover, package, publication e production activation são gates diferentes.
- Notes continua sujeito ao trust gate operacional canônico. Studio permanece provider-neutral, com source portátil único para OS/Windows.
- Não confundir ideia, `app.json`, package candidate, CI verde ou demo com release disponível.
- Não incorporar código externo sem revisão de licença, segurança, provenance e manutenção.

## Prioridade de produto (MVP)

Antes de iniciar outra rodada de polimento individual, ler [docs/MVP-MINIMO-TODOS-APPS.md](docs/MVP-MINIMO-TODOS-APPS.md) e executar `python3 tools/verify_mvp_app_minimum.py --minimum-candidates 13 --format markdown`. Priorizar completar estrutura/ports/pacote de todos os 20 alvos sem inventar source ou grants onde os owners ainda não autorizaram. O verificador gera apenas evidência de candidato não assinado; não representa catálogo verificado nem instalação. Bugs de segurança/corrupção de dados continuam prioridade imediata.

## Como trabalhar

- Vincular cada mudança ao item/épico do roadmap ou justificar claramente a exceção.
- Declarar owner, contratos/dependências, risco, testes e critérios de aceite.
- Implementar o menor incremento seguro e verificável; bloquear quando faltar contrato público.
- Atualizar o roadmap quando uma decisão, dependência ou estado **comprovado** mudar.
- Em caso de divergência, prevalecem contratos/locks/CI e políticas canônicas; corrigir a documentação, não enfraquecer os gates.

Estas instruções aumentam a chance de o roadmap ser lido por agentes que respeitam `AGENTS.md`; não garantem leitura automática por todas as ferramentas ou pessoas.
