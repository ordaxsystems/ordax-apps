# OrdaX 3D — plano de evolução

## Princípio do produto

Construir uma estação de trabalho 3D confiável: preparação e fatiamento com resultados produzidos por um motor real, configuração rastreável, validação antes da impressão e IA que explica o que sabe, mostra suas evidências e pede revisão antes de alterar o projeto. A interface de desenvolvimento continua sendo a interface real de cada app; o host só injeta serviços pelo contrato público.

## Etapas

| Etapa | Resultado verificável | Estado |
| --- | --- | --- |
| 0. Base de produto e host | Apps separados, contratos públicos de dados/arquivos/Intelligence e hosts diretos para desenvolver cada produto. | Feita nesta base de protótipos |
| 1. Copiloto confiável | Saída JSON estruturada, validação de esquema e limites no cliente, contexto tipado, sugestões revisáveis, sem execução implícita. | Implementado nesta branch; reiniciar o host local ativa o modo estrito da Groq |
| 2. Motor real | Integrar OrcaSlicer como primeiro adaptador local opcional; detectar versão e capacidades, aceitar perfis instalados/importados, executar em processo isolado, cancelar trabalhos e guardar logs/identidade do motor. Só exportar G-code gerado pelo engine. | Pendente; engine não instalado/conectado |
| 3. Perfis e compatibilidade | Catálogo de impressoras, bicos e materiais com origem/licença/versão, importação dos formatos upstream, validação de limites e combinação compatível antes de fatiar. Substituir referências visuais atuais por perfis selecionáveis com proveniência. | Pendente |
| 4. Projeto e geometria | Projetos reproduzíveis com arquivos/3MF, múltiplas placas, transformações e processos preservados; inspeção real da malha, unidades, reparos sugeridos e histórico de alterações. | Parcial: importação e edição local; reparo e persistência portável pendentes |
| 5. Preview e análise de fabricação | Mostrar o G-code do motor por camada/tipo de extrusão; estatísticas reais, limites da máquina, conflitos, avisos de material e comparação antes/depois. Todo número derivado do resultado do engine deve identificar sua origem. | Pendente; preview atual não substitui saída do slicer |
| 6. IA ligada ao trabalho real | Copiloto recebe dados derivados localmente da malha e do slicer, explica avisos, compara perfis, propõe calibrações e configurações com justificativa/confiança/evidências; aplica mudanças só após revisão e oferece desfazer. Envio de arquivos a provedores externos exige escolha explícita; análise local é preferida quando disponível. | Parcial: Groq de desenvolvimento recebe metadados; não recebe arquivos nem resultados de fatiamento |
| 7. Impressoras e calibração | Conectar impressoras pelo gateway autorizado, acompanhar estado/fila e executar calibrações com confirmação explícita, limites de segurança e registro do resultado. | Pendente; não há controle de hardware neste app |
| 8. Comunidade e distribuição | Projetos compartilháveis, perfis importáveis com procedência, extensões assinadas, compatibilidade entre Spaces, atualizações e Loja, respeitando licenças do motor e dos perfis. | Pendente |

## Decisões técnicas e de confiança

- OrcaSlicer é o primeiro candidato de motor por oferecer CLI sem interface, perfis e ações de fatiamento/estatísticas; a integração deve usar uma instalação local controlada pelo usuário. Avaliar compatibilidade de licença e distribuição antes de embutir ou redistribuir qualquer binário.
- A CLI oficial aceita presets de processo/máquina e filamento, fatiamento por placa, exportação e estatísticas JSON. Para composição de placa, `--load-assemble-list` recebe a lista completa de placas, objetos e parâmetros, mas não pode ser combinada com arquivos de modelo posicionais nem com flags de transformação. O adaptador deve criar a lista completa a partir do projeto importado e mapear nela as transformações e atribuições por objeto/processo; confirmar esse mapeamento com a versão do engine antes de anunciar suporte.
- O host não deve criar G-code de demonstração, estimativas que pareçam resultados de fabricação ou ações ocultas. Ausência de engine/perfil compatível deve bloquear fatiamento e explicar o que falta.
- A IA ajuda a interpretar contexto e propor mudanças; cálculos críticos, validações e aplicação de limites permanecem determinísticos no app/motor. Cada sugestão precisa indicar a que objeto/processo se aplica e permanecer revisável/desfazível.
- A integração Groq atual é apenas um adaptador local de desenvolvimento. Chaves e dados de produção pertencem ao serviço OrdaX Intelligence, não ao navegador nem ao bundle do app.

## Próximas entregas

1. Ativar e validar no host Groq a resposta estruturada implementada nesta entrega.
2. Definir o contrato de descoberta/instalação local do engine e converter uma instalação OrcaSlicer existente em `host.slicer`, sem fingir capacidade quando não houver engine.
3. Fazer a matriz de suporte entre formatos, operações por objeto/processo e CLI upstream; ajustar o contrato antes de prometer recursos que o motor não executa.
4. Usar um perfil upstream real para produzir um trabalho demonstrativo local completo: importar → validar → fatiar → inspecionar saída/estatísticas → exportar.
5. Expandir contexto da IA com diagnósticos locais verificáveis e resultados reais do slicer; manter o envio de geometria fora do provedor até uma escolha explícita de privacidade.

## Referências de integração

- [OrcaSlicer CLI Mode](https://github.com/OrcaSlicer/OrcaSlicer/wiki/cli_mode)
- [OrcaSlicer CLI Actions](https://github.com/OrcaSlicer/OrcaSlicer/wiki/cli_actions)
- [OrcaSlicer CLI Misc](https://github.com/OrcaSlicer/OrcaSlicer/wiki/cli_misc)
- [Repositório e licença do OrcaSlicer](https://github.com/OrcaSlicer/OrcaSlicer)
