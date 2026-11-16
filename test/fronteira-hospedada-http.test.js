// Fronteira HTTP do motor hospedado (fase 2a, spec 6.2) no servidor REAL: host público na
// allowlist, origens permitidas com CORS, preflight antes do porteiro, autenticação sempre
// exigida no modo hospedado e a rota de saúde. O modo hospedado é ligado aqui mexendo em
// engine.config (o boot com o arquivo é coberto em test/fronteira-hospedada-config.test.js).
// FAROL_HOME temporário antes de qualquer import, e HOME junto: o boot da Engine escreve
// ~/.claude.json, e teste nenhum pode mexer no arquivo real.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-fronteira-http-'));
process.env.FAROL_HOME = HOME;
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const { emitirSessao } = await import('../lib/local-auth/sessoes.js');
const { PUBLICAS, todasAsRotas } = await import('../lib/local-auth/inventario.js');

const RAIZ = path.join(import.meta.dirname, '..');
const HOST = 'farol.exemplo.com';
const ORIGEM = 'https://painel.exemplo.com';
const HEADERS_CORS = 'Authorization, Content-Type, x-farol';
const METODOS_CORS = 'GET, POST';
let engine, server, porta, token;

before(async () => {
  engine = new Engine();
  engine.config.port = 0;
  await new Promise((resolve, reject) => {
    server = startServer(engine, (url, err) => (err ? reject(err) : resolve()));
  });
  porta = server.address().port;
  token = emitirSessao('fronteira');
});

after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(() => resolve()));
  fs.rmSync(HOME, { recursive: true, force: true });
});

const local = () => `127.0.0.1:${porta}`;
const bearer = () => ({ Authorization: `Bearer ${token}` });

// Liga o modo hospedado só durante o teste. Sem argumento: host público e uma origem.
async function hospedado(fn, chaves = { hostPublico: HOST, origensPermitidas: [ORIGEM] }) {
  const anterior = { hostPublico: engine.config.hostPublico, origensPermitidas: engine.config.origensPermitidas, localAuth: engine.config.localAuth };
  Object.assign(engine.config, { hostPublico: '', origensPermitidas: [] }, chaves);
  try { return await fn(); } finally { Object.assign(engine.config, anterior); }
}

// Pedido com os cabeçalhos que o teste escolher (o http.request mantém o Host passado).
// O SSE não termina: resolve no primeiro evento completo e derruba a conexão.
function pedir(metodo, rota, { headers = {}, corpo } = {}) {
  return new Promise((resolve, reject) => {
    const data = corpo === undefined ? '' : JSON.stringify(corpo);
    const todos = { host: local(), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers };
    const req = http.request({ host: '127.0.0.1', port: porta, path: rota, method: metodo, headers: todos }, res => {
      let d = '';
      const fim = () => resolve({ status: res.statusCode, headers: res.headers, cru: res.rawHeaders, body: d });
      const sse = String(res.headers['content-type'] || '').startsWith('text/event-stream');
      res.on('data', c => { d += c; if (sse && d.includes('\n\n')) { req.destroy(); fim(); } });
      res.on('end', fim);
    });
    req.on('error', err => { if (err.code !== 'ECONNRESET') reject(err); });
    req.end(data);
  });
}

// Pedido escrito byte a byte, para o que o http.request se recusa a mandar: cabeçalho
// repetido, alvo malformado, caractere de controle. Devolve a resposta inteira como texto.
function cru(texto) {
  return new Promise((resolve, reject) => {
    const s = net.connect(porta, '127.0.0.1');
    let d = '';
    s.setEncoding('latin1');
    s.on('connect', () => s.write(texto));
    s.on('data', c => (d += c));
    s.on('close', () => {
      const corte = d.indexOf('\r\n\r\n');
      const cabeca = corte < 0 ? d : d.slice(0, corte);
      const linhas = cabeca.split('\r\n');
      const resto = corte < 0 ? '' : d.slice(corte + 4);
      const body = /^transfer-encoding: *chunked\s*$/im.test(cabeca) ? semPedacos(resto) : resto;
      resolve({ status: Number((linhas[0] || '').split(' ')[1]) || 0, linhas: linhas.slice(1), cabeca, body, vazio: d === '' });
    });
    s.on('error', err => { if (err.code !== 'ECONNRESET') reject(err); });
    setTimeout(() => s.destroy(), 3000).unref();
  });
}

// Corpo em pedaços (Transfer-Encoding: chunked) de volta ao texto: o tamanho em hexa, o
// pedaço, e assim até o tamanho zero.
function semPedacos(texto) {
  let resto = texto;
  let corpo = '';
  for (;;) {
    const fim = resto.indexOf('\r\n');
    const tamanho = fim < 0 ? 0 : Number.parseInt(resto.slice(0, fim), 16);
    if (!tamanho) return corpo;
    corpo += resto.slice(fim + 2, fim + 2 + tamanho);
    resto = resto.slice(fim + 2 + tamanho + 2);
  }
}

