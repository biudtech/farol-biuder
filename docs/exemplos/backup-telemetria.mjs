// Backup diário do registro do motor na hospedagem compartilhada, sem Docker
// (docs/HOSPEDAGEM.md, "Hospedagem compartilhada, sem Docker"): o telemetria.db (sessões, falhas e
// o histórico das decisões), o usage.json (o agregado do consumo) e o decisions.json (as
// pendências). No container a cópia é a do volume; aqui não há volume para copiar.
//
// A cópia do banco é a do próprio SQLite (VACUUM INTO por uma conexão só de leitura), consistente
// com o motor de pé em WAL ("Copiar com o motor de pé", no mesmo guia). Antes de entrar na rotação a
// cópia é aberta e conferida: integrity_check e a contagem de sessões, que não pode ser menor que a
// da cópia anterior (as sessões não têm poda). Cópia que não confere não substitui nada. Depois de
// restaurar um banco antigo, a contagem cai de propósito: rode uma vez com --agora, que aceita.
//
// Falha que se repete não vira uma tentativa por minuto: a rodada que falha grava
// <base>/run/backup.espera, e quem agenda deixa de chamar por uma hora (a receita do guia confere a
// marca). A cópia morta no meio deixa a pasta .parcial, que a rodada seguinte apaga.
//
// Rotação: as 7 diárias mais recentes, mais a de cada domingo por 5 semanas e a do dia 1 por 6
// meses. Fica na mesma máquina: cobre banco corrompido, migração que deu errado e apagamento por
// engano, não a perda da conta inteira (essa é do backup da própria hospedagem, ou de uma cópia
// para fora, que este script não faz).
//
// Uso, a cada rodada do agendador da hospedagem (o "já fiz hoje" é conferido aqui dentro, e quem
// agenda pode conferir antes a marca <base>/run/backup.ultima para nem subir o Node):
//   FAROL_BASE=<base> node backup-telemetria.mjs           no máximo uma cópia por dia
//   FAROL_BASE=<base> node backup-telemetria.mjs --agora   copia de novo hoje, e aceita menos sessões
//
// Variáveis: FAROL_BASE (obrigatória, a pasta com run/ e log/) e FAROL_DADOS (o HOME do motor,
// padrão <base>/dados). As cópias ficam em <base>/backup/AAAA-MM-DD, com modo 700 e 600, e cada
// rodada dá uma linha em <base>/log/backup.log (ok, com as contagens, ou ERRO, com o motivo).
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const BASE = process.env.FAROL_BASE;
if (!BASE) {
  process.stderr.write('defina FAROL_BASE com a pasta base da hospedagem\n');
  process.exit(2);
}
const DADOS = process.env.FAROL_DADOS || path.join(BASE, 'dados');
const ESTADO = path.join(DADOS, '.farol', 'workspace', 'state');
const DESTINO = path.join(BASE, 'backup');
const LOG = path.join(BASE, 'log', 'backup.log');
const MARCA = path.join(BASE, 'run', 'backup.ultima');
const TRAVA = path.join(BASE, 'run', 'backup.trava');
const ESPERA = path.join(BASE, 'run', 'backup.espera');
const DIARIAS = 7;
const SEMANAIS = 5;
const MENSAIS = 6;

