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
const lerTela = (nome) => { try { return fs.readFileSync(path.join(RAIZ, 'ui', 'telas', nome), 'utf8'); } catch { return ''; } };
const LOGIN = lerTela('login-claude.js');

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

// A chave não sai do motor (15/11/2026): a tela recebe o perfil só com `temChave`, o campo
// nasce vazio e diz que há uma chave guardada. Mesmo que um perfil chegue com a chave (estado
// antigo na memória da aba), ela não é escrita no HTML.
test('o campo da chave nasce vazio: diz que há chave guardada e nunca escreve o valor', () => {
  const guardada = claudeProfilesHtml({ config: { claudeProfiles: [{ id: 'k1', label: 'Chave', kind: 'apikey', temChave: true, baseUrl: '' }], claudeProfileId: 'k1' }, usage: {}, doctor: {} });
  const campo = guardada.match(/<input class="cp-apikey"[^>]*>/)[0];
  assert.doesNotMatch(campo, / value="[^"]/, 'o campo não nasce preenchido');
  assert.match(guardada, /Há uma chave guardada/);
  assert.match(guardada, /digitar outra aqui substitui/);
  assert.doesNotMatch(guardada, /undefined/);
  const antiga = claudeProfilesHtml({ config: CONFIG, usage: {}, doctor: {} });
  assert.equal(antiga.includes('sk-ant-nao-e-real'), false, 'chave que veio no estado não vai para o HTML');
  const semChave = claudeProfilesHtml({ config: { claudeProfiles: [{ id: 'k2', label: 'Vazio', kind: 'apikey' }], claudeProfileId: '' }, usage: {}, doctor: {} });
  assert.doesNotMatch(semChave, /Há uma chave guardada/);
  assert.match(semChave, /Sem chave guardada/);
});

// Mudar o endereço sem redigitar a chave é recusado pelo motor: o motivo aparece junto do
// perfil, e a tela manda a chave e o endereço no mesmo salvar quando os dois estão digitados.
test('a recusa do endereço aparece junto do perfil, e chave e endereço vão no mesmo salvar', () => {
  const config = { claudeProfiles: [{ id: 'k1', label: 'Chave', kind: 'apikey', temChave: true, baseUrl: '' }, { id: 'k2', label: 'Outra', kind: 'apikey', temChave: true }], claudeProfileId: 'k1' };
  const motivo = 'Para mudar o endereço <deste> perfil, digite a chave de novo.';
  const html = claudeProfilesHtml({ config, usage: {}, doctor: {}, recusas: { k1: motivo } });
  assert.match(html, /<div class="cp-teste-erro" data-recusa="k1" role="alert">Para mudar o endereço &lt;deste&gt; perfil, digite a chave de novo\.<\/div>/);
  assert.match(html, /<div class="cp-teste-erro" data-recusa="k2" role="alert"><\/div>/, 'perfil sem recusa tem o lugar vazio');
  assert.doesNotMatch(claudeProfilesHtml({ config, usage: {}, doctor: {} }), /undefined/);
  assert.match(TELA, /r\?\.code === 'chave_exigida'/);
  assert.match(TELA, /estado\(\)\.config\.claudeProfiles = r\.config\.claudeProfiles/, 'a tela volta ao que o motor guarda');
  assert.match(TELA, /recusas: Object\.fromEntries\(recusas\)/);
  assert.match(TELA, /\.cp-baseurl\[data-id=/, 'o salvar da chave lê o endereço digitado, e o do endereço lê a chave');
});

test('a tela só manda a chave quando ela foi digitada', () => {
  assert.doesNotMatch(TELA, /next\.apiKey = t\.value\.trim\(\);/, 'campo vazio não vira chave vazia no perfil');
  assert.match(TELA, /if \(chave\) next\.apiKey = chave;/);
});

// Em 15/11/2026 a assinatura do Claude voltou (decisão do dono): a tela oferece os dois tipos
// de perfil, e o de assinatura entra pelo login na própria tela. Continuam fora a pasta
// digitada à mão, o login pelo terminal, a adoção do login da máquina e os outros provedores.
test('a tela oferece assinatura e chave de API: login pela tela, sem terminal e sem outros provedores', () => {
  const html = claudeProfilesHtml({ config: { claudeProfiles: [], claudeProfileId: '', accounts: [] }, usage: {}, doctor: {} });
  assert.match(html, /id="cpAddApiKey"/);
  assert.match(html, /id="btnCpAdd"/);
  assert.match(html, /id="btnCpAddAssinatura"/);
  assert.match(html, /id="cpLoginWeb"/);
  assert.doesNotMatch(html, /cpAddDir|btnClaudeMigrate|diretório de config|Abrir sessão de login|terminal|Codex|OpenRouter|Antigravity|ordem de uso/i);
  const comChave = claudeProfilesHtml({ config: CONFIG, usage: {}, doctor: {} });
  assert.doesNotMatch(comChave, /cp-login/, 'perfil de chave de API não tem login');
  const comPlano = claudeProfilesHtml({ config: { claudeProfiles: [{ id: 's1', label: 'Plano Max', kind: 'dir', dir: '' }], claudeProfileId: 's1', accounts: [] }, usage: {}, doctor: {} });
  assert.equal((comPlano.match(/class="btn sm cp-login" data-id="s1"/g) || []).length, 1);
  assert.match(comPlano, /class="btn sm cp-testar" data-id="s1"/);
  assert.doesNotMatch(comPlano, /cp-apikey|cp-baseurl/, 'perfil de assinatura não tem campo de chave');
  assert.doesNotMatch(comPlano + comChave, /cp-budget|Orçamento|[Tt]eto/, 'o perfil não tem mais campo de teto de gasto');
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
  const invalido = perfilProblemasHtml([{ escopo: 'padrao', user: '', profileId: 'x', code: 'perfil-invalido' }]);
  assert.match(invalido, /O padrão do Farol aponta para o perfil "x"/);
  assert.match(invalido, /incompleto/);
});

test('o markup escapa o que vem da configuração', () => {
  const html = perfilProblemasHtml([{ escopo: 'padrao', user: '"><script>alert(1)</script>', profileId: '<img src=x>', code: 'perfil-inexistente' }]);
  assert.doesNotMatch(html, /<script|<img/i);
});

test('a tela liga o teste e o login pela tela às rotas do engine; adoção e login pelo terminal continuam fora', () => {
  assert.match(TELA, /\/api\/claude\/profile-test/);
  for (const rota of ['start', 'code', 'cancel']) assert.ok(LOGIN.includes(`'/api/claude/login-web/${rota}'`), `rota ${rota} do login pela tela`);
  // o código colado vive só no campo e na chamada: nada de guardar no navegador nem no console
  assert.doesNotMatch(TELA + LOGIN, /profile-adopt|claude-login|localStorage|sessionStorage|console\./);
  // o aviso entra no desenho do bloco, não só no import
  const render = TELA.slice(TELA.indexOf('export function renderClaudeProfiles()'), TELA.indexOf('/* editor de perfis'));
  assert.match(render, /perfilProblemasHtml\(/);
});
