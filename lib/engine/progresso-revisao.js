// A porcentagem da revisão em andamento, que o cartão "Analisando agora" mostra (17/11/2026).
//
// Só entra no número o que o motor de fato sabe:
//   - a ETAPA, marcada pelo próprio fluxo da revisão (marcarEtapa): as fontes desde o início da
//     sessão, o card quando o Farol vai ler o Jira, o código quando a sessão do modelo é aberta,
//     a conferência dos achados quando o modelo devolve (ou antes, numa linha de verificação do
//     feed, mas só com a leitura dos arquivos da rodada completa: abrirConferenciaPelaVerificacao),
//     a postagem quando o desfecho começa e `concluida` quando ele termina;
//   - dentro do código, os arquivos da rodada que podem ser lidos (contagemDeLeitura) e quantos
//     deles a sessão já leu, inteiros ou em parte, pelo que o motor conferiu de cada entrega;
//   - dentro do código, o arquivo da vez: o último que a sessão leu pelo mesmo sinal que conta os
//     lidos (o Read creditado ou a última entrega conferida, `ultimoLido`, read-evidence.js), e só
//     quando ele é um dos arquivos contados. É o caminho relativo do PR, nunca o caminho no disco;
//   - o tempo restante só pela duração real das revisões anteriores desta máquina (tempoTipico,
//     estimativa-sessao.js, sobre o histórico de decisões do banco da telemetria).
// Fora do código não há sinal de avanço dentro da etapa: o número fica no marco de entrada dela,
// sem interpolar. A etapa só avança (marcarEtapa recusa voltar), a leitura só cresce (Sets) e o
// total não muda depois de medido, então o número nunca regride; 100 só com `concluida`.
//
// PURA na parte que calcula (calcularProgresso); progressoDaSessao só lê o registro da sessão.
import { arquivosComEntrega } from './read-evidence.js';

// `ate` é o marco do fim da etapa; o começo é o `ate` da anterior
const ETAPAS = [
  { id: 'fontes', rotulo: 'fontes', ate: 10 },
  { id: 'card', rotulo: 'card', ate: 20 },
  { id: 'codigo', rotulo: 'código', ate: 65 },
  { id: 'conferencia', rotulo: 'conferência dos achados', ate: 90 },
  { id: 'postagem', rotulo: 'postagem', ate: 100 },
];
const CONCLUIDA = 'concluida';
// Os nomes das etapas, na ordem, para a tela listar as feitas e as que faltam pelo nome (17/11/2026).
// Fixos: a lista é a mesma em toda sessão e em todo momento dela.
const NOMES_DAS_ETAPAS = Object.freeze(ETAPAS.map(e => e.rotulo));
const ORDEM = [...ETAPAS.map(e => e.id), CONCLUIDA];
const IDX_CONFERENCIA = ETAPAS.findIndex(e => e.id === 'conferencia');
const MINUTO_MS = 60000;
// o caminho do arquivo da vez, em caracteres: o GitHub não lista caminho maior que isso na prática
const TETO_DO_CAMINHO = 300;

