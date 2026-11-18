// O detalhe da revisão com o que o redesenho pedia e o motor não mandava (17/11/2026):
//   - os achados com arquivo, linha e o trecho do diff daquela linha (memória de rodadas e provas);
//   - as rodadas do mesmo PR, uma a uma, do histórico;
//   - o tamanho do PR (arquivos, adições e remoções), do inventário gravado na decisão.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-detalhe-achados-'));
process.env.FAROL_HOME = home;
const io = (await import('../lib/io.js')).default;
const { linhasDoPatch, trechosDosAchados, trechosGravados } = await import('../lib/engine/trecho-do-achado.js');
const { provasDaDecisao } = await import('../lib/engine/provas-da-decisao.js');
const { saveRound, scopeFor, readRound } = await import('../lib/engine/review-round-store.js');
const { detalheDaDecisao, achadosDaRodada, rodadasEntre, tamanhoDoPr } = await import('../lib/engine/detalhe-da-decisao.js');
const { fetchPrInventory } = await import('../lib/engine/pr-inventory.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));

const PATCH = [
  '@@ -10,4 +10,5 @@ export function editar() {',
  '   const versoes = carregar();',
  '-  const alvo = versoes[indice];',
  '+  const alvo = versoes[indice] ?? { id: 1 };',
  "+  await api.patch('/respostas/' + alvo.id, corpo);",
  '   return alvo;',
  ' }',
  '@@ -40,2 +41,3 @@',
  '   linha40();',
  '+  linha42();',
  '   linha43();',
].join('\n');

test('o trecho: a linha do head e as vizinhas do diff; linha fora do diff não tem trecho', () => {
  assert.deepEqual(linhasDoPatch(PATCH, 11), [
    { linha: 10, tipo: 'contexto', texto: '  const versoes = carregar();' },
    { linha: 11, tipo: 'adicionada', texto: '  const alvo = versoes[indice] ?? { id: 1 };' },
    { linha: 12, tipo: 'adicionada', texto: "  await api.patch('/respostas/' + alvo.id, corpo);" },
  ]);
  assert.deepEqual(linhasDoPatch(PATCH, 42).map((l) => l.linha), [41, 42, 43], 'o segundo bloco conta do cabeçalho dele');
  assert.deepEqual(linhasDoPatch(PATCH, 30), [], 'entre blocos: fora do diff');
  assert.deepEqual(linhasDoPatch('(sem patch textual: arquivo binário)', 1), []);
  assert.equal(linhasDoPatch(`@@ -1 +1 @@\n+${'x'.repeat(500)}`, 1)[0].texto.length, 160);
});

function escopo(nome, arquivos) {
  const raiz = path.join(home, 'pr-scope', nome);
  for (const [rel, conteudo] of Object.entries(arquivos)) {
    fs.mkdirSync(path.dirname(path.join(raiz, rel)), { recursive: true });
    fs.writeFileSync(path.join(raiz, rel), conteudo);
  }
  return raiz;
}

const achado = (extra) => ({ severity: 'blocking', causa: 'defeito_codigo', title: 'Editar falha', summary: 'perde a edição', ...extra });

test('os trechos dos achados: só do escopo, nunca de caminho protegido nem fora da raiz, com segredo mascarado', () => {
  const raiz = escopo('a', {
    'src/editar.ts': PATCH,
    '.env': '@@ -1 +1 @@\n+TOKEN=nao-pode-sair',
    'src/chave.ts': '@@ -1 +1 @@\n+const k = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";',
  });
  fs.writeFileSync(path.join(home, 'pr-scope', 'fora.ts'), '@@ -1 +1 @@\n+fora');
  const trechos = trechosDosAchados(raiz, [
    achado({ file: 'src/editar.ts', line: 11 }),
    achado({ file: 'src/editar.ts', line: 11, title: 'repetido' }),
    achado({ file: '.env', line: 1 }),
    achado({ file: '../fora.ts', line: 1 }),
    achado({ file: 'src/chave.ts', line: 1 }),
    achado({ file: 'src/editar.ts', line: 30 }),
    { severity: 'suggestion', title: 'sem arquivo', summary: 's' },
  ]);
  assert.deepEqual(trechos.map((t) => `${t.arquivo}:${t.linha}`), ['src/editar.ts:11', 'src/chave.ts:1']);
  assert.doesNotMatch(JSON.stringify(trechos), /ghp_abcdefghij/);
  assert.deepEqual(trechosDosAchados('', [achado({ file: 'src/editar.ts', line: 11 })]), []);
  assert.deepEqual(trechosDosAchados(raiz, 'torto'), []);
});

test('as provas gravam os trechos conferidos, com teto, e o que vem torto do disco sai', () => {
  const raiz = escopo('b', { 'x.ts': PATCH });
  const p = provasDaDecisao({ trechosDosAchados: trechosDosAchados(raiz, [achado({ file: 'x.ts', line: 42 })]) });
  assert.deepEqual(p.trechos, [{ arquivo: 'x.ts', linha: 42, linhas: [
    { linha: 41, tipo: 'contexto', texto: '  linha40();' }, { linha: 42, tipo: 'adicionada', texto: '  linha42();' }, { linha: 43, tipo: 'contexto', texto: '  linha43();' }] }]);
  assert.deepEqual(provasDaDecisao({}).trechos, []);
  assert.deepEqual(trechosGravados([{ arquivo: 'a', linha: 1, linhas: [{ linha: 'x', texto: 1 }] }, null, { arquivo: 2 }]), []);
  assert.equal(trechosGravados(Array.from({ length: 30 }, (_, i) => ({ arquivo: 'a', linha: i + 1, linhas: [{ linha: i + 1, texto: 't' }] }))).length, 10);
});

const ID_RODADA = 'c'.repeat(32);
const KEY = 'acme/app#7';
const HEAD = 'a3f91c2'.padEnd(40, '0');

function gravarRodada(findings) {
  const scope = scopeFor(KEY, 'revisora');
  saveRound({ schema: 1, id: ID_RODADA, ordinal: 1, scope, parents: [], headSha: HEAD, baseSha: 'b'.repeat(40), at: 1, executor: 'local',
    decision: 'needs_decision', verdict: 'request_changes', findingsStatus: 'complete', findings, unresolved: findings.filter((f) => f.severity === 'blocking'),
    files: [{ path: 'src/editar.ts', sha: 's' }], integrity: [] });
  return scope;
}

test('achados no detalhe: da rodada gravada, com arquivo, linha e o trecho das provas', () => {
  const findings = [
    { id: `${ID_RODADA}:f1`, ...achado({ file: 'src/editar.ts', line: 11, evidence: 'e' }) },
    { id: `${ID_RODADA}:f2`, severity: 'suggestion', title: 'Contador não volta', summary: 'o estado fica no hook', file: 'src/useVersoes.ts', line: 41, status: 'persiste' },
    { id: `${ID_RODADA}:f3`, severity: 'question', title: 'Sem arquivo', summary: 'pergunta geral' },
  ];
  const scope = gravarRodada(findings);
  assert.equal(readRound(scope, ID_RODADA).id, ID_RODADA);
  assert.equal(readRound(scope, '../x'), null);
  const provas = { trechos: [{ arquivo: 'src/editar.ts', linha: 11, linhas: [{ linha: 11, tipo: 'adicionada', texto: 'const alvo = versoes[indice] ?? { id: 1 };' }] }] };
  const decisao = { id: 'd1', key: KEY, createdAt: 10, resolvedAt: 11, action: 'request_changes', verdict: 'request_changes', headSha: HEAD,
    roundId: ID_RODADA, pr: { repo: 'acme/app', number: 7, account: 'revisora', author: 'bia', title: 'T' }, provas,
    inventarioDiff: { status: 'complete', changedFiles: 14, additions: 612, deletions: 148, files: [] } };
  const engine = { decisions: { pending: [], resolved: [decisao] } };
  const d = detalheDaDecisao(engine, new URLSearchParams(`key=${encodeURIComponent(KEY)}`)).body.decision;
  assert.deepEqual(d.achados, [
    { severidade: 'blocking', titulo: 'Editar falha', resumo: 'perde a edição', arquivo: 'src/editar.ts', linha: 11,
      trecho: [{ linha: 11, tipo: 'adicionada', texto: 'const alvo = versoes[indice] ?? { id: 1 };' }] },
    { severidade: 'suggestion', titulo: 'Contador não volta', resumo: 'o estado fica no hook', arquivo: 'src/useVersoes.ts', linha: 41, situacao: 'persiste' },
    { severidade: 'question', titulo: 'Sem arquivo', resumo: 'pergunta geral' },
  ]);
  assert.deepEqual(d.tamanhoDoPr, { arquivos: 14, adicoes: 612, remocoes: 148 });
  assert.equal(d.provas, undefined, 'as provas brutas não saem');
  // sem roundId ou com a rodada de outra conta não há achados
  const semRodada = detalheDaDecisao({ decisions: { pending: [], resolved: [{ ...decisao, roundId: null }] } }, new URLSearchParams(`key=${encodeURIComponent(KEY)}`)).body.decision;
  assert.equal('achados' in semRodada, false);
  assert.equal(achadosDaRodada(null, provas), null);
  assert.equal(achadosDaRodada({ findings: [{ severity: 'praise', title: 'x' }] }, provas), null);
});

test('rodadas do PR: em ordem de criação, com head curto, parecer, o que foi publicado e a pendente', () => {
  const leves = [
    { id: 'r3', key: KEY, createdAt: 30, resolvedAt: 31, headSha: 'a3f91c2'.padEnd(40, '1'), verdict: 'request_changes', action: 'request_changes' },
    { id: 'outro', key: 'acme/app#8', createdAt: 25, action: 'approve' },
    { id: 'r2', key: KEY, createdAt: 20, resolvedAt: 21, headSha: '81bd0e4'.padEnd(40, '2'), verdict: 'approve', action: 'skip' },
    { id: 'r1', key: KEY, createdAt: 10, resolvedAt: 11, headSha: '', verdict: 'comment', action: 'comment' },
  ];
  const pendente = { id: 'p4', key: KEY, createdAt: 40, headSha: 'f'.repeat(40), verdict: 'approve', status: 'pending' };
  assert.deepEqual(rodadasEntre({ key: KEY }, [pendente], leves, false), { itens: [
    { id: 'r1', rodada: 1, em: 11, parecer: 'comment', publicado: 'comment' },
    { id: 'r2', rodada: 2, em: 21, head: '81bd0e4', parecer: 'approve', publicado: null },
    { id: 'r3', rodada: 3, em: 31, head: 'a3f91c2', parecer: 'request_changes', publicado: 'request_changes' },
    { id: 'p4', rodada: 4, em: 40, head: 'fffffff', parecer: 'approve', publicado: null, pendente: true },
  ] });
  // no teto, o PR que tem a decisão mais antiga guardada pode ter perdido rodadas
  assert.equal(rodadasEntre({ key: KEY }, [], leves, true).inicioIncerto, true);
  assert.equal('inicioIncerto' in rodadasEntre({ key: 'acme/app#8' }, [], leves, true), false);
  assert.equal(rodadasEntre({ key: 'nao#1' }, [], leves, false), null);
  // no detalhe, e fora com o histórico indisponível
  const engine = { decisions: { pending: [], resolved: leves.map((l) => ({ ...l, pr: { repo: 'acme/app', number: 7 } })) } };
  const d = detalheDaDecisao(engine, new URLSearchParams(`key=${encodeURIComponent(KEY)}`)).body.decision;
  assert.deepEqual(d.rodadasDoPr.itens.map((r) => r.id), ['r1', 'r2', 'r3']);
  const fora = detalheDaDecisao({ ...engine, historicoForaDoBanco: true, decisions: { pending: [pendente], resolved: [] } }, new URLSearchParams(`key=${encodeURIComponent(KEY)}`)).body.decision;
  assert.equal('rodadasDoPr' in fora, false);
});

test('tamanho do PR: arquivos sempre que contados; adições e remoções só quando gravadas as duas', () => {
  assert.deepEqual(tamanhoDoPr({ changedFiles: 3 }), { arquivos: 3 });
  assert.deepEqual(tamanhoDoPr({ changedFiles: 3, additions: 10, deletions: null }), { arquivos: 3 });
  assert.deepEqual(tamanhoDoPr({ changedFiles: 3, additions: 10, deletions: 0 }), { arquivos: 3, adicoes: 10, remocoes: 0 });
  assert.equal(tamanhoDoPr({ changedFiles: null }), null);
  assert.equal(tamanhoDoPr(null), null);
});

test('o inventário passa a gravar as adições e remoções do PR, sem mudar a conferência', async (t) => {
  const meta = { headSha: HEAD, baseSha: 'b'.repeat(40), changedFiles: 1, additions: 612, deletions: 148 };
  const files = [{ path: 'a.ts', sha: 's', status: 'modified', lines: 760 }];
  const original = io.run;
  t.after(() => { io.run = original; });
  const chamadas = [];
  io.run = async (_cmd, args) => { chamadas.push(args); return { ok: true, stdout: JSON.stringify(args.includes('--paginate') ? files : meta) }; };
  const engine = { accountForPr: () => 'eu', tokenFor: () => 'fixture', ghEnv: () => ({}) };
  const inv = await fetchPrInventory(engine, { repo: 'o/r', number: 1 }, HEAD);
  assert.equal(inv.status, 'complete');
  assert.equal(inv.additions, 612);
  assert.equal(inv.deletions, 148);
  assert.match(chamadas[0].at(-1), /additions: \.additions, deletions: \.deletions/);
  io.run = async (_cmd, args) => ({ ok: true, stdout: JSON.stringify(args.includes('--paginate') ? files : { ...meta, additions: 'muitas', deletions: -1 }) });
  const torto = await fetchPrInventory(engine, { repo: 'o/r', number: 1 }, HEAD);
  assert.equal(torto.status, 'complete', 'contagem torta não invalida o inventário');
  assert.equal(torto.additions, null);
  assert.equal(torto.deletions, null);
});

test('o desfecho lê os trechos do escopo da sessão antes de decidir, e as provas os levam', async () => {
  const { concluirRevisao } = await import('../lib/engine/desfecho-da-revisao.js');
  const raiz = escopo('c', { 'src/editar.ts': PATCH });
  const rec = { etapa: 'conferencia', scopeRoot: raiz };
  const engine = { activeReviews: new Map([['s1', rec]]), pushState() {}, attentionPoints: () => { throw new Error('parou aqui'); } };
  const result = { findings: [achado({ file: 'src/editar.ts', line: 12 })] };
  await assert.rejects(concluirRevisao(engine, { id: 's1', pr: { key: KEY }, result }), /parou aqui/);
  assert.deepEqual(result.trechosDosAchados.map((t) => `${t.arquivo}:${t.linha}`), ['src/editar.ts:12']);
  assert.equal(provasDaDecisao(result).trechos[0].linhas.length, 3);
});
