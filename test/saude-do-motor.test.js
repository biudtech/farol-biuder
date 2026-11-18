// A saúde do motor no doctor (17/11/2026, lib/engine/saude-do-motor.js): o início do processo, o
// commit lido dos arquivos do git (sem rodar git), o disco da pasta de dados e a telemetria
// gravando, com a última escrita pelo arquivo do banco e do -wal.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-saude-'));
process.env.FAROL_HOME = home;
const { saudeDoMotor, commitDoRepositorio, discoDaPasta, telemetriaDoMotor } = await import('../lib/engine/saude-do-motor.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));

const SHA_A = 'a'.repeat(40);
const SHA_B = '0123456789abcdef0123456789abcdef01234567';

function repo(nome, arquivos) {
  const raiz = path.join(home, nome);
  for (const [rel, conteudo] of Object.entries(arquivos)) {
    fs.mkdirSync(path.dirname(path.join(raiz, rel)), { recursive: true });
    fs.writeFileSync(path.join(raiz, rel), conteudo);
  }
  fs.mkdirSync(raiz, { recursive: true });
  return raiz;
}

test('commit: HEAD solto, ref solta, packed-refs e worktree pelo gitdir e commondir', () => {
  assert.equal(commitDoRepositorio(repo('solto', { '.git/HEAD': `${SHA_A}\n` })), SHA_A);
  assert.equal(commitDoRepositorio(repo('ref', { '.git/HEAD': 'ref: refs/heads/main\n', '.git/refs/heads/main': `${SHA_B}\n` })), SHA_B);
  assert.equal(commitDoRepositorio(repo('pack', { '.git/HEAD': 'ref: refs/heads/main\n', '.git/packed-refs': `# pack-refs\n${SHA_B} refs/heads/main\n` })), SHA_B);
  const principal = repo('principal', { '.git/packed-refs': `${SHA_A} refs/heads/feat/x\n`, '.git/worktrees/wt/HEAD': 'ref: refs/heads/feat/x\n', '.git/worktrees/wt/commondir': '../..\n' });
  const wt = repo('wt', { '.git': `gitdir: ${path.join(principal, '.git', 'worktrees', 'wt')}\n` });
  assert.equal(commitDoRepositorio(wt), SHA_A);
});

test('commit: sem repositório, HEAD torto ou ref que sobe de pasta dão null', () => {
  assert.equal(commitDoRepositorio(repo('nada', {})), null);
  assert.equal(commitDoRepositorio(repo('torto', { '.git/HEAD': 'lixo' })), null);
  assert.equal(commitDoRepositorio(repo('sobe', { '.git/HEAD': 'ref: refs/../../segredo\n', segredo: SHA_A })), null);
  assert.equal(commitDoRepositorio(repo('sem-ref', { '.git/HEAD': 'ref: refs/heads/main\n' })), null);
});

test('disco: livre e total da pasta de dados; pasta que não existe dá null', () => {
  const d = discoDaPasta(home);
  assert.ok(d.totalBytes > 0 && d.livreBytes >= 0 && d.livreBytes <= d.totalBytes);
  assert.equal(discoDaPasta(path.join(home, 'nao-existe')), null);
});

test('telemetria: o banco aberto e a última escrita pelo arquivo e pelo -wal', () => {
  const banco = path.join(home, 'tele.db');
  assert.deepEqual(telemetriaDoMotor({}, banco), { consumoNoBanco: false, historicoNoBanco: false });
  fs.writeFileSync(banco, '');
  fs.writeFileSync(`${banco}-wal`, '');
  fs.utimesSync(banco, 1000, 1000);
  fs.utimesSync(`${banco}-wal`, 2000, 2000);
  const aberto = { db: { isOpen: true } };
  assert.deepEqual(telemetriaDoMotor({ telemetria: aberto, historicoH: aberto, historicoNoBanco: true }, banco),
    { consumoNoBanco: true, historicoNoBanco: true, ultimaEscritaEm: 2000000 });
  // histórico com o banco aberto mas fora dele (voltou ao JSON) não conta como gravando
  assert.equal(telemetriaDoMotor({ historicoH: aberto, historicoNoBanco: false }, banco).historicoNoBanco, false);
  assert.equal(telemetriaDoMotor({ telemetria: { db: { isOpen: false } } }, banco).consumoNoBanco, false);
});

test('a saúde inteira: início do processo no passado, commit do código e medição com a hora', () => {
  const s = saudeDoMotor(null, { agora: 123, pasta: home, banco: path.join(home, 'outro.db') });
  assert.equal(s.medidoEm, 123);
  assert.ok(Number.isSafeInteger(s.noArDesde) && s.noArDesde <= Date.now());
  assert.ok(s.commit === null || /^[0-9a-f]{40}$/.test(s.commit));
  assert.ok(s.disco.totalBytes > 0);
  assert.deepEqual(s.telemetria, { consumoNoBanco: false, historicoNoBanco: false });
  assert.deepEqual(Object.keys(s).sort(), ['commit', 'disco', 'medidoEm', 'noArDesde', 'telemetria']);
});
