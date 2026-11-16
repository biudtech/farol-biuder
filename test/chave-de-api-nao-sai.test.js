// A chave da Anthropic entra no motor e nunca mais sai dele por resposta nenhuma (15/11/2026).
// O motor vai ficar exposto na internet: o perfil de chave leva para fora só `temChave`, e a
// tela, que manda a lista inteira de perfis ao salvar, não precisa devolver a chave para ela
// continuar guardada. Aqui a prova é pela camada HTTP de verdade, com uma chave falsa
// reconhecível, numa VARREDURA: toda rota do inventário responde sem a chave.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-chave-nao-sai-'));
process.env.FAROL_HOME = HOME;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const { CONFIG_FILE } = await import('../lib/paths.js');
const { todasAsRotas } = await import('../lib/local-auth/inventario.js');
const { configParaFora, comChaveGuardada, recusaDoEndereco } = await import('../lib/engine/chave-do-perfil.js');

const CHAVE = 'sk-ant-CHAVEFALSA-nao-pode-sair-0123456789';
const CHAVE_NOVA = 'sk-ant-CHAVENOVA-tambem-nao-sai-9876543210';
// nem o valor, nem um pedaço dele: o miolo e o fim da chave também são procurados
const PEDACOS = [CHAVE, 'CHAVEFALSA', '0123456789', CHAVE_NOVA, 'CHAVENOVA', '9876543210'];
const semChave = (texto, onde) => {
  for (const p of PEDACOS) assert.equal(String(texto).includes(p), false, `${onde} traz a chave de API (${p.slice(0, 6)}...)`);
};

let server, base, engine;

before(async () => {
  engine = new Engine();
  engine.config.port = 0;
  engine.updateSettings({
    claudeProfiles: [
      { id: 'k1', label: 'Chave', kind: 'apikey', apiKey: CHAVE, baseUrl: '' },
      { id: 's1', label: 'Plano', kind: 'dir', dir: '' },
    ],
    claudeProfileId: 'k1',
  }, 'teste');
  await new Promise((resolve, reject) => {
    server = startServer(engine, (url, err) => (err ? reject(err) : resolve()));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  try { server.closeAllConnections(); await new Promise((r) => server.close(() => r())); } catch { /* ok */ }
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function pedir(metodo, rota, corpo) {
  return new Promise((resolve, reject) => {
    const dados = metodo === 'POST' ? JSON.stringify(corpo || {}) : '';
    const headers = { Connection: 'close' };
    if (metodo === 'POST') Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados), 'x-farol': '1' });
    const req = http.request(base + rota, { method: metodo, headers }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(d); } catch { /* corpo que não é JSON */ }
        resolve({ status: res.statusCode, corpo: d, json });
      });
    });
    req.on('error', reject);
    req.end(dados);
  });
}

// Lê o SSE até aparecer o evento pedido (ou o prazo vencer) e devolve tudo o que chegou.
function ouvirEventos(ate, aoConectar) {
  return new Promise((resolve, reject) => {
    let texto = '';
    const req = http.get(`${base}/api/events`, (res) => {
      const fim = setTimeout(() => { req.destroy(); resolve(texto); }, 4000);
      let avisou = false;
      res.on('data', (c) => {
        texto += c;
        if (!avisou && texto.includes('event: state\n')) { avisou = true; aoConectar(); }
        if (texto.includes(`event: ${ate}\n`) && texto.endsWith('\n\n')) { clearTimeout(fim); req.destroy(); resolve(texto); }
      });
    });
    req.on('error', (e) => { if (texto) resolve(texto); else reject(e); });
  });
}

const perfil = (id) => engine.config.claudeProfiles.find((p) => p.id === id);
const noDisco = () => JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const perfilNoDisco = (id) => (noDisco().claudeProfiles || []).find((p) => p.id === id);
// o que a tela tem na memória: a lista de perfis como o snapshot a entrega
const perfisDaTela = () => structuredClone(engine.snapshot().config.claudeProfiles);

test('o motor guarda a chave: a sessão continua recebendo, e o arquivo também', () => {
  assert.equal(perfil('k1').apiKey, CHAVE);
  assert.equal(perfilNoDisco('k1').apiKey, CHAVE);
});

