// Camada HTTP + SSE (Onda 2, colaborador): roteia as chamadas /api/* pros métodos do engine.
// É o "adapter" do lace (traduz request -> chamada de domínio -> resposta); nenhuma regra de
// negócio mora aqui. Recebe o engine pronto. Ver docs/QUALITY.md.
// O motor não serve página (a tela antiga saiu em 16/11/2026): o front é o pacote `web/`, que
// fala com esta API de outra origem. Fora de /api/ todo pedido responde 404 em JSON.
import http from 'node:http';
import { usageActivity } from './engine/usage-activity.js';
import { TEMPOS } from './constants.js';
import { parseTeam } from './workspace.js';
import { tailLog } from './engine/diagnostico.js';
import { triage } from './log-taxonomy.js';
import { validarHostEOrigem, hostDoPedido } from './http-guard.js';
import { aplicarCors, responderPreflight } from './http-cors.js';
import { camposSerializados, mudancas, corpoDoPatch, semMudanca } from './estado-delta.js';
import { safeStringify } from './io.js';
import acesso from './local-auth/acesso.js';
// A rota chama o colaborador direto, com o engine como contexto (o mesmo contrato das
// fachadas da Onda 2), porque o server.js esta no teto de linhas do ratchet e uma fachada
// de uma linha so repassaria a chamada.
import loginWeb from './engine/login-web.js';
import { patchDaTela, configParaFora, recusaDoEndereco } from './engine/chave-do-perfil.js';
import { historicoPaginado } from './engine/historico-paginado.js';

// O schema público limita o texto agregado a 200 kB. A rota mantém folga para
// paths, envelope JSON e UTF-8, além de um teto absoluto contra body sem limite.
const MAX_HTTP_BODY = 3 * 1024 * 1024;

// Corpo que não é objeto (`null`, `0`) vira vazio: com um falsy, quem antecipou a leitura relia o
// stream já consumido e a requisição ficava sem resposta.
function corpoEmJson(data) {
  if (!data) return {};
  try {
    const valor = JSON.parse(data);
    return valor && typeof valor === 'object' ? valor : {};
  } catch { return {}; }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (Buffer.byteLength(data, 'utf8') > MAX_HTTP_BODY) { reject(new Error('body grande demais')); req.destroy(); } });
    req.on('end', () => resolve(corpoEmJson(data)));
    req.on('error', reject);
  });
}

// Corpo das duas respostas de credencial, fora do dispatch de rotas: o literal
// nasce aqui, num nível raso, pra não empilhar mais um objeto na árvore de ifs
// já funda da rota (regra de profundidade do gate de qualidade).
function okResponse(value) { return { ok: !!value }; }

function jiraCredentialResult(ok) { return ok ? { ok: true } : { ok: false, error: 'dados incompletos' }; }

// plano e chaves (A2): a confirmação da adoção é literal, nunca um valor qualquer que seja
// verdadeiro, porque quem grava a configuração da assinatura é a pessoa, não a requisição
function perfilTesteDe(body) { return { profileId: String(body.profileId || '') }; }
// diagnóstico unificado (A3): envelope, para a tela separar "veio vazio" de "a busca falhou"
function diagnosticoResult(engine) { return { ok: true, markdown: engine.diagnosticoMarkdown(), falhas: engine.diagnosticoFalhas() }; }
function reverificarSaude(engine) { return engine.doctor({ forcarVersaoClaude: true }); }
// resposta que já vem com o status decidido pelo colaborador (200 ou a recusa 400 do parâmetro)
function enviarComStatus(send, resposta) { return send(resposta.status, resposta.body); }

// O alvo do pedido como URL, ou null quando não dá para ler (`//`, `//[`, `http://[`). Sem
// isto o `new URL` lançava fora do try do servidor, dentro de uma função assíncrona: rejeição
// sem tratamento, que derruba o processo com um pedido anônimo.
function urlDoPedido(alvo) {
  try { return new URL(alvo, 'http://127.0.0.1'); } catch { return null; }
}

