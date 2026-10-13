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
- fronteira opcional de métodos nativos tipados, vinculada exclusivamente por código host confiável; agora há **um subconjunto inicial da ABI JNI** com `JNIEnv*` e tabela indexada, mas ainda sem classes Android, JNI completo, JNI_OnLoad, carregamento automático de bibliotecas ou autoridade da plataforma;
- executor **AArch64 C++20 de prova** com memória convidada limitada, MOVZ/MOVK, ADD/SUB, LDR/STR, B, RET e NOP; falha em instruções ausentes;
- carregador ELF64 ARM64 `ET_EXEC` e `ET_DYN`, com `PT_LOAD`, mapa guest isolado, `DT_RELA` e relocação `R_AARCH64_RELATIVE`; o interpretador suporta `ADRP` para endereçamento independente da base de carregamento;
- **RELR compactado em ELF ARM64**: o mesmo carregador interpreta `DT_RELR`/`DT_RELRSZ`/`DT_RELRENT` e as variantes anteriores `DT_ANDROID_RELR`/`DT_ANDROID_RELRSZ`/`DT_ANDROID_RELRENT`, inclusive `DT_ANDROID_RELRCOUNT` (dica opcional ignorada pelo Bionic). O decoder trata entradas diretas e bitmaps de 63 posições, lê os addends implícitos da imagem original, valida segmentos graváveis, pointers remapeados, duplicatas com `RELA`, limite de 8.192 patches e impede overflow. O fluxo cobre provedores independentes e consumidores `DT_NEEDED` com `JUMP_SLOT` + `RELR` no mesmo ELF, sem duplicar a arquitetura. **Não** implementa Bionic completo nem todas as relocations Android; o suporte a `APS2` é restrito a registros `R_AARCH64_RELATIVE` com símbolo zero, descrito a seguir;
- **Android Packed Relocations `APS2`**: decoder clean-room do formato `APS2` com grupos SLEB128 (deslocamentos, `r_info` e addends acumulados), limitado a 8.192 relocations / 64 KiB de entrada. O mesmo carregador ELF interpreta `DT_ANDROID_RELA` (`0x60000011`) e `DT_ANDROID_RELASZ` (`0x60000012`), permite coexistência com `DT_RELA` e `DT_RELR`, aplica exclusivamente relocations relativas ARM64 para segmentos graváveis e recusa sobreposição, overflow, símbolo externo, flags inválidas e tabela truncada. Essa implementação **não** equivale ao linker Android, não resolve símbolos APS2 externos e não carrega automaticamente o Instagram. Formato verificado contra fontes públicas do Bionic: https://android.googlesource.com/platform/bionic/+/refs/heads/aml_con_341810060/linker/linker_reloc_iterators.h e https://android.googlesource.com/platform/bionic/+/a00ed8a89519e91766a72a124ae2e9bfcf8feb32/libc/include/elf.h; sem copiar código desses arquivos;
- **SSOT das relocations — `RelocationPlan`**: existe um único planejador no carregador `native/src/elf_a64.cpp` que autoriza as gravações de `RELA`, `RELR` e `APS2`: **limite global de 8.192 patches**, destinos alinhados e graváveis, colisões dentro do mesmo formato ou entre formatos, e aplicação somente depois de concluir toda a validação. Cada decoder interpreta exclusivamente sua representação binária; nenhum decoder autoriza writes, nem há carregador alternativo. A regressão inclui `RELA+APS2`, `RELR+APS2` e `JUMP_SLOT+APS2`, falhas por duplicidade e nova tentativa válida na mesma CPU após uma recusa;
- **Hash GNU para símbolos dinâmicos ELF**: o mesmo parser de `DT_SYMTAB`/`DT_STRTAB` aceita `DT_GNU_HASH` (`0x6ffffef5`) ou `DT_HASH` SysV, e rejeita contagens divergentes quando ambos são declarados. Varre buckets/chains GNU de modo limitado (até 4.096 símbolos, headers e bloom bounded), sem carregar símbolos de host. A suíte testa provedor e consumidor `.so` com GNU hash somente e com hashes coexistentes, função AArch64 real e rejeições de bloom, bucket, chain e contagem malformados. **É enumeração verificada do dynsym, não resolução GNU completa com versionamento de símbolos Android**;
- **Identidade ELF `DT_SONAME`**: o provedor só pode exportar símbolos quando `DT_SONAME` existe e corresponde ao nome esperado pela biblioteca consumidora; usa a mesma tabela dinâmica validada por `DT_HASH`/`DT_GNU_HASH`, recusando SONAME ausente, duplicado, adulterado ou divergente. Nenhum nome de arquivo passado pelo host substitui a identidade declarada pelo ELF;
- **Inicialização de bibliotecas `DT_INIT` + `DT_INIT_ARRAY`**: o carregador faz validação e mapeamento sem executar o convidado. A função explícita `runGuestInitializers` deve ser chamada pelo host confiável depois de carregar suas dependências; executa `DT_INIT` antes de cada slot de `DT_INIT_ARRAY`, lendo ponteiros já relocados da memória guest, confirmando que apontam para código RX da própria biblioteca e aplicando orçamento de instruções. Bloqueia chamadas repetidas sobre a mesma instância de imagem e não permite retry após execução parcial. Sem inicialização automática, `JNI_OnLoad`, destructor `DT_FINI`, TLS ou ordem transitiva de dependências Android. Os testes geram dois ELFs ARM64 independentes que escrevem dados reais e comprovam a ordem, rejeição de destinos NX, metadados inválidos e tentativa de repetição;
- **PLT `DT_JMPREL` sem duplicação**: o mesmo resolvedor processa as relocations usuais de `DT_RELA` e as entradas `R_AARCH64_JUMP_SLOT` em `DT_JMPREL`/`DT_PLTRELSZ`/`DT_PLTREL=DT_RELA`, com resolução imediata (sem lazy binding). Confere tamanho e limites, rejeita metadados parciais, sobreposição entre tabelas e imports sem provedor previamente carregado. Ambas seguem o `RelocationPlan` único para proteção de memória e destinos duplicados. Testes Linux/Windows fazem chamadas ARM64 reais a símbolos importados com `DT_HASH` e `DT_GNU_HASH`, com `DT_RELA` e `DT_JMPREL` coexistindo; nenhum `dlopen`, construtor, ABI Bionic ou resolução de símbolos de host é declarado;
- **linker experimental entre dois ELF convidados**: um provedor `ET_DYN` independente exporta funções `GLOBAL FUNC` de `DT_SYMTAB`/`DT_STRTAB` com contagem limitada de `DT_HASH` SysV ou `DT_GNU_HASH`. Um consumidor `ET_DYN` com `DT_NEEDED` explícito pode resolver `R_AARCH64_JUMP_SLOT` e `R_AARCH64_GLOB_DAT` somente contra essas exportações previamente carregadas. A função importada é executada por `BLR` dentro da CPU convidada; nenhum símbolo ou endereço nativo do Windows é importado. Colisões de segmentos, símbolos inexistentes/ambíguos, tipos não suportados, TLS e dependências implícitas são recusados;
- executável nativo de desenvolvimento `ordax-mobile-guest`, que carrega um ELF existente em disco e executa até 100.000 instruções guest, sempre com limite de memória e permissões ELF de leitura, escrita e execução (nega escrita em RX e execução em dados NX);
- **ponte experimental Dalvik → ARM64 para métodos `int32`**: `invoke-static` de um método DEX opt-in chama `NativeMethodBoundary`, que pode usar `registerArm64IntegerMethod` para executar um ELF de desenvolvimento no motor ARM64 nativo. O arquivo é conferido por SHA-256 e executado a partir de uma cópia privada validada, com subprocesso limitado por tempo e saída. Só `(I{0,5})I`, sem objetos exportados, ponteiros host, símbolos dinâmicos ou autorização escolhida pelo APK;
- o comando de desenvolvimento `ordax-mobile-guest invoke-i32-elf arquivo.elf [int32 ...]` aceita até cinco argumentos em `x0` a `x4`. A variante `invoke-jni-i32-elf` fornece `JNIEnv*` em `x0`, um identificador `jclass` opaco em `x1`, e até cinco `jint` em `x2`–`x6`, com resultado `jint` em `x0`;
- **JNI experimental verificável**: memória protegida para a representação `JNIEnv*` e a `JNINativeInterface` de 64 bits, com entradas oficiais `GetVersion` (índice 4), `GetArrayLength` (171), `GetIntArrayRegion` (203), `SetIntArrayRegion` (211) e `ExceptionCheck` (228). As demais entradas são nulas e não simulam implementações. Chamadas `BLR` entram somente em uma porta autorizada; referências inválidas, ponteiros `JNIEnv` incorretos e mapeamentos sobrepostos são recusados;
- **JNI `int[]` criado pelo ARM64**: `NewIntArray` no índice JNI oficial 179 cria um `jintArray` local; um ELF ARM64 pode preenchê-lo com `SetIntArrayRegion` e retorná-lo por `jintArray` em `x0`. A mesma fronteira confiável valida o conteúdo (até 1.024 inteiros) e cria uma **nova referência Dalvik**, privada por execução. Esse retorno nativo `()[I` permite usar `move-result-object` e `aget` em código DEX sem transferir handles ou ponteiros JNI para o host. As chamadas com arrays e os retornos de arrays são comprovados em APK/XAPK de teste, não no Instagram;
- **JNI `int[]` de ida e volta**: uma chamada nativa estática `([I)I` recebe um array criado pelo Dalvik, transfere um snapshot binário validado ao processo ARM64, lê o elemento com `GetIntArrayRegion`, modifica-o com `SetIntArrayRegion` e devolve um array validado para escrita atômica no heap Dalvik. As cópias não compartilham endereços nem memória entre processos. O transporte é privado, limitado a 1.024 inteiros por chamada e protegido pelas mesmas regras de hash, tempo e ausência de shell da ponte existente;
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
Não há herança, GC, objetos host, classes Android, arrays de referências ou outros tipos, ABI JNI completa, reflexão,
chamadas de rede nem instruções não implementadas. A execução tem limites
de memória (máximo de 4096 objetos, 128 campos por objeto e 65536 campos
no total para campos, 262.144 posições para arrays), instruções, pilha e registradores, e exige inicialização antes
de invocar métodos virtuais.
O adaptador nativo de teste exige registro explícito pelo host e não pode
ser selecionado pelo CLI. A existência do `JNIEnv` mínimo não representa
ART ou Dalvik completo. Somente arrays primitivos `int[]` são transportados
entre o heap Dalvik e o ambiente JNI por snapshots tipados e cópia de volta.
Objetos comuns, `jclass` reais, objetos de referência, strings, ponteiros do
host, threads, exceções e bibliotecas Android continuam sem integração.