function pedidoCru(linha, cabecalhos) {
  return cru([linha, ...cabecalhos, 'Connection: close', '', ''].join('\r\n'));
}

const corsDe = r => Object.keys(r.headers).filter(h => h.startsWith('access-control-')).sort();

function assertSemCors(r, onde) {
  assert.deepEqual(corsDe(r), [], `${onde}: nenhum cabeçalho CORS`);
}

// Os quatro cabeçalhos, a origem EXATA, e nunca `*` nem Allow-Credentials. `cru` confere que
// cada um sai uma vez só (cabeçalho repetido o navegador rejeita).
function assertCors(r, onde, origem = ORIGEM) {
  assert.equal(r.headers['access-control-allow-origin'], origem, `${onde}: Allow-Origin é a origem exata`);
  assert.equal(r.headers['access-control-allow-headers'], HEADERS_CORS, `${onde}: Allow-Headers`);
  assert.equal(r.headers['access-control-allow-methods'], METODOS_CORS, `${onde}: Allow-Methods`);
  assert.match(String(r.headers.vary), /(^|,\s*)Origin(\s*,|$)/, `${onde}: Vary: Origin`);
  assert.equal('access-control-allow-credentials' in r.headers, false, `${onde}: sem Allow-Credentials`);
  const nomes = r.cru.filter((_, i) => i % 2 === 0).map(n => n.toLowerCase());
  assert.equal(nomes.filter(n => n === 'access-control-allow-origin').length, 1, `${onde}: Allow-Origin sai uma vez`);
  assert.doesNotMatch(r.cru.join('\n'), /^\*$/m, `${onde}: nunca o curinga`);
}

async function espiar(nomes, fn) {
  const chamadas = [];
  const originais = new Map();
  for (const nome of nomes) {
    originais.set(nome, engine[nome]);
    engine[nome] = () => { chamadas.push(nome); return { ok: true }; };
  }
  try { return await fn(chamadas); } finally { for (const [nome, f] of originais) engine[nome] = f; }
}

