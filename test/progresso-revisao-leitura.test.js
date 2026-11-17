// A contagem de arquivos da porcentagem: o total sem o que nunca pode ser creditado, a leitura em
// partes (reviewBatchedReads) contando pelo que o motor conferiu, e a retomada sem "N de M".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-progresso-leitura-'));
process.env.FAROL_HOME = home;
const { observeReadEvent, observarLeitura } = await import('../lib/engine/read-evidence.js');
const { progressoDaSessao, abrirConferenciaPelaVerificacao } = await import('../lib/engine/progresso-revisao.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));

const root = path.join(home, 'patches');
fs.mkdirSync(root);
for (const name of ['a.js', 'b.js', 'c.js', 'd.js']) fs.writeFileSync(path.join(root, name), 'first\nsecond\nthird\n');
const opts = { id: 'a1' };

function motor(extra = {}) {
  const rec = { id: 'a1', etapa: 'codigo', startedAt: Date.now(), scopeRoot: root, filesRead: new Set(), arquivosALer: new Set(['a.js', 'b.js', 'c.js', 'd.js']), ...extra };
  return { config: { reviewBatchedReads: true }, activeReviews: new Map([['a1', rec]]), pushState() {}, rec };
}
function ler(engine, file, id, { start = 1, lines = ['first', 'second', 'third'] } = {}) {
  const block = { type: 'tool_use', name: 'Read', id, input: { file_path: path.join(root, file) } };
  observeReadEvent(engine, opts, { type: 'assistant', parent_tool_use_id: null, message: { content: [block] } });
  observarLeitura(engine, opts, block);
  const content = lines.map((line, i) => ` ${start + i}→${line}`).join('\n');
  observeReadEvent(engine, opts, { type: 'user', parent_tool_use_id: null,
    tool_use_result: { type: 'text', file: { filePath: path.join(root, file), content: lines.join('\n'), startLine: start, numLines: lines.length, totalLines: 3 } },
    message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: false, content }] } });
}

test('arquivo sem conteúdo integral sai do total: a leitura completa chega a 65 e abre a conferência', () => {
  const e = motor({ semConteudoIntegral: new Set(['d.js']) });
  for (const [i, f] of ['a.js', 'b.js', 'c.js'].entries()) ler(e, f, `r${i}`);
  const p = progressoDaSessao(e.rec);
  assert.equal(p.arquivosTotais, 3);
  assert.equal(p.arquivosLidos, 3);
  assert.equal(p.percentual, 65);
  abrirConferenciaPelaVerificacao(e, 'a1');
  assert.equal(e.rec.etapa, 'conferencia');
});

test('leitura em partes com reviewBatchedReads: a entrega conferida conta no andamento, sem creditar a cobertura', () => {
  const e = motor();
  ler(e, 'a.js', 'r0', { lines: ['first'] });
  assert.equal(e.rec.filesRead.size, 0);
  assert.equal(progressoDaSessao(e.rec).arquivosLidos, 1);
  // entrega adulterada não conta
  ler(e, 'b.js', 'r1', { lines: ['outra coisa'] });
  assert.equal(progressoDaSessao(e.rec).arquivosLidos, 1);
});

test('retomada: o número segue pela leitura observada e o "N de M" sai; a verificação não abre a conferência', () => {
  const e = motor({ resumeOutcome: 'retomada' });
  ler(e, 'a.js', 'r0');
  const p = progressoDaSessao(e.rec);
  assert.equal(p.percentual, 20 + Math.floor(45 / 4));
  assert.equal(p.arquivosLidos, undefined);
  assert.equal(p.arquivosTotais, undefined);
  for (const [i, f] of ['b.js', 'c.js', 'd.js'].entries()) ler(e, f, `s${i}`);
  abrirConferenciaPelaVerificacao(e, 'a1');
  assert.equal(e.rec.etapa, 'codigo');
});
