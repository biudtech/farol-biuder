// A importação dos JSON do consumo para o banco, na subida (decisão de 16/11/2026).
//
// Todo JSON do consumo (usage-sessions.json, usage-tentativas.json, falhas-sessao.json) presente
// na subida é importado, só com as linhas que o banco ainda não tem, numa transação só, conferida
// antes do COMMIT: o que o banco tem depois é exatamente o que tinha antes mais as linhas que
// faltavam, linha a linha, com a contagem e as somas (sessões, tokens e custo) batendo. Qualquer
// diferença desfaz a transação inteira. Só depois do COMMIT cada JSON é renomeado para
// <nome>.migrado-<dia>, nunca apagado.
//
// Os casos que isso cobre: a primeira subida desta versão (tabela vazia, entra tudo); a subida em
// que o banco não abriu e o motor gravou num JSON novo (entram as linhas daquela subida, e as que
// já estavam no banco ficam como estavam); a queda entre o COMMIT e o rename (nada entra de novo,
// e o arquivo é renomeado). Repetir não duplica. A identidade de cada linha: a chave da sessão
// (chaveDaSessao, consumo.js), a chave da tentativa e o id da falha. Item que não é objeto não
// entra e é contado, para a linha de log dizer.
//
// JSON ilegível ou de formato errado faz a importação falhar sem tocar em nada: quem chama segue
// nos JSON, como antes do banco, e tenta de novo na próxima subida. A linha de log de cada
// desfecho é montada por quem chama (lib/engine/telemetria-do-motor.js).
import fs from 'node:fs';
import path from 'node:path';
import { readJson, safeStringify } from '../io.js';
import { transacao } from './banco.js';
import * as consumo from './consumo.js';
import { gravarTentativa, todasAsTentativas } from './tentativas.js';
import { inserirFalha, todasAsFalhas } from './falhas.js';
import * as historico from './historico.js';

const AUSENTE = Symbol('ausente');
function objeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function ordenado(v) {
  if (Array.isArray(v)) return v.map(ordenado);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenado(v[k])]));
}
const mesmo = (a, b) => safeStringify(ordenado(a)) === safeStringify(ordenado(b));

// O formato de cada arquivo: { dados, ilegiveis } prontos para importar, ou null se o formato não
// é o que o motor grava. Campo da raiz ausente vale vazio, como a carga de antes lia.
function lista(b, campo) {
  const v = objeto(b) ? (b[campo] ?? []) : null;
  return Array.isArray(v) ? { dados: v.filter(objeto), ilegiveis: v.filter((x) => !objeto(x)).length } : null;
}
const FORMATOS = {
  sessoes: (b) => lista(b, 'sessions'),
  tentativas: (b) => {
    const mapa = objeto(b) ? (b.tentativas ?? {}) : null;
    if (!objeto(mapa)) return null;
    const pares = Object.entries(mapa);
    return { dados: Object.fromEntries(pares.filter(([, t]) => objeto(t))), ilegiveis: pares.filter(([, t]) => !objeto(t)).length };
  },
  falhas: (b) => lista(b, 'falhas'),
};

function lerFonte(arquivo, formato) {
  if (!fs.existsSync(arquivo)) return { arquivo, existe: false };
  let aviso = '';
  const bruto = readJson(arquivo, AUSENTE, (m) => { aviso = m; });
  if (bruto === AUSENTE) return { arquivo, existe: true, erro: aviso || `${path.basename(arquivo)} ilegível` };
  const lido = formato(bruto);
  if (!lido) return { arquivo, existe: true, erro: `${path.basename(arquivo)} fora do formato que o motor grava` };
  return { arquivo, existe: true, ...lido };
}

function lerFontes(arquivos) {
  return Object.fromEntries(Object.entries(FORMATOS).map(([nome, f]) => [nome, lerFonte(arquivos[nome], f)]));
}

