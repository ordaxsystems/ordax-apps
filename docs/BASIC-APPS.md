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
