// Dívida herdada da production não bloqueia backmerge (05/11/2026). Medido em biud-frontend#1822: o
// merge-back da production na development foi reprovado pela falta de um teste num arquivo idêntico
// ao da production, lacuna que já estava em produção. A primeira reprovação do mesmo PR (hash do
// manifest deixado errado pela resolução de conflito) procedia e continua possível.
//
// A sessão produz a evidência e o app decide (o rebaixamento exige as duas metades):
//   - a sessão marca o achado com `herdadoDaProducao: true` e diz por quê na evidência;
//   - o app confere que o PR é merge-back (o head contém a ponta da production e a base não é ela)
//     e que o arquivo é herdado de verdade: idêntico à ponta da production e não alterado na base
//     desde o ancestral comum. Arquivo em que a base tinha trabalho próprio é resolução de
//     conflito, e o que o PR criou ali continua bloqueando.
// Só causa `defeito_codigo` ou `card` é rebaixada: estado do PR já segue outro caminho.
import { SHA } from '../review-source/contract.js';
import { ler, NAO_EXISTE, compararComAFoto } from './regua-de-heranca.js';

const PRODUCAO = 'production';
const CAUSAS_DE_DIVIDA = new Set(['defeito_codigo', 'card']);

const candidato = (f) => f && f.severity === 'blocking' && f.herdadoDaProducao === true
  && CAUSAS_DE_DIVIDA.has(f.causa) && typeof f.evidence === 'string' && f.evidence.trim();

// Arquivos do diff herdados de verdade da production, ou null quando o PR não é merge-back ou não
// deu para saber. Repositório sem production fica guardado e não paga a consulta de novo.
async function provaDaHeranca(engine, pr, headSha, arquivosDoPr, baseEsperada) {
  const conta = engine.accountForPr(pr);
  if (!SHA.test(headSha || '') || !pr.repo || !pr.number || !arquivosDoPr.length || !engine.tokenFor(conta)) return null;
  if (engine.semProducao?.has(pr.repo)) return null;
  const base = await ler(engine, conta, [`repos/${pr.repo}/pulls/${pr.number}`, '--jq', '{base: .base.ref, baseSha: .base.sha, headSha: .head.sha}']);
  if (!base?.base || base.base === PRODUCAO || base.headSha !== headSha || !SHA.test(base.baseSha || '')
    || (baseEsperada && base.baseSha !== baseEsperada)) return null;
  const producao = await ler(engine, conta, [`repos/${pr.repo}/git/ref/heads/${PRODUCAO}`, '--jq', '{sha: .object.sha}']);
  // Só a ausência da REF prova que não existe production. Um 404 na comparação pode ser
  // o head ausente (fork, force-push, corrida), e não desliga a regra no repositório.
  if (producao === NAO_EXISTE) { (engine.semProducao ||= new Set()).add(pr.repo); return null; }
  if (!SHA.test(producao?.sha || '')) return null;
  // merge-back: o head contém a ponta da production, e a base é medida desde o ancestral comum
  // com ela (regua-de-heranca.js)
  const comparacao = await compararComAFoto(engine, conta, pr.repo, { foto: producao.sha, head: headSha, baseDaResolucao: base.baseSha });
  if (!comparacao) return null;
  const { diferemDaFoto: diferemDaProducao, mexidosNaBase } = comparacao;
  const fora = new Set([...diferemDaProducao, ...mexidosNaBase]);
  return { arquivos: arquivosDoPr.filter((f) => !fora.has(f)), contextoAlterado: [...fora] };
}

const NOTA = 'conferido pelo app: arquivo idêntico ao da production e sem mudança própria da base; dívida herdada, vale um follow-up na task de origem';

