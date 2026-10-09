# Host local de validação do ORDAX Studio

O diretório mantém seu nome anterior para compatibilidade com comandos existentes. O produto/package é **ORDAX Studio** (versão canônica em `apps/studio/app.json`, conferida com `tools/assistant-host/package.json` pelo builder) e usa o source `apps/studio/conversation`. O preview do projeto fica à direita; novas conversas mostram ChatGPT Web à esquerda. Studio · beta abre a interface de conversa experimental. O envio automatizado requer Chat confirmado; Work ou modo desconhecido bloqueiam a automação. Chat tem limites próprios. Não há outro produto Assistant neste host.

Na raiz de `ordax-apps`:

```powershell
npm.cmd --prefix tools/assistant-host start
npm.cmd --prefix tools/assistant-host test
npm.cmd --prefix tools/assistant-host run test:native
npm.cmd --prefix tools/assistant-host run test:preview
npm.cmd --prefix tools/assistant-host run build:windows
```

O host serve a UI local, uma superfície ChatGPT isolada e um cliente de ações Product com lista fixa. Execução/grants ficam no Runtime/Control Plane. Configuração Product deve vir da sessão autorizada do host; não inserir tokens no frontend. O host oficial de distribuição Windows permanece sob ownership de `ordax-runtime`; este pacote Electron é candidato local de desenvolvimento e validação.

Perfil e login permanecem em `%LOCALAPPDATA%/OrdaX/Assistant-web`; manter este nome interno evita criar uma sessão vazia na troca de marca. Não abrir duas builds contra o mesmo profile. As fixtures usam sessões isoladas sem conta real.

A workflow [Studio Windows Candidate Proof](../../.github/workflows/studio-windows-candidate.yml)
executa o builder real em `windows-2025` e verifica **todos os hashes da pasta**
independentemente, incluindo versão, licença, entrada e contratos de rollout.
Não assina, publica, copia perfis nem ativa o Runtime. E2E com sessão real do
ChatGPT, microfone e computador autorizado permanece uma etapa separada.

Consulte [a matriz de substituição](../../docs/STUDIO-CONVERSATION-REPLACEMENT.md). O builder inclui as UIs de conversa e workspace avançado da mesma fonte, licenças do Electron e hashes. Não inclui perfis, credenciais, testes ou dependências do Codex. A build é local e não assinada; não representa promoção pela Store.
