# Calculadora

Aplicativo first-party portátil do OrdaX para cálculo local.

## Boundary

A Calculadora é um **app**, não um serviço estrutural do sistema. Ela não possui acesso privilegiado, rede, arquivos, contas, App Data ou autoridade de instalação.

O runtime depende apenas do lifecycle público de Surface/localization para montagem e mudança de idioma. Toda avaliação matemática acontece localmente por um parser app-owned; não há uso de `eval()`, `Function()` ou dependências remotas.

## Capability

O app declara `calculator.calculate` para que o OrdaX Intelligence possa entender solicitações de cálculo. O manifesto permanece `authority=none` e a capability permanece `executionAuthorized=false`; o pacote não concede execução ao modelo.

## Escopo 0.1

- operações básicas: +, -, ×, ÷, %, potência;
- parênteses e operadores unários;
- constantes `pi` e `e`;
- funções `sqrt`, `abs`, `sin`, `cos`, `tan`, `ln` e `log`;
- entrada por teclado e botões;
- pt-BR e en-US;
- sem persistência de histórico nesta primeira versão.
