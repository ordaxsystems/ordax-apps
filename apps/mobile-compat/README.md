# OrdaX Mobile Compat — fundação limpa

**Owner:** ordaxsystems/ordax-apps/apps/mobile-compat.

**Objetivo:** criar uma camada independente para executar pacotes Android originais no Windows e, no futuro, OrdaX OS. O caso de validação inicial é o Instagram, fornecido legalmente pelo próprio usuário. Este repositório não contém nem distribui APK, marca, autenticação ou outros dados proprietários do Instagram.

## Estado implementado

O código atual é uma fundação técnica, NÃO é o Instagram funcionando:

- Leitor APK/XAPK limitado, com validação de CRC, offsets, nomes, travessia, duplicatas, criptografia e tamanho expandido;
- identificação e validação de DEX e ABI ELF64;
- ferramenta de inspeção que falha fechada quando se solicita execução do app;
- testes sintéticos sem download de aplicativo proprietário;
- interpretador Dalvik limitado, com tabelas reais DEX (`class_data`, `code_item`), chamadas estáticas, construtores e chamadas virtuais de classe local; objetos em heap isolado, campos `int32`, `new-instance`, `invoke-direct`, `invoke-virtual`, `iget`, `iput`, `move-object`, `return-object` e `move-result-object`;
- arrays de inteiros Dalvik com `new-array`, `array-length`, `aget` e `aput` e alocação tipada em memória do convidado (até 65.536 posições por array e até 262.144 posições no conjunto, além do limite de 4.096 objetos/arrays); acesso inválido, tipo não suportado e retorno de referência guest ao host são recusados;
- fronteira opcional de métodos nativos tipados, vinculada exclusivamente por código host confiável; sem JNIEnv, ponteiros guest, carregamento automático de bibliotecas ou autoridade da plataforma;
- executor **AArch64 C++20 de prova** com memória convidada limitada, MOVZ/MOVK, ADD/SUB, LDR/STR, B, RET e NOP; falha em instruções ausentes;
- carregador ELF64 ARM64 `ET_EXEC` e subconjunto relocável `ET_DYN`, com `PT_LOAD`, mapa guest isolado, `DT_RELA` e relocação `R_AARCH64_RELATIVE` sem símbolos externos; o interpretador suporta `ADRP` para endereçamento independente da base de carregamento;
- executável nativo de desenvolvimento `ordax-mobile-guest`, que carrega um ELF existente em disco e executa até 100.000 instruções guest, sempre com limite de memória e permissões ELF de leitura, escrita e execução (nega escrita em RX e execução em dados NX);
- testes fim a fim desse executável com um ELF ARM64 relocável gerado pelos testes, repetindo-o sob diferentes bases virtuais e verificando acessos proibidos. Dependências de bibliotecas, Bionic, ART e execução de APK continuam indisponíveis.

Rodar testes com Node.js 20+:

    node --test apps/mobile-compat/tests/intake.test.mjs

Inspecionar um pacote fornecido localmente:

    node apps/mobile-compat/bin/mobile-compat.mjs inspect CAMINHO_DO_APK_OU_XAPK

Prova de método Dalvik, usando **um APK próprio de teste**, sem executar Android:

    node apps/mobile-compat/bin/mobile-compat.mjs dex-method CAMINHO_DO_APK 'Ltest/Arithmetic;' sum 19 23

O comando acima executa somente um método estático com argumentos `int32`,
com heap de objetos privado por execução. Esse método pode criar objetos de
classes locais sem superclass, chamar construtores e métodos virtuais locais,
e acessar campos inteiros; porém **não pode expor referências guest ao host**.
Não há herança, GC, objetos host, classes Android, arrays de referências ou outros tipos, JNI ABI, reflexão,
chamadas de rede nem instruções não implementadas. A execução tem limites
de memória (máximo de 4096 objetos, 128 campos por objeto e 65536 campos
no total, inclusive arrays), instruções, pilha e registradores, e exige inicialização antes
de invocar métodos virtuais.
O adaptador nativo de teste exige registro explícito pelo host e não pode
ser selecionado pelo CLI. Isso não é ART nem JNI completo.

Testar a prova nativa do executor (Linux ou Visual Studio no Windows):

    cmake -S apps/mobile-compat/native -B apps/mobile-compat/native/build -DCMAKE_BUILD_TYPE=Debug
    cmake --build apps/mobile-compat/native/build --config Debug
    ctest --test-dir apps/mobile-compat/native/build -C Debug --output-on-failure

O host nativo de desenvolvimento é compilado no diretório `native/build`.
Sua única execução suportada é `ordax-mobile-guest run-elf arquivo.elf`
para o subconjunto ARM64; bibliotecas com símbolos externos são recusadas,
sem executar instruções diretamente no processador do host.

O comando `run` da ferramenta de APK falha explicitamente com `EXECUTION_UNAVAILABLE`. Inspecionar APK não comprova compatibilidade nem abre Instagram.

## Implementação necessária para o MVP de execução

1. Container e assinatura APK v2/v3, base/splits, DEX e bibliotecas ELF, extração isolada verificada.
2. Executor independente ARM64, memória guest, syscalls, loader ELF, Bionic, TLS, relocations e barreira host/guest. Sem incorporar Lunaria ou copiar Android OS.
3. Runtime Dalvik/ART e JNI: classes, chamadas, reflection, threads, exceções, GC, interfaces nativas e verificações.
4. Serviços Android reais: atividades, packages/resources, permissões, armazenamento, rede e mídia.
5. Host Windows: janelas, input, GPU/EGL/GLES, compositor com quadros apresentados e detecção de travamentos.
6. E2E Instagram: iniciar com APK original, abrir interface real, login humano, navegar, reiniciar e preservar somente o estado autorizado.

A viabilidade ainda não está demonstrada. Desenvolver essa camada é comparável ao esforço de construir um subsistema de compatibilidade de sistema operacional, não um simples aplicativo.

## Regras de integração

- Fonte de produto somente neste repositório.
- OS/Runtime conservam autoridade de instalação, grants, signing, trust, atualização, Store, contas e execução de dispositivos.
- Sem app.json, inscrição na Store ou metadados que anunciem o app instalável enquanto o runtime guest e o host Windows não funcionarem.
- Nenhum código de Lunaria ou NativeDexLab é copiado. Registros de falhas anteriores servem só como evidência.
- Não cadastrar versões falsas de Android, não capturar credenciais, não contornar proteções de autenticação, não publicar APK proprietário.
- Branch e PR separados para não interferir nas migrações existentes dos demais apps.

**Gate de MVP:** demonstração real no Windows, com Instagram original renderizando e respondendo a entrada, além de testes de integridade, permissão, segurança, recuperação e reinicialização. Só depois preparar manifesto, pacote e Store.
