# Renovação autenticada Runtime → Lab — candidata 2026-10-21

Owner Apps: protocolo privado e estado da lease do mesmo serviço.
Owner Runtime: autorização Product fresca antes/depois, cliente e launcher.
Owner Platform: grants reais, registro de instalação e MCP público, pendentes.

## Contrato e comportamento

Alpha.3 anuncia `leaseRenewal: hmac-sha256-key-rotation/1` no bootstrap de
`ordax.orchestrator-host/1`. O host pode enviar `$lease_renew` assinado pela
chave atual, somente na sessão ainda válida, com nova chave efêmera e prazo
estritamente maior e limitado a cinco minutos. O host limita também ao grant
atual e exige o mesmo usuário, cliente, dispositivo e grant antes e depois.

O App mantém identidade, perfil, build, processo e capabilities de leitura.
Rotaciona e apaga a chave anterior antes de limpar o conjunto limitado de IDs:
frames antigos continuam inválidos. Nenhuma escrita ou chamada ao serviço é
introduzida. Renovação durante leitura ativa é recusada. Lease vencida não é
reativada. Erro, resposta atrasada, revogação ou fechamento explícito invalidam
o cliente sem repetir renovação, bootstrap ou mensagens.

O host solicita a renovação explicitamente; não há scheduler/timer novo.
Clientes antigos continuam lendo; host novo não renova com App antigo sem o
anúncio do contrato. O catálogo compartilhado de 14 ferramentas não muda:
renovação é controle privado do transporte, não ferramenta pública.

## Evidência local

- 350 testes do produto aprovados, incluindo renovação, replay, limites e corrida com leitura.
- 38 testes do bootstrap aprovados; versão canônica alpha.3 projetada nos pacotes/lock.
- 28 testes Python focados: 23 passaram e cinco exclusivos do Windows foram pulados no Linux.
- Cliente Python real e módulo JavaScript real em processos separados: 361
  rotações, 24 horas de relógio simulado, mesma sessão, leitura após renovação,
  rejeição de chave anterior e revogação antes de transmitir qualquer frame.

O workflow Windows fixa o Runtime por commit e exige o mesmo teste do protocolo
mais renovação no Electron empacotado, leitura posterior e preservação do App
ao fechar. Consultar o resultado remoto antes de declarar esta prova aprovada.

## Limites e aceite

Simulação não comprova autonomia real de 24 horas. Instalação/provenance oficial,
grant OAuth real, publicação do MCP, monitor de inatividade e supervisor contínuo
seguem pendentes. Não há instalação no computador do usuário, envio ao GPT,
chamada paga, migração de perfil, alteração do Grátis/Flow ou distribuição.

PRs existentes Apps #268 e Runtime #182 permanecem candidatas. Risco principal:
ACK perdido após rotação deixa os peers com chaves diferentes; a sessão é
invalidada e nunca se tenta adivinhar/repetir a renovação. Atualizadores ainda
precisam drenar sessões e liberar pins antes de substituir arquivos.
