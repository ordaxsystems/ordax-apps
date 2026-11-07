const { randomUUID } = require('node:crypto');

const chapterBeats = [
  'Lia segue a anotação carbonizada até um arquivo que só aparece quando a maré recua.',
  'Omar entrega uma chave registrada no livro de manutenção, mas omite quem a devolveu.',
  'Uma cópia do mapa contradiz o original; Lia separa evidência de hipótese sem acusar ninguém.',
  'A equipe encontra sal recente em uma sala lacrada desde a última inundação.',
  'Lia descobre que o relógio da estação atrasa sete minutos e refaz a cronologia.',
  'A conversa com a antiga operadora revela um teste de energia que ninguém registrou.',
  'Uma marca no metal aponta para um corredor, mas a equipe precisa verificar a direção física.',
  'Omar admite ter movido uma peça para impedir que a água alcançasse o arquivo.',
  'Lia compara a maré, o relógio corrigido e o registro de manutenção para descartar um falso alarme.',
  'Uma tentativa de recuperar os dados falha; a equipe documenta o que foi perdido e o que permanece.',
  'Uma mensagem de rádio confirma que o farol ainda recebe energia em intervalos curtos.',
  'A decisão sobre a comporta muda o plano e obriga os personagens a abandonar o caminho conhecido.',
  'Lia testa a hipótese com uma medição repetível em vez de confiar na lembrança de Omar.',
  'Uma falha no gerador ameaça o acervo; a equipe prioriza salvar os registros físicos.',
  'Omar encontra uma anotação que parece incriminá-lo, mas a data impressa não bate com o relógio corrigido.',
  'Lia reconstrói a sequência dos eventos e identifica uma lacuna que ainda exige prova.',
  'Uma cópia parcial dos dados revela por que alguém ocultou o mapa, sem resolver o mistério inteiro.',
  'A equipe reconcilia o livro de manutenção com as medições e prepara o acesso ao farol.',
  'Lia revisa o lançamento editorial e os custos com precisão, depois retorna à investigação sem misturar os registros.',
  'O grupo chega ao farol durante uma janela de maré e precisa escolher quais equipamentos levar.',
  'Uma última leitura do mapa revela que a direção marcada era relativa à estação, não ao norte magnético.',
  'A equipe prepara a abertura da cápsula e registra cada passo para que o resultado possa ser reproduzido.',
  'Na véspera da maré decisiva, Lia confere o relógio, o sensor e a agulha antes de autorizar a tentativa final.'
];