const log = (msg) => appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`);
// O dia de Brasília, o mesmo do consumo e da marca que o agendador confere.
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

const agora = process.argv.includes('--agora');
const feitoHoje = () => existsSync(MARCA) && readFileSync(MARCA, 'utf8').trim() === hoje;

process.umask(0o077);
mkdirSync(DESTINO, { recursive: true, mode: 0o700 });
chmodSync(DESTINO, 0o700);
if (!agora && feitoHoje()) process.exit(0);

// Uma cópia por vez: duas rodadas do agendador podem chegar juntas. A trava esquecida por uma
// rodada morta sai depois de 30 minutos. Com a trava, a marca do dia é conferida de novo: a outra
// rodada pode ter acabado de copiar.
try {
  mkdirSync(TRAVA);
} catch {
  try {
    if (Date.now() - statSync(TRAVA).mtimeMs > 30 * 60_000) rmSync(TRAVA, { recursive: true, force: true });
  } catch {
    // a trava saiu entre as duas chamadas: a rodada seguinte tenta
  }
  process.exit(0);
}
if (!agora && feitoHoje()) {
  rmSync(TRAVA, { recursive: true, force: true });
  process.exit(0);
}

function contagens(arquivo) {
  const db = new DatabaseSync(arquivo, { readOnly: true });
  try {
    const integridade = db.prepare('PRAGMA integrity_check').get().integrity_check;
    if (integridade !== 'ok') throw new Error(`integrity_check: ${integridade}`);
    return {
      sessoes: db.prepare('SELECT COUNT(*) AS n FROM sessoes').get().n,
      resolvidas: db.prepare('SELECT COUNT(*) AS n FROM resolvidas').get().n,
    };
  } finally {
    db.close();
  }
}

function anterior() {
  try {
    return JSON.parse(readFileSync(path.join(DESTINO, 'ultima.json'), 'utf8'));
  } catch {
    return null;
  }
}

// As pastas AAAA-MM-DD que ficam: as que caem em alguma das três janelas. A pasta .parcial de uma
// rodada morta no meio sai sempre.
function rotacionar() {
  for (const f of readdirSync(DESTINO)) if (f.endsWith('.parcial')) rmSync(path.join(DESTINO, f), { recursive: true, force: true });
  const dias = readdirSync(DESTINO).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort().reverse();
  const domingos = dias.filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 0).slice(0, SEMANAIS);
  const primeiros = dias.filter((d) => d.endsWith('-01')).slice(0, MENSAIS);
  const ficam = new Set([...dias.slice(0, DIARIAS), ...domingos, ...primeiros]);
  const saem = dias.filter((d) => !ficam.has(d));
  for (const d of saem) rmSync(path.join(DESTINO, d), { recursive: true, force: true });
  return { guardadas: ficam.size, saem };
}

const pasta = path.join(DESTINO, hoje);
const parcial = `${pasta}.parcial`;
try {
  rmSync(parcial, { recursive: true, force: true });
  mkdirSync(parcial, { mode: 0o700 });
  const fonte = new DatabaseSync(path.join(ESTADO, 'telemetria.db'), { readOnly: true });
  try {
    fonte.prepare('VACUUM INTO ?').run(path.join(parcial, 'telemetria.db'));
  } finally {
    fonte.close();
  }
  const contagem = contagens(path.join(parcial, 'telemetria.db'));
  const antes = anterior();
  if (antes && contagem.sessoes < antes.sessoes && !agora) {
    throw new Error(`cópia com menos sessões (${contagem.sessoes}) que a anterior (${antes.sessoes}, ${antes.dia})`);
  }
  for (const nome of ['usage.json', 'decisions.json']) {
    if (!existsSync(path.join(ESTADO, nome))) continue;
    copyFileSync(path.join(ESTADO, nome), path.join(parcial, nome));
    chmodSync(path.join(parcial, nome), 0o600);
  }
  execFileSync('gzip', ['-6', path.join(parcial, 'telemetria.db')]);
  rmSync(pasta, { recursive: true, force: true });
  renameSync(parcial, pasta);
  const bytes = readdirSync(pasta).reduce((s, f) => s + statSync(path.join(pasta, f)).size, 0);
  writeFileSync(path.join(DESTINO, 'ultima.json'), `${JSON.stringify({ dia: hoje, ...contagem, bytes })}\n`);
  writeFileSync(MARCA, `${hoje}\n`);
  rmSync(ESPERA, { force: true });
  const { guardadas, saem } = rotacionar();
  log(`ok ${hoje} sessoes=${contagem.sessoes} resolvidas=${contagem.resolvidas} bytes=${bytes} guardadas=${guardadas}${saem.length ? ` removidas=${saem.join(',')}` : ''}`);
} catch (erro) {
  rmSync(parcial, { recursive: true, force: true });
  log(`ERRO ${hoje} ${erro?.message ?? erro}`);
  writeFileSync(ESPERA, `${new Date().toISOString()}\n`);
  process.exitCode = 1;
} finally {
  rmSync(TRAVA, { recursive: true, force: true });
}