test('(a) o snapshot não traz a chave em lugar nenhum: o perfil de chave leva só temChave', () => {
  const s = engine.snapshot();
  semChave(JSON.stringify(s), 'o snapshot');
  const k1 = s.config.claudeProfiles.find((p) => p.id === 'k1');
  assert.equal(k1.temChave, true);
  assert.equal('apiKey' in k1, false);
  assert.equal(k1.label, 'Chave');
  const s1 = s.config.claudeProfiles.find((p) => p.id === 's1');
  assert.equal('temChave' in s1, false, 'perfil de assinatura não tem chave para declarar');
  assert.equal(perfil('k1').apiKey, CHAVE, 'projetar não muta a configuração do motor');
});

test('a projeção é pura: não muta a config, e config sem perfil passa igual', () => {
  const config = { theme: 'dark', claudeProfiles: [{ id: 'a', label: 'A', kind: 'apikey', apiKey: CHAVE, baseUrl: 'https://x.example' }] };
  const antes = structuredClone(config);
  const fora = configParaFora(config);
  assert.deepEqual(config, antes);
  assert.deepEqual(fora, { theme: 'dark', claudeProfiles: [{ id: 'a', label: 'A', kind: 'apikey', baseUrl: 'https://x.example', temChave: true }] });
  assert.deepEqual(configParaFora({ theme: 'dark' }), { theme: 'dark' });
  assert.deepEqual(configParaFora({ claudeProfiles: [null, { id: 'b', kind: 'apikey', apiKey: '' }] }).claudeProfiles, [null, { id: 'b', kind: 'apikey', temChave: false }]);
});

test('(b) a (e) varredura: nenhuma rota GET do inventário responde com a chave', async () => {
  // o diagnóstico e o log leem o farol.log: uma linha de falha com o perfil em uso entra antes
  engine.log('ERROR', 'falha de teste com o perfil k1 em uso');
  const conferidas = [];
  for (const rota of todasAsRotas().filter((r) => r !== '/api/events')) {
    const r = await pedir('GET', rota + (rota === '/api/decision' ? '?key=acme/repo%231' : ''));
    semChave(r.corpo, `GET ${rota}`);
    conferidas.push(`${rota}=${r.status}`);
  }
  // a varredura não está cega: as leituras respondem 200, e são as que o motor tem
  const com200 = conferidas.filter((c) => c.endsWith('=200')).map((c) => c.split('=')[0]).sort();
  assert.deepEqual(com200, ['/api/auth/status', '/api/decision', '/api/diagnostics', '/api/doctor', '/api/log', '/api/log/triage', '/api/state', '/api/team', '/api/usage']);
  const estado = await pedir('GET', '/api/state');
  assert.equal(estado.json.config.claudeProfiles.find((p) => p.id === 'k1').temChave, true);
});

test('(c) o SSE não manda a chave, nem no state inicial nem no state-patch', async () => {
  const texto = await ouvirEventos('state-patch', () => { pedir('POST', '/api/settings', { soundEnabled: !engine.config.soundEnabled }); });
  assert.match(texto, /event: state\n/);
  assert.match(texto, /event: state-patch\n/, 'a mudança de configuração chegou por diferença');
  assert.match(texto.split('event: state-patch\n')[1], /"config"/, 'e a diferença trouxe a config');
  semChave(texto, 'o SSE');
});

test('(d) e (e) as respostas de POST não trazem a chave', async () => {
  const chamadas = [
    ['/api/settings', { theme: 'dark' }],
    ['/api/claude/profile-test', { profileId: 'k1' }],
    ['/api/claude/profile-test', {}],
    ['/api/accounts/edit', {}],
    ['/api/auth/sessions', {}],
    ['/api/jira/test', { siteId: 'nao-existe' }],
    ['/api/cancel', { id: 'nao-existe' }],
    ['/api/pushback', {}],
  ];
  for (const [rota, corpo] of chamadas) {
    const r = await pedir('POST', rota, corpo);
    assert.equal(r.status, 200, `POST ${rota}`);
    semChave(r.corpo, `POST ${rota}`);
  }
  const r = await pedir('POST', '/api/settings', { theme: 'dark' });
  assert.equal(r.json.config.claudeProfiles.find((p) => p.id === 'k1').temChave, true);
});

