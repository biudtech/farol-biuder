// Prova da migração do consumo para o banco (lib/telemetria/), sobre uma CÓPIA dos JSON de uma
// instância: monta o que `GET /api/usage` e a chave `usage` do snapshot devolvem, para os
// períodos de 7, 30 e 90 dias, com filtros de tipo, modelo, conta e repositório e várias páginas
// do histórico, e grava tudo como JSON de chaves ordenadas, para comparar byte a byte.
//
//   FAROL_HOME=<pasta temporária vazia> node tools/comparar-consumo-sqlite.js \
//     --pasta <dir> --modo json|banco --saida <arquivo> [--hoje AAAA-MM-DD] [--medir N]
//
// `--pasta` tem os quatro arquivos (usage-sessions.json, usage.json, usage-tentativas.json e
// falhas-sessao.json); eles são copiados para o FAROL_HOME, e o original nunca é aberto para
// escrita. `json` lê o diário em memória, como o motor lia antes do banco (e como lê quando o
// banco não abre); `banco` passa pela carga do motor (`carregarConsumo`), que migra a cópia para
// o telemetria.db e lê dele. As tentativas abertas não são reconciliadas aqui: a reconciliação
// do boot grava uma linha com a hora de agora e é igual nos dois modos.
//
// Só lê: não sobe a Engine nem abre o GitHub. O FAROL_HOME tem de existir, estar vazio e ficar
// fora do ~/.farol (como em tools/provar-fontes-github.js); quem chama o apaga depois.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { semAsVariaveis } from '../lib/env.js';
import { TEMPOS } from '../lib/constants.js';

const ARQUIVOS = ['usage-sessions.json', 'usage.json', 'usage-tentativas.json', 'falhas-sessao.json'];
const DIA_MS = TEMPOS.DIA_MS;

// As chaves em ordem, em qualquer profundidade: a comparação não depende da ordem em que cada
// caminho do código monta o objeto.
function ordenado(v) {
  if (Array.isArray(v)) return v.map(ordenado);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenado(v[k])]));
}

function diaAntes(dia, n) { return new Date(Date.parse(`${dia}T12:00:00Z`) - n * DIA_MS).toISOString().slice(0, 10); }

// As consultas da prova, derivadas dos próprios dados (as opções do relatório de 90 dias), para
// os dois modos fazerem a mesma lista quando os dados são iguais.
function consultasDoConsumo(opcoes, hoje) {
  const filtros = [{}, { kind: 'review' }, { kind: 'pushback' }];
  for (const model of (opcoes.model || []).slice(0, 3)) filtros.push({ model }, { kind: 'review', model });
  for (const repo of (opcoes.repo || []).slice(0, 3)) filtros.push({ repo });
  for (const account of (opcoes.account || []).slice(0, 2)) filtros.push({ account });
  filtros.push({ focus: 'review' }, { focus: 'pr' }, { search: 'review' }, { search: '#1' });
  const consultas = [''];
  for (const dias of [7, 30, 90]) {
    for (const filtro of filtros) {
      for (const page of [0, 1, 2, 5]) consultas.push(new URLSearchParams({ start: diaAntes(hoje, dias - 1), end: hoje, ...filtro, page: String(page) }).toString());
    }
  }
  return consultas;
}

async function retratoDoConsumo(engine, { usageActivity, usageSummary, snapshotUsage }, hoje) {
  const base = await usageActivity(engine, new URLSearchParams({ start: diaAntes(hoje, 89), end: hoje }));
  const consultas = consultasDoConsumo(base.options || {}, hoje);
  const rota = {};
  for (const q of consultas) rota[q] = await usageActivity(engine, new URLSearchParams(q));
  return { consultas: consultas.length, rota, snapshot: snapshotUsage(usageSummary(engine)) };
}

// contagem e somas do diário em memória, a mesma definição da conferência da migração
function somasDoDiario(linhas) {
  const r = { sessoes: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 };
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  for (const s of linhas) {
    if (!s || typeof s !== 'object') continue;
    r.sessoes++;
    for (const k of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'costUsd']) r[k] += num(s[k]);
  }
  return r;
}

function mediana(xs) { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }

async function medir(engine, usageActivity, n) {
  const tempos = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await usageActivity(engine, new URLSearchParams());
    tempos.push(performance.now() - t0);
  }
  return { n, medianaMs: +mediana(tempos).toFixed(2), minMs: +Math.min(...tempos).toFixed(2), maxMs: +Math.max(...tempos).toFixed(2) };
}