// PURO. O texto cita o caminho inteiro, não um pedaço de outro: `src/aviso.ts` dentro de
// `apps/web/src/aviso.ts` (o próprio arquivo do achado) ou o `package.json` da raiz dentro de
// `apps/web/package.json` não apontam o arquivo que a base mudou. Valem `./caminho`, o link do
// GitHub (`.../blob/<ref>/caminho`) e o cabeçalho de diff (`--- a/caminho`, `+++ b/caminho`,
// `diff --git a/caminho b/caminho`). O `a/` e o `b/` só saem nesse cabeçalho: solto no texto,
// `a/package.json` é o arquivo da pasta `a`, não o `package.json` da raiz. A barra invertida do
// estilo Windows vira `/` antes da busca: os caminhos do inventário usam sempre `/`.
const PREFIXOS_DE_CITACAO = [
  // link do GitHub: `https://github.com/o/r/blob/<ref>/caminho` deixa só o caminho
  [/https?:\/\/\S+?\/blob\/[^/\s]+\//g, ' '],
  // cabeçalho de arquivo do diff: `--- a/caminho` e `+++ b/caminho` perdem o `a/` ou o `b/`
  [/(^|[\s(`'"[])(---|\+\+\+) [ab]\//g, '$1$2 '],
  // linha `diff --git a/x b/y`: os dois lados perdem o prefixo
  [/(^|[\s(`'"[])diff --git a\/(\S+) b\//g, '$1diff --git $2 '],
];
function citaCaminho(bruto, caminho) {
  if (!caminho) return false;
  const texto = PREFIXOS_DE_CITACAO.reduce((t, [prefixo, troca]) => t.replace(prefixo, troca), bruto.replaceAll('\\', '/'));
  for (let i = texto.indexOf(caminho); i >= 0; i = texto.indexOf(caminho, i + 1)) {
    const inicio = i >= 2 && texto.startsWith('./', i - 2) ? i - 2 : i;
    const fim = i + caminho.length;
    const antes = /[\w.\-/@~]/.test(texto[inicio - 1] || '');
    const depois = /[\w\-/]/.test(texto[fim] || '') || (texto[fim] === '.' && /\w/.test(texto[fim + 1] || ''));
    if (!antes && !depois) return true;
  }
  return false;
}

// PURO. Rebaixa no próprio resultado o que a sessão declarou herdado e o app confirmou.
// `opcoes`: quem é candidato e a nota do app (o sync por herança usa a dele).
function rebaixarHeranca(result, herdados, contextoAlterado = [], { ehCandidato = candidato, nota = NOTA } = {}) {
  if (!Array.isArray(herdados) || !herdados.length || !Array.isArray(result?.findings)) return 0;
  const herdado = new Set(herdados);
  let mudou = 0;
  result.findings = result.findings.map((f) => {
    if (!ehCandidato(f) || !herdado.has(f.file)) return f;
    // Mesmo blob não prova mesmo comportamento. A própria evidência pode apontar
    // consumidor, dependência ou configuração que a base alterou; isso não é dívida local.
    const evidencia = [f.title, f.summary, f.evidence, f.introduzidoPor?.file, f.introduzidoPor?.evidence].filter(Boolean).join('\n');
    if (contextoAlterado.some((p) => citaCaminho(evidencia, p))) return f;
    mudou += 1;
    const evidence = [String(f.evidence || '').trim(), nota].filter(Boolean).join(' · ');
    // o que vinha de rodada anterior sai como retirado, para a memória não o guardar vivo
    // `herancaConfirmada` é a marca do APP: só ela isenta a memória de rodadas
    return { ...f, severity: 'suggestion', evidence, herancaConfirmada: true, ...(f.ref ? { status: 'retirado' } : {}) };
  });
  return mudou;
}

function temAprovacaoEscrita(result) {
  const p = result?.payloads?.approve;
  return !!(p && p.event === 'APPROVE' && (String(p.body || '').trim() || (Array.isArray(p.comments) && p.comments.length)));
}

// O rebaixamento confirmado fecha a decisão do mesmo jeito para a production e para o sync.
function fecharRebaixamento(result, antes, n, motivo, gateReason) {
  if (!n) return 0;
  // pedido de mudanças sem bloqueio e sem texto de aprovação seria incoerente (e nova análise
  // paga): nesse caso nada é rebaixado e a decisão fica com a pessoa, como estava
  if (result.verdict === 'request_changes' && !result.findings.some((f) => f?.severity === 'blocking') && !temAprovacaoEscrita(result)) {
    result.findings = antes;
    return 0;
  }
  result.reasons = [gateReason(motivo), ...(result.reasons || [])];
  // sem bloqueio próprio, o pedido de mudanças não tem o que sustentar: a decisão volta à política
  // da conta, com o motivo como ressalva. Sem texto de aprovação escrito, fica com a pessoa.
  if (result.verdict === 'request_changes' && !result.findings.some((f) => f?.severity === 'blocking')) {
    result.verdict = 'approve';
    result.decision = 'needs_decision';
  }
  return n;
}

// O sync por herança (sync-por-heranca.js, 24/11/2026): o achado que a sessão marcou como herdado
// da origem (`herdadoDaOrigem`, ou o `herdadoDaProducao` de antes) só é rebaixado se o arquivo
// estiver na lista de herdados que o MOTOR mediu (`result.herancaDoSync`), com a evidência fora do
// contexto alterado (o que a base mexeu e o que ficou a ler). Sem a marca do motor, nada muda.
const NOTA_DO_SYNC = 'conferido pelo app: arquivo idêntico à ponta da origem do sync e sem mudança própria da base; dívida herdada, vale um follow-up na task de origem';
const candidatoDaOrigem = (f) => f && f.severity === 'blocking' && (f.herdadoDaOrigem === true || f.herdadoDaProducao === true)
  && CAUSAS_DE_DIVIDA.has(f.causa) && typeof f.evidence === 'string' && f.evidence.trim();

function aplicarHerancaDoSync(result, gateReason) {
  const h = result?.herancaDoSync;
  if (!h || !Array.isArray(h.herdados) || !Array.isArray(result.findings)) return 0;
  const antes = result.findings;
  const n = rebaixarHeranca(result, h.herdados, Array.isArray(h.contextoAlterado) ? h.contextoAlterado : [],
    { ehCandidato: candidatoDaOrigem, nota: NOTA_DO_SYNC });
  return fecharRebaixamento(result, antes, n,
    `${n} ponto(s) em arquivo herdado da origem do sync viraram sugestão: dívida que já estava na origem, não criada por este PR`, gateReason);
}

async function aplicarHerancaDeProducao(engine, pr, headSha, inventario, result, gateReason) {
  // a marca do app nunca vem da sessão
  if (Array.isArray(result?.findings)) result.findings = result.findings.map((f) => { if (!f || !('herancaConfirmada' in f)) return f; const { herancaConfirmada, ...resto } = f; return resto; });
  // no sync por herança a régua é a origem que o motor mediu, e a production não é lida
  if (result?.herancaDoSync) { aplicarHerancaDoSync(result, gateReason); return; }
  if (!(result?.findings || []).some(candidato)) return;
  if (inventario?.status !== 'complete' || inventario.headSha !== headSha || !SHA.test(inventario.baseSha || '')) return;
  const arquivos = (inventario?.files || []).map((f) => f.path).filter(Boolean);
  const antes = result.findings;
  const prova = await provaDaHeranca(engine, pr, headSha, arquivos, inventario.baseSha);
  const n = rebaixarHeranca(result, prova?.arquivos, prova?.contextoAlterado);
  fecharRebaixamento(result, antes, n, `${n} ponto(s) em arquivo herdado da production viraram sugestão: dívida que já estava em produção, não criada por este PR`, gateReason);
}

export { provaDaHeranca, rebaixarHeranca, aplicarHerancaDeProducao, aplicarHerancaDoSync };