// Os outros segredos que passam pelo motor, na mesma varredura: o token do GitHub da conta, a
// credencial do Jira, o código de pareamento, o token e o hash das sessões da autenticação
// local, e o conteúdo do `.credentials.json` do perfil de assinatura. O token de sessão sai
// uma vez, no corpo de POST /api/auth/pair, que é onde ele nasce; em mais nenhuma resposta.
test('os outros segredos também não saem: GitHub, Jira, autenticação local e a credencial da assinatura', async () => {
  const { criarCodigo } = await import('../lib/local-auth/pareamento.js');
  const { sessoesPath } = await import('../lib/local-auth/sessoes.js');
  const { pareamentosPath } = await import('../lib/local-auth/pareamento.js');
  const { CLAUDE_PERFIS_DIR } = await import('../lib/paths.js');

  engine.token = 'ghp_TOKENFALSODOGITHUB0123456789abcdef';
  await pedir('POST', '/api/settings', { jiraSites: [{ id: 'site1', label: 'Jira', baseUrl: 'https://exemplo.atlassian.net', owners: ['acme'], projectKeys: ['BT'] }] });
  const jira = await pedir('POST', '/api/jira/credential', { siteId: 'site1', email: 'pessoa@exemplo.com', token: 'JIRATOKENFALSO-nao-sai-0123456789' });
  assert.deepEqual(jira.json, { ok: true });
  const pasta = path.join(CLAUDE_PERFIS_DIR, 's1');
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-CREDENCIALFALSA-0123456789', refreshToken: 'sk-ant-ort-RENOVACAOFALSA-0123456789', expiresAt: Date.now() + 3600000 } }));
  const usado = criarCodigo();
  const pendente = criarCodigo();
  const par = await pedir('POST', '/api/auth/pair', { codigo: usado, rotulo: 'teste' });
  assert.equal(par.json.ok, true);
  const tokenDaSessao = par.json.token;
  const hashes = [...JSON.parse(fs.readFileSync(sessoesPath(), 'utf8')), ...JSON.parse(fs.readFileSync(pareamentosPath(), 'utf8'))].flatMap((r) => [r.hash, r.sal]).filter(Boolean);
  assert.ok(hashes.length >= 3, 'há hash de sessão e de código pendente para procurar');

  const segredos = ['TOKENFALSODOGITHUB', 'JIRATOKENFALSO', 'CREDENCIALFALSA', 'RENOVACAOFALSA', tokenDaSessao, pendente, ...hashes];
  const limpo = (texto, onde) => { for (const x of segredos) assert.equal(String(texto).includes(x), false, `${onde} traz um segredo (${x.slice(0, 6)}...)`); };

  await engine.doctor();
  const s = engine.snapshot();
  limpo(JSON.stringify(s), 'o snapshot');
  assert.equal(s.accounts.every((a) => typeof a.tokenOk === 'boolean'), true);
  assert.equal(s.jiraSites.find((x) => x.id === 'site1').hasCredential, true, 'do Jira sai só a existência');
  for (const rota of todasAsRotas().filter((r) => r !== '/api/events')) limpo((await pedir('GET', rota)).corpo, `GET ${rota}`);
  const posts = [
    ['/api/settings', { theme: 'dark' }], ['/api/claude/profile-test', { profileId: 's1' }], ['/api/accounts/edit', {}],
    ['/api/auth/sessions', {}], ['/api/jira/test', { siteId: 'site1' }], ['/api/jira/credential', { siteId: 'site1' }],
    ['/api/auth/pair', { codigo: 'ERRADO0000', rotulo: 'x' }],
  ];
  for (const [rota, corpo] of posts) limpo((await pedir('POST', rota, corpo)).corpo, `POST ${rota}`);
  limpo(await ouvirEventos('state', () => {}), 'o SSE');
});

