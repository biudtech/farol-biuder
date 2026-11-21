// O uso do plano conferido antes da sessão automática (21/11/2026). Até aqui o motor só sabia do
// limite depois que uma sessão batia nele: o primeiro PR depois que a cota acabava abria sessão,
// punha a label <conta>:revisando no PR e morria segundos depois. Agora o `/usage` lido (o mesmo
// da tela, guardado por dois minutos) registra o limite antes, e o PR volta sem sessão.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-uso-antes-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { LIMITE_PLANO_FILE } = await import('../lib/paths.js');
const { TEMPOS } = await import('../lib/constants.js');
const uso = await import('../lib/engine/uso-do-plano.js');
const antes = await import('../lib/engine/uso-antes-da-sessao.js');
const { perfisParaTela } = await import('../lib/engine/perfil-claude.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// o reset no formato do CLI, em UTC, arredondado ao minuto
function resetTexto(ms) {
  const d = new Date(ms);
  const h = d.getUTCHours();
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${MESES[d.getUTCMonth()]} ${d.getUTCDate()}, ${h % 12 || 12}:${mm}${h < 12 ? 'am' : 'pm'} (UTC)`;
}
const EM_DUAS_HORAS = () => Math.floor((Date.now() + 2 * TEMPOS.HORA_MS) / 60000) * 60000;

function textoDoUso({ sessao = 10, semana = 20, fable = null, reset = EM_DUAS_HORAS() } = {}) {
  const r = resetTexto(reset);
  const linhas = [`Current session: ${sessao}% used · resets ${r}`, `Current week (all models): ${semana}% used · resets ${r}`];
  if (fable !== null) linhas.push(`Current week (Fable): ${fable}% used · resets ${r}`);
  return linhas.join('\n');
}
const saida = (texto) => ({ ok: true, code: 0, stdout: JSON.stringify({ type: 'result', is_error: false, result: texto, credential_expires_at: '2027-01-01T00:00:00Z' }), stderr: '' });

const pasta = (nome) => path.join(process.env.FAROL_HOME, 'claude', nome);
const PERFIS = [
  { id: 'a', label: 'Assinatura A', kind: 'dir', dir: pasta('a') },
  { id: 'b', label: 'Assinatura B', kind: 'dir', dir: pasta('b') },
];
for (const p of PERFIS) { fs.mkdirSync(p.dir, { recursive: true }); fs.writeFileSync(path.join(p.dir, '.credentials.json'), '{}'); }

const prDe = (key, extra) => ({ key, url: `https://github.com/${key.replace('#', '/pull/')}`, ...extra });

function engineBase({ reviewModel = 'opus', perfis = [PERFIS[0]] } = {}) {
  try { fs.rmSync(LIMITE_PLANO_FILE, { force: true }); } catch { /* best-effort */ }
  const e = new Engine();
  e.config.claudeProfiles = perfis;
  e.config.claudeProfileId = perfis[0].id;
  e.config.reviewModel = reviewModel;
  e.usoDoPlanoLigado = true;
  e.accountForPr = () => 'eu';
  e.token = 't1';
  e.linhas = [];
  e.log = (nivel, texto) => e.linhas.push(`${nivel} ${texto}`);
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  e.prState = async () => 'OPEN';
  e.sessoesAbertas = 0;
  e.runHeadlessReview = async () => { e.sessoesAbertas += 1; };
  return e;
}

// guarda uma leitura recente no cache do perfil, como a tela ou a conferência anterior faria
async function guardarUso(e, perfil, texto) {
  await uso.lerUso(e, perfil, { forcar: true, rodar: async () => saida(texto) });
}

test('janela da sessão em 100%: não abre sessão, não põe label, registra até o reset e não gasta tentativa', async () => {
  const e = engineBase();
  const reset = EM_DUAS_HORAS();
  await guardarUso(e, PERFIS[0], textoDoUso({ sessao: 100, reset }));
  await e.runOneHeadless(prDe('o/r#1'), 'eu');
  assert.equal(e.sessoesAbertas, 0, 'a sessão não abre, e a label só entra com a sessão aberta');
  assert.equal(e.limiteDoPlanoAte('eu'), reset, 'o limite vai até o reset da janela');
  const guardado = e.retryAfterNet.get('o/r#1');
  assert.equal(guardado.notBefore, reset);
  assert.equal(guardado.tries, 0, 'nada falhou neste PR');
  assert.ok(e.queue.some((p) => p.key === 'o/r#1'), 'o PR continua na fila');
  const gravado = JSON.parse(fs.readFileSync(LIMITE_PLANO_FILE, 'utf8'))['dir:a'];
  assert.deepEqual([gravado.origem, gravado.janela, gravado.estimado], ['uso', 'Sessão', false]);
  assert.equal(e.linhas.filter((l) => l.includes('em 100%')).length, 1);
});

test('a semana com todos os modelos em 100% também trava', async () => {
  const e = engineBase();
  await guardarUso(e, PERFIS[0], textoDoUso({ semana: 100 }));
  await e.runOneHeadless(prDe('o/r#2'), 'eu');
  assert.equal(e.sessoesAbertas, 0);
  assert.ok(e.limiteDoPlanoAte('eu') > Date.now());
});

test('janela de um modelo só que não é o da revisão: segue', async () => {
  const e = engineBase({ reviewModel: 'opus' });
  await guardarUso(e, PERFIS[0], textoDoUso({ fable: 100 }));
  await e.runOneHeadless(prDe('o/r#3'), 'eu');
  assert.equal(e.sessoesAbertas, 1, 'a semana do Fable não barra o Opus');
  assert.equal(e.limiteDoPlanoAte('eu'), 0);
});

test('janela de um modelo só que é o da revisão: trava; modelo de família desconhecida não', async () => {
  const fable = engineBase({ reviewModel: 'fable' });
  await guardarUso(fable, PERFIS[0], textoDoUso({ fable: 100 }));
  await fable.runOneHeadless(prDe('o/r#4'), 'eu');
  assert.equal(fable.sessoesAbertas, 0);

  const padrao = engineBase({ reviewModel: '' });
  await guardarUso(padrao, PERFIS[0], textoDoUso({ fable: 100 }));
  await padrao.runOneHeadless(prDe('o/r#5'), 'eu');
  assert.equal(padrao.sessoesAbertas, 1, 'o padrão da assinatura pode não ser o Fable: não trava');
});

test('o modo Auto só trava pela janela de um modelo quando todo modelo possível é dela', () => {
  assert.deepEqual(antes.modelosDaRevisao({ reviewModel: 'auto' }), ['opus']);
  const opus = { id: 'semana:opus', usado: 1, reset: Date.now() + 1000 };
  assert.equal(antes.janelaSeAplica(opus, ['opus']), true);
  assert.equal(antes.janelaSeAplica(opus, ['opus', 'sonnet']), false);
  assert.equal(antes.janelaSeAplica({ id: 'semana:desconhecido' }, ['opus']), false);
  assert.equal(antes.janelaSeAplica({ id: 'sessao' }, ['']), true);
});

test('leitura que falha, sem login ou de formato novo: segue, e o log escreve uma vez por estado', async () => {
  const e = engineBase();
  let leituras = 0;
  const falha = async () => { leituras += 1; throw new Error('spawn falhou'); };
  assert.equal(await antes.limiteAntesDaSessao(e, 'eu', { rodar: falha }), 0);
  assert.equal(await antes.limiteAntesDaSessao(e, 'eu', { rodar: falha }), 0);
  assert.equal(leituras, 1, 'a falha guardada não abre um processo por PR');
  assert.equal(e.linhas.filter((l) => l.includes('não conferido antes da sessão')).length, 1);

  const semLogin = engineBase();
  const r = async () => ({ ok: true, code: 0, stdout: JSON.stringify({ type: 'result', result: '' }), stderr: '' });
  assert.equal(await antes.limiteAntesDaSessao(semLogin, 'eu', { rodar: r }), 0);
  const outroFormato = engineBase();
  assert.equal(await antes.limiteAntesDaSessao(outroFormato, 'eu', { rodar: async () => saida('Session: full') }), 0);
  await outroFormato.runOneHeadless(prDe('o/r#6'), 'eu');
  assert.equal(outroFormato.sessoesAbertas, 1);
});

test('leitura que passa do prazo: segue sem esperar o fim dela', async () => {
  const e = engineBase();
  const lenta = () => new Promise((resolve) => setTimeout(() => resolve(saida(textoDoUso({ sessao: 100 }))), 200));
  assert.equal(await antes.limiteAntesDaSessao(e, 'eu', { rodar: lenta, prazoMs: 20 }), 0);
  await new Promise((resolve) => setTimeout(resolve, 250));
});

test('a leitura guardada evita ler de novo; velha de mais de dois minutos lê', async () => {
  const e = engineBase();
  let leituras = 0;
  const rodar = async () => { leituras += 1; return saida(textoDoUso()); };
  await antes.limiteAntesDaSessao(e, 'eu', { rodar });
  await antes.limiteAntesDaSessao(e, 'eu', { rodar });
  await antes.limiteAntesDaSessao(e, 'eu', { rodar });
  assert.equal(leituras, 1);
  e.usosDoPlano.get('a').leitura.em -= TEMPOS.CLAUDE_USO_ANTES_MS + 1;
  await antes.limiteAntesDaSessao(e, 'eu', { rodar });
  assert.equal(leituras, 2);
});

test('com a assinatura já no limite, nem lê o uso', async () => {
  const e = engineBase();
  await guardarUso(e, PERFIS[0], textoDoUso({ sessao: 100 }));
  await antes.limiteAntesDaSessao(e, 'eu');
  let leituras = 0;
  await antes.limiteAntesDaSessao(e, 'eu', { rodar: async () => { leituras += 1; return saida(textoDoUso()); } });
  assert.equal(leituras, 0);
});

test('clique manual passa mesmo com o uso em 100%', async () => {
  const e = engineBase();
  await guardarUso(e, PERFIS[0], textoDoUso({ sessao: 100 }));
  await e.runOneHeadless(prDe('o/r#7', { manual: true }), 'eu');
  assert.equal(e.sessoesAbertas, 1);
  assert.equal(e.limiteDoPlanoAte('eu'), 0, 'o clique nem consulta o uso');
});

test('engine que não foi ligado no boot não lê o uso (o de teste nunca abre o CLI)', async () => {
  const e = engineBase();
  e.usoDoPlanoLigado = false;
  let leituras = 0;
  assert.equal(await antes.limiteAntesDaSessao(e, 'eu', { rodar: async () => { leituras += 1; return saida(textoDoUso({ sessao: 100 })); } }), 0);
  assert.equal(leituras, 0);
});

test('perfil padrão cheio passa para o próximo, que é conferido também; a tela diz por que parou', async () => {
  const e = engineBase({ perfis: PERFIS });
  const reset = EM_DUAS_HORAS();
  await guardarUso(e, PERFIS[0], textoDoUso({ semana: 100, reset }));
  await guardarUso(e, PERFIS[1], textoDoUso());
  await e.runOneHeadless(prDe('o/r#8'), 'eu');
  assert.equal(e.sessoesAbertas, 1, 'o segundo perfil está livre');
  assert.equal(e.resolveClaudeAuth('eu').id, 'b');
  const tela = perfisParaTela(e);
  assert.deepEqual(tela.limites, { a: { ate: reset, estimado: false, origem: 'uso', janela: 'Semana' } });

  await guardarUso(e, PERFIS[1], textoDoUso({ sessao: 100, reset: reset + 60000 }));
  await e.runOneHeadless(prDe('o/r#9'), 'eu');
  assert.equal(e.sessoesAbertas, 1, 'os dois cheios: a fila espera o reset mais cedo');
  assert.equal(e.retryAfterNet.get('o/r#9').notBefore, reset);
});
