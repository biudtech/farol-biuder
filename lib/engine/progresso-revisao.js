// A porcentagem da revisão em andamento, que o cartão "Analisando agora" mostra (17/11/2026).
//
// Só entra no número o que o motor de fato sabe:
//   - a ETAPA, marcada pelo próprio fluxo da revisão (marcarEtapa): as fontes desde o início da
//     sessão, o card quando o Farol vai ler o Jira, o código quando a sessão do modelo é aberta,
//     a conferência dos achados na primeira linha de verificação do feed ou quando o modelo
//     devolve, a postagem quando o desfecho começa e `concluida` quando ele termina;
//   - dentro do código, os arquivos que esta rodada tem a ler (metricsLeitura, já incremental) e
//     quantos deles a sessão leu (filesRead, a mesma regra do Read que credita a cobertura);
//   - o tempo restante só pela mediana real das revisões anteriores desta máquina (tempoTipico,
//     estimativa-sessao.js, sobre o histórico de decisões do banco da telemetria). Sem amostra
//     suficiente, ou com a revisão já além da mediana, o campo vai ausente.
// Fora do código não há sinal de avanço dentro da etapa: o número fica no marco de entrada dela,
// sem interpolar. A etapa só avança (marcarEtapa recusa voltar), a leitura só cresce (Set) e o
// total não muda depois de medido, então o número nunca regride; 100 só com `concluida`.
//
// PURA na parte que calcula (calcularProgresso); progressoDaSessao só lê o registro da sessão.

// `ate` é o marco do fim da etapa; o começo é o `ate` da anterior
const ETAPAS = [
  { id: 'fontes', rotulo: 'fontes', ate: 10 },
  { id: 'card', rotulo: 'card', ate: 20 },
  { id: 'codigo', rotulo: 'código', ate: 65 },
  { id: 'conferencia', rotulo: 'conferência dos achados', ate: 90 },
  { id: 'postagem', rotulo: 'postagem', ate: 100 },
];
const CONCLUIDA = 'concluida';
const ORDEM = [...ETAPAS.map(e => e.id), CONCLUIDA];

function inteiroNaoNegativo(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

// PURA. `sinais`: { etapa, lidos, arquivos, tipicoMs, decorridoMs }. Devolve o progresso, ou
// null quando a sessão não tem etapa marcada (chat, ferramentas: quem não é revisão).
function calcularProgresso(sinais) {
  const s = sinais || {};
  const fim = s.etapa === CONCLUIDA;
  const i = fim ? ETAPAS.length - 1 : ETAPAS.findIndex(e => e.id === s.etapa);
  if (i < 0) return null;
  const etapa = ETAPAS[i];
  const inicio = i ? ETAPAS[i - 1].ate : 0;
  const arquivos = inteiroNaoNegativo(s.arquivos);
  const lidos = Math.min(inteiroNaoNegativo(s.lidos), arquivos);
  let percentual = fim ? 100 : inicio;
  if (etapa.id === 'codigo' && arquivos) percentual = inicio + Math.floor(((etapa.ate - inicio) * lidos) / arquivos);
  const progresso = { percentual, etapa: i + 1, totalEtapas: ETAPAS.length, rotuloDaEtapa: etapa.rotulo };
  if (etapa.id === 'codigo' && arquivos) Object.assign(progresso, { arquivosLidos: lidos, arquivosTotais: arquivos });
  const restante = inteiroNaoNegativo(s.tipicoMs) - inteiroNaoNegativo(s.decorridoMs);
  if (!fim && inteiroNaoNegativo(s.tipicoMs) && restante > 0) progresso.restanteEstimadoMs = restante;
  return progresso;
}

// os lidos que contam: só os arquivos que esta rodada tem a ler (na incremental, o herdado lido
// de novo não empurra a barra)
function lidosDaRodada(rec) {
  if (!(rec.arquivosALer instanceof Set) || !(rec.filesRead instanceof Set)) return 0;
  let n = 0;
  for (const f of rec.filesRead) if (rec.arquivosALer.has(f)) n++;
  return n;
}

function progressoDaSessao(rec, agora = Date.now()) {
  if (!rec || !rec.etapa) return null;
  const arquivos = rec.arquivosALer instanceof Set ? rec.arquivosALer.size : 0;
  const decorridoMs = Number.isFinite(rec.startedAt) ? agora - rec.startedAt : 0;
  return calcularProgresso({
    etapa: rec.etapa, lidos: lidosDaRodada(rec), arquivos, decorridoMs,
    tipicoMs: rec.estimativa && rec.estimativa.tipicoMs,
  });
}

// A etapa só avança: marca fora de ordem (uma linha de verificação atrasada, um desfecho que
// chama de novo) é ignorada. Mudou, empurra o estado para a tela.
function marcarEtapa(engine, id, etapa) {
  const rec = engine && engine.activeReviews && engine.activeReviews.get(id);
  const nova = ORDEM.indexOf(etapa);
  if (!rec || !rec.etapa || nova < 0 || nova <= ORDEM.indexOf(rec.etapa)) return;
  rec.etapa = etapa;
  if (typeof engine.pushState === 'function') engine.pushState();
}

const progressoMod = { ETAPAS, CONCLUIDA, calcularProgresso, progressoDaSessao, marcarEtapa };
export default progressoMod;
export { ETAPAS, CONCLUIDA, calcularProgresso, progressoDaSessao, marcarEtapa };