test('salvar pela tela sem redigitar a chave mantém a chave guardada, em memória e no disco', async () => {
  const lista = perfisDaTela().map((p) => (p.id === 'k1' ? { ...p, label: 'Chave renomeada' } : p));
  assert.equal('apiKey' in lista.find((p) => p.id === 'k1'), false, 'a tela não tem a chave para mandar');
  const r = await pedir('POST', '/api/settings', { claudeProfiles: lista });
  assert.equal(r.json.ok, true);
  semChave(r.corpo, 'a resposta do salvar');
  assert.equal(perfil('k1').label, 'Chave renomeada');
  assert.equal(perfil('k1').apiKey, CHAVE);
  assert.equal(perfilNoDisco('k1').apiKey, CHAVE);
  assert.equal(perfilNoDisco('k1').label, 'Chave renomeada');
});

test('chave vazia no corpo também mantém a guardada', async () => {
  const lista = perfisDaTela().map((p) => (p.id === 'k1' ? { ...p, apiKey: '   ' } : p));
  await pedir('POST', '/api/settings', { claudeProfiles: lista });
  assert.equal(perfil('k1').apiKey, CHAVE);
  assert.equal(perfilNoDisco('k1').apiKey, CHAVE);
});

test('temChave que chega no corpo nunca é gravado no config.json', async () => {
  const lista = perfisDaTela();
  assert.equal(lista.find((p) => p.id === 'k1').temChave, true);
  await pedir('POST', '/api/settings', { claudeProfiles: lista });
  assert.equal(fs.readFileSync(CONFIG_FILE, 'utf8').includes('temChave'), false);
  assert.equal('temChave' in perfil('k1'), false);
  // nem quem mente sobre a chave ganha uma: perfil novo com temChave e sem chave é incompleto
  await pedir('POST', '/api/settings', { claudeProfiles: [...lista, { id: 'falso', label: 'Falso', kind: 'apikey', temChave: true }] });
  assert.equal(perfil('falso'), undefined);
  assert.equal(fs.readFileSync(CONFIG_FILE, 'utf8').includes('temChave'), false);
});

test('perfil novo de chave sem chave é recusado como perfil incompleto, e não herda a de outro', async () => {
  const lista = [...perfisDaTela(), { id: 'k2', label: 'Sem chave', kind: 'apikey', apiKey: '', baseUrl: '' }];
  const r = await pedir('POST', '/api/settings', { claudeProfiles: lista });
  semChave(r.corpo, 'a resposta');
  assert.equal(perfil('k2'), undefined);
  assert.equal(perfilNoDisco('k2'), undefined);
  assert.equal(perfil('k1').apiKey, CHAVE);
  // perfil de assinatura com o id de um perfil de chave não recebe a chave dele
  const patch = comChaveGuardada({ claudeProfiles: [{ id: 'k1', label: 'Virou plano', kind: 'dir', dir: '' }] }, engine.config);
  assert.equal('apiKey' in patch.claudeProfiles[0], false);
});

// O endereço (URL base) decide PARA ONDE a chave guardada é enviada. Mudar o endereço sem
// redigitar a chave seria um jeito de tirar a chave do motor com uma sessão válida: a próxima
// revisão a mandaria para o endereço novo. Então endereço novo exige a chave no mesmo salvar.
const comK1 = (mudanca) => perfisDaTela().map((p) => (p.id === 'k1' ? { ...p, ...mudanca } : p));
const ENDERECO = 'https://proxy.exemplo.com/v1';

test('mudar o endereço sem redigitar a chave é recusado, e nada do salvar é gravado', async () => {
  const antes = fs.readFileSync(CONFIG_FILE, 'utf8');
  const tema = engine.config.theme;
  const lista = comK1({ baseUrl: ENDERECO, label: 'Rótulo que não entra' }).map((p) => (p.id === 's1' ? { ...p, label: 'Plano que não entra' } : p));
  const r = await pedir('POST', '/api/settings', { claudeProfiles: lista, theme: tema === 'dark' ? 'light' : 'dark' });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.code, 'chave_exigida');
  assert.deepEqual(r.json.perfis, ['k1']);
  assert.match(r.json.erro, /digite a chave de novo/);
  semChave(r.corpo, 'a resposta da recusa');
  assert.equal(r.json.config.claudeProfiles.find((p) => p.id === 'k1').baseUrl, '', 'a resposta devolve a config que continua valendo');
  assert.equal(perfil('k1').baseUrl, '');
  assert.equal(perfil('k1').apiKey, CHAVE);
  assert.equal(perfil('k1').label, 'Chave renomeada');
  assert.equal(perfil('s1').label, 'Plano', 'o outro perfil do mesmo salvar também não entra');
  assert.equal(engine.config.theme, tema, 'nem o outro campo do mesmo salvar');
  assert.equal(fs.readFileSync(CONFIG_FILE, 'utf8'), antes, 'o config.json não foi tocado');
});