// Cada fonte: o que o banco tem, o que falta, como gravar e como conferir.
const FONTES = {
  sessoes: {
    antes: (h) => consumo.todasAsSessoes(h),
    faltantes: (antes, dados) => {
      const chaves = new Set(antes.map(consumo.chaveDaSessao));
      return dados.filter((r) => !chaves.has(consumo.chaveDaSessao(r)));
    },
    gravar: (h, faltantes, inserirSessao) => { for (const s of faltantes) inserirSessao(h, s); },
    conferir: (h, antes, faltantes) => {
      const esperado = [...antes, ...faltantes];
      const banco = consumo.somasDasSessoes(h);
      const arquivo = consumo.somasDoDiario(esperado);
      if (!mesmo(banco, arquivo)) throw new Error(`conferência das sessões não fechou: banco ${safeStringify(banco)}, esperado ${safeStringify(arquivo)}`);
      if (!mesmo(consumo.todasAsSessoes(h), esperado)) throw new Error('conferência das sessões não fechou: linha diferente do arquivo');
    },
    tamanho: (faltantes) => faltantes.length,
  },
  tentativas: {
    antes: (h) => todasAsTentativas(h),
    faltantes: (antes, dados) => Object.fromEntries(Object.entries(dados).filter(([chave]) => !Object.hasOwn(antes, chave))),
    gravar: (h, faltantes) => { for (const [chave, t] of Object.entries(faltantes)) gravarTentativa(h, chave, t); },
    conferir: (h, antes, faltantes) => {
      if (!mesmo(todasAsTentativas(h), { ...antes, ...faltantes })) throw new Error('conferência das tentativas não fechou');
    },
    tamanho: (faltantes) => Object.keys(faltantes).length,
  },
  falhas: {
    antes: (h) => todasAsFalhas(h),
    faltantes: (antes, dados) => {
      const ids = new Set(antes.map((f) => safeStringify(f.id)));
      return dados.filter((f) => !ids.has(safeStringify(f.id)));
    },
    gravar: (h, faltantes) => { for (const f of faltantes) inserirFalha(h, f); },
    conferir: (h, antes, faltantes) => {
      if (!mesmo(todasAsFalhas(h), [...antes, ...faltantes])) throw new Error('conferência das falhas não fechou');
    },
    tamanho: (faltantes) => faltantes.length,
  },
};

const tamanhoDosDados = (d) => (Array.isArray(d) ? d.length : Object.keys(d).length);

// Uma fonte, dentro da transação: grava o que falta, confere e soma no relato `r`.
function importarFonte(h, nome, fonte, inserirSessao, r) {
  const f = FONTES[nome];
  const antes = f.antes(h);
  const faltantes = f.faltantes(antes, fonte.dados);
  f.gravar(h, faltantes, inserirSessao);
  f.conferir(h, antes, faltantes);
  r.importadas[nome] = f.tamanho(faltantes);
  r.jaEstavam += tamanhoDosDados(fonte.dados) - f.tamanho(faltantes);
  r.ilegiveis += fonte.ilegiveis;
}

// Importa e confere numa transação. Não renomeia nada. Devolve { ok, motivo?, presentes (as
// fontes a renomear), importadas (linhas novas por fonte), jaEstavam, ilegiveis }. `inserirSessao`
// existe para o teste provar que a conferência desfaz tudo quando uma linha não entra.
function importarConsumo(h, fontes, { inserirSessao = consumo.inserirSessao } = {}) {
  const presentes = Object.keys(FONTES).filter((nome) => fontes[nome]?.existe);
  const erro = presentes.map((nome) => fontes[nome].erro).find(Boolean);
  const vazio = { presentes: [], importadas: {}, jaEstavam: 0, ilegiveis: 0 };
  if (erro) return { ok: false, motivo: erro, ...vazio };
  const r = { ok: true, presentes, importadas: {}, jaEstavam: 0, ilegiveis: 0 };
  try {
    transacao(h, () => { for (const nome of presentes) importarFonte(h, nome, fontes[nome], inserirSessao, r); });
  } catch (err) {
    return { ok: false, motivo: err.message, ...vazio };
  }
  return r;
}