Testar a prova nativa do executor (Linux ou Visual Studio no Windows):

    cmake -S apps/mobile-compat/native -B apps/mobile-compat/native/build -DCMAKE_BUILD_TYPE=Debug
    cmake --build apps/mobile-compat/native/build --config Debug
    ctest --test-dir apps/mobile-compat/native/build -C Debug --output-on-failure

O host nativo de desenvolvimento é compilado no diretório `native/build`.

Prova de ligação entre **dois arquivos ELF ARM64 de teste**:

    ordax-mobile-guest link-two-elf CAMINHO/libprovider.so CAMINHO/libconsumer.so 40

Os arquivos podem ser gerados pelo teste nativo
`ordax_mobile_linked_elf_tests --emit-linked-fixtures`, recebendo os
caminhos de saída do provedor e do consumidor. Esse comando retorna o
resultado convidado `42` após uma relocação `JUMP_SLOT` e uma chamada
real `BLR`. A rotina do carregador usa bases virtuais fixas para esta
prova e bloqueia bibliotecas concorrentes ou endereços externos. **Não
é `dlopen`, não contém Bionic, não suporta dependências transitivas,
vinculação dinâmica Android completa, `JNI_OnLoad`, versionamento de símbolos
nem o ABI/linker completo para aplicativos reais.**

