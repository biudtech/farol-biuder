// O SSE registra o cliente nos mapas do servidor ANTES de terminar de montar o retrato dele.
// Se o erro vem depois do registro, a resposta já começou e a conexão é destruída; sem tirar a
// entrada dos mapas, o cliente morto ficava lá para sempre (o `close` do pedido ainda não tinha
// ouvinte), e cada empurrão de estado serializava o snapshot inteiro para ninguém.
// FAROL_HOME temporário ANTES do import do engine, e HOME junto (o boot escreve ~/.claude.json).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-sse-vazamento-'));
process.env.FAROL_HOME = HOME;
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');

let engine, server, porta;

before(async () => {
  engine = new Engine();
  engine.config.port = 0;
  await new Promise((resolve, reject) => {
    server = startServer(engine, (url, err) => (err ? reject(err) : resolve()));
  });
  porta = server.address().port;
});

after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(() => resolve()));
  fs.rmSync(HOME, { recursive: true, force: true });
});

// Abre o SSE e resolve quando a conexão fecha (ou no primeiro evento, se `ateEvento`).
function abrirSse({ ateEvento = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: '/api/events', method: 'GET' }, (res) => {
      let corpo = '';
      res.on('data', (c) => { corpo += c; if (ateEvento && corpo.includes('\n\n')) resolve({ req, corpo }); });
      res.on('close', () => resolve({ req, corpo }));
      res.on('error', () => resolve({ req, corpo }));
    });
    req.on('error', (erro) => (erro.code === 'ECONNRESET' ? resolve({ req, corpo: '' }) : reject(erro)));
    req.end();
  });
}

// Um estado que conta quantas vezes foi serializado INTEIRO. O servidor só serializa o estado
// inteiro para cliente registrado que ainda não tem retrato; sem cliente, ou com todos em dia,
// manda só a diferença, que não passa por aqui.
function estadoQueConta() {
  const estado = { marca: Math.random() };
  let inteiro = 0;
  Object.defineProperty(estado, 'toJSON', { enumerable: false, value: () => { inteiro++; return { marca: estado.marca }; } });
  return { estado, vezes: () => inteiro };
}

test('erro no SSE depois do registro do cliente não deixa entrada nos mapas do servidor', async () => {
  const original = engine.snapshot;
  // a primeira leitura (o envio do estado inicial) passa; a segunda, que monta o retrato do
  // cliente já registrado, lança
  let lancou = 0;
  engine.snapshot = () => {
    let leituras = 0;
    return { get campo() { if (++leituras >= 2) { lancou++; throw new Error('falha de propósito depois do registro'); } return 1; } };
  };
  try {
    await abrirSse();
    assert.equal(lancou, 1, 'o erro veio na segunda leitura, com o cliente já registrado');
  } finally {
    engine.snapshot = original;
  }
  const { estado, vezes } = estadoQueConta();
  engine.emit('state', estado);
  assert.equal(vezes(), 0, 'nenhum cliente morto ficou registrado esperando o snapshot inteiro');
});

test('controle: depois do erro o SSE segue funcionando, e cliente vivo e em dia recebe só a diferença', async () => {
  const vivo = await abrirSse({ ateEvento: true });
  try {
    assert.match(vivo.corpo, /^event: state\n/);
    const { estado, vezes } = estadoQueConta();
    engine.emit('state', estado);
    engine.emit('state', estado);
    assert.equal(vezes(), 0, 'cliente em dia recebe só a diferença');
  } finally {
    vivo.req.destroy();
  }
});