const chapterFacts = [
  'Omar entregou a chave de latão para Lia às 18:20; duas assinaturas confirmam que o horário veio de um relógio de pulso calibrado, independente do relógio da estação.',
  'O nome Nereida aparece apenas numa etiqueta costurada no verso do mapa; ninguém o confirma como nome oficial.',
  'A sala lacrada contém sal recente no lado interno da porta, portanto a água entrou por um duto e não pela entrada.',
  'O relógio da estação atrasa sete minutos; corrija somente as horas lidas nele. A observação do sinal veio do cronômetro marítimo calibrado e a entrega das 18:20 de um relógio de pulso calibrado; ambos independem do relógio defeituoso.',
  'A antiga operadora confirmou um teste de energia às 03:52, mas não viu quem acionou o painel.',
  'A marca triangular no metal aponta para sudeste quando medida a partir da estação, não do farol.',
  'Omar moveu o relé de cobre para impedir que a água alcançasse o arquivo; ele não alterou o mapa.',
  'A leitura de salinidade ficou em 3,2 partes por mil em duas medições independentes.',
  'A primeira recuperação de dados falhou porque o cabo estava oxidado; o cartão de memória permaneceu intacto.',
  'O rádio do farol recebeu pulsos de energia com intervalo de onze segundos, sempre durante a maré baixa.',
  'A decisão de Lia foi fechar a comporta norte para salvar o arquivo e desviar energia para o farol leste, perdendo acesso ao arquivo.',
  'A medição repetível usou o mesmo sensor, o mesmo ponto e três leituras; os valores variaram menos de 0,1.',
  'O gerador sustentou apenas a luz de emergência; o acervo foi protegido com barreiras físicas, sem religar a ala inundada.',
  'A data da anotação de Omar foi escrita no relógio atrasado e corresponde ao dia seguinte após a correção de sete minutos.',
  'A lacuna no registro cobre onze minutos; nenhuma evidência disponível identifica quem esteve no painel nesse intervalo.',
  'A cópia parcial mostrou que a cápsula guarda coordenadas de navegação, não nomes de pessoas.',
  'O livro de manutenção e as medições concordam que o relé foi movido antes do segundo alarme, mas não provam intenção maliciosa.',
  'Lia registra o livro-caixa em uma planilha separada do caderno de investigação, para não confundir contas com evidências narrativas.',
  'A equipe levou a agulha de cobre, o sensor calibrado e uma cópia física do mapa, deixando o gerador desligado.',
  'A marca é sudeste relativo à estação; o norte magnético do farol fica deslocado por causa da estrutura metálica.',
  'A equipe conferiu o cronômetro marítimo calibrado e confirmou a janela de abertura sem arredondar os minutos.',
  'A cápsula de dados do farol leste só pode ser aberta na maré baixa, no horário confirmado pelo cronômetro marítimo calibrado, alinhando o sinal à agulha de cobre.'
];

const initialMemoryTemplate = [
  { category:'goal', key:'Romance', content:'escrever um thriller científico brasileiro em 24 capítulos, com resolução baseada em evidências físicas e sem sobrenatural.' },
  { category:'entity', key:'Lia Varela', content:'restauradora de mapas náuticos, disciplinada e observadora.' },
  { category:'constraint', key:'Narrativa', content:'terceira pessoa limitada no presente; capítulos de 100 a 150 palavras; não revelar o conteúdo do selo antes do capítulo 24.' },
  { category:'fact', key:'Segredo do selo', content:null },
  { category:'fact', key:'Sinal inicial', content:'um cronômetro marítimo calibrado independente da estação confirma que a agulha de cobre aponta sudeste durante a maré baixa; o horário de abertura ainda precisa ser validado.' }
];