O host nativo de desenvolvimento é compilado no diretório `native/build`.
As opções suportadas são `run-elf`, `invoke-i32-elf`, `invoke-jni-i32-elf`,
`invoke-jni-new-int-array-elf` e `invoke-jni-int-array-elf` (esta última requer um snapshot binário produzido
pela ponte confiável)
para o subconjunto ARM64; bibliotecas com símbolos externos são recusadas,
sem executar instruções diretamente no processador do host.

O CI executa também `mobile-dex-to-arm64-bridge`: o teste gera um
ELF AArch64 que soma dois ao parâmetro recebido em `x0`, carrega um
`classes.dex` contendo método nativo tipado, chama-o por `invoke-static`,
verifica resultados positivos, negativos e overflow `int32`, testa o mesmo
caminho via APK e XAPK e confirma que a execução falha sem registro host.
O CTest inclui `mobile-a64-cross-elf-jump-slot-proof` e
`mobile-linked-elf-files-run`, executados em Linux e Windows e
acompanhados de negativas explícitas para símbolos não resolvidos,
sobreposição de páginas e tipos de relocação desconhecidos.
A prova `mobile-a64-cross-elf-jump-slot-proof` também exercita o
cenário combinado **DT_NEEDED + JUMP_SLOT externo + APS2 relativo**
na biblioteca consumidora, com testes negativos de colisão de relocation,
tipo de símbolo não suportado e escrita em segmento RX.
O teste `mobile-a64-aps2-format-and-bounds-proof` cobre o formato
SLEB128, grupos, bitmaps, limites e entrada malformada.