// Todo método do engine que alguma rota chama, derivado do fonte do servidor.
const METODOS_DO_ENGINE = [...new Set([...fs.readFileSync(path.join(RAIZ, 'lib', 'http-server.js'), 'utf8')
  .matchAll(/engine\.(\w+)\(/g)].map(m => m[1]))].filter(n => n !== 'on' && n !== 'log');

/* ---------- host público ---------- */

test('host público sem porta é aceito, e o loopback continua valendo ao lado dele', async () => {
  await hospedado(async () => {
    assert.equal((await pedir('GET', '/api/auth/status', { headers: { host: HOST } })).status, 200);
    assert.equal((await pedir('GET', '/api/auth/status', { headers: { host: local() } })).status, 200);
    assert.equal((await pedir('GET', '/api/state', { headers: { host: HOST, ...bearer() } })).status, 200);
  });
});

test('host público com porta, host parecido e host de rebinding recebem 403 de host', async () => {
  await hospedado(async () => {
    const recusados = [`${HOST}:443`, `${HOST}:${porta}`, `${HOST}:80`, `${HOST}.atacante.net`, `x${HOST}`, `sub.${HOST}`, 'FAROL.EXEMPLO.COM',
      `${HOST}.`, `rebinding.evil.example:${porta}`, '127.0.0.1', 'localhost', `127.0.0.1:${porta + 1 > 65535 ? porta - 1 : porta + 1}`];
    for (const host of recusados) {
      const r = await pedir('GET', '/api/state', { headers: { host, ...bearer() } });
      assert.equal(r.status, 403, host);
      assert.deepEqual(JSON.parse(r.body), { error: 'forbidden', motivo: 'host' }, host);
      assertSemCors(r, host);
    }
  });
});

test('sem hostPublico o nome de fora continua recusado', async () => {
  const r = await pedir('GET', '/api/state', { headers: { host: HOST } });
  assert.equal(r.status, 403);
  assert.deepEqual(JSON.parse(r.body), { error: 'forbidden', motivo: 'host' });
});

test('a tela antiga continua servida em loopback, com e sem o modo hospedado', async () => {
  const fora = await pedir('GET', '/');
  assert.equal(fora.status, 200);
  assert.match(String(fora.headers['content-type']), /text\/html/);
  assertSemCors(fora, 'página em loopback');
  await hospedado(async () => {
    const dentro = await pedir('GET', '/');
    assert.equal(dentro.status, 200);
    assert.equal(dentro.body, fora.body);
    assert.equal((await pedir('GET', '/pure/comum.js')).status, 200);
  });
});

/* ---------- origem e CORS ---------- */

test('cabeçalhos CORS saem em 200, 401, 403 do x-farol, 404, 405, 500 e no SSE', async () => {
  await hospedado(async () => {
    const h = { host: HOST, origin: ORIGEM };
    const ok = await pedir('GET', '/api/state', { headers: { ...h, ...bearer() } });
    assert.equal(ok.status, 200);
    assertCors(ok, '200');

    const semBearer = await pedir('GET', '/api/state', { headers: h });
    assert.equal(semBearer.status, 401);
    assert.deepEqual(JSON.parse(semBearer.body), { error: 'nao_autenticado' });
    assertCors(semBearer, '401');

    const semXFarol = await espiar(['checkNow'], async (chamadas) => {
      const r = await pedir('POST', '/api/check', { headers: { ...h, ...bearer() }, corpo: {} });
      assert.deepEqual(chamadas, [], 'sem x-farol a ação não roda');
      return r;
    });
    assert.equal(semXFarol.status, 403);
    assert.deepEqual(JSON.parse(semXFarol.body), { error: 'forbidden' });
    assertCors(semXFarol, '403 do x-farol');

    const naoExiste = await pedir('POST', '/api/rota-que-nao-existe', { headers: { ...h, ...bearer(), 'x-farol': '1' }, corpo: {} });
    assert.equal(naoExiste.status, 404);
    assertCors(naoExiste, '404');

    const metodo = await pedir('GET', '/api/check', { headers: { ...h, ...bearer() } });
    assert.equal(metodo.status, 405);
    assertCors(metodo, '405');

    const original = engine.snapshot;
    engine.snapshot = () => { throw new Error('falha de propósito'); };
    try {
      const erro = await pedir('GET', '/api/state', { headers: { ...h, ...bearer() } });
      assert.equal(erro.status, 500);
      assertCors(erro, '500');
    } finally { engine.snapshot = original; }

    const sse = await pedir('GET', '/api/events', { headers: { ...h, ...bearer() } });
    assert.equal(sse.status, 200);
    assert.match(String(sse.headers['content-type']), /text\/event-stream/);
    assert.match(sse.body, /^event: state\n/);
    assertCors(sse, 'SSE');
  });
});

test('o CORS também vale pelo Host do loopback (front em desenvolvimento contra o motor local)', async () => {
  await hospedado(async () => {
    const r = await pedir('GET', '/api/state', { headers: { origin: 'http://localhost:3000', ...bearer() } });
    assert.equal(r.status, 200);
    assertCors(r, 'loopback', 'http://localhost:3000');
  }, { origensPermitidas: ['http://localhost:3000'] });
});

test('com duas origens na lista, cada resposta leva só a origem de quem pediu', async () => {
  await hospedado(async () => {
    for (const origem of [ORIGEM, 'https://outro.exemplo.com']) {
      const r = await pedir('GET', '/api/auth/status', { headers: { host: HOST, origin: origem } });
      assert.equal(r.status, 200);
      assertCors(r, origem, origem);
    }
  }, { hostPublico: HOST, origensPermitidas: [ORIGEM, 'https://outro.exemplo.com'] });
});

test('sem Origin não sai cabeçalho CORS, nem no modo hospedado', async () => {
  await hospedado(async () => {
    for (const host of [HOST, local()]) {
      const r = await pedir('GET', '/api/state', { headers: { host, ...bearer() } });
      assert.equal(r.status, 200);
      assertSemCors(r, host);
      assert.equal(r.headers.vary, undefined);
    }
    assertSemCors(await pedir('GET', '/api/state', { headers: { host: HOST } }), '401 sem Origin');
  });
});

test('Origin do loopback continua como antes: aceito e sem cabeçalho CORS', async () => {
  for (const ligar of [false, true]) {
    await hospedado(async () => {
      const r = await pedir('GET', '/api/auth/status', { headers: { origin: `http://127.0.0.1:${porta}` } });
      assert.equal(r.status, 200);
      assertSemCors(r, `loopback, hospedado=${ligar}`);
    }, ligar ? undefined : {});
  }
});

test('origem não permitida recebe 403 de origin, sem cabeçalho CORS e sem executar nada', async () => {
  await hospedado(() => espiar(['snapshot', 'checkNow'], async (chamadas) => {
    const recusadas = ['http://painel.exemplo.com', 'https://painel.exemplo.com:8443', 'https://painel.exemplo.com:443', 'https://painel.exemplo.com/',
      'https://sub.painel.exemplo.com', 'https://painel.exemplo.com.atacante.net', 'https://PAINEL.exemplo.com', 'null', 'https://atacante.net',
      `https://${HOST}`, `http://${HOST}`, 'http://localhost:3000'];
    for (const origin of recusadas) {
      const r = await pedir('GET', '/api/state', { headers: { host: HOST, origin, ...bearer() } });
      assert.equal(r.status, 403, origin);
      assert.deepEqual(JSON.parse(r.body), { error: 'forbidden', motivo: 'origin' }, origin);
      assertSemCors(r, origin);
      assert.equal(r.headers.vary, undefined, origin);
    }
    const post = await pedir('POST', '/api/check', { headers: { host: HOST, origin: 'https://atacante.net', 'x-farol': '1', ...bearer() }, corpo: {} });
    assert.equal(post.status, 403);
    assert.deepEqual(chamadas, []);
  }));
});

test('sem origensPermitidas a origem de fora continua recusada, como antes', async () => {
  const r = await pedir('GET', '/api/state', { headers: { origin: ORIGEM } });
  assert.equal(r.status, 403);
  assert.deepEqual(JSON.parse(r.body), { error: 'forbidden', motivo: 'origin' });
  assertSemCors(r, 'sem lista');
});

test('origem permitida com Host não permitido: 403 de host, sem cabeçalho CORS', async () => {
  await hospedado(async () => {
    for (const metodo of ['GET', 'OPTIONS']) {
      const r = await pedir(metodo, '/api/state', { headers: { host: 'atacante.net', origin: ORIGEM, ...bearer() } });
      assert.equal(r.status, 403, metodo);
      assert.deepEqual(JSON.parse(r.body), { error: 'forbidden', motivo: 'host' });
      assertSemCors(r, metodo);
    }
  });
});

/* ---------- preflight ---------- */

test('preflight de origem permitida: 204 sem autenticação, com os cabeçalhos, sem executar a rota', async () => {
  await hospedado(() => espiar(METODOS_DO_ENGINE, async (chamadas) => {
    for (const [rota, metodo] of [['/api/state', 'GET'], ['/api/events', 'GET'], ['/api/check', 'POST'], ['/api/decide', 'POST'], ['/api/review', 'POST'], ['/api/rota-que-nao-existe', 'POST']]) {
      const r = await pedir('OPTIONS', rota, { headers: { host: HOST, origin: ORIGEM, 'Access-Control-Request-Method': metodo, 'Access-Control-Request-Headers': 'authorization,content-type,x-farol' } });
      assert.equal(r.status, 204, rota);
      assert.equal(r.body, '', rota);
      assertCors(r, `preflight ${rota}`);
      assert.match(String(r.headers['access-control-max-age']), /^\d+$/, 'o preflight diz por quanto tempo vale');
    }
    assert.deepEqual(chamadas, [], 'um OPTIONS não chega ao engine');
  }));
});

// O x-farol é exigido em todo POST. O preflight o anuncia em Allow-Headers, então o fetch
// do front consegue mandá-lo; e com ele, o Bearer e a origem certa, o POST de verdade passa.
test('o preflight anuncia x-farol e Authorization, e o POST que vem depois dele passa', async () => {
  await hospedado(() => espiar(['checkNow'], async (chamadas) => {
    const pre = await pedir('OPTIONS', '/api/check', { headers: { host: HOST, origin: ORIGEM, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,x-farol' } });
    const anunciados = pre.headers['access-control-allow-headers'].split(',').map(s => s.trim().toLowerCase());
    for (const pedido of ['authorization', 'content-type', 'x-farol']) assert.ok(anunciados.includes(pedido), pedido);
    assert.ok(pre.headers['access-control-allow-methods'].split(',').map(s => s.trim()).includes('POST'));
    assert.deepEqual(chamadas, []);
    const post = await pedir('POST', '/api/check', { headers: { host: HOST, origin: ORIGEM, 'x-farol': '1', ...bearer() }, corpo: {} });
    assert.equal(post.status, 200);
    assertCors(post, 'POST depois do preflight');
    assert.deepEqual(chamadas, ['checkNow']);
  }));
});

test('preflight de origem não permitida é recusado como qualquer origem, sem cabeçalho CORS', async () => {
  await hospedado(async () => {
    for (const origin of ['https://atacante.net', 'null', 'https://painel.exemplo.com/']) {
      const r = await pedir('OPTIONS', '/api/state', { headers: { host: HOST, origin, 'Access-Control-Request-Method': 'GET' } });
      assert.equal(r.status, 403, origin);
      assert.deepEqual(JSON.parse(r.body), { error: 'forbidden', motivo: 'origin' });
      assertSemCors(r, origin);
      assert.equal(r.headers['access-control-max-age'], undefined);
    }
  });
});

test('preflight que pede método ou cabeçalho fora da lista recebe a lista fixa, nunca o que pediu', async () => {
  await hospedado(async () => {
    const r = await pedir('OPTIONS', '/api/state', { headers: { host: HOST, origin: ORIGEM, 'Access-Control-Request-Method': 'DELETE', 'Access-Control-Request-Headers': 'x-evil, cookie, x-farol' } });
    assert.equal(r.status, 204);
    assert.equal(r.headers['access-control-allow-methods'], METODOS_CORS);
    assert.equal(r.headers['access-control-allow-headers'], HEADERS_CORS);
    assert.doesNotMatch(r.cru.join('\n'), /DELETE|x-evil|cookie/i);
  });
});

test('OPTIONS sem Origin, ou com Origin do loopback, não executa a rota e não ganha CORS', async () => {
  for (const ligar of [false, true]) {
    await hospedado(() => espiar(METODOS_DO_ENGINE, async (chamadas) => {
      for (const headers of [{}, { origin: `http://127.0.0.1:${porta}` }]) {
        const r = await pedir('OPTIONS', '/api/state', { headers });
        assert.equal(r.status, 204);
        assert.equal(r.body, '');
        assertSemCors(r, 'OPTIONS local');
      }
      assert.deepEqual(chamadas, [], 'OPTIONS não monta o snapshot');
    }), ligar ? undefined : {});
  }
});

/* ---------- autenticação no modo hospedado ---------- */

const MODOS_HOSPEDADOS = [
  ['só hostPublico', { hostPublico: HOST }],
  ['só origensPermitidas', { origensPermitidas: [ORIGEM] }],
  ['os dois', { hostPublico: HOST, origensPermitidas: [ORIGEM] }],
];
const LOCAL_AUTH_QUE_NAO_DESLIGA = [undefined, '', 'desligar', 'nunca', false, 0, null];

for (const [nome, chaves] of MODOS_HOSPEDADOS) {
  test(`modo hospedado (${nome}): toda rota não pública do inventário responde 401 sem Bearer, com qualquer localAuth`, async () => {
    const naoPublicas = todasAsRotas().filter(r => !Object.hasOwn(PUBLICAS, r));
    assert.ok(naoPublicas.length >= 28, 'o inventário não pode ter encolhido sem este teste saber');
    const hosts = chaves.hostPublico ? [HOST, local()] : [local()];
    for (const localAuth of LOCAL_AUTH_QUE_NAO_DESLIGA) {
      await hospedado(() => espiar(METODOS_DO_ENGINE, async (chamadas) => {
        for (const rota of naoPublicas) {
          for (const metodo of ['GET', 'POST']) {
            for (const host of hosts) {
              const r = await pedir(metodo, rota, { headers: { host, 'x-farol': '1' }, corpo: metodo === 'POST' ? { urls: ['https://github.com/acme/app/pull/1'], id: 'x', key: 'acme/app#1' } : undefined });
              assert.equal(r.status, 401, `${metodo} ${rota} via ${host}, localAuth ${JSON.stringify(localAuth)}`);
              assert.deepEqual(JSON.parse(r.body), { error: 'nao_autenticado' });
              assert.match(String(r.headers['content-type']), /application\/json/, `${rota} não abre stream`);
            }
          }
        }
        assert.deepEqual(chamadas, [], 'nada chega ao engine sem credencial');
      }), { ...chaves, localAuth });
    }
  });
}

test('modo hospedado: token inválido também recebe 401, e o válido passa', async () => {
  await hospedado(async () => {
    for (const Authorization of ['Bearer ' + 'a'.repeat(43), 'Bearer x', `Basic ${token}`, token, '']) {
      assert.equal((await pedir('GET', '/api/state', { headers: { host: HOST, Authorization } })).status, 401, Authorization);
    }
    assert.equal((await pedir('GET', '/api/state', { headers: { host: HOST, ...bearer() } })).status, 200);
  });
});

test('modo hospedado: as públicas continuam públicas só no método delas, e o status diz que exige', async () => {
  for (const [, chaves] of MODOS_HOSPEDADOS) {
    await hospedado(async () => {
      const status = await pedir('GET', '/api/auth/status');
      assert.equal(status.status, 200);
      assert.deepEqual(JSON.parse(status.body), { exigida: true, autenticado: false });
      const par = await pedir('POST', '/api/auth/pair', { headers: { 'x-farol': '1' }, corpo: { codigo: 'errado' } });
      assert.equal(par.status, 200);
      assert.equal(JSON.parse(par.body).ok, false);
      assert.equal((await pedir('GET', '/api/auth/pair')).status, 401, 'fora do método, exige');
      assert.equal((await pedir('POST', '/api/auth/status', { headers: { 'x-farol': '1' }, corpo: {} })).status, 401);
      assert.equal((await pedir('POST', '/api/health', { headers: { 'x-farol': '1' }, corpo: {} })).status, 401);
    }, chaves);
  }
});

test('em loopback puro nada muda: a API responde sem Bearer e o status diz que não exige', async () => {
  assert.equal(engine.config.hostPublico, '');
  assert.deepEqual(engine.config.origensPermitidas, []);
  assert.equal((await pedir('GET', '/api/state')).status, 200);
  assert.deepEqual(JSON.parse((await pedir('GET', '/api/auth/status')).body), { exigida: false, autenticado: false });
});

/* ---------- saúde ---------- */

const SAUDE = '{"ok":true}';

test('saúde: 200 sem autenticação, sem x-farol e com Host fora da allowlist (o probe chega pelo IP do pod)', async () => {
  for (const ligar of [false, true]) {
    await hospedado(async () => {
      for (const host of [`10.0.31.7:${porta}`, '10.0.31.7', local(), HOST, 'atacante.net', '']) {
        const r = await pedir('GET', '/api/health', { headers: { host } });
        assert.equal(r.status, 200, `host ${JSON.stringify(host)}, hospedado=${ligar}`);
        assert.equal(r.body, SAUDE);
        assert.match(String(r.headers['content-type']), /application\/json/);
        assert.equal(r.headers['cache-control'], 'no-store');
        assertSemCors(r, 'saúde');
      }
      assert.equal((await pedir('GET', '/api/health?x=1', { headers: { host: '10.0.31.7' } })).body, SAUDE);
    }, ligar ? undefined : {});
  }
});

test('saúde: o corpo é fixo e não leva nada do motor, mesmo com segredo e login plantados', async () => {
  const plantados = ['ghp_tokenPlantado123', 'sk-ant-chavePlantada456', 'login-plantado', 'segredo-do-jira-789'];
  const anterior = { conta: engine.config.conta, claudeProfiles: engine.config.claudeProfiles, jiraSites: engine.config.jiraSites };
  engine.config.conta = { user: 'login-plantado', owners: ['org-login-plantado'] };
  engine.config.claudeProfiles = [{ id: 'p1', kind: 'apikey', label: 'login-plantado', apiKey: 'sk-ant-chavePlantada456' }];
  engine.config.jiraSites = [{ id: 's1', baseUrl: 'https://segredo-do-jira-789.atlassian.net' }];
  try {
    const r = await pedir('GET', '/api/health', { headers: { host: '10.0.31.7', Authorization: 'Bearer ghp_tokenPlantado123', cookie: 'x=ghp_tokenPlantado123' } });
    assert.equal(r.status, 200);
    assert.equal(r.body, SAUDE);
    const tudo = r.cru.join('\n') + r.body;
    for (const p of plantados) assert.equal(tudo.includes(p), false, p);
    assert.deepEqual(Object.keys(r.headers).filter(h => !['content-type', 'cache-control', 'date', 'connection', 'keep-alive', 'transfer-encoding', 'content-length'].includes(h)), []);
    assert.doesNotMatch(r.body, /vers|path|home|fila|queue|\d\.\d/i);
  } finally { Object.assign(engine.config, anterior); }
});

test('saúde: não chama o engine', async () => {
  await espiar(METODOS_DO_ENGINE, async (chamadas) => {
    await pedir('GET', '/api/health', { headers: { host: '10.0.31.7' } });
    assert.deepEqual(chamadas, []);
  });
});

test('saúde: só GET no caminho exato; o resto cai nas defesas de sempre', async () => {
  // Host fora da allowlist: só o GET exato escapa dela
  for (const [metodo, rota] of [['POST', '/api/health'], ['HEAD', '/api/health'], ['OPTIONS', '/api/health'], ['PUT', '/api/health'], ['GET', '/api/health/'], ['GET', '/api/healthz'], ['GET', '/api/health/x'], ['GET', '/API/health'], ['GET', '/api/health%2f'], ['GET', '/health']]) {
    const r = await pedir(metodo, rota, { headers: { host: '10.0.31.7', 'x-farol': '1' } });
    assert.equal(r.status, 403, `${metodo} ${rota}`);
    assert.notEqual(r.body, SAUDE);
  }
  // em loopback: POST sem x-farol é 403, com x-farol não existe; caminho com barra não é a saúde
  assert.equal((await pedir('POST', '/api/health', { corpo: {} })).status, 403);
  assert.equal((await pedir('POST', '/api/health', { headers: { 'x-farol': '1' }, corpo: {} })).status, 404);
  const comBarra = await pedir('GET', '/api/health/');
  assert.notEqual(comBarra.status, 200);
  assert.notEqual(comBarra.body, SAUDE);
  await hospedado(async () => {
    assert.equal((await pedir('GET', '/api/health/', { headers: { host: HOST } })).status, 401, 'no modo hospedado o caminho vizinho exige credencial');
  });
});

/* ---------- pensando como quem ataca: pedidos escritos byte a byte ---------- */

const linhaDoGet = 'GET /api/auth/status HTTP/1.1';

test('ataque: dois cabeçalhos Origin (o permitido e o do atacante) não passam nem ganham CORS', async () => {
  await hospedado(async () => {
    for (const par of [[ORIGEM, 'https://atacante.net'], ['https://atacante.net', ORIGEM], [ORIGEM, ORIGEM]]) {
      const r = await pedidoCru(linhaDoGet, [`Host: ${HOST}`, `Origin: ${par[0]}`, `Origin: ${par[1]}`]);
      assert.equal(r.status, 403, par.join(' + '));
      assert.match(r.body, /"motivo":"origin"/);
      assert.doesNotMatch(r.cabeca, /access-control-/i);
    }
  });
});

test('ataque: Origin com vírgula ou com espaço no meio não casa e nada é refletido', async () => {
  await hospedado(async () => {
    for (const origin of [`${ORIGEM}, https://atacante.net`, `${ORIGEM},https://atacante.net`, `${ORIGEM} https://atacante.net`, `${ORIGEM}\thttps://atacante.net`, `${ORIGEM}/`, `${ORIGEM}#`]) {
      const r = await pedidoCru(linhaDoGet, [`Host: ${HOST}`, `Origin: ${origin}`]);
      assert.equal(r.status, 403, JSON.stringify(origin));
      assert.doesNotMatch(r.cabeca, /access-control-|atacante/i);
    }
  });
});

// Espaço em volta do valor não é parte dele (o parser HTTP tira antes de entregar). Passa, e
// o que volta é o item da lista, byte a byte, sem o espaço.
test('ataque: Origin com espaço em volta volta refletido exatamente como está na lista', async () => {
  await hospedado(async () => {
    const r = await pedidoCru(linhaDoGet, [`Host: ${HOST}`, `Origin:   ${ORIGEM}  `]);
    assert.equal(r.status, 200);
    const acao = r.linhas.filter(l => /^access-control-allow-origin:/i.test(l));
    assert.deepEqual(acao, [`Access-Control-Allow-Origin: ${ORIGEM}`]);
  });
});

// Quebra de linha dentro do valor: ou o parser recusa o pedido, ou trata o resto como outro
// cabeçalho do PEDIDO. Nos dois casos nada do que o atacante escreveu vira cabeçalho da resposta.
test('ataque: quebra de linha no Origin não injeta cabeçalho na resposta', async () => {
  await hospedado(async () => {
    for (const quebra of ['\r\n', '\n', '\r', '\r\n ', '\0']) {
      const r = await pedidoCru(linhaDoGet, [`Host: ${HOST}`, `Origin: ${ORIGEM}${quebra}Set-Cookie: roubado=1`]);
      assert.doesNotMatch(r.cabeca, /set-cookie|roubado/i, JSON.stringify(quebra));
      const acao = r.linhas.filter(l => /^access-control-allow-origin:/i.test(l));
      assert.ok(acao.length === 0 || (acao.length === 1 && acao[0] === `Access-Control-Allow-Origin: ${ORIGEM}`), JSON.stringify(acao));
    }
    assert.equal((await pedir('GET', '/api/auth/status', { headers: { host: HOST } })).status, 200, 'o servidor segue de pé');
  });
});

test('ataque: Host com userinfo ou com @ é recusado', async () => {
  await hospedado(async () => {
    for (const host of [`usuario@${HOST}`, `usuario:senha@${HOST}`, `${HOST}@atacante.net`, `atacante.net@${HOST}`, `127.0.0.1:${porta}@atacante.net`, `atacante.net@127.0.0.1:${porta}`]) {
      const r = await pedidoCru('GET /api/state HTTP/1.1', [`Host: ${host}`, `Authorization: Bearer ${token}`]);
      assert.ok(r.status === 403 || r.status === 400, `${host}: ${r.status}`);
      assert.doesNotMatch(r.body, /"decisions"/, host);
    }
  });
});

// O Node guarda o primeiro Host e descarta os outros sem avisar: com dois, o proxy e o motor
// poderiam ler nomes diferentes do mesmo pedido. Dois Host é recusa, em qualquer ordem e mesmo
// com credencial válida (lib/http-guard.js, hostDoPedido).
test('ataque: pedido com dois cabeçalhos Host é recusado em qualquer ordem', async () => {
  const pares = () => [['atacante.net', HOST], [HOST, 'atacante.net'], [HOST, HOST], [local(), 'atacante.net'], ['atacante.net', local()], [local(), local()]];
  for (const ligar of [false, true]) {
    await hospedado(async () => {
      for (const [primeiro, segundo] of pares()) {
        const r = await pedidoCru('GET /api/state HTTP/1.1', [`Host: ${primeiro}`, `Host: ${segundo}`, `Authorization: Bearer ${token}`]);
        assert.equal(r.status, 403, `${primeiro} + ${segundo}, hospedado=${ligar}`);
        assert.match(r.body, /"motivo":"host"/);
        assert.doesNotMatch(r.body, /"decisions"/);
      }
      // controle: com um Host só e a mesma credencial, o pedido cru chega ao estado
      const um = await pedidoCru('GET /api/state HTTP/1.1', [`Host: ${local()}`, `Authorization: Bearer ${token}`]);
      assert.equal(um.status, 200);
      assert.match(um.body, /"decisions"/);
    }, ligar ? undefined : {});
  }
});

test('ataque: o alvo do pedido não contrabandeia o host (forma absoluta e barra dupla)', async () => {
  await hospedado(async () => {
    for (const alvo of [`http://${HOST}/api/state`, `https://${HOST}/api/state`, `//${HOST}/api/state`, `http://127.0.0.1:${porta}/api/state`]) {
      const r = await pedidoCru(`GET ${alvo} HTTP/1.1`, ['Host: atacante.net', `Authorization: Bearer ${token}`]);
      assert.ok(r.status === 403 || r.status === 400, `${alvo}: ${r.status}`);
      assert.doesNotMatch(r.body, /"decisions"/, alvo);
    }
  });
});

// Antes desta fase o alvo que a URL não consegue ler lançava fora do try do servidor, numa
// função assíncrona: rejeição sem tratamento, que derruba o processo. Atrás de um proxy isso
// é um pedido anônimo derrubando o motor.
test('ataque: alvo malformado recebe 400 e o processo continua de pé', async () => {
  for (const alvo of ['//', '//[', 'http://[', '///', '//:x']) {
    const r = await pedidoCru(`GET ${alvo} HTTP/1.1`, [`Host: ${local()}`]);
    assert.ok(!r.vazio, `${alvo}: o servidor tem que responder`);
    assert.equal(r.status, 400, alvo);
    assert.doesNotMatch(r.cabeca, /access-control-/i);
  }
  assert.equal((await pedir('GET', '/api/health')).status, 200, 'o servidor segue de pé');
});

test('ataque: a saúde não vira eco nem porta de entrada', async () => {
  // corpo grande num GET de saúde: a resposta sai fixa, sem ler o corpo
  const r = await pedidoCru('GET /api/health HTTP/1.1', ['Host: atacante.net', `Origin: ${ORIGEM}`, 'X-Forwarded-Host: atacante.net', 'Content-Length: 0']);
  assert.equal(r.status, 200);
  assert.equal(r.body, SAUDE);
  assert.doesNotMatch(r.cabeca, /atacante|access-control-/i);
  // travessia que normaliza para a saúde responde a saúde (corpo fixo), nunca outra rota
  const normalizada = await pedidoCru('GET /api/state/../health HTTP/1.1', ['Host: atacante.net']);
  assert.equal(normalizada.body, SAUDE);
  // e a volta: partir da saúde não alcança rota nenhuma sem passar pela allowlist
  const fuga = await pedidoCru('GET /api/health/../state HTTP/1.1', ['Host: atacante.net']);
  assert.equal(fuga.status, 403);
  assert.doesNotMatch(fuga.body, /"decisions"/);
});

/* ---------- as duas chaves não mudam pela API ---------- */

test('POST /api/settings e POST /api/accounts/edit não mudam hostPublico nem origensPermitidas', async () => {
  const antes = { hostPublico: engine.config.hostPublico, origensPermitidas: engine.config.origensPermitidas };
  const ataque = { hostPublico: 'atacante.net', origensPermitidas: ['https://atacante.net'] };
  const h = { 'x-farol': '1' };
  const settings = await pedir('POST', '/api/settings', { headers: h, corpo: { ...ataque, soundEnabled: false } });
  assert.equal(settings.status, 200);
  const corpo = JSON.parse(settings.body);
  assert.deepEqual(corpo.ignoradas.slice().sort(), ['hostPublico', 'origensPermitidas']);
  assert.equal(corpo.config.soundEnabled, false, 'o resto do salvar entrou');
  engine.config = { ...engine.config, conta: { user: 'revisora', owners: ['biudtech'] } };
  for (const op of [
    { user: 'revisora', tipo: 'editar', campos: { ...ataque, onClean: 'wait' } },
    { user: 'revisora', tipo: 'editar', campos: {}, ...ataque },
    { ...ataque },
  ]) {
    assert.equal((await pedir('POST', '/api/accounts/edit', { headers: h, corpo: op })).status, 200);
  }
  assert.equal(engine.config.hostPublico, antes.hostPublico);
  assert.deepEqual(engine.config.origensPermitidas, antes.origensPermitidas);
  assert.equal('hostPublico' in engine.config.conta, false);
  assert.equal('origensPermitidas' in engine.config.conta, false);
  const gravado = JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf8'));
  assert.equal('hostPublico' in gravado, false);
  assert.equal('origensPermitidas' in gravado, false);
  assert.doesNotMatch(JSON.stringify(gravado), /atacante/);
  // a origem do atacante continua de fora depois da tentativa
  assert.equal((await pedir('GET', '/api/state', { headers: { origin: 'https://atacante.net' } })).status, 403);
  assert.equal((await pedir('GET', '/api/state', { headers: { host: 'atacante.net' } })).status, 403);
});
