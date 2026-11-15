// Login do Claude pela própria tela (20/10/2026; de volta ao motor em 15/11/2026, com a
// assinatura). O motor roda num container, sem terminal e sem janela: é por aqui que o perfil
// de assinatura ganha o login.
//
// Medido com o Claude Code 2.1.295, sem TTY (stdin em pipe): `claude auth login` imprime
//   "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&..."
//   "Paste code here if prompted > "
// e espera o código no stdin. O redirect desse link é a página da Anthropic que MOSTRA o
// código (`platform.claude.com/oauth/code/callback`), então o navegador não precisa estar na
// mesma máquina. Código falso colado no pipe devolve "Login failed: Request failed with
// status code 400" e sai com 1. Zero dependência nova: é o `child_process` do Node
// conversando com o próprio CLI.
//
// O que NÃO foi medido aqui: o login que dá certo (exigiria uma assinatura real), e o CLI
// tentando abrir navegador numa máquina sem nenhum. Por isso o sucesso é o código de saída 0
// e nada mais, e o fim é conferido pelo doctor.
//
// O código colado é credencial de uso único: vai só para o stdin do CLI, nunca para log,
// spawns.log, snapshot ou toast. A saída do CLI também não vai para log (traz o link), e o
// motivo de falha que volta para a tela sai sem o link e sem o código.
//
// UM login por vez no motor: com um em curso, o próximo `iniciar` é recusado (quem está no
// meio do login não perde o link por causa de outro clique, de outra aba ou de outra pessoa).
// O login fica aberto por no máximo TEMPOS.LOGIN_WEB_ABERTO_MS.
import cp from 'node:child_process';
import crypto from 'node:crypto';
import { TEMPOS } from '../constants.js';
import { claudeAuthPosixPrefix } from '../parse.js';
import { pastaDoPerfil, garantirPasta } from './pasta-do-perfil.js';
import { ambienteDoPerfil } from './perfil-assinatura.js';
import { esquecerPasta } from './uso-do-plano.js';

