# Arquitetura — OrdaX Food

## Decisão de produto

OrdaX Food é um produto portátil. A primeira superfície de desenvolvimento é o navegador; Windows e OrdaX OS são possíveis ambientes futuros. A fonte de interface e domínio deve permanecer única. O diretório `apps/food-pizzeria` fixa o owner do código do produto neste repositório; ele não seleciona plataforma de destino nem declara que exista pacote instalável.

`prototypes/food-pizzeria` contém somente o host local de desenvolvimento. O host injeta o adapter de preview e monta o runtime do produto. Não existe uma segunda implementação de Food no host.

## Limites entre camadas

- `src/domain`: regras de pedidos, cardápio, comandas, fichas técnicas e estoque; não acessa navegador, filesystem ou serviços de plataforma.
- `src/application/commands.mjs`: transforma comandos de negócio serializáveis em transições do domínio. `ordax.food-pizzeria-command/1` é um formato interno do app.
- `src/ports/food-data-port.mjs`: contrato de composição app-owned para inicialização, leitura de snapshot, inscrição, execução de comando e encerramento. `ordax.food-pizzeria-data-port/1` não é contrato público de plataforma nem concede autoridade.
- `src/ui`: interface montável com um elemento raiz e uma porta de dados injetados; não escolhe localStorage, identidade, Space ou transporte.
- `src/adapters/browser-local-store.mjs`: adapter temporário do host de preview. Grava a base fictícia em localStorage, usa Web Locks, aplica revisão esperada e registra os identificadores recentes de comandos.
- `src/fixtures`: dados exclusivamente fictícios para a exploração do app.

## Escopo de negócio e Space

`businessId` identifica o negócio no modelo do produto. No preview, recebe o valor fictício `preview-na-garagem` para separar os dados locais da pizzaria. `businessId` não é `spaceId`, identidade da conta ou grant. O domínio não deve armazenar IDs de Space nem deduzir que uma pizzaria corresponde a um Space.

Uma futura integração pode associar o negócio a um contexto autorizado fornecido pelo host, mas a regra e a autoridade dessa associação pertencem aos contratos públicos dos owners de Platform/OS. App Data local, armazenamento de navegador e este port interno não provam sync multi-dispositivo.

## Compatibilidade futura

Windows e OrdaX OS deverão montar a mesma fonte de UI/domínio e fornecer adapters implementados em cada host. Cada adapter só poderá usar capacidades públicas e versionadas existentes. Se faltar contrato público para identidade, persistência compartilhada, autorização, conflitos ou reconciliação, a integração correspondente permanece indisponível até o owner publicar o contrato. Não se adiciona serviço de sync, login, grants, updater ou instalação paralelo dentro do Food.

A sequência de integração será:

1. consolidar o estado operacional completo do app no domínio versionado;
2. definir com cada owner os ports públicos e o modelo de negócio/Space autorizado;
3. implementar adapters para Browser, Windows e OrdaX OS sem copiar regras do domínio;
4. validar compatibilidade, ciclo de vida e recuperação por plataforma;
5. só então habilitar pacote e distribuição pelos mecanismos oficiais.

## Trabalho pendente que afeta compartilhamento

Pedidos, sabores, comandas, receitas e movimentos de estoque já usam o estado versionado. PDV/turnos, perfis de clientes, equipe, produtos auxiliares e alguns ajustes ainda estão em `mockWorkspace` em memória. Antes de afirmar que o app sincroniza o negócio inteiro, essas entidades precisam migrar para o mesmo modelo de dados e comandos, com migração compatível e sem contadores duplicados.