// O corpo da rota de saúde, fixo: diz só que o processo responde. Nada do motor entra aqui
// (versão, caminho, conta, fila, estado de credencial), porque a rota é pública.
const SAUDE = Object.freeze({ ok: true });

function startServer(engine, onReady) {
  // cada stream aberto guarda a própria vigília de credencial (A4): o que perdeu a sessão
  // é encerrado antes do próximo envio, e não recebe mais nada
  const sseClients = new Map();
  // retrato serializado do ultimo estado que CADA cliente recebeu (ver broadcastEstado)
  const estadoDoCliente = new Map();

  function encerrarStream(res) {
    sseClients.delete(res);
    estadoDoCliente.delete(res);
    try { res.end(); } catch { /* cliente já tinha caído */ }
  }

  // escrita num stream que pode ter caído entre o laço e o write: um lugar só, porque
  // agora são dois caminhos de envio (evento comum e estado por diferença)
  function escreverNoStream(res, payload) {
    try { res.write(payload); } catch { /* cliente caiu */ }
  }

  function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${safeStringify(data)}\n\n`;
    for (const [res, valida] of sseClients) {
      if (!valida()) { encerrarStream(res); continue; }
      escreverNoStream(res, payload);
    }
  }

  // O estado vai por DIFERENÇA (lib/estado-delta.js, que tem a medição que motivou
  // isto). Cada cliente carrega o retrato serializado do que já recebeu, porque quem
  // acabou de conectar está num ponto diferente de quem está aberto há uma hora.
  // Cliente sem retrato conhecido leva o snapshot inteiro, que é o caso do primeiro
  // envio e o único jeito de ele ter em que mesclar.
  // O que ESTE cliente recebe: nada (não mudou), o snapshot inteiro (ainda não tem em
  // que mesclar) ou só a diferença. Separado do laço para o corpo do bloco não passar do
  // teto de profundidade do gate de qualidade.
  function eventoDeEstado(res, serializado, estadoInteiro) {
    const anterior = estadoDoCliente.get(res);
    estadoDoCliente.set(res, serializado);
    if (!anterior) return `event: state\ndata: ${estadoInteiro()}\n\n`;
    const diff = mudancas(anterior, serializado);
    // empurrão que não muda nada não vira evento: hoje ele custa o snapshot
    // inteiro e uma repintura completa da tela para dizer o mesmo
    if (semMudanca(diff)) return '';
    return `event: state-patch\ndata: ${corpoDoPatch(serializado, diff)}\n\n`;
  }

  function broadcastEstado(estado) {
    const serializado = camposSerializados(estado);
    // o snapshot inteiro é serializado no máximo UMA vez por empurrão, e só se algum
    // cliente precisar dele
    let cache = null;
    const estadoInteiro = () => (cache = cache ?? safeStringify(estado));
    for (const [res, valida] of sseClients) {
      if (!valida()) { encerrarStream(res); continue; }
      const payload = eventoDeEstado(res, serializado, estadoInteiro);
      if (payload) escreverNoStream(res, payload);
    }
  }

  engine.on('state', s => broadcastEstado(s));
  engine.on('toast', t => broadcast('toast', t));
  ['new-prs', 'auto-approved', 'auto-rejected', 'auto-commented', 'review-started'].forEach(evento => engine.on(evento, p => broadcast(evento, p)));
  engine.on('needs-decision', p => broadcast('needs-decision', p));
  engine.on('focus-pr', p => broadcast('focus-pr', p));
  engine.on('activity', p => broadcast('activity', p));

  const server = http.createServer(async (req, res) => {
    const send = (code, data) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };

    const url = urlDoPedido(req.url);
    if (!url) return send(400, { error: 'bad request' });
    const p = url.pathname;

    // Saúde (fase 2a): o probe do orquestrador chega pelo IP do pod, com um Host que não
    // está em allowlist nenhuma. Por isso responde ANTES da allowlist, e só pode fazer isso
    // porque é GET no caminho exato, com corpo fixo, sem ler o corpo do pedido, sem tocar no
    // engine e sem cabeçalho CORS. Qualquer outro método ou caminho segue para as defesas.
    if (p === '/api/health' && req.method === 'GET') return send(200, SAUDE);

    // C1a: Host e Origin passam pela allowlist ANTES de qualquer rota, o SSE e o 404 de
    // fora de /api inclusive. A porta é a EFETIVA do socket, não a da config (config 0 = efêmera).
    // Fica fora do try de propósito: a função é pura e não lança, e address() nulo
    // (socket já fechado) vira porta inválida e recusa, em vez de derrubar o processo.
    // A recusa não leva cabeçalho CORS, então nenhuma origem de fora ganha leitura.
    const endereco = server.address();
    const { bind, hostPublico, origensPermitidas } = engine.config;
    const guarda = validarHostEOrigem({ host: hostDoPedido(req), origin: req.headers.origin, porta: endereco?.port, bind, hostPublico, origensPermitidas });
    if (!guarda.ok) return send(403, { error: 'forbidden', motivo: guarda.motivo });
    // A origem é uma das configuradas: daqui em diante TODA resposta leva os cabeçalhos CORS
    // (200, 401, 403 do x-farol, 404, 500 e o SSE), porque eles ficam marcados na resposta
    // antes de qualquer rota escrever. Sem Origin, ou com a do loopback, não marca nada.
    aplicarCors(res, guarda.cors);

    try {
      if (p.startsWith('/api/')) {
        // Preflight: depois da allowlist de Host e Origin e ANTES do x-farol e do porteiro,
        // porque o navegador não manda credencial nem cabeçalho próprio num OPTIONS. Não
        // executa rota: todo OPTIONS em /api acaba aqui.
        if (req.method === 'OPTIONS') return responderPreflight(res, guarda.cors);
        if (req.method === 'POST' && req.headers['x-farol'] !== '1') return send(403, { error: 'forbidden' });

        // A4: no modo que exige (sempre, no modo hospedado), todo /api/* pede Authorization
        // válido, exceto o pareamento e o status (lib/local-auth/inventario.js). Fica depois da allowlist
        // de Host (C1a) e do x-farol, para o pareamento herdar as duas proteções, e antes
        // de qualquer rota, para nenhuma leitura, SSE ou ação escapar.
        const recusa = acesso.recusaSemCredencial(req, p, engine.config);
        if (recusa) return send(recusa.status, recusa.body);
        if (p === '/api/auth/status' && req.method === 'GET') return send(200, acesso.statusAutenticacao(req, engine.config));

        if (p === '/api/state') return send(200, engine.snapshot());
        // caixa de revisão por chave: o snapshot manda só as 30 mais recentes (com
        // relatório, cada decisão pesa ~5 KB), então a revisão antiga vem por aqui,
        // sob demanda. Responde ENVELOPE (`{found, decision}`), nunca a decisão
        // crua nem 404: quem chama trata falha de rede e 404 do mesmo jeito, então sem o
        // envelope "não existe essa revisão" e "a busca falhou" ficariam
        // indistinguíveis, que é o M18 (404 engolido) de novo, com outra roupa.
        if (p === '/api/decision' && req.method === 'GET') {
          const d = engine.decisionByKey(String(url.searchParams.get('key') || ''));
          return send(200, { found: !!d, decision: d });
        }
        // O histórico inteiro (até 3.000 resolvidas), uma página por vez, com busca e filtro: a
        // tela de Histórico do front novo. Só leitura, e cada item sai pela mesma projeção do
        // snapshot (lib/engine/historico-paginado.js). As pendentes continuam só no snapshot.
        if (p === '/api/decisions' && req.method === 'GET') return enviarComStatus(send, historicoPaginado(engine, url.searchParams));
        if (p === '/api/team') return send(200, parseTeam());
        if (p === '/api/log') return send(200, tailLog(parseInt(url.searchParams.get('lines'), 10) || 300));
        // MESMO tail da rota acima, já agrupado por lib/log-taxonomy.js. Existe como rota
        // porque quem está fora do motor não importa módulo de lib/. A rota crua fica
        // intocada, com o contrato de array de strings.
        if (p === '/api/log/triage') return send(200, triage(tailLog(parseInt(url.searchParams.get('lines'), 10) || 300)));
        if (p === '/api/diagnostics') return send(200, diagnosticoResult(engine));
        if (p === '/api/doctor') return send(200, await reverificarSaude(engine));
        if (p === '/api/usage' && req.method === 'GET') return send(200, await usageActivity(engine, url.searchParams));

        if (p === '/api/events') {
          // X-Accel-Buffering: quem bufferiza text/event-stream (proxy, antivírus com
          // inspeção de HTTP local) segura até o ping de 25 s, e a aba fica com a
          // conexão "aberta" recebendo nada, que é o pior dos mundos: nem atualiza,
          // nem dispara o onerror que acenderia o aviso de queda.
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          const inicial = engine.snapshot();
          res.write(`event: state\ndata: ${safeStringify(inicial)}\n\n`);
          const vigia = acesso.vigiaDoStream(req, engine.config);
          sseClients.set(res, vigia);
          // a partir daqui este cliente recebe só diferença, contra ESTE retrato
          estadoDoCliente.set(res, camposSerializados(inicial));
          // o batimento também confere: sem envio nenhum, a aba revogada não fica aberta
          // O batimento é EVENTO, não comentário: comentário mantém o socket vivo mas é
          // invisível para o cliente (o EventSource não entrega linha `:`), e sem poder
          // vê-lo a tela não tem como saber que está muda por falha e não por sossego.
          // O cliente usa isto como prova de vida (TEMPOS.SSE_OCIOSO_MS).
          const beat = setInterval(() => {
            if (!vigia()) { clearInterval(beat); encerrarStream(res); return; }
            try { res.write(`event: ping\ndata: ${Date.now()}\n\n`); } catch { }
          }, TEMPOS.SSE_PING_MS);
          req.on('close', () => { clearInterval(beat); sseClients.delete(res); estadoDoCliente.delete(res); });
          return;
        }

        if (req.method !== 'POST') return send(405, { error: 'method' });
        const body = await readBody(req);

        // o token de sessão sai SÓ aqui, no corpo da resposta; nunca em cabeçalho,
        // cookie, URL ou log
        if (p === '/api/auth/pair') return send(200, acesso.parear(body, (m) => engine.log('WARN', m)));
        if (p === '/api/auth/sessions') return send(200, acesso.sessoes(req));
        if (p === '/api/auth/revoke') return send(200, acesso.revogar(req, body));

        if (p === '/api/check') { engine.checkNow(); return send(200, { ok: true }); }
        // POST nas duas, nunca DELETE: a linha 98 acima responde 405 ANTES do corpo
        // ser lido, e o guarda de origem (x-farol) só cobre POST. Nunca ecoe o token
        // na resposta nem no log. `body` vai inteiro pro setCredential porque ele só
        // lê .email/.token (lib/jira/credentials.js); o resto é ignorado.
        if (p === '/api/jira/credential') return send(200, jiraCredentialResult(engine.setJiraCredential(String(body.siteId || ''), body)));
        if (p === '/api/jira/credential/remove') return send(200, okResponse(engine.removeJiraCredential(String(body.siteId || ''))));
        // resposta com ENVELOPE, nunca o objeto cru: a tela precisa distinguir
        // "testou e falhou" de "a chamada não chegou".
        if (p === '/api/jira/test') return send(200, await engine.testarJiraSite(String(body.siteId || '')));
        if (p === '/api/review') {
          // contrato explícito: quem chama SEMPRE manda a lista de PRs. O fallback antigo
          // (sem urls = fila inteira) fazia um {} acidental revisar PRs de todas as
          // contas, fora do escopo visível (achado B22).
          const urls = Array.isArray(body.urls) ? body.urls.filter(u => typeof u === 'string' && u) : [];
          if (!urls.length) return send(400, { error: 'urls é obrigatório: a lista explícita das URLs dos PRs a revisar' });
          // só existe a revisão headless: outro modo no corpo é erro de quem chama, nunca ignorado
          if (body.mode !== undefined && body.mode !== 'auto') return send(400, { error: 'modo_invalido' });
          // 'clique': veio de um humano apertando Revisar, então nunca é barrado
          // pela saída de cena (e desfaz a saída). Ver enqueueHeadless.
          const extras = { lote: body.lote === true };
          return send(200, await engine.launchReview(urls, 'auto', 'clique', extras));
        }
        if (p === '/api/claude/profile-test') return send(200, await engine.claudeTestarPerfil(perfilTesteDe(body)));
        // login da assinatura pela tela: o código colado vai só ao stdin do CLI (lib/engine/login-web.js)
        if (p === '/api/claude/login-web/start') return send(200, await loginWeb.iniciar(engine, String(body.profileId || '')));
        if (p === '/api/claude/login-web/code') return send(200, await loginWeb.enviarCodigo(engine, String(body.loginId || ''), body.code));
        if (p === '/api/claude/login-web/cancel') return send(200, loginWeb.cancelar(engine, String(body.loginId || ''), String(body.profileId || '')));
        if (p === '/api/decide') return send(200, await engine.decide(String(body.id || ''), String(body.action || '')));
        if (p === '/api/ignore') { engine.ignore(String(body.key || '')); return send(200, { ok: true }); }
        if (p === '/api/restore') { engine.restore(String(body.key || '')); return send(200, { ok: true }); }
        if (p === '/api/settings') { const r = recusaDoEndereco(body, engine.config) || engine.updateSettings(patchDaTela(body || {}, engine.config), engine.origemDe(req.headers['user-agent'])); return send(200, { ...r, config: configParaFora(engine.config) }); }
        if (p === '/api/accounts/edit') return send(200, engine.editarConta(body, engine.origemDe(req.headers['user-agent'])));
        if (p === '/api/pushback') return send(200, engine.recordPushback(body || {}));
        if (p === '/api/team/remove') return send(200, engine.removeTeamMember((body || {}).login));
        if (p === '/api/cancel') return send(200, engine.cancelSession(String(body.id || '')));
        return send(404, { error: 'not found' });
      }

      // Fora de /api/ não há nada: nem página, nem arquivo. A resposta é a mesma da rota de
      // API que não existe, em qualquer método, e nunca lê o disco.
      send(404, { error: 'not found' });
    } catch (err) {
      engine.log('ERROR', `http ${p}: ${err.message}`);
      // O SSE escreve o cabeçalho antes de montar o snapshot. Se a resposta já começou, não há
      // como mandar 500: outro writeHead lançaria AQUI, fora de qualquer try, e a rejeição sem
      // tratamento derrubaria o processo. Fecha a conexão, e o cliente reconecta.
      // Antes, tira a resposta dos dois mapas: o erro pode ter vindo depois do registro do
      // cliente e antes do ouvinte de `close`, e a entrada ficaria lá para sempre.
      if (res.headersSent) { sseClients.delete(res); estadoDoCliente.delete(res); return res.destroy(); }
      send(500, { error: err.message });
    }
  });

  // config.bind chega saneado do construtor da Engine. O listen quer o IPv6 sem os
  // colchetes, que só existem na forma do cabeçalho Host e da URL.
  const bind = engine.config.bind;
  server.listen(engine.config.port, bind.replace(/^\[(.*)\]$/, '$1'), () => {
    const url = `http://${bind}:${engine.config.port}`;
    if (onReady) onReady(url);
  });
  server.on('error', (err) => {
    engine.log('ERROR', `servidor http: ${err.message}`);
    if (onReady) onReady(null, err);
  });
  return server;
}

export default { startServer };
export { startServer };
