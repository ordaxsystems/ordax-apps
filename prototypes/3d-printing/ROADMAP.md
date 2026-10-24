# OrdaX 3D — plano de evolução

## Princípio do produto

Construir uma estação de trabalho 3D confiável: preparação e fatiamento com resultados produzidos por um motor real, configuração rastreável, validação antes da impressão e IA que explica o que sabe, mostra suas evidências e pede revisão antes de alterar o projeto. A interface de desenvolvimento continua sendo a interface real de cada app; o host só injeta serviços pelo contrato público.

## Etapas

| Etapa | Resultado verificável | Estado |
| --- | --- | --- |
| 0. Base de produto e host | Apps separados, contratos públicos de dados/arquivos/Intelligence e hosts diretos para desenvolver cada produto. | Feita nesta base de protótipos |
| 1. Copiloto confiável | Saída JSON estruturada, validação de esquema e limites no cliente, contexto tipado, sugestões revisáveis, sem execução implícita. | Implementado nesta branch; reiniciar o host local ativa o modo estrito da Groq |
| 2. Motor real | Integrar OrcaSlicer como primeiro adaptador local opcional; detectar versão, executar em processo isolado, cancelar trabalhos e só exportar G-code gerado pelo engine. | Adaptador do host implementado; aguarda instalação/perfis locais e E2E real. Escopo inicial: processo uniforme por mesa. |
| 3. Perfis e compatibilidade | Catálogo de impressoras, bicos e materiais com origem/licença/versão, importação dos formatos upstream, validação de limites e combinação compatível antes de fatiar. Substituir referências visuais atuais por perfis selecionáveis com proveniência. | Parcial: carrega um JSON local de máquina, processo e filamento, apresenta nomes/dimensões/temperaturas; catálogo, seleção múltipla e verificação real ainda pendentes. |
| 4. Projeto e geometria | Projetos reproduzíveis com arquivos/3MF, múltiplas placas, transformações e processos preservados; inspeção real da malha, unidades, reparos sugeridos e histórico de alterações. | Parcial: importação, edição local e área triangulada por objeto recalculada pelas unidades/escalas atuais; reparo, topologia e persistência portável pendentes |
| 5. Preview e análise de fabricação | Mostrar o G-code do motor por camada/tipo de extrusão; estatísticas reais, limites da máquina, conflitos, avisos de material e comparação antes/depois. Todo número derivado do resultado do engine deve identificar sua origem. | Parcial: preview do G-code e estatísticas do OrcaSlicer incluem tempo, gramas, metros, camadas e tempo por tipo de extrusão quando emitido no JSON. Análises geométricas profundas e validação E2E pendentes. |
| 6. IA ligada ao trabalho real | Copiloto recebe dados derivados localmente da malha e do slicer, explica avisos, compara perfis, propõe calibrações e configurações com justificativa/confiança/evidências; aplica mudanças só após revisão e oferece desfazer. Envio de arquivos a provedores externos exige escolha explícita; análise local é preferida quando disponível. | Parcial: contexto inclui área triangulada local e metadados reais de perfil, motor, versão e estatísticas de extrusão quando houver resultado; sugestões agora declaram confiança e citam IDs de dados validados contra o contexto. Topologia profunda e E2E com engine pendentes. Arquivos e G-code não são enviados. |
| 7. Impressoras e calibração | Conectar impressoras pelo gateway autorizado, acompanhar estado/fila e executar calibrações com confirmação explícita, limites de segurança e registro do resultado. | Pendente; não há controle de hardware neste app |
| 8. Comunidade e distribuição | Projetos compartilháveis, perfis importáveis com procedência, extensões assinadas, compatibilidade entre Spaces, atualizações e Loja, respeitando licenças do motor e dos perfis. | Pendente |

## Decisões técnicas e de confiança