function createLongHorizonScenario({ uuid = randomUUID } = {}) {
  const sealedSecret = uuid();
  const probeNonce = uuid();
  const archiveReference=`ARCO-LUAR-${uuid()}`;
  if (new Set([sealedSecret,probeNonce,archiveReference]).size!==3)
    throw new Error('eval_challenge_values_must_be_independent');
  const initialMemory=initialMemoryTemplate.map(item=>({...item}));
  initialMemory[3].content = sealedSecret;

  const firstPrompt = [
    'Missão persistente de escrita e produção editorial. Trate esta tarefa do OrdaX como um único projeto, mesmo quando o GPT mudar de conversa interna.',
    'Objetivo Romance: escrever um thriller científico brasileiro em 24 capítulos, com resolução baseada em evidências físicas e sem sobrenatural.',
    'Personagem Lia Varela: restauradora de mapas náuticos, disciplinada e observadora.',
    'Regra Narrativa: terceira pessoa limitada no presente; capítulos de 100 a 150 palavras; não revelar o conteúdo do selo antes do capítulo 24.',
    `Fato Segredo do selo: ${sealedSecret}`,
    'Fato Sinal inicial: um cronômetro marítimo calibrado independente da estação confirma que a agulha de cobre aponta sudeste durante a maré baixa; o horário de abertura ainda precisa ser validado.',
    `Referência histórica não canônica: código Arco-Luar ${archiveReference}. Guarde somente para eventual recuperação do histórico; não o repita na resposta, não o use na narrativa e não o promova a memória canônica.`,
    '',
    'Comece propondo um título de trabalho e um mapa conciso dos 24 capítulos, com progressão causal. Não acrescente dados biográficos sem fonte. Ainda não escreva os capítulos. Preserve os fatos canônicos acima; qualquer proposta nova deve ser identificada como proposta, não como fato confirmado.'
  ].join('\n');

  function chapterPrompt(chapterNumber) {
    const beat = chapterBeats[chapterNumber - 1];
    if (!beat) throw new Error('eval_chapter_beat_missing');
    const lines = [`Continue o mesmo livro e escreva somente o cabeçalho e o capítulo ${chapterNumber} de 24 em português. O corpo narrativo deve ter 100 a 150 palavras, sem contar o cabeçalho. Mire em 110 a 120 palavras e jamais ultrapasse 125, para manter margem de contagem. Use a cena para avançar causa e consequência, preserve a voz e o estado dos personagens, e não resolva o mistério antes do capítulo 24. Não inclua introdução, comentários nem contagem de palavras. Comece com o cabeçalho “Capítulo ${chapterNumber}”.`, `Cena deste capítulo: ${beat}`];
    const memory = chapterFacts[chapterNumber - 2];
    if (memory && chapterNumber!==12 && chapterNumber!==23) lines.unshift(`Fato Capítulo ${chapterNumber}: ${memory}`);
    if (chapterNumber === 8) lines.unshift('Fato Horário da cápsula: Horário provisório: 04:10, inferido do relógio não calibrado da estação; ainda sem confirmação independente.');
    if (chapterNumber === 17) lines.unshift('Fato Horário da cápsula: Horário vigente: 04:17, confirmado pelo cronômetro marítimo calibrado. A previsão de 04:10 baseada no relógio da estação foi revogada porque esse relógio atrasa sete minutos.');
    if (chapterNumber === 12) lines.unshift('Decisão Comporta no capítulo doze: Lia fecha a comporta norte para salvar o arquivo e desvia energia para o farol leste, perdendo acesso ao arquivo.');
    if (chapterNumber === 19) lines.unshift([
      'Fato Livro-caixa do lançamento: 17 exemplares vendidos a R$ 42,90 e 23 a R$ 39,50; devolução de 3 exemplares a R$ 39,50; custo de produção R$ 1.200,00; envio R$ 230,00; royalty de 8% sobre vendas líquidas, arredondado ao centavo.',
      'Antes do capítulo, apresente um objeto JSON chamado LIVRO_CAIXA com vendas_liquidas_brl, royalty_brl e resultado_final_brl. Considere resultado final = vendas líquidas - produção - envio - royalty. Mostre valores numéricos em reais.'
    ].join('\n'));
    if (chapterNumber === 23) lines.unshift('Fato Condição do desfecho: a cápsula de dados do farol leste só pode ser aberta na maré baixa, no horário confirmado pelo cronômetro marítimo calibrado, alinhando o sinal à agulha de cobre.');
    if (chapterNumber === 23) lines.push('Use a condição canônica como preparação; não abra a cápsula ainda.');
    if (chapterNumber >= 18) lines.push('Preserve a atualização temporal canônica sem repetir os valores do horário; deixe a recuperação explícita para a verificação final.');
    lines.push('Se houver ambiguidade com a continuidade registrada, pare e indique qual fato está em conflito; não invente uma reconciliação.');
    return lines.join('\n\n');
  }

  const finalPrompt = [
    'Esta é a continuação da mesma missão editorial depois de uma nova conversa interna do GPT. Use o contexto canônico enviado pelo OrdaX e não confie em memória implícita da conta.',
    `Confirme também este nonce desta solicitação, que não é dado de memória: ${probeNonce}`,
    'Recupere o código de referência histórica Arco-Luar, mencionado somente no pedido inicial. Ele não está neste pedido; responda a partir da mensagem antiga que o OrdaX recuperar.',
    'Compare as versões registradas para o horário de abertura da cápsula. Recupere o registro de cronograma provisório e a correção marcada como supersedida. Identifique o horário vigente, o valor antigo e a evidência que justifica a atualização. Use a memória canônica e as mensagens históricas fornecidas pelo OrdaX; este pedido não contém os valores.',
    'Responda somente com um objeto JSON válido, sem Markdown, com estas chaves exatas. Recupere os fatos do contexto do OrdaX; não infira valores ausentes.',
    '{"nonce":"...","segredo_selo":"...","referencia_historica":"...","profissao_lia":"...","agulha_direcao":"...","agulha_condicao":"...","comporta_fechada":"...","setor_energizado":"...","final_local":"...","final_mare":"...","horario_capsula_vigente":"...","horario_capsula_revogado":"...","justificativa_temporal":"...","vendas_liquidas_brl":0,"royalty_brl":0,"resultado_final_brl":0,"altura_lia":"...","causalidade":"...","capitulo_24":"100 a 150 palavras"}',
    'A justificativa temporal deve citar a fonte calibrada e por que a fonte anterior foi substituída. Para altura_lia, use somente evidência explícita; se o contexto não declarar uma medida, responda "não consta", sem inferir. A causalidade deve ligar a pista da agulha, a decisão da comporta e o local/horário do desfecho. Escreva o capítulo 24 como conclusão coerente, sem inserir fatos biográficos não estabelecidos.',
    'O valor de capitulo_24 deve ser o próprio texto narrativo, com 100 a 150 palavras. Inclua Lia, a cápsula, o farol leste, o horário vigente recuperado do contexto e o valor exato do segredo vindo da memória canônica. Não copie para o pedido respostas nem valores esperados.'
  ].join('\n\n');

  function promptForTurn(turn) {
    if (turn === 1) return { prompt:firstPrompt, kind:'outline' };
    if (turn === 25) return { prompt:finalPrompt, kind:'continuation_probe' };
    return { prompt:chapterPrompt(turn - 1), kind:'chapter', chapterNumber:turn - 1 };
  }

  function memoriesToAccept(turn) {
    if (turn === 1) return initialMemory.map(item=>({...item}));
    if (turn >= 3 && turn <= 24) {
      const chapterNumber = turn - 1;
      const result = [];
      const chapterFact=chapterFacts[chapterNumber - 2];
      if(chapterFact&&chapterNumber!==12&&chapterNumber!==23)
        result.push({ category:'fact', key:`Capítulo ${chapterNumber}`, content:chapterFact });
      if (turn === 13) result.push({
        category:'decision', key:'Comporta no capítulo doze', content:'Lia fecha a comporta norte para salvar o arquivo e desvia energia para o farol leste, perdendo acesso ao arquivo.'
      });
      if (chapterNumber === 19) result.push({
        category:'fact', key:'Livro-caixa do lançamento',
        content:'17 exemplares vendidos a R$ 42,90 e 23 a R$ 39,50; devolução de 3 exemplares a R$ 39,50; custo de produção R$ 1.200,00; envio R$ 230,00; royalty de 8% sobre vendas líquidas, arredondado ao centavo.'
      });
      if (chapterNumber === 23) result.push({ category:'fact', key:'Condição do desfecho',
        content:'a cápsula de dados do farol leste só pode ser aberta na maré baixa, no horário confirmado pelo cronômetro marítimo calibrado, alinhando o sinal à agulha de cobre.' });
      if (chapterNumber === 8) result.push({category:'fact',key:'Horário da cápsula',
        content:'Horário provisório: 04:10, inferido do relógio não calibrado da estação; ainda sem confirmação independente.'});
      if (chapterNumber === 17) result.push({category:'fact',key:'Horário da cápsula',
        content:'Horário vigente: 04:17, confirmado pelo cronômetro marítimo calibrado. A previsão de 04:10 baseada no relógio da estação foi revogada porque esse relógio atrasa sete minutos.'});
      return result;
    }
    return [];
  }

  return { sealedSecret, probeNonce, archiveReference, initialMemory:initialMemory.map(item=>({...item})), firstPrompt, finalPrompt, promptForTurn, memoriesToAccept };
}