Há também `mobile-jni-table-abi-proof`, `mobile-dex-to-jni-aarch64-bridge`
e `mobile-dex-jni-array-roundtrip` / `mobile-dex-jni-new-array-roundtrip`,
que usam os índices reais de `JNIEnv` com chamadas indiretas do CPU ARM64 e
reutilizam o mesmo contrato DEX/APK/XAPK com a ABI de `jint` e `jintArray`
de funções estáticas JNI. A prova de arrays confirma atualização via `aput`
Dalvik, `Get/SetIntArrayRegion` ARM64, `aget` Dalvik e bloqueio de alterações
parciais se a função nativa falhar. A prova inversa cria `jintArray` no lado
ARM64 por `NewIntArray`, o preenche e o devolve como nova referência Dalvik. A tabela é baseada na especificação pública:
https://docs.oracle.com/en/java/javase/24/docs/specs/jni/functions.html

Todos os testes são feitos sobre código de prova; **nenhuma biblioteca
nativa do Instagram foi executada por essa ponte**.

O comando `run` da ferramenta de APK falha explicitamente com `EXECUTION_UNAVAILABLE`. Inspecionar APK não comprova compatibilidade nem abre Instagram.

## Estado da validação e isolamento

A [PR #240](https://github.com/ordaxsystems/ordax-apps/pull/240) foi fechada
sem merge em 13/10/2026, por decisão registrada no GitHub: o código permanece
um laboratório, não o MVP do Instagram. A branch
`feature/mobile-compat-cleanroom-foundation-20261012` conserva o histórico.
**Não reabrir nem anunciar release** sem o gate interativo do APK original.

O commit `5491530` consolidou as validações num `RelocationPlan`
e adicionou testes cruzados para não aceitar duas gravações no mesmo destino.
O job correspondente está em
https://github.com/ordaxsystems/ordax-apps/actions/runs/38368062003.
Esta referência é evidência dos testes do novo SSOT, não uma alegação
de suporte completo ao linker Android ou ao Instagram.

O workflow de `push` da branch está acessível pela API oficial
`/repos/ordaxsystems/ordax-apps/actions/runs?branch=...`, mesmo após o
fechamento da PR. O [run #38366172006](https://github.com/ordaxsystems/ordax-apps/actions/runs/38366172006)
validou o commit de código `06a3e141`: **Linux e Windows aprovados, 20/20
testes CTest em cada sistema**, além da suíte JavaScript de inspeção/DEX.
Isso inclui `RELR`, `APS2`, carga dinâmica de dois ELFs, JNI e testes de
negação de entradas malformadas. A documentação posterior não deve ser
confundida com nova demonstração interativa de aplicativo Android.

O workflow `.github/workflows/mobile-compat-cleanroom.yml` continua
configurado apenas para verificar a branch isolada. Nenhuma aprovação do CI
substitui o gate de abrir o Instagram original com interface interativa.

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
- Branch do laboratório preservada; PR #240 fechada sem merge. Não interferir nas migrações existentes dos demais apps.

**Gate de MVP:** demonstração real no Windows, com Instagram original renderizando e respondendo a entrada, além de testes de integridade, permissão, segurança, recuperação e reinicialização. Só depois preparar manifesto, pacote e Store.
