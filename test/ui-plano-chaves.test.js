// Plano e chaves na tela (A2, brief B2 item 2.2): testar o perfil é um ato explícito, cada
// informação diz de onde veio, perfil apontado que não existe aparece como ERRO (nunca como
// "usa o padrão"), e a tela liga o teste à rota do engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const { claudeProfilesHtml, perfilTesteHtml, perfilProblemasHtml } = await import('../ui/pure.js');

const RAIZ = path.join(import.meta.dirname, '..');
const TELA = fs.readFileSync(path.join(RAIZ, 'ui', 'telas', 'sistema-perfis.js'), 'utf8');

const CONFIG = {
  claudeProfiles: [
    { id: 'p1', label: 'Pessoal', kind: 'apikey', apiKey: 'sk-ant-nao-e-real-pessoal-1234567890' },
    { id: 'k1', label: 'Chave de laboratório', kind: 'apikey', apiKey: 'sk-ant-nao-e-real-123456789012345' },
  ],
  claudeProfileId: 'p1',
  accounts: [],
};

test('cada perfil ganha o botão de testar e o lugar do resultado', () => {
  const html = claudeProfilesHtml({ config: CONFIG, usage: {}, doctor: {} });
  assert.equal((html.match(/class="btn sm cp-testar"/g) || []).length, 2, 'um por perfil salvo');
  assert.match(html, /data-teste="p1"/);
  assert.match(html, /data-teste="k1"/);
  // o campo da chave continua sendo o editor dela (é onde se digita), mas o RESULTADO do
  // teste nunca repete a chave: ele diz só que está preenchida
  const resultado = perfilTesteHtml({ estado: 'pronto', perfil: { id: 'k1', label: 'Chave', kind: 'apikey', aviso: '', campos: { chave: { valor: 'preenchida', origem: 'informado' }, login: { valor: null, origem: 'desconhecido', motivo: 'testar a chave exigiria uma chamada paga ao provedor' } } } });
  assert.equal(resultado.includes('sk-ant-nao-e-real'), false);
  assert.match(resultado, /preenchida/);
});

test('a tela só oferece cadastrar chave de API: sem pasta, sem login, sem outros provedores', () => {
  const html = claudeProfilesHtml({ config: { claudeProfiles: [], claudeProfileId: '', accounts: [] }, usage: {}, doctor: {} });
  assert.match(html, /id="cpAddApiKey"/);
  assert.match(html, /id="btnCpAdd"/);
  assert.doesNotMatch(html, /cpAddDir|cpAddKind|cp-login|btnClaudeMigrate|cpLoginWeb|diretório de config/);
  const comPerfil = claudeProfilesHtml({ config: CONFIG, usage: {}, doctor: {} });
  assert.doesNotMatch(comPerfil, /cp-login|Abrir sessão de login/);
});

test('o resultado do teste mostra a origem de cada informação', () => {
  const html = perfilTesteHtml({
    estado: 'pronto',
    perfil: {
      id: 'p1', label: 'Pessoal', kind: 'apikey', aviso: '',
      campos: {
        chave: { valor: 'preenchida', origem: 'informado' },
        login: { valor: null, origem: 'desconhecido', motivo: 'testar a chave exigiria uma chamada paga ao provedor' },
        tipoAuth: { valor: 'chave-de-api', origem: 'informado' },
        plano: { valor: null, origem: 'desconhecido', motivo: 'não é detectável com confiança' },
      },
    },
  });
  assert.match(html, /informado/);
  assert.match(html, /desconhecido/);
  assert.match(html, /não é detectável com confiança/);
  assert.match(html, /chamada paga/, 'a tela diz que a chave não foi validada, e por quê');
  assert.match(html, /Testado agora|Testado às/);
});

test('o teste que não deu certo diz o motivo, e o aviso do engine aparece', () => {
  assert.match(perfilTesteHtml({ estado: 'erro', code: 'perfil-inexistente', motivo: 'esse perfil não existe mais na configuração' }), /não existe mais/);
  assert.match(perfilTesteHtml({ estado: 'testando' }), /testando/i);
  const comAviso = perfilTesteHtml({ estado: 'pronto', perfil: { id: 'p1', label: 'A', kind: 'apikey', aviso: 'o provedor não respondeu à verificação', campos: { login: { valor: false, origem: 'desconhecido' } } } });
  assert.match(comAviso, /não respondeu/);
  assert.match(comAviso, /desconhecido/);
});

test('perfil apontado que não existe aparece como erro, nunca como "usa o padrão"', () => {
  const html = perfilProblemasHtml([{ escopo: 'padrao', user: '', profileId: 'sumiu', code: 'perfil-inexistente' }]);
  assert.match(html, /não existe/);
  assert.match(html, /não usam esse perfil/);
  assert.doesNotMatch(html, /usa o padrão/i);
  assert.equal(perfilProblemasHtml([]), '', 'sem problema, nenhum aviso');
  const daConta = perfilProblemasHtml([{ escopo: 'conta', user: 'ana-exemplo', profileId: 'x', code: 'perfil-invalido' }]);
  assert.match(daConta, /@ana-exemplo/);
  assert.match(daConta, /incompleto/);
});

test('o markup escapa o que vem da configuração', () => {
  const html = perfilProblemasHtml([{ escopo: 'conta', user: '"><script>alert(1)</script>', profileId: '<img src=x>', code: 'perfil-inexistente' }]);
  assert.doesNotMatch(html, /<script|<img/i);
});

test('a tela liga o teste à rota do engine, e as rotas de adoção e de login saíram da tela', () => {
  assert.match(TELA, /\/api\/claude\/profile-test/);
  assert.doesNotMatch(TELA, /profile-adopt|claude-login|login-web/);
  // o aviso entra no desenho do bloco, não só no import
  const render = TELA.slice(TELA.indexOf('export function renderClaudeProfiles()'), TELA.indexOf('/* editor de perfis'));
  assert.match(render, /perfilProblemasHtml\(/);
});
