// O histórico das decisões na subida (lote 2 do banco da telemetria, 17/11/2026), chamado pelo
// start() depois do listen, logo depois do consumo (iniciarTelemetria, telemetria-do-motor.js).
//
// Abre o banco por conta própria (a mesma conexão compartilhada do consumo, banco.js), para a
// falha da importação do CONSUMO, que fecha o handle do consumo, não levar o histórico junto.
// Depois importa o `resolved` que o construtor leu do decisions.json (só o que o banco ainda não
// tem), confere, guarda uma cópia do arquivo original como decisions.json.migrado-<dia> e só então
// o regrava com `resolved: []` e a marca `historicoNoBanco: true`; as pendências ficam nele.
//
// A marca separa os dois casos de banco fora:
//   - sem a marca (antes da primeira migração), o histórico inteiro está no decisions.json: o
//     motor segue nele, como antes do banco, e importa numa subida seguinte;
//   - com a marca, o histórico mora no banco, e banco que não abre deixa o histórico
//     INDISPONÍVEL (historico-decisoes.js): as regras que tratariam o vazio como "nada decidido"
//     ficam seguradas até ele voltar. Importação ou folga de disco que falham com a marca não
//     tiram o histórico do banco: o que estava no `resolved` (a fila de uma subida sem banco)
//     fica no decisions.json, por cima do banco, e entra na próxima gravação.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { TELEMETRIA_DB, STATE_DIR } from '../paths.js';
import { writeJsonAtomic } from '../io.js';
import { abrirBanco, fecharBanco, compactarWal } from '../telemetria/banco.js';
import { importarHistorico } from '../telemetria/migracao.js';
import { chaveDaPendencia } from '../telemetria/historico.js';
import { historico, marcarForaDoBanco, HIST_LIMIT } from './historico-decisoes.js';
import { colunasDaBusca } from './busca-do-historico.js';
import usageMod from './usage.js';

// Folga de disco para migrar: 2,5 vezes o decisions.json. Medido com o histórico real
// (17/11/2026, 217 MB): o pico é de 1,9 vez (o banco e o WAL da transação, ou o banco e a cópia
// depois que o WAL é zerado); o resto é margem.
const FOLGA = 2.5;
const SEGUE_NO_JSON = 'o histórico desta subida segue no decisions.json e entra no banco numa subida seguinte';
const ARQUIVO = () => path.join(STATE_DIR, 'decisions.json');

function plural(n, um, varios) { return `${n} ${n === 1 ? um : varios}`; }

