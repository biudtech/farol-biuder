// buildSessionScript usa resolveClaudeAuth(account) em vez de ler a config direto, pra a
// sessão de terminal respeitar o perfil por conta, igual ao headless (ghEnv, ver ghEnv.test
// em claude-profiles.test.js).
import os from 'node:os';
import path from 'node:path';
import fsMod from 'node:fs';

// fixar FAROL_HOME num diretório temporário ANTES de qualquer require que carregue
// lib/paths.js (const de nível de módulo, lida uma única vez no load), senão o teste
// escreve dentro do ~/.farol real da máquina (mesmo padrão de test/boot.test.js e
// test/session-unsee-on-exit.test.js).
const FAROL_HOME = fsMod.mkdtempSync(path.join(os.tmpdir(), 'farol-test-sessprofile-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { buildSessionScript } = await import('../lib/engine/session.js');
const { bashDoTeste } = await import('./helpers/bash-real.js');
import { execFileSync } from 'node:child_process';

after(() => {
  try { fsMod.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// engine "de mentira": só precisa do que buildSessionScript usa. Conta sem perfil na tabela
// fica sem autenticação (null), como o engine real sem perfil de chave de API utilizável.
function fakeEngine(authByUser) {
  return {
    config: { skipPermissions: false, port: 47170 },
    resolveClaudeAuth(user) {
      return (authByUser || {})[user] || null;
    },
    primaryUser() { return 'default-user'; }
  };
}

test('buildSessionScript: sem perfil de chave de API, só limpa a auth herdada e não exporta nada', () => {
  const engine = fakeEngine({});
  const script = buildSessionScript(engine, '/pr-review x', 'id1', 'alice');
  assert.match(script, /# sem perfil de chave de API/);
  // o posix cita CLAUDE_CONFIG_DIR e ANTHROPIC_* na linha de unset (G21), então o que não
  // pode existir é o EXPORT
  assert.doesNotMatch(script, /export CLAUDE_CONFIG_DIR/);
  assert.doesNotMatch(script, /export ANTHROPIC_/);
});

test('buildSessionScript: perfil apikey da conta, com baseUrl, escaping de aspa simples', () => {
  const engine = fakeEngine({ bob: { kind: 'apikey', apiKey: "sk-ant-abc' ; touch /tmp/PROOF #", baseUrl: 'https://proxy.x' } });
  const script = buildSessionScript(engine, '/pr-review x', 'id1', 'bob');
  assert.match(script, /export ANTHROPIC_API_KEY='sk-ant-abc'\\''/);
  assert.match(script, /export ANTHROPIC_BASE_URL='https:\/\/proxy\.x'/);
  assert.doesNotMatch(script, /export CLAUDE_CONFIG_DIR/); // ver nota do G21 acima
});

// bash pode não estar no PATH - checa
// antes de rodar o teste de verdade, pra pular com mensagem clara em vez de estourar ENOENT
// confuso e derrubar a suíte inteira.
const bashDisponivel = !!bashDoTeste;

// Prova de verdade (execução real com bash, não só leitura do template literal) de que
// uma chave com aspa simples não escapa da atribuição `export ANTHROPIC_API_KEY='...'`
// e executa comando arbitrário. Achado de auditoria adversarial (Fix 2).
test(
  'buildSessionScript: aspa simples na chave é escapada, não quebra a string bash (execução real)',
  { skip: bashDisponivel ? false : 'bash não encontrado no PATH' },
  () => {
    // pasta de nome aleatório (mkdtemp): o script é EXECUTADO logo abaixo, e um nome previsível
    // no tmp compartilhado deixaria outro usuário trocá-lo antes (alerta de CodeQL, 05/10/2026)
    const pasta = fsMod.mkdtempSync(path.join(os.tmpdir(), 'farol-test-escape-'));
    const proofFile = path.join(pasta, 'PROOF_INJECTION').replace(/\\/g, '/');
    const maliciosa = `sk-x' ; touch ${proofFile} #`;
    const engine = fakeEngine({ bob: { kind: 'apikey', apiKey: maliciosa, baseUrl: '' } });
    const script = buildSessionScript(engine, '/pr-review x', 'id1', 'bob');
    const exportLine = script.split('\n').find(l => l.startsWith('export ANTHROPIC_API_KEY'));
    assert.ok(exportLine, 'linha do export existe no script gerado');

    const tmpScript = path.join(pasta, 'escape.sh');
    try { fsMod.unlinkSync(proofFile); } catch { /* já não existe */ }
    fsMod.writeFileSync(tmpScript, `#!/bin/bash\n${exportLine}\necho "va-$ANTHROPIC_API_KEY-lor"\n`, { flag: 'wx', mode: 0o700 });
    let out;
    try {
      try {
        out = execFileSync(bashDoTeste, [tmpScript], { windowsHide: true, timeout: 5000 }).toString();
      } finally {
        try { fsMod.unlinkSync(tmpScript); } catch { /* best-effort */ }
      }
      assert.equal(fsMod.existsSync(proofFile), false, 'comando injetado NÃO deve ter rodado (touch do arquivo de prova)');
      assert.match(out, /va-sk-x' ; touch .* #-lor/, 'valor preservado como string literal única, aspa simples incluída');
    } finally {
      // garantido mesmo se alguma asserção acima falhar - senão o arquivo de prova
      // fica no /tmp pra sempre.
      try { fsMod.rmSync(pasta, { recursive: true, force: true }); } catch { /* limpeza, caso o teste falhe e o comando tenha rodado */ }
    }
  }
);

/* ---------- contratos cross-platform dos scripts de sessão (auditoria 16/08) ---------- */

test('FAROL_REVIEW_CMD: quoting do stub é aspas simples no .command', () => {
  const antes = process.env.FAROL_REVIEW_CMD;
  process.env.FAROL_REVIEW_CMD = 'meu-stub';
  try {
    const script = buildSessionScript(fakeEngine({}), '/pr-review x', 'id1', 'default-user');
    assert.ok(script.includes("meu-stub '/pr-review x'"), 'bash: aspas simples');
  } finally {
    if (antes === undefined) delete process.env.FAROL_REVIEW_CMD; else process.env.FAROL_REVIEW_CMD = antes;
  }
});

test('buildSessionScript: porta sem config cai no 47170, nunca "undefined" na URL do trap', () => {
  const engine = fakeEngine({});
  engine.config = { skipPermissions: false };   // sem port, como um config.json mínimo
  const s = buildSessionScript(engine, '/pr-review x', 'id1', 'default-user');
  assert.ok(s.includes('http://127.0.0.1:47170/api/session-exit'), 'fallback de porta no notify');
  assert.ok(!s.includes('undefined'), 'porta ausente não pode virar texto na URL');
});

test('buildSessionScript: conta pedida sem token ABORTA a sessão (paridade com o ghEnv)', () => {
  const s = buildSessionScript(fakeEngine({}), '/pr-review x', 'id1', 'bob');
  assert.ok(s.includes("conta 'bob' nao autenticada"), 'o erro nomeia a conta');
  assert.match(s, /if \[ -z "\$GH_TOKEN" \]; then[\s\S]*exit 1/, 'token vazio sai com erro, não segue no keyring');
});