- OrcaSlicer é o primeiro motor por oferecer CLI, presets e estatísticas; a integração usa uma instalação local controlada pelo usuário. Não embutir ou redistribuir binário sem revisão de licença.
- O adaptador inicial carrega três perfis JSON configurados no host, transforma geometria e unidades no navegador e envia somente uma malha STL combinada ao host local. O CLI recebe overrides validados de camada, paredes, preenchimento, suporte e ventoinha; o engine gera G-code e estatísticas. O G-code retorna ao navegador como arquivo e não fica arquivado no diretório temporário.
- Não usar `--load-assemble-list` como base de suporte por peça até validar a versão exata instalada: existem relatos upstream de falha nessa modalidade e não há prova neste workspace de que o problema esteja resolvido na instalação do usuário. Por isso, enquanto o adapter só aceita processo uniforme, ele bloqueia combinações diferentes em vez de simular uma atribuição independente. Um único STL combinado preserva a geometria transformada, mas não as identidades/processos independentes dentro do slicer.
- O status do host valida metadados e limites dos perfis; a compatibilidade efetiva entre máquina, processo e filamento ainda precisa ser confirmada por uma execução real do engine. A ausência do binário nesta máquina impede declarar E2E aprovada.
- A área triangulada é a soma local das faces fornecidas, convertida para mm² e recalculada após as escalas globais/individuais. Faces coincidentes ou internas continuam contadas; esse valor não representa volume fechado, consumo de material nem validação topológica.
- A prévia expõe estatísticas de fabricação extraídas do JSON oficial do motor. Tempo por tipo de extrusão, peso, metros e camadas não são preenchidos por aproximações da interface; quando não vierem no resultado, permanecem identificados como indisponíveis.
- O host não deve criar G-code de demonstração, estimativas que pareçam resultados de fabricação ou ações ocultas. Ausência de engine/perfil compatível deve bloquear fatiamento e explicar o que falta.
- A IA ajuda a interpretar contexto e propor mudanças; cálculos críticos, validações e aplicação de limites permanecem determinísticos no app/motor. Cada sugestão precisa indicar a que objeto/processo se aplica e permanecer revisável/desfazível.
- Confiança da sugestão é uma avaliação declarada pela IA, não uma probabilidade calibrada. Os IDs citados são aceitos somente quando o dado correspondente foi incluído no contexto; isso melhora a rastreabilidade, mas não transforma uma inferência em diagnóstico do motor.
- A integração Groq atual é apenas um adaptador local de desenvolvimento. Chaves e dados de produção pertencem ao serviço OrdaX Intelligence, não ao navegador nem ao bundle do app.

## Próximas entregas

1. Configurar o host Groq com uma instalação OrcaSlicer e perfis reais exportados, preservando a chave Groq apenas na memória do processo.
2. Executar o fluxo completo com modelo de teste local: importar → validar geometria/área útil → aplicar transformações → fatiar → comparar preview e estatísticas com OrcaSlicer → exportar.
3. Corrigir incompatibilidades encontradas e registrar a matriz validada de versões, formatos, settings e perfis.
4. Investigar uma rota upstream estável para processos distintos por peça; habilitá-la somente depois de um E2E com configurações divergentes e comparação do G-code.
5. Expandir a IA com explicação de avisos e comparação de resultados reais; manter geometria e G-code fora do provedor até uma escolha explícita de privacidade.
6. Expandir as medições locais com diagnósticos topológicos que tenham tolerâncias documentadas e custo de memória limitado; não transformar a contagem de área em um certificado de malha imprimível.

## Referências de integração

- [OrcaSlicer CLI Mode](https://github.com/OrcaSlicer/OrcaSlicer/wiki/cli_mode)
- [OrcaSlicer CLI Actions](https://github.com/OrcaSlicer/OrcaSlicer/wiki/cli_actions)
- [OrcaSlicer CLI Misc](https://github.com/OrcaSlicer/OrcaSlicer/wiki/cli_misc)
- [OrcaSlicer CLI Transform](https://github.com/OrcaSlicer/OrcaSlicer/wiki/cli_transform)
- [OrcaSlicer CLI assemble-list report #11588](https://github.com/OrcaSlicer/OrcaSlicer/issues/11588)
- [OrcaSlicer CLI assemble-list report #6611](https://github.com/OrcaSlicer/OrcaSlicer/issues/6611)
- [OrcaSlicer Import/Export and statistics](https://github.com/OrcaSlicer/OrcaSlicer/wiki/import_export)
- [Repositório e licença do OrcaSlicer](https://github.com/OrcaSlicer/OrcaSlicer)