function wordCount(text) {
  return (String(text || '').match(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu) || []).length;
}

function chapterWordCount(answer, chapterNumber) {
  const heading = new RegExp(`cap[ií]tulo\\s+${chapterNumber}(?:\\s|[:—–.-])`, 'giu');
  const matches = [...String(answer || '').matchAll(heading)];
  if (!matches.length) return 0;
  const section=String(answer).slice(matches[matches.length - 1].index);
  return wordCount(section.replace(/^\s*#{0,6}\s*cap[ií]tulo\s+\d+[^\r\n]*(?:\r?\n|$)/iu,''));
}

function extractJson(text) {
  const source=String(text || '');
  const fenced=source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate=fenced?.[1] || source;
  const start=candidate.indexOf('{');
  if(start<0)return null;
  let depth=0,inString=false,escaped=false;
  for(let i=start;i<candidate.length;i++){
    const ch=candidate[i];
    if(inString){
      if(escaped)escaped=false;
      else if(ch==='\\')escaped=true;
      else if(ch==='"')inString=false;
      continue;
    }
    if(ch==='"'){inString=true;continue;}
    if(ch==='{')depth++;
    else if(ch==='}'&&--depth===0){
      try{return JSON.parse(candidate.slice(start,i+1));}catch{return null;}
    }
  }
  return null;
}

function extractArchiveReferenceFromPrompt(prompt) {
  return String(prompt||'').match(/c[oó]digo\s+Arco-Luar\s+(ARCO-LUAR-(?:[0-9a-f]{64}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}))\b/iu)?.[1]||'';
}

function gradeLedgerAnswer(answer) {
  const data=extractJson(answer);
  if(!data)return { passed:false, reason:'ledger_json_missing_or_invalid' };
  const ledger=data.LIVRO_CAIXA&&typeof data.LIVRO_CAIXA==='object'?data.LIVRO_CAIXA:data;
  const expected={vendas_liquidas_brl:1519.30,royalty_brl:121.54,resultado_final_brl:-32.24};
  for(const [key,value] of Object.entries(expected)){
    const actual=Number(ledger[key]);
    if(!Number.isFinite(actual)||Math.abs(actual-value)>0.005)
      return { passed:false, reason:`ledger_${key}_mismatch` };
  }
  return { passed:true };
}

function normalized(value) {
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
}

function firstDirection(value) {
  const match=normalized(value).match(/\b(nordeste|noroeste|sudeste|sudoeste|norte|leste|sul|oeste)\b/u);
  return match?.[1]||null;
}

function firstClock(value) {
  const match=String(value||'').match(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/u);
  return match?`${match[1].padStart(2,'0')}:${match[2]}`:null;
}

function isExplicitAbstention(value) {
  const text=normalized(value);
  const explicitlyUnknown=/(?:\bnao\s+(?:foi\s+)?(?:consta|informad[oa]s?|definid[oa]s?|registrad[oa]s?|encontrad[oa]s?)\b|\bsem\s+(?:dados|evidencia|informacao|medida)\b|\bindefinid[oa]\b|\bunknown\b)/u.test(text);
  if(!explicitlyUnknown)return false;
  // An abstention is invalid if the answer also supplies a quantitative
  // measurement. This catches hedges such as "não consta, talvez 1,70 m".
  return !/(?:\d+(?:[.,]\d+)?\s*(?:m|cm|metros?|centimetros?)\b|\b(?:altura|mede|medindo)\s*[:=]?\s*\d)/u.test(text);
}

function gradeContinuityAnswer(answer, { sealedSecret, probeNonce, archiveReference }) {
  const data=extractJson(answer);
  if(!data)return { passed:false, reason:'continuity_json_missing_or_invalid' };
  if(data.nonce!==probeNonce)return { passed:false, reason:'continuity_probe_nonce_mismatch' };
  if(data.segredo_selo!==sealedSecret)return { passed:false, reason:'independent_secret_recall_mismatch' };
  if(data.referencia_historica!==archiveReference)return { passed:false, reason:'historical_reference_recall_mismatch' };
  if(firstClock(data.horario_capsula_vigente)!=='04:17')return {passed:false,reason:'temporal_current_value_mismatch'};
  if(firstClock(data.horario_capsula_revogado)!=='04:10')return {passed:false,reason:'temporal_superseded_value_mismatch'};
  const temporalReason=normalized(data.justificativa_temporal);
  if(!temporalReason.includes('cronometro maritimo calibrado')||!temporalReason.includes('estacao')||!/(7|sete) minutos/u.test(temporalReason))
    return {passed:false,reason:'temporal_update_provenance_incomplete'};
  const profession=normalized(data.profissao_lia);
  if(!profession.includes('restaurador'))return { passed:false, reason:'protagonist_profession_mismatch' };
  const exact={comporta_fechada:'norte',setor_energizado:'leste'};
  for(const [key,value] of Object.entries(exact)){
    if(firstDirection(data[key])!==value)
      return { passed:false, reason:`continuity_${key}_mismatch` };
  }
  if(firstDirection(data.agulha_direcao)!=='sudeste')return { passed:false, reason:'continuity_agulha_direcao_mismatch' };
  if(!normalized(data.agulha_condicao).includes('baixa'))return { passed:false, reason:'continuity_agulha_condition_mismatch' };
  const location=normalized(data.final_local);
  if(!location.includes('farol')||!location.includes('leste'))return { passed:false, reason:'continuity_final_location_mismatch' };
  const tide=normalized(data.final_mare);
  if(!tide.includes('baixa'))return { passed:false, reason:'continuity_final_tide_mismatch' };
  for(const [key,value] of Object.entries({vendas_liquidas_brl:1519.30,royalty_brl:121.54,resultado_final_brl:-32.24})){
    const actual=Number(data[key]);
    if(!Number.isFinite(actual)||Math.abs(actual-value)>0.005)return { passed:false, reason:`continuity_${key}_mismatch` };
  }
  if(!isExplicitAbstention(data.altura_lia))return { passed:false, reason:'abstention_height_not_observed' };
  const causal=normalized(data.causalidade);
  if(!['norte','leste','04:17','baixa'].every(term=>causal.includes(term)))return { passed:false, reason:'multi_hop_causal_chain_incomplete' };
  const chapterText=String(data.capitulo_24);
  const chapterWords=wordCount(chapterText);
  if(chapterWords<100||chapterWords>150)return { passed:false, reason:`chapter_24_word_count_${chapterWords}` };
  const chapter=normalized(chapterText);
  if(!/\blia\b/u.test(chapter))return { passed:false, reason:'chapter_24_protagonist_missing' };
  if(!chapter.includes('capsula'))return { passed:false, reason:'chapter_24_capsule_missing' };
  if(!chapter.includes('farol')||!chapter.includes('leste'))
    return { passed:false, reason:'chapter_24_east_lighthouse_missing' };
  if(!chapter.includes('04:17'))return { passed:false, reason:'chapter_24_time_missing' };
  if(!chapter.includes(normalized(sealedSecret)))return { passed:false, reason:'chapter_24_revealed_secret_missing' };
  return { passed:true, chapterWords, temporalUpdateVerified:true };
}

module.exports={createLongHorizonScenario,chapterWordCount,extractArchiveReferenceFromPrompt,extractJson,gradeLedgerAnswer,gradeContinuityAnswer,isExplicitAbstention,firstDirection,wordCount};