function destinoLivre(arquivo, dia) {
  const base = `${arquivo}.migrado-${dia}`;
  let destino = base;
  for (let n = 2; fs.existsSync(destino); n++) destino = `${base}-${n}`;
  return destino;
}

// Renomeia cada JSON importado. Devolve os erros (o dado já está no banco; o arquivo fica, e a
// próxima subida o importa de novo sem duplicar e tenta o rename outra vez).
function renomearMigrados(fontes, presentes, dia) {
  const erros = [];
  for (const nome of presentes) {
    const { arquivo } = fontes[nome];
    try { fs.renameSync(arquivo, destinoLivre(arquivo, dia)); } catch (err) { erros.push(`${path.basename(arquivo)}: ${err.message}`); }
  }
  return erros;
}

const inserirSessaoPadrao = consumo.inserirSessao;

// O histórico das decisões (lote 2, 17/11/2026): o `resolved` do decisions.json, que a carga da
// Engine já leu (`resolvidas`, da mais nova para a mais antiga). Entra só o que o banco ainda não
// tem (pela chave da decisão), da mais antiga para a mais nova, numa transação conferida antes do
// COMMIT: a contagem fecha (antes mais as que entraram) e cada linha nova, lida de volta, é a
// decisão do arquivo, campo a campo, com o `leve` igual ao recorte dela. Qualquer diferença
// desfaz tudo. Depois da conferência vale o teto (`teto`, o HIST_LIMIT de decision.js). Item que
// não é objeto não entra e é contado. Quem chama cuida da cópia e da regravação do arquivo.
function importarHistorico(h, resolvidas, { colunasDaBusca, teto, inserir = historico.inserirDecisao }) {
  const objetos = (Array.isArray(resolvidas) ? resolvidas : []).filter(objeto);
  const r = { ok: true, importadas: 0, jaEstavam: 0, ilegiveis: (resolvidas || []).length - objetos.length, podadas: 0 };
  try {
    transacao(h, () => {
      const nAntes = historico.contarDecisoes(h);
      const seqAntes = historico.maiorSeq(h);
      const faltantes = faltantesDoHistorico(h, objetos, r);
      for (const item of faltantes) inserir(h, item, colunasDaBusca);
      conferirHistorico(h, faltantes, nAntes, seqAntes);
      r.importadas = faltantes.length;
      r.podadas = historico.podarDecisoes(h, teto);
    });
  } catch (err) {
    return { ok: false, motivo: err.message, importadas: 0, jaEstavam: 0, ilegiveis: r.ilegiveis, podadas: 0 };
  }
  return r;
}

// As que o banco não tem, da mais antiga para a mais nova; a repetida dentro do arquivo conta
// como já presente.
function faltantesDoHistorico(h, objetos, r) {
  const chaves = historico.chavesDasDecisoes(h);
  const faltantes = [];
  for (const item of [...objetos].reverse()) {
    const chave = historico.chaveDaDecisao(item);
    if (chaves.has(chave)) { r.jaEstavam++; continue; }
    chaves.add(chave);
    faltantes.push(item);
  }
  return faltantes;
}

function conferirHistorico(h, faltantes, nAntes, seqAntes) {
  const n = historico.contarDecisoes(h);
  if (n !== nAntes + faltantes.length) throw new Error(`conferência do histórico não fechou: ${n} decisões no banco, esperadas ${nAntes + faltantes.length}`);
  let i = 0;
  for (const linha of historico.decisoesDepoisDe(h, seqAntes)) {
    const esperado = faltantes[i++];
    if (!esperado || !mesmo(linha.item, esperado) || !mesmo(linha.leve, historico.leveDe(esperado)) || linha.chave !== historico.chaveDaDecisao(esperado)) {
      throw new Error(`conferência do histórico não fechou: a decisão ${i} gravada difere do arquivo`);
    }
  }
  if (i !== faltantes.length) throw new Error(`conferência do histórico não fechou: ${i} decisões novas no banco, esperadas ${faltantes.length}`);
}

export { lerFontes, importarConsumo, renomearMigrados, inserirSessaoPadrao, importarHistorico };