function inteiroNaoNegativo(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

// O tempo restante em minutos inteiros, para cima: o valor muda no máximo uma vez por minuto, e
// o estado por diferença não reenvia as sessões a cada atualização por causa dele. A base é a
// duração até o fim do desfecho quando o histórico a tem; sem ela, a mediana até o modelo
// devolver, que só vale antes da conferência (o que vem depois dela, gate e postagem, essa
// mediana não mede). Sem base, ou com a revisão além dela, o campo vai ausente.
function restanteEstimado(s, i, fim) {
  if (fim) return 0;
  const ateOFim = inteiroNaoNegativo(s.ateOFimMs);
  const base = ateOFim || (i < IDX_CONFERENCIA ? inteiroNaoNegativo(s.tipicoMs) : 0);
  const restante = base - inteiroNaoNegativo(s.decorridoMs);
  return base && restante > 0 ? Math.ceil(restante / MINUTO_MS) * MINUTO_MS : 0;
}

// PURA. `sinais`: { etapa, lidos, arquivos, mostrarContagem, arquivoAtual, tipicoMs, ateOFimMs, decorridoMs }.
// Devolve o progresso, ou null quando a sessão não tem etapa marcada (chat, ferramentas: quem
// não é revisão). `mostrarContagem: false` mantém o número pela leitura observada (piso real) e
// tira o "N de M", para quando a sessão herdou leituras que o motor não viu.
function calcularProgresso(sinais) {
  const s = sinais || {};
  const fim = s.etapa === CONCLUIDA;
  const i = fim ? ETAPAS.length - 1 : ETAPAS.findIndex(e => e.id === s.etapa);
  if (i < 0) return null;
  const etapa = ETAPAS[i];
  const inicio = i ? ETAPAS[i - 1].ate : 0;
  const arquivos = inteiroNaoNegativo(s.arquivos);
  const lidos = Math.min(inteiroNaoNegativo(s.lidos), arquivos);
  const noCodigo = etapa.id === 'codigo' && arquivos > 0;
  let percentual = fim ? 100 : inicio;
  if (noCodigo) percentual = inicio + Math.floor(((etapa.ate - inicio) * lidos) / arquivos);
  const progresso = { percentual, etapa: i + 1, totalEtapas: ETAPAS.length, rotuloDaEtapa: etapa.rotulo, etapas: [...NOMES_DAS_ETAPAS] };
  if (noCodigo && s.mostrarContagem !== false) Object.assign(progresso, { arquivosLidos: lidos, arquivosTotais: arquivos });
  if (noCodigo && typeof s.arquivoAtual === 'string' && s.arquivoAtual) progresso.arquivoAtual = s.arquivoAtual.slice(0, TETO_DO_CAMINHO);
  const restante = restanteEstimado(s, i, fim);
  if (restante) progresso.restanteEstimadoMs = restante;
  return progresso;
}

// O total são os arquivos que esta rodada tem a ler (na incremental, só os alterados) menos os
// que nunca podem ser creditados (sem conteúdo integral: binário, patch truncado ou ausente,
// pr-scope.js). Lido é o que a regra do Read creditou ou o que teve ao menos uma entrega
// conferida. Na retomada (--resume) a sessão herda leituras do processo anterior que o motor
// não observou e não tem como listar: o número segue pela leitura observada, e o "N de M" sai.
function contagemDeLeitura(rec) {
  if (!(rec.arquivosALer instanceof Set)) return { lidos: 0, arquivos: 0, mostrarContagem: false };
  const semConteudo = rec.semConteudoIntegral instanceof Set ? rec.semConteudoIntegral : new Set();
  const lidos = new Set([...(rec.filesRead instanceof Set ? rec.filesRead : []), ...arquivosComEntrega(rec)]);
  let arquivos = 0;
  let n = 0;
  for (const f of rec.arquivosALer) {
    if (semConteudo.has(f)) continue;
    arquivos++;
    if (lidos.has(f)) n++;
  }
  const atual = typeof rec.ultimoLido === 'string' && rec.arquivosALer.has(rec.ultimoLido) && !semConteudo.has(rec.ultimoLido) ? rec.ultimoLido : '';
  return { lidos: n, arquivos, arquivoAtual: atual, mostrarContagem: rec.resumeOutcome !== 'retomada' };
}

function progressoDaSessao(rec, agora = Date.now()) {
  if (!rec || !rec.etapa) return null;
  const decorridoMs = Number.isFinite(rec.startedAt) ? agora - rec.startedAt : 0;
  const est = rec.estimativa || {};
  return calcularProgresso({
    etapa: rec.etapa, ...contagemDeLeitura(rec), decorridoMs, tipicoMs: est.tipicoMs, ateOFimMs: est.ateOFimMs,
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

// A linha de verificação do feed também vem do checkpoint escrito no meio da leitura e dos
// verificadores de um lote paralelo: sozinha ela não diz que a leitura acabou. Só abre a
// conferência com todos os arquivos creditáveis da rodada lidos e a contagem confiável; fora
// disso, quem abre é o modelo devolvendo (marcarFase, etapas-revisao.js).
function abrirConferenciaPelaVerificacao(engine, id) {
  const rec = engine && engine.activeReviews && engine.activeReviews.get(id);
  if (!rec || rec.etapa !== 'codigo') return;
  const { lidos, arquivos, mostrarContagem } = contagemDeLeitura(rec);
  if (mostrarContagem && arquivos > 0 && lidos >= arquivos) marcarEtapa(engine, id, 'conferencia');
}

const progressoMod = { ETAPAS, CONCLUIDA, calcularProgresso, progressoDaSessao, marcarEtapa, abrirConferenciaPelaVerificacao };
export default progressoMod;
export { ETAPAS, CONCLUIDA, calcularProgresso, progressoDaSessao, marcarEtapa, abrirConferenciaPelaVerificacao };
