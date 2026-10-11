# ORDAX Studio — modos padrão e Central

**Decisão:** um único Studio e uma única base de código, sem dois executores, brokers, bancos ou históricos. O modo padrão prioriza conversas, projetos e preview; a Central organiza informações operacionais.

A Central é uma página da mesma aplicação. O código `apps/studio/conversation/src/central.mjs` consulta `host.runtimeState()` (dispositivos Product autorizados e recibos) e `host.relayObservation()` (laboratório local). Não executa comandos, não altera permissões e não infere disponibilidade a partir de uma data: `online=null` aparece como presença desconhecida. O laboratório nunca é anunciado como serviço de IA compartilhada.

**Limites atuais:** conversas remotas por cliente, streaming multi-PC, imagens e entrega segregada ainda exigem contratos autenticados do owner Intelligence/Model Router. Os históricos pessoais do WebView não são tratados como conversas de computadores remotos. A Central no host de testes ainda reporta Product desconectado e Relay não configurado.

**Evidências:** 41/41 testes da interface em checkout isolado no Windows, além do Electron nativo e do candidato Windows em CI. O candidato portátil 0.14.1 tem 152 arquivos verificados; permanece sem assinatura e não é o instalador oficial. O owner do host publicado é `ordaxsystems/ordax-runtime`.

Próximo aceite: owner/cliente/dispositivo/conversa/requisição/recibo precisam ser vinculados por autoridade canônica antes de exibir chats por computador ou declarar Relay em produção. Falhas de grant por Space no plugin público continuam abertas até implantação comprovada, não apenas CI verde.