test('com a chave redigitada no mesmo salvar, o endereço troca', async () => {
  const r = await pedir('POST', '/api/settings', { claudeProfiles: comK1({ baseUrl: ENDERECO, apiKey: CHAVE }) });
  assert.equal(r.json.ok, true);
  semChave(r.corpo, 'a resposta');
  assert.equal(perfil('k1').baseUrl, ENDERECO);
  assert.equal(perfilNoDisco('k1').baseUrl, ENDERECO);
  assert.equal(perfilNoDisco('k1').apiKey, CHAVE);
});

test('com o endereço igual, rótulo e orçamento mudam sem pedir a chave; espaço e barra final não são mudança', async () => {
  for (const [baseUrl, label] of [[ENDERECO, 'Um'], [`  ${ENDERECO}  `, 'Dois'], [`${ENDERECO}/`, 'Três'], [`"${ENDERECO}"`, 'Quatro']]) {
    const r = await pedir('POST', '/api/settings', { claudeProfiles: comK1({ baseUrl, label, budgetDaily: 7 }) });
    assert.equal(r.json.ok, true, `endereço ${JSON.stringify(baseUrl)}`);
    assert.equal(perfil('k1').label, label);
    assert.equal(perfil('k1').apiKey, CHAVE);
    assert.equal(perfilNoDisco('k1').budgetDaily, 7);
  }
});

test('endereço esvaziado, ausente ou trocado por outro, sem a chave, é recusado; a barra final não serve de desvio', async () => {
  // a rodada anterior pode ter gravado outra grafia do mesmo endereço: a comparação é a mesma nos dois lados
  const guardado = perfil('k1').baseUrl;
  const antes = fs.readFileSync(CONFIG_FILE, 'utf8');
  const semEndereco = perfisDaTela().map((p) => (p.id === 'k1' ? Object.fromEntries(Object.entries(p).filter(([c]) => c !== 'baseUrl')) : p));
  const tentativas = [comK1({ baseUrl: '' }), semEndereco, comK1({ baseUrl: 'https://outro.exemplo.com' }),
    comK1({ baseUrl: `${ENDERECO}/../roubo` }), comK1({ baseUrl: 'https://proxy.exemplo.com.atacante.net/v1/' }),
    comK1({ baseUrl: 'https://outro.exemplo.com/', apiKey: '   ' }), comK1({ baseUrl: 42 })];
  for (const lista of tentativas) {
    const r = await pedir('POST', '/api/settings', { claudeProfiles: lista });
    assert.equal(r.json.ok, false);
    assert.equal(r.json.code, 'chave_exigida');
    assert.equal(perfil('k1').baseUrl, guardado);
  }
  assert.equal(fs.readFileSync(CONFIG_FILE, 'utf8'), antes);
});

