# Studio — dependências do preview e instalação

Incremento MVP-04/Studio solicitado pelo usuário em 2026-10-09. UI/source único em `ordaxsystems/ordax-apps`; execução/host Windows em `ordaxsystems/ordax-runtime`; contratos/instalação e lifecycle do OrdaX OS no owner da plataforma. Candidato local 0.8.0, sem promoção de instalação.

## O que existe neste pacote

| Camada | Candidato Windows portátil | Integração OrdaX OS |
| --- | --- | --- |
| Renderização, navegador manual e viewport responsivo | Electron/Chromium e arquivos de runtime incluídos; sem instalação separada de Chrome, Node ou npm para abrir o app | Usar o host de renderização da plataforma; adapter do novo port ainda não integrado/validado |
| Servidor do projeto e escolha de porta | Não provisionado neste candidato; endereço deve apontar para servidor ativo | Runtime canônico precisa publicar/integrar o lifecycle e o endereço alcançável |
| Node/Python/framework/banco do projeto | Não incluídos nem instalados automaticamente; dependem do projeto/dispositivo autorizado | Preparação pela infraestrutura canônica, conforme projeto, sem novo instalador dentro do Studio |
| Instalador, atualização e rollback | Este artefato é pasta portátil local sem assinatura/instalador; não inclui todo o ORDAX Runtime oficial | Gates de component/compatibility/health/trust continuam pendentes para Studio |

O Node embutido no Electron executa o host do aplicativo. Não fornece um `node`/`npm` de projeto instalado no PATH nem substitui Node/Python/bancos exigidos por um servidor. Um site já publicado ou servidor ativo pode ser mostrado sem iniciar código local pelo Studio.

No source atual de `ordax-runtime/ordax_dev_agent/preview_actions.py`, o start local para package.json procura npm instalado e script `dev`, com tratamento para Vite/Next. Esse código não instala automaticamente as dependências do projeto. Sua existência não autoriza start pelo Product API: o gateway deste cliente expõe somente consulta de estado e remove URL, conforme [STUDIO-PREVIEW-HANDOFF.md](STUDIO-PREVIEW-HANDOFF.md).

## Como deve funcionar a distribuição oficial

Windows deve instalar Studio e ORDAX Runtime compatível pelo instalador do owner Runtime, mantendo o mesmo source portátil e dados de usuário. OrdaX OS fornece os ports da plataforma e não deve receber uma segunda cópia do Runtime. Os gates e owners vêm de `migrations/studio.distribution.json`; `app.json.dependencies=[]` não comprova que essa integração foi entregue.

A preparação de um projeto deve apresentar requisitos detectados, disponibilidade, versão e instalação/erro pelo Runtime autorizado. Não instalar todos os frameworks/bancos globalmente, baixar executáveis no frontend ou executar `npm install` para contornar um contrato ausente. É necessário um contrato público de preparação de ambiente e preview antes de oferecer a instalação automática.

Aceite de distribuição: Windows limpo abre sem ferramentas de desenvolvimento; OS monta pela plataforma; projeto autorizado recebe ambiente/host conforme contrato; URLs são alcançáveis no dispositivo cliente; mobile/tablet/desktop renderizam; upgrade/rollback/uninstall preservam dados. Esses testes de instalação oficial ainda não foram realizados para esta tela.

## Evidência do candidato

O builder inclui `candidate-dependencies.json`, com o runtime de apresentação incluído e os recursos de execução/instalação ausentes. É relatório do artefato local, não contrato de autorização ou promessa de release. As fixtures verificam o viewport CSS real e o navegador em sessões isoladas; não certificam uma instalação limpa, conta real ou preparação de projeto.

Referências do adaptador: [emulação de viewport no Electron](https://www.electronjs.org/docs/latest/api/web-contents#contentsenabledeviceemulationparameters), [histórico de navegação](https://www.electronjs.org/docs/latest/api/navigation-history).