function espacoLivrePadrao(pasta) {
  try { const s = fs.statfsSync(pasta); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

function abrir() {
  try { return abrirBanco(TELEMETRIA_DB); } catch (err) { return { erro: err.message }; }
}

function hashDe(arquivo) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(arquivo, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    for (let n = fs.readSync(fd, buf); n > 0; n = fs.readSync(fd, buf)) hash.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

// A cópia do decisions.json original. Já existindo uma cópia íntegra do mesmo arquivo (mesmo
// tamanho e hash), ela vale e nada é copiado. A cópia nova é feita num nome temporário
// (.parcial) e só então renomeada: uma cópia interrompida nunca fica com o nome de cópia válida,
// e a sobra dela sai aqui. Devolve o nome da cópia; lança se não copiou.
function copiarMigrado(arquivo, dia) {
  const pasta = path.dirname(arquivo);
  const base = path.basename(arquivo);
  const valida = new RegExp(`^${base.replace('.', '\\.')}\\.migrado-\\d{4}-\\d{2}-\\d{2}(-\\d+)?$`);
  for (const nome of fs.readdirSync(pasta).filter((n) => n.startsWith(`${base}.migrado-`) && n.endsWith('.parcial'))) fs.rmSync(path.join(pasta, nome), { force: true });
  const tamanho = fs.statSync(arquivo).size;
  let hash = '';
  for (const nome of fs.readdirSync(pasta).filter((n) => valida.test(n)).sort()) {
    if (fs.statSync(path.join(pasta, nome)).size !== tamanho) continue;
    hash = hash || hashDe(arquivo);
    if (hashDe(path.join(pasta, nome)) === hash) return nome;
  }
  let destino = path.join(pasta, `${base}.migrado-${dia}`);
  for (let n = 2; fs.existsSync(destino); n++) destino = path.join(pasta, `${base}.migrado-${dia}-${n}`);
  const temporario = `${destino}.parcial`;
  fs.copyFileSync(arquivo, temporario, fs.constants.COPYFILE_EXCL);
  fs.renameSync(temporario, destino);
  return path.basename(destino);
}

function resumo(r) {
  const partes = [plural(r.importadas, 'decisão', 'decisões')];
  if (r.jaEstavam) partes.push(`${plural(r.jaEstavam, 'já estava', 'já estavam')} no banco`);
  if (r.ilegiveis) partes.push(plural(r.ilegiveis, 'item ilegível descartado', 'itens ilegíveis descartados'));
  if (r.podadas) partes.push(`${plural(r.podadas, 'saiu', 'saíram')} pelo teto de ${HIST_LIMIT}`);
  return partes.join('; ');
}

// A pendência que já está no histórico do banco (queda entre o COMMIT do resolveIntoHistory e o
// saveDecisions) sai das pendências aqui, sem gravar de novo. O que o caminho normal fazia depois
// do save e se perde nessa queda: o dossiê do autor (writeMemory), o toast e o evento para a tela;
// o review, quando houve, já está no GitHub, e a decisão está no histórico.
function tirarPendenciasJaResolvidas(engine) {
  const pend = Array.isArray(engine.decisions.pending) ? engine.decisions.pending : [];
  if (!pend.length) return 0;
  const noHistorico = new Set(historico(engine).leves().map(chaveDaPendencia));
  const ficam = pend.filter((d) => !(d && typeof d === 'object' && noHistorico.has(chaveDaPendencia(d))));
  engine.decisions.pending = ficam;
  return pend.length - ficam.length;
}

function folgaQueFalta(espacoLivre) {
  const arquivo = ARQUIVO();
  if (!fs.existsSync(arquivo)) return 0;
  const precisa = Math.ceil(fs.statSync(arquivo).size * FOLGA);
  const livre = espacoLivre(STATE_DIR);
  return livre === null || livre >= precisa ? 0 : precisa - livre;
}

// Importa, confere e copia. Devolve { ok, r, copia } ou { ok: false, motivo }.
function migrar(h, resolvidas, espacoLivre) {
  const falta = folgaQueFalta(espacoLivre);
  if (falta) return { ok: false, motivo: `espaço em disco insuficiente para migrar o histórico de decisões: faltam ${falta} bytes (a folga é de ${FOLGA} vezes o decisions.json)` };
  const r = importarHistorico(h, resolvidas, { colunasDaBusca, teto: HIST_LIMIT });
  if (!r.ok) return { ok: false, motivo: `a importação do histórico de decisões para o banco falhou (${r.motivo})` };
  if (r.importadas) compactarWal(h);
  // copiar (e não renomear) deixa o arquivo vivo no lugar até a regravação atômica: uma queda no
  // meio não leva as pendências
  try { return { ok: true, r, copia: fs.existsSync(ARQUIVO()) ? copiarMigrado(ARQUIVO(), usageMod.localDay()) : '' }; } catch (err) {
    return { ok: false, motivo: `o histórico já está no banco, mas não copiei o decisions.json (${err.message}); a próxima subida importa de novo sem duplicar` };
  }
}

function ativar(engine, h) {
  engine.historicoH = h;
  engine.historicoNoBanco = true;
  engine.historicoCache = null;
  engine.decisions.historicoNoBanco = true;
}

function iniciarHistorico(engine, warn = () => { /* sem log */ }, { espacoLivre = espacoLivrePadrao } = {}) {
  if (engine.historicoNoBanco || !engine.decisions) return;
  const log = (nivel, msg) => (typeof engine.log === 'function' ? engine.log(nivel, msg) : warn(msg));
  const marcado = engine.decisions.historicoNoBanco === true;
  const h = abrir();
  if (h.erro) {
    // sem a marca, o banco fora já tem a linha do consumo e o histórico inteiro está no arquivo
    if (marcado) marcarForaDoBanco(engine, `o histórico mora no banco ${TELEMETRIA_DB}, que não abriu: ${h.erro}`);
    return;
  }
  const resolvidas = Array.isArray(engine.decisions.resolved) ? engine.decisions.resolved : [];
  const m = resolvidas.length ? migrar(h, resolvidas, espacoLivre) : { ok: true, r: null };
  if (!m.ok && !marcado) {
    fecharBanco(h);
    log('WARN', `telemetria: ${m.motivo}; o decisions.json não foi tocado; ${SEGUE_NO_JSON}`);
    return;
  }
  if (!m.ok) log('WARN', `telemetria: ${m.motivo}; as decisões que estão no decisions.json ficam nele, por cima do histórico do banco, e entram na próxima gravação`);
  const novaMarca = !marcado;
  ativar(engine, h);
  if (m.ok && m.r) engine.decisions.resolved = [];
  const tiradas = tirarPendenciasJaResolvidas(engine);
  if ((m.ok && m.r) || tiradas || novaMarca) {
    try { writeJsonAtomic(ARQUIVO(), engine.decisions); } catch (err) { log('WARN', `telemetria: regravar o decisions.json sem o histórico falhou (${err.message}); a próxima gravação das decisões tenta de novo`); }
  }
  if (m.ok && m.r) log('INFO', `telemetria: histórico de decisões migrado para telemetria.db: ${resumo(m.r)}; o decisions.json original ficou como ${m.copia}`);
  if (tiradas) log('INFO', `telemetria: ${plural(tiradas, 'pendência já estava', 'pendências já estavam')} no histórico do banco (queda antes de regravar o decisions.json) e ${tiradas === 1 ? 'saiu' : 'saíram'} das pendências`);
}

function fecharHistorico(engine) {
  if (engine && engine.historicoH) fecharBanco(engine.historicoH);
  if (!engine) return;
  engine.historicoH = null;
  engine.historicoNoBanco = false;
  engine.historicoCache = null;
}

export { iniciarHistorico, fecharHistorico, copiarMigrado, FOLGA };
