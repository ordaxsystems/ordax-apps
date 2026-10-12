# Rede — Network

Aplicativo OrdaX de comunidades e mensagens, com identidade profissional vinculada
ao **Space remetente**. A fonte oficial está somente em `ordaxsystems/ordax-apps`,
após a remoção em `ordax-os` no commit `b0bad623`.

## Funcionalidade disponível neste candidato

- Interface de Rede com diretório, comunidades e mensagens com estado honesto de
  **serviço ainda não ativado**; sem criar conversas ou histórico falsos.
- Exibição do Space selecionado e rascunho, quando o host fornecer uma porta
  de Rede validada (`ordax.network-draft/1`), vinculada à Conta e ao Space.
- Troca explícita de remetente e limpeza de rascunho; nunca envia sem um serviço
  autenticado real. O botão Enviar permanece desabilitado.

Toda a interface e as traduções pt-BR/en-US pertencem ao pacote do aplicativo.
Wi-Fi, conectividade, credenciais e o serviço de rascunhos permanecem no OS.

## Contratos e distribuição

- App SDK canônico **1.17**, fixado por commit/hash em `platform-sdk.lock.json`.
- `src/sdk/network-draft.mjs` contém **os mesmos bytes** do contrato público
  do SDK 1.17 (verificação de git blob nos testes). Não inclui implementação do
  serviço. `src/sdk/surface-lifecycle.mjs` é um adaptador local de validação.
- O pacote é um **candidato não assinado**. Manifestos de ações e inteligência
  são declarativos, sem executar mensagens, conceder grants ou instalar.
- Disponibilidade real depende de binding Native confiável, pacote assinado,
  verificações de instalação, saúde e rollback. Nenhum destes é autorizado
  automaticamente por este pacote.

Ver `migrations/network.externalization.json` para gates ainda não provados.
