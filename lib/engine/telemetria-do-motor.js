// A carga do registro de consumo no boot da Engine, a migração dos JSON para o banco da
// telemetria e o fechamento na saída (decisão do dono, 16/11/2026; lib/telemetria/).
//
// O agregado (usage.json) continua JSON: é pequeno e podado (MAX_DAYS), e não se deriva das
// sessões. Medido na instância real em 16/11/2026: o agregado tem 5.568 sessões e 5,44 bilhões de
// tokens de entrada, e o diário 5.567 linhas e 5,34 bilhões, porque o agregado vem de antes do
// diário e tem dias cortados em UTC e camadas sem detalhamento (_resto). Uma consulta sobre as
// sessões mudaria os números da tela.
//
// Desfechos do boot, cada um com no máximo uma linha de log:
//   - banco aberto e nada a migrar (instalação nova ou já migrada): nenhuma linha;
//   - migração feita: uma linha INFO, porque é a mudança de estado que alguém vai perguntar depois
//     (para onde foram os JSON) e acontece uma vez na vida da instalação;
//   - banco que não abre, JSON ilegível ou conferência que não fecha: uma linha WARN com a causa
//     (classe telemetria-anormal, lib/log-taxonomy.js); o motor segue nos JSON, sem perder dado, e
//     tenta de novo na próxima subida;
//   - JSON presente com a tabela já preenchida: uma linha WARN; o banco vale, nada é importado de
//     novo e o arquivo fica onde está.
import { TELEMETRIA_DB } from '../paths.js';
import { readJson } from '../io.js';
import { abrirBanco, fecharBanco } from '../telemetria/banco.js';
import { lerFontes, importarConsumo, renomearMigrados } from '../telemetria/migracao.js';
import usageMod from './usage.js';
import { arquivoDeTentativas } from './usage-tentativas.js';
import { arquivoDeFalhas } from './falhas.js';
import { diario } from './usage-diario.js';

const NOMES = { sessoes: 'usage-sessions.json', tentativas: 'usage-tentativas.json', falhas: 'falhas-sessao.json' };

function plural(n, um, varios) { return `${n} ${n === 1 ? um : varios}`; }

function resumo(fontes, importados) {
  const n = (nome) => {
    if (!importados.includes(nome)) return 0;
    const d = fontes[nome].dados;
    return Array.isArray(d) ? d.length : Object.keys(d).length;
  };
  return `${plural(n('sessoes'), 'sessão', 'sessões')}, ${plural(n('tentativas'), 'tentativa aberta', 'tentativas abertas')} e ${plural(n('falhas'), 'falha', 'falhas')}`;
}

function abrir(log) {
  try { return abrirBanco(TELEMETRIA_DB); } catch (err) {
    log('WARN', `telemetria: o banco ${TELEMETRIA_DB} não abriu (${err.message}); o consumo segue nos arquivos JSON nesta subida e a migração tenta de novo na próxima`);
    return null;
  }
}

// Abre o banco e migra o que houver. Devolve o handle, ou null quando o motor fica nos JSON.
function abrirEMigrar(log, dia) {
  const h = abrir(log);
  if (!h) return null;
  const fontes = lerFontes({ sessoes: usageMod.SESSIONS_FILE, tentativas: arquivoDeTentativas(), falhas: arquivoDeFalhas() });
  const r = importarConsumo(h, fontes);
  if (!r.ok) {
    fecharBanco(h);
    log('WARN', `telemetria: a migração do consumo para o banco falhou (${r.motivo}); nada foi renomeado, o consumo segue nos arquivos JSON nesta subida e a migração tenta de novo na próxima`);
    return null;
  }
  const erros = renomearMigrados(fontes, r.importados, dia);
  const avisos = [
    ...r.conflitos.map((nome) => `${NOMES[nome]} presente com o banco já preenchido, não importado de novo (o banco vale; o arquivo ficou onde está)`),
    ...erros.map((e) => `não renomeei ${e} (os dados já estão no banco)`),
  ];
  if (avisos.length) log('WARN', `telemetria: ${avisos.join('; ')}`);
  else if (r.importados.length) log('INFO', `telemetria: consumo migrado para telemetria.db: ${resumo(fontes, r.importados)}; os JSON antigos ficaram como <nome>.migrado-${dia}`);
  return h;
}

// Chamado no construtor da Engine, no lugar da leitura dos dois JSON do consumo.
function carregarConsumo(engine, warn) {
  engine.usage = { ...usageMod.defaultUsage(), ...readJson(usageMod.USAGE_FILE, {}, warn) };
  const log = (nivel, msg) => (typeof engine.log === 'function' ? engine.log(nivel, msg) : warn(msg));
  engine.telemetria = abrirEMigrar(log, usageMod.localDay());
  engine.usageSessions = engine.telemetria ? null : { ...usageMod.defaultSessions(), ...readJson(usageMod.SESSIONS_FILE, {}, warn) };
}

function fecharTelemetria(engine) {
  if (!engine || !engine.telemetria) return;
  fecharBanco(engine.telemetria);
  engine.telemetria = null;
}

// O diário inteiro, na ordem, de onde ele estiver: para teste e ferramenta.
function sessoesDoDiario(engine) { return diario(engine).todas(); }

export { carregarConsumo, fecharTelemetria, sessoesDoDiario };