function homeTemporario() {
  const home = semAsVariaveis([]).FAROL_HOME;
  const real = path.join(os.homedir(), '.farol');
  if (!home || !fs.existsSync(home) || fs.readdirSync(home).length || path.resolve(home) === real) {
    throw new Error('FAROL_HOME tem de apontar para uma pasta temporária vazia, fora do ~/.farol.');
  }
  return home;
}

// O diário e o motor de cada modo. Os módulos do motor só carregam aqui, depois do FAROL_HOME.
async function montar(modo, estado, log) {
  const usageMod = await import('../lib/engine/usage.js');
  const engine = { config: { claudeProfiles: [] }, log, pushState() { /* sem tela */ } };
  if (modo === 'json') {
    const { readJson } = await import('../lib/io.js');
    engine.usage = { ...usageMod.defaultUsage(), ...readJson(path.join(estado, 'usage.json'), {}) };
    engine.usageSessions = { ...usageMod.defaultSessions(), ...readJson(path.join(estado, 'usage-sessions.json'), {}) };
    return { engine, usageMod, linhas: () => engine.usageSessions.sessions, fechar: () => { /* nada aberto */ } };
  }
  const motor = await import('../lib/engine/telemetria-do-motor.js');
  motor.carregarConsumo(engine, (m) => log('WARN', m));
  motor.iniciarConsumo(engine, (m) => log('WARN', m), { reconciliar: false });
  if (!engine.telemetria) throw new Error('o banco não abriu; veja as linhas de log acima');
  return { engine, usageMod, linhas: () => motor.sessoesDoDiario(engine), fechar: () => motor.fecharTelemetria(engine) };
}

async function principal(argv) {
  const { values } = parseArgs({ args: argv, options: { pasta: { type: 'string' }, modo: { type: 'string' }, saida: { type: 'string' },
    hoje: { type: 'string' }, medir: { type: 'string' } } });
  if (!values.pasta || !['json', 'banco'].includes(values.modo) || !values.saida) {
    console.error('uso: FAROL_HOME=<pasta vazia> node tools/comparar-consumo-sqlite.js --pasta <dir> --modo json|banco --saida <arquivo> [--hoje AAAA-MM-DD] [--medir N]');
    return 2;
  }
  const estado = path.join(homeTemporario(), 'workspace', 'state');
  fs.mkdirSync(estado, { recursive: true });
  for (const nome of ARQUIVOS) {
    const origem = path.join(values.pasta, nome);
    if (fs.existsSync(origem)) fs.copyFileSync(origem, path.join(estado, nome));
  }
  const { safeStringify } = await import('../lib/io.js');
  const { usageActivity } = await import('../lib/engine/usage-activity.js');
  const { snapshotUsage } = await import('../lib/engine/snapshot-usage.js');
  const { activityDay } = await import('../lib/usage/activity.js');
  const hoje = values.hoje || activityDay(Date.now());
  const linhasDeLog = [];
  const t0 = performance.now();
  const m = await montar(values.modo, estado, (nivel, msg) => { linhasDeLog.push(`${nivel} ${msg}`); console.error(`${nivel} ${msg}`); });
  const cargaMs = +(performance.now() - t0).toFixed(1);
  let relato;
  try {
    const retrato = await retratoDoConsumo(m.engine, { usageActivity, usageSummary: m.usageMod.usageSummary, snapshotUsage }, hoje);
    const texto = safeStringify(ordenado(retrato));
    fs.writeFileSync(values.saida, texto + '\n');
    relato = {
      modo: values.modo, hoje, cargaMs, consultas: retrato.consultas, somas: somasDoDiario(m.linhas()),
      sha256: crypto.createHash('sha256').update(texto).digest('hex'), bytes: Buffer.byteLength(texto), log: linhasDeLog,
    };
    if (values.medir) relato.rota = await medir(m.engine, usageActivity, Number(values.medir) || 20);
  } finally { m.fechar(); }
  // depois de fechar: o WAL já voltou para o arquivo principal
  relato.tamanhos = Object.fromEntries(fs.readdirSync(estado).sort().map((n) => [n, fs.statSync(path.join(estado, n)).size]));
  console.log(safeStringify(relato));
  return 0;
}

export { ordenado, consultasDoConsumo, retratoDoConsumo, somasDoDiario };

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  principal(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { console.error(err); process.exitCode = 1; });
}
