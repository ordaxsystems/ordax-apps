# Aplicativos básicos do OrdaX

## Regra de classificação

Um recurso não deve entrar no core apenas por vir instalado de fábrica.

### Plataforma / nativo estrutural

Permanece em `prototipo-ordax-os` quando é necessário para boot, segurança, autoridade ou manutenção do próprio sistema. Exemplos: Store estrutural, Settings, Account, System, Identity, permissions, component lifecycle, recovery e trust.

### App first-party

Pertence a `ordax-apps` quando é uma experiência de usuário que pode ser versionada, atualizada, removida e reinstalada sem alterar a autoridade do sistema. Exemplos: Calculadora, Notas, Studio, Projects e futuros apps de Relógio/Timer, mídia ou produtividade.

### Tool / capability

Uma tool/capability é a superfície semântica de uma ação fornecida por um app, não substitui o app. Exemplo:

```text
Calculadora (app)
  └─ calculator.calculate (capability)
```

A capability ensina o Intelligence a rotear intenção, mas não concede autoridade.

## Primeiro app nascido externo

`apps/calculator` é o primeiro app básico criado diretamente no repositório de apps, sem existir primeiro no core do OS.

Objetivos arquiteturais:

- provar que app simples não precisa de API privada;
- manter instalação e atualização independentes do Base OS;
- exercitar runtime, localization, AI manifest e Application Actions;
- manter zero autoridade e zero acesso privilegiado;
- servir de referência pequena para próximos apps.

## Próximos candidatos

- **Relógio**: relógio mundial e cronômetro podem ser app-owned; timers em background devem esperar contrato público de scheduling/notifications, sem polling oculto ou daemon próprio.
- **Visualizador de mídia**: app-owned, consumindo file grants públicos em vez de caminhos brutos.
- **Editor de texto simples**: app-owned, reutilizando File Space e grants públicos; não duplicar Notes.
- **Conversões matemáticas**: preferencialmente modos da Calculadora para evitar micro-apps redundantes.
- **Terminal**: não é app básico inocente; envolve execução de processos e deve continuar atrás de authority explícita do sistema, nunca embutida por conveniência.

## Invariante

Nenhum app básico pode copiar Identity, Memory, updater, permissions, sync, Store authority ou serviços centrais para dentro de seu pacote.


## Matriz de aplicativos básicos do MVP

Estado arquitetural em 2026-10-07:

| Recurso | Forma correta | Estado |
|---|---|---|
| Calculadora | app first-party | implementado |
| Conversor de unidades | app first-party | implementado |
| Relógio | app first-party | implementado |
| Cronômetro | recurso do Relógio | implementado |
| Temporizador | recurso foreground do Relógio | implementado |
| Calendário | app first-party | implementado em modo local/read-only |
| Visualizador de texto | app first-party | implementado |
| Visualizador de imagens | app first-party | implementado |
| Áudio/vídeo | Media Player first-party | implementado; requer media-preview público |
| PDF | PDF Viewer first-party | implementado; requer document-preview público |
| Alarmes/background timer | recurso do Relógio | bloqueado até scheduling/notifications público |
| Eventos de calendário | recurso do Calendário | bloqueado até persistência/scheduling público |
| Câmera | app first-party futuro | bloqueado até camera/permission broker público |
| Gravador de áudio | app first-party futuro | bloqueado até capture/permission broker público |
| Captura de tela | app first-party futuro | bloqueado até screen-capture grant público |
| Área de transferência | app/recurso futuro | bloqueado até clipboard permission contract |
| Compactador/ZIP | app first-party futuro | bloqueado até binary file I/O público e bounded |
| Editor de imagem/Paint | app first-party futuro | canvas local é possível, mas salvar deve esperar write/file-picker grant adequado |
| Terminal | app privilegiado futuro | não é utilitário inocente; requer process-execution authority explícita |
| Clima | app/conector futuro | requer fonte de rede autorizada e dados atuais |
| Mapas | app/conector futuro | requer rede/geodados autorizados |
| E-mail | conector/app futuro | requer identidade/OAuth e provider contract |
| Contatos | app futuro | requer storage sensível e permission boundary |
| Calculadora de câmbio | recurso/conector | não deve usar taxa estática; requer fonte atual autorizada |

### Regra de MVP

Ter um ícone não conta como ter um app.

Um aplicativo básico só é considerado implementado quando possui:

1. runtime funcional;
2. `app.json` canônico;
3. compatibility descriptor;
4. localization apropriada;
5. `ai/manifest.json`;
6. Application Actions fail-closed;
7. package determinístico;
8. testes de boundary/comportamento;
9. CI verde;
10. nenhum acesso privado ao host;
11. lifecycle de instalação independente compatível com o OrdaX OS.

Quando uma capacidade depende de autoridade ainda inexistente, o app deve permanecer parcial e explícito, ou bloqueado, em vez de criar um fallback privilegiado.
