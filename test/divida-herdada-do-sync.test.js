// Achado em arquivo herdado do sync por herança (24/11/2026): o arquivo é idêntico à ponta da
// origem e a base não mexeu nele, então o achado automático nele é dívida herdada da origem, que
// informa e não bloqueia. O achado em arquivo a ler segue a regra de hoje. O achado da sessão só é
// rebaixado com a lista do motor: a sessão nunca decide sozinha o que é herdado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificarPorLinhas, pontoDaDivida } from '../lib/technical-review/divida-fora-das-linhas.js';
import { technicalGap, TOOL } from '../lib/technical-review/verdict.js';
import { relatorioTecnico } from '../lib/technical-review/runtime.js';
import { aplicarHerancaDoSync } from '../lib/engine/heranca-de-producao.js';

const HEAD = 'd'.repeat(40);
const BLOB = 'c'.repeat(40);
const SUPRESSAO = 'core.suppression.declared';
const LACUNA_DE_VIOLACAO = 'violação técnica confirmada';
const HERDADO = 'src/zonas/zona.guard.ts';
const TELA = 'src/features/first-steps/RegisterFlow.tsx';
const faixa = (linha) => ({ intervaloVerificado: { inicio: linha, fim: linha, blob: BLOB } });
const supressor = (file, linha) => ({ rule: SUPRESSAO, file, ...faixa(linha),
  message: `supressor "@ts-expect-error" na linha ${linha} sem motivo; a ficha e "<supressor> <identificador> -- <motivo>"`,
  assinatura: `${SUPRESSAO}|${file}|@ts-expect-error:motivo` });
const arquivo = (path, patch) => ({ path, sha: BLOB, status: 'modified', patch, patchStatus: 'available',
  patchOrigin: { status: 'available', policy: null }, representation: null });
const INVENTARIO = { status: 'complete', headSha: HEAD, baseSha: 'b'.repeat(40), changedFiles: 2,
  files: [arquivo(HERDADO, '@@ -10,3 +10,4 @@\n a\n+b\n c\n'), arquivo(TELA, '@@ -10,3 +10,4 @@\n a\n+b\n c\n')] };
const ctx = { repo: 'o/r', base: 'b'.repeat(40), head: HEAD, profile: { fingerprint: 'p' }, objections: { fingerprint: 'h' } };
const base = { catalogFingerprint: 'c', verdict: 'fail', coverage: {} };
const gateReason = (text) => ({ text, kind: 'gate' });

test('achado mecânico em arquivo herdado do sync vira dívida, com linha ou sem', () => {
  const r = classificarPorLinhas({ rules: [{ rule: SUPRESSAO, verdict: 'fail' }], findings: [supressor(HERDADO, 10), { rule: SUPRESSAO, file: HERDADO, message: 'sem linha' }] }, INVENTARIO, HEAD, [HERDADO]);
  assert.ok(r.findings.every((f) => f.foraDasLinhas === true && f.herdadoDaOrigem === true));
  assert.equal(r.rules[0].dividaForaDasLinhas, true);
  assert.equal(r.resumo.herdadosDaOrigem, 2);
  const rel = relatorioTecnico(ctx, { ...base, rules: [{ rule: SUPRESSAO, verdict: 'fail' }], findings: [supressor(HERDADO, 10)] }, { inventario: INVENTARIO, herdadosDoSync: [HERDADO] });
  assert.equal(technicalGap(rel, { head: HEAD }), '');
  assert.equal(rel.version, TOOL.version);
});

test('sem o mapa de trechos, o herdado do sync ainda vira dívida', () => {
  const r = classificarPorLinhas({ rules: [{ rule: SUPRESSAO, verdict: 'fail' }], findings: [supressor(HERDADO, 10)] }, null, HEAD, [HERDADO]);
  assert.equal(r.findings[0].herdadoDaOrigem, true);
  assert.equal(r.rules[0].dividaForaDasLinhas, true);
});

test('achado em arquivo a ler segue bloqueando', () => {
  const r = classificarPorLinhas({ rules: [{ rule: SUPRESSAO, verdict: 'fail' }], findings: [supressor(TELA, 11)] }, INVENTARIO, HEAD, [HERDADO]);
  assert.equal(r.rules[0].dividaForaDasLinhas, undefined);
  assert.equal(technicalGap(relatorioTecnico(ctx, { ...base, rules: r.rules, findings: r.findings }, { inventario: INVENTARIO, herdadosDoSync: [HERDADO] }), { head: HEAD }), LACUNA_DE_VIOLACAO);
});

test('sem a lista do motor, nada muda', () => {
  const r = classificarPorLinhas({ rules: [{ rule: SUPRESSAO, verdict: 'fail' }], findings: [supressor(HERDADO, 11)] }, INVENTARIO, HEAD);
  assert.equal(r.findings[0].herdadoDaOrigem, undefined);
  assert.equal(r.rules[0].dividaForaDasLinhas, undefined);
});

test('o ponto da dívida diz que veio da origem', () => {
  assert.match(pontoDaDivida({ foraDasLinhas: { achados: 2, herdadosDaOrigem: 2, amostra: [] } }), /herdado\(s\) da origem do sync/);
  assert.doesNotMatch(pontoDaDivida({ foraDasLinhas: { achados: 2, amostra: [] } }), /origem do sync/);
});

const achado = (file, extra = {}) => ({ severity: 'blocking', causa: 'defeito_codigo', file, line: 3, title: 'Guarda sem teste',
  summary: 'A guarda não tem teste.', evidence: 'O arquivo já era assim na homologation.', ...extra });

test('achado da sessão herdadoDaOrigem em arquivo da lista do motor vira sugestão', () => {
  const result = { verdict: 'request_changes', findings: [achado(HERDADO, { herdadoDaOrigem: true })], herancaDoSync: { herdados: [HERDADO], contextoAlterado: [TELA] }, payloads: { approve: { event: 'APPROVE', body: 'ok' } } };
  assert.equal(aplicarHerancaDoSync(result, gateReason), 1);
  assert.equal(result.findings[0].severity, 'suggestion');
  assert.equal(result.findings[0].herancaConfirmada, true);
  assert.equal(result.verdict, 'approve');
});

test('fora da lista, sem a marca do motor ou com evidência no contexto alterado: segue bloqueando', () => {
  const casos = [
    { verdict: 'request_changes', findings: [achado(TELA, { herdadoDaOrigem: true })], herancaDoSync: { herdados: [HERDADO], contextoAlterado: [] } },
    { verdict: 'request_changes', findings: [achado(HERDADO, { herdadoDaOrigem: true })] },
    { verdict: 'request_changes', findings: [achado(HERDADO, { herdadoDaOrigem: true, evidence: `O consumidor ${TELA} mudou.` })], herancaDoSync: { herdados: [HERDADO], contextoAlterado: [TELA] } },
  ];
  for (const r of casos) { assert.equal(aplicarHerancaDoSync(r, gateReason), 0); assert.equal(r.findings[0].severity, 'blocking'); }
});
