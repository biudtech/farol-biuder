// O stream da UI contra uma Engine real: quem conecta recebe o snapshot inteiro UMA
// vez e, dali em diante, só o que mudou. É o par de ponta a ponta do teste puro em
// test/estado-delta.test.js, porque o ganho medido (84% do tráfego de /api/events)
// depende da fiação em lib/http-server.js, não só da função.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-sse-delta-'));
process.env.FAROL_HOME = HOME;

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');

let server, base, engine;

// Os limites próprios deste arquivo. Um stream SSE não termina sozinho: caso que falhava
// antes do `fechar()` deixava a conexão aberta, o `server.close()` esperava por ela para
// sempre e o processo do arquivo nunca saía (o `--test-timeout` do runner vale por caso,
// não para o processo que sobra depois deles). Agora todo stream aberto é fechado depois
// de cada caso, passe ou falhe, e o fim do arquivo derruba as conexões com prazo.
const LIMITE_DO_CASO_MS = 15000;
const LIMITE_DA_CONEXAO_MS = 5000;
const LIMITE_DO_FECHAMENTO_MS = 5000;
const abertos = new Set();

function fecharTodosOsStreams() {
  for (const req of abertos) req.destroy();
  abertos.clear();
}

before(async () => {
  engine = new Engine();
  engine.config.port = 0;
  await new Promise((resolve, reject) => {
    server = startServer(engine, (url, err) => (err ? reject(err) : resolve()));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => fecharTodosOsStreams());

after(async () => {
  try {
    fecharTodosOsStreams();
    if (!server) return;
    // derruba do lado do servidor o que o cliente ainda não soltou: o `close()` sozinho
    // espera cada conexão aberta terminar, e um SSE não termina
    server.closeAllConnections();
    let relogio;
    const fechou = new Promise((resolve) => server.close(() => resolve(true)));
    const estourou = new Promise((resolve) => { relogio = setTimeout(() => resolve(false), LIMITE_DO_FECHAMENTO_MS); });
    const ok = await Promise.race([fechou, estourou]);
    clearTimeout(relogio);
    if (!ok) {
      // falha com mensagem em vez de prender o processo: o que sobrou não segura a saída
      server.unref();
      const conexoes = await new Promise((resolve) => server.getConnections((e, n) => resolve(e ? '?' : n)));
      throw new Error(`o servidor do teste não fechou em ${LIMITE_DO_FECHAMENTO_MS} ms (${conexoes} conexões abertas)`);
    }
  } finally {
    try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// Abre o stream e devolve um coletor de eventos já separados por tipo. O stream fica
// registrado até ser fechado: o `afterEach` fecha o que o caso deixou aberto.
function abrirStream() {
  return new Promise((resolve, reject) => {
    const req = http.get(base + '/api/events', (res) => {
      clearTimeout(semResposta);
      const eventos = [];
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (pedaco) => {
        buffer += pedaco;
        let corte;
        while ((corte = buffer.indexOf('\n\n')) >= 0) {
          const bloco = buffer.slice(0, corte);
          buffer = buffer.slice(corte + 2);
          const tipo = /^event: (.+)$/m.exec(bloco);
          const dado = /^data: (.*)$/m.exec(bloco);
          if (tipo && dado && (tipo[1] === 'state' || tipo[1] === 'state-patch')) eventos.push({ tipo: tipo[1], dados: dado[1] });
        }
      });
      resolve({ eventos, headers: res.headers, fechar: () => { abertos.delete(req); req.destroy(); } });
    });
    abertos.add(req);
    const semResposta = setTimeout(() => {
      req.destroy();
      reject(new Error(`/api/events não respondeu em ${LIMITE_DA_CONEXAO_MS} ms`));
    }, LIMITE_DA_CONEXAO_MS);
    req.on('error', (err) => { clearTimeout(semResposta); reject(err); });
  });
}

// O write do estado é síncrono dentro do emit, mas o socket entrega no tique
// seguinte: esperar por condição em vez de dormir um tempo fixo.
async function ate(condicao, limiteMs = 3000) {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (condicao()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

test('abre com o snapshot inteiro e depois só manda o que mudou', { timeout: LIMITE_DO_CASO_MS }, async () => {
  const s = await abrirStream();
  assert.ok(await ate(() => s.eventos.length >= 1), 'o primeiro evento não chegou');
  assert.equal(s.eventos[0].tipo, 'state');
  const inicial = JSON.parse(s.eventos[0].dados);
  assert.ok(Object.keys(inicial).length > 10, 'o snapshot inicial deve vir inteiro');

  engine.status = 'checking';
  engine.pushState();
  assert.ok(await ate(() => s.eventos.length >= 2), 'o patch não chegou');
  const patch = s.eventos[1];
  assert.equal(patch.tipo, 'state-patch');
  const corpo = JSON.parse(patch.dados);
  // só o que mudou, e a hora do motor junto quando ela andou desde o retrato inicial
  assert.deepEqual(Object.keys(corpo.campos).filter((k) => k !== 'agora'), ['status']);
  assert.equal(corpo.campos.status, 'checking');
  // o patch é ordens de grandeza menor que o snapshot: é o motivo desta mudança
  assert.ok(patch.dados.length < s.eventos[0].dados.length / 10,
    `patch de ${patch.dados.length} bytes contra snapshot de ${s.eventos[0].dados.length}`);
  s.fechar();
});

test('empurrão que não muda nada não vira evento nenhum', { timeout: LIMITE_DO_CASO_MS }, async () => {
  const s = await abrirStream();
  assert.ok(await ate(() => s.eventos.length >= 1));
  engine.pushState();
  engine.pushState();
  // espera ATIVA por um evento que não deve existir: se aparecer, o teste falha
  await ate(() => s.eventos.length >= 2, 300);
  assert.equal(s.eventos.length, 1, 'estado igual não pode gerar tráfego, nem com a hora do motor andando');
  s.fechar();
});

test('mesclar os patches no snapshot inicial reproduz o estado do engine', { timeout: LIMITE_DO_CASO_MS }, async () => {
  const s = await abrirStream();
  assert.ok(await ate(() => s.eventos.length >= 1));
  let estado = JSON.parse(s.eventos[0].dados);

  engine.status = 'idle';
  engine.pushState();
  assert.ok(await ate(() => s.eventos.length >= 2));
  engine.status = 'checking';
  engine.pushState();
  assert.ok(await ate(() => s.eventos.length >= 3));

  for (const e of s.eventos.slice(1)) {
    const corpo = JSON.parse(e.dados);
    estado = { ...estado, ...corpo.campos };
    for (const k of corpo.removidos || []) delete estado[k];
  }
  // a hora do motor muda a cada retrato: vai junto de cada mudança, e o resto bate
  const { agora, ...semCarimbo } = estado;
  const { agora: agoraDoEngine, ...doEngine } = JSON.parse(JSON.stringify(engine.snapshot()));
  assert.ok(Number.isSafeInteger(agora) && agora <= agoraDoEngine, String(agora));
  assert.ok(s.eventos.slice(1).every((e) => Number.isSafeInteger(JSON.parse(e.dados).campos.agora)), 'cada patch leva a hora do motor');
  assert.deepEqual(semCarimbo, doEngine);
  s.fechar();
});

// Quem conecta depois não pode receber a diferença contra o retrato de OUTRO cliente:
// ele nunca viu aquele estado, e mesclar sobre o que não tem daria tela divergente.
test('cliente novo recebe o snapshot inteiro, não o patch do vizinho', { timeout: LIMITE_DO_CASO_MS }, async () => {
  const antigo = await abrirStream();
  assert.ok(await ate(() => antigo.eventos.length >= 1));
  engine.status = 'idle';
  engine.pushState();
  assert.ok(await ate(() => antigo.eventos.length >= 2));

  const novo = await abrirStream();
  assert.ok(await ate(() => novo.eventos.length >= 1));
  assert.equal(novo.eventos[0].tipo, 'state');

  engine.status = 'checking';
  engine.pushState();
  assert.ok(await ate(() => novo.eventos.length >= 2));
  assert.equal(novo.eventos[1].tipo, 'state-patch');
  antigo.fechar(); novo.fechar();
});

test('o stream pede para não ser bufferizado por intermediário', { timeout: LIMITE_DO_CASO_MS }, async () => {
  const s = await abrirStream();
  assert.equal(s.headers['x-accel-buffering'], 'no');
  s.fechar();
});