const SAIDA_MAX = 64 * 1024;
const LINK = /https:\/\/\S+\/oauth\/authorize\?\S+/;
// o código que a página da Anthropic mostra é `<código>#<estado>`; nada além disso entra
const CODIGO = /^[A-Za-z0-9._~#-]{8,2048}$/;
// onde o instalador oficial põe o `claude`
const LINHA_DO_PATH = 'export PATH="$HOME/.local/bin:$PATH"';

// PURA: o link de autorização na saída do CLI, ou ''.
function linkDaSaida(texto) {
  const m = String(texto || '').match(LINK);
  return m ? m[0] : '';
}

// PURA: o código como a pessoa colou, sem espaço em volta, ou '' quando não tem a forma.
function codigoValido(v) {
  const s = String(v == null ? '' : v).trim();
  return CODIGO.test(s) ? s : '';
}

// O código é `<código>#<estado>`: sai o inteiro e cada metade (o CLI pode repetir só uma). Metade
// curta demais fica, porque apagá-la comeria letra solta da frase.
const METADE_MINIMA = 8;
function semOCodigo(linha, codigo) {
  const pedacos = [codigo, ...String(codigo || '').split('#')].filter((p) => p && p.length >= METADE_MINIMA);
  return pedacos.reduce((texto, p) => texto.split(p).join(''), linha);
}

// PURA: o motivo da falha que pode ir para a tela. Só a linha "Login failed", sem o link e
// sem o código (se o CLI o repetir na mensagem, ele sai antes de a frase seguir adiante).
function motivoDaFalha(texto, codigo = '') {
  const linha = String(texto || '').split(/\r?\n/).map((l) => l.replace(/^.*?>\s*/, '').trim())
    .find((l) => /^Login failed/i.test(l));
  if (!linha) return 'o Claude Code não aceitou o código';
  return semOCodigo(linha, codigo).replace(/https?:\/\/\S+/g, '').slice(0, 200);
}

function sessoes(engine) {
  if (!engine.loginsWeb) engine.loginsWeb = new Map();
  return engine.loginsWeb;
}

// PURA: a linha do shell POSIX. O `-l` lê /etc/profile e ~/.profile DEPOIS do ambiente
// limpo, e um profile que exporte CLAUDE_CONFIG_DIR ou ANTHROPIC_* gravaria o login em
// outro lugar; por isso a autenticação do perfil é reaplicada depois, como na sessão
// headless (claudeAuthPosixPrefix). ~/.local/bin vai na frente.
function linhaPosix(dir) {
  return `${LINHA_DO_PATH}; ${claudeAuthPosixPrefix({ kind: 'dir', dir })}exec claude auth login`;
}

function encerrar(engine, id, s) {
  s.encerrada = true;
  sessoes(engine).delete(id);
  clearTimeout(s.prazo);
  if (s.fim !== null) return;
  try { process.kill(-s.child.pid, 'SIGKILL'); } catch { /* o processo já saiu */ }
}

// Resolve quando `pronto()` fica verdadeiro (a cada saída ou fim do processo) ou no prazo.
function esperar(s, pronto, prazoMs) {
  return new Promise((resolve) => {
    const fim = () => { clearTimeout(desistir); s.ouvintes = []; resolve(); };
    const desistir = setTimeout(fim, prazoMs);
    if (pronto()) return fim();
    s.ouvintes.push(() => { if (pronto()) fim(); });
  });
}

// A pasta do perfil de assinatura pedido, ou '' (perfil de chave de API, perfil que não
// existe ou pasta que não resolve): só perfil de assinatura utilizável entra por login.
function pastaDoLogin(engine, profileId) {
  const p = (engine.config?.claudeProfiles || []).find((x) => x && x.id === profileId);
  return pastaDoPerfil(p);
}

function ligarProcesso(s) {
  const avisar = () => s.ouvintes.forEach((f) => f());
  const juntar = (b) => { if (s.saida.length < SAIDA_MAX) s.saida += String(b); avisar(); };
  s.child.stdout.on('data', juntar);
  s.child.stderr.on('data', juntar);
  s.child.on('error', () => { s.fim = -1; avisar(); });
  // o CLI pode fechar a entrada enquanto o código chega (EPIPE assíncrono); sem ouvinte o
  // erro derrubaria o engine inteiro. O fim do processo é quem responde, pelo `exit`
  s.child.stdin.on('error', () => { /* o exit do processo decide o resultado */ });
  s.child.on('exit', (code) => { s.fim = code === null ? -1 : code; avisar(); });
}

/**
 * Abre o `claude auth login` na pasta do perfil e devolve o link de autorização.
 * @returns {Promise<{ok: true, loginId: string, url: string} | {ok: false, code: string, motivo: string}>}
 */
function iniciar(engine, profileId, deps = {}) {
  const dir = pastaDoLogin(engine, String(profileId || ''));
  if (!dir) return Promise.resolve({ ok: false, code: 'sem-login', motivo: 'este perfil não entra por login do Claude' });
  // `perfilAberto` deixa a tela oferecer cancelar aquele login (ela pode ter perdido o loginId)
  const [aberto] = sessoes(engine).values();
  if (aberto) return Promise.resolve({ ok: false, code: 'login-em-curso', perfilAberto: aberto.profileId, motivo: 'já há um login do Claude aberto neste Farol; termine ou cancele aquele antes de abrir outro' });
  garantirPasta(dir);
  const spawn = deps.spawn || cp.spawn;
  const child = spawn('/bin/sh', ['-lc', linhaPosix(dir)], { env: ambienteDoPerfil(dir), detached: true, stdio: 'pipe' });
  const id = crypto.randomUUID();
  const s = { child, dir, profileId: String(profileId), saida: '', fim: null, ouvintes: [], prazo: null };
  sessoes(engine).set(id, s);
  s.prazo = setTimeout(() => encerrar(engine, id, s), deps.prazoTotalMs || TEMPOS.LOGIN_WEB_ABERTO_MS);
  s.prazo.unref?.(); // o prazo do login não segura o processo do motor vivo
  ligarProcesso(s);
  return esperar(s, () => linkDaSaida(s.saida) || s.fim !== null, deps.prazoDoLinkMs || TEMPOS.LOGIN_WEB_LINK_MS).then(() => {
    const url = linkDaSaida(s.saida);
    if (url && s.fim === null && !s.encerrada) return { ok: true, loginId: id, url };
    encerrar(engine, id, s);
    return { ok: false, code: 'sem-link', motivo: 'o Claude Code não mostrou o link de login; confira se ele está instalado no motor (ou se o perfil já está logado)' };
  });
}

/**
 * Entrega o código colado ao CLI e espera ele sair.
 * @returns {Promise<{ok: boolean, code?: string, motivo?: string}>}
 */
function enviarCodigo(engine, loginId, codigo, deps = {}) {
  const s = sessoes(engine).get(String(loginId || ''));
  if (!s || s.fim !== null) return Promise.resolve({ ok: false, code: 'expirou', motivo: 'este login não está mais aberto; comece de novo' });
  const c = codigoValido(codigo);
  if (!c) return Promise.resolve({ ok: false, code: 'codigo-invalido', motivo: 'cole o código inteiro, como a página de login mostra' });
  const inicio = s.saida.length;
  s.child.stdin.write(c + '\n');
  return esperar(s, () => s.fim !== null, deps.prazoDoCodigoMs || TEMPOS.LOGIN_WEB_CODIGO_MS).then(() => {
    const fim = s.fim;
    const encerrada = s.encerrada;
    encerrar(engine, String(loginId), s);
    if (encerrada) return { ok: false, code: 'expirou', motivo: 'este login foi encerrado; comece de novo' };
    if (fim === null) return { ok: false, code: 'sem-resposta', motivo: 'o Claude Code não respondeu ao código' };
    if (fim !== 0) return { ok: false, code: 'recusado', motivo: motivoDaFalha(s.saida.slice(inicio), c) };
    // login refeito: o uso do plano e a validade guardados dessa pasta são lidos de novo
    esquecerPasta(engine, s.dir);
    engine.doctor().catch(() => { /* o selo atualiza no próximo doctor */ });
    engine.emit('toast', { kind: 'ok', text: 'Login do Claude feito neste perfil.' });
    return { ok: true };
  });
}

// Cancela pelo id do login ou, sem ele, pelo perfil: a tela que recarregou perdeu o loginId, e
// sem isto o login abandonado seguraria o próximo até o prazo. Idempotente.
function cancelar(engine, loginId, profileId = '') {
  const id = String(loginId || '');
  for (const [chave, s] of [...sessoes(engine)]) {
    if (chave === id || (!id && profileId && s.profileId === String(profileId))) encerrar(engine, chave, s);
  }
  return { ok: true };
}

// Saída ordenada do motor (lib/engine/saida-ordenada.js): o filho do login nasce destacado e
// sobreviveria ao motor, com o link de autorização ainda válido.
function encerrarTodos(engine) {
  for (const [chave, s] of [...sessoes(engine)]) encerrar(engine, chave, s);
}

export default { iniciar, enviarCodigo, cancelar, encerrarTodos, linhaPosix, linkDaSaida, codigoValido, motivoDaFalha };
export { iniciar, enviarCodigo, cancelar, encerrarTodos, linhaPosix, linkDaSaida, codigoValido, motivoDaFalha };