test('a regra do endereço é pura: só perfil de chave que já existe, com endereço diferente e sem chave', () => {
  const config = { claudeProfiles: [
    { id: 'a', label: 'A', kind: 'apikey', apiKey: CHAVE, baseUrl: '' },
    { id: 'b', label: 'B', kind: 'apikey', apiKey: CHAVE, baseUrl: 'https://b.exemplo.com' },
  ] };
  const patch = (...perfis) => ({ claudeProfiles: perfis });
  assert.equal(recusaDoEndereco({ theme: 'dark' }, config), null);
  assert.equal(recusaDoEndereco(null, config), null);
  assert.equal(recusaDoEndereco(patch({ id: 'a', kind: 'apikey', baseUrl: '' }, { id: 'b', kind: 'apikey', baseUrl: 'https://b.exemplo.com//' }), config), null);
  assert.equal(recusaDoEndereco(patch({ id: 'novo', kind: 'apikey', baseUrl: 'https://x.exemplo.com' }), config), null, 'perfil novo não tem chave guardada para desviar');
  assert.equal(recusaDoEndereco(patch({ id: 'a', kind: 'dir', dir: '' }), config), null, 'virar assinatura larga a chave, não a envia');
  assert.equal(recusaDoEndereco(patch({ id: 'a', kind: 'apikey', baseUrl: 'https://x.exemplo.com', apiKey: 'sk-outra' }), config), null);
  const r = recusaDoEndereco(patch({ id: ' a ', kind: 'apikey', baseUrl: 'https://x.exemplo.com' }, { id: 'b', kind: 'apikey', baseUrl: '', temChave: true }, { id: 'b', kind: 'apikey', baseUrl: 'https://b.exemplo.com' }), config);
  assert.equal(r.ok, false);
  assert.deepEqual(r.perfis, ['a', 'b']);
  semChave(JSON.stringify(r), 'a recusa');
});

test('chave digitada troca a guardada, e a nova também não volta na resposta', async () => {
  const lista = perfisDaTela().map((p) => (p.id === 'k1' ? { ...p, apiKey: CHAVE_NOVA } : p));
  const r = await pedir('POST', '/api/settings', { claudeProfiles: lista });
  semChave(r.corpo, 'a resposta da troca');
  assert.equal(perfil('k1').apiKey, CHAVE_NOVA);
  assert.equal(perfilNoDisco('k1').apiKey, CHAVE_NOVA);
  semChave(JSON.stringify(engine.snapshot()), 'o snapshot depois da troca');
  semChave((await pedir('GET', '/api/state')).corpo, 'GET /api/state depois da troca');
});

test('apagar a chave é remover o perfil', async () => {
  const lista = perfisDaTela().filter((p) => p.id !== 'k1');
  await pedir('POST', '/api/settings', { claudeProfiles: lista, claudeProfileId: 's1' });
  assert.equal(perfil('k1'), undefined);
  assert.equal(fs.readFileSync(CONFIG_FILE, 'utf8').includes('CHAVE'), false, 'a chave saiu do arquivo com o perfil');
  assert.equal(perfil('s1').kind, 'dir');
});

test('a guarda da chave é pura: não muta o patch, e patch sem perfis passa igual', () => {
  const config = { claudeProfiles: [{ id: 'a', label: 'A', kind: 'apikey', apiKey: CHAVE, baseUrl: '' }] };
  const patch = { claudeProfiles: [{ id: 'a', label: 'A2', kind: 'apikey', temChave: true }, null, 'lixo'] };
  const antes = structuredClone(patch);
  const saida = comChaveGuardada(patch, config);
  assert.deepEqual(patch, antes);
  assert.equal(saida.claudeProfiles[0].apiKey, CHAVE);
  assert.equal(saida.claudeProfiles[0].label, 'A2');
  assert.deepEqual(saida.claudeProfiles.slice(1), [null, 'lixo']);
  const outro = { theme: 'light' };
  assert.equal(comChaveGuardada(outro, config), outro);
  assert.equal(comChaveGuardada(null, config), null);
});

test('endereço só de barras não passa por "vazio": sem a chave é recusado', () => {
  const config = { claudeProfiles: [{ id: 'a', label: 'A', kind: 'apikey', apiKey: CHAVE, baseUrl: '' }] };
  for (const baseUrl of ['/', '//', ' / ']) {
    const r = recusaDoEndereco({ claudeProfiles: [{ id: 'a', kind: 'apikey', baseUrl }] }, config);
    assert.equal(r && r.code, 'chave_exigida', `endereço ${JSON.stringify(baseUrl)}`);
  }
  assert.equal(recusaDoEndereco({ claudeProfiles: [{ id: 'a', kind: 'apikey', baseUrl: '  ' }] }, config), null, 'só espaço é vazio de verdade');
});
