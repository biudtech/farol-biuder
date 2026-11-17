// A migração do consumo dos JSON para o banco, no boot (decisão de 16/11/2026).
//
// Para cada JSON antigo (usage-sessions.json, usage-tentativas.json, falhas-sessao.json) que
// existe e cuja tabela está vazia, importa tudo numa transação só e confere antes do COMMIT: a
// contagem e as somas (sessões, tokens e custo) e, linha a linha, que o que voltou do banco é o
// que estava no arquivo. Qualquer diferença desfaz a transação inteira. Só depois do COMMIT cada
// JSON importado é renomeado para <nome>.migrado-<dia>, nunca apagado.
//
// JSON presente com a tabela já preenchida não é importado (repetir não duplica): é estado
// anormal (o arquivo voltou, ou um rename anterior falhou depois do COMMIT), o banco vale e o
// arquivo fica onde está. JSON ilegível ou de formato errado faz a migração falhar sem tocar em
// nada: quem chama segue nos JSON, como antes do banco, e tenta de novo na próxima subida. A
// linha de log de cada desfecho é montada por quem chama (lib/engine/telemetria-do-motor.js).
import fs from 'node:fs';
import path from 'node:path';
import { readJson, safeStringify } from '../io.js';
import { transacao } from './banco.js';
import * as consumo from './consumo.js';
import { gravarTentativa, todasAsTentativas, contarTentativas } from './tentativas.js';
import { inserirFalha, todasAsFalhas, contarFalhas } from './falhas.js';

const AUSENTE = Symbol('ausente');
function objeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function ordenado(v) {
  if (Array.isArray(v)) return v.map(ordenado);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenado(v[k])]));
}
const mesmo = (a, b) => safeStringify(ordenado(a)) === safeStringify(ordenado(b));

// O formato de cada arquivo: devolve os dados prontos para importar, ou null se o formato não é o
// que o motor grava. Campo da raiz ausente vale vazio, como a carga de antes lia.
const FORMATOS = {
  sessoes: (b) => {
    const lista = objeto(b) ? (b.sessions ?? []) : null;
    return Array.isArray(lista) ? lista.filter(objeto) : null;
  },
  tentativas: (b) => {
    const mapa = objeto(b) ? (b.tentativas ?? {}) : null;
    return objeto(mapa) ? Object.fromEntries(Object.entries(mapa).filter(([, t]) => objeto(t))) : null;
  },
  falhas: (b) => {
    const lista = objeto(b) ? (b.falhas ?? []) : null;
    return Array.isArray(lista) ? lista.filter(objeto) : null;
  },
};

function lerFonte(arquivo, formato) {
  if (!fs.existsSync(arquivo)) return { arquivo, existe: false };
  let aviso = '';
  const bruto = readJson(arquivo, AUSENTE, (m) => { aviso = m; });
  if (bruto === AUSENTE) return { arquivo, existe: true, erro: aviso || `${path.basename(arquivo)} ilegível` };
  const dados = formato(bruto);
  if (!dados) return { arquivo, existe: true, erro: `${path.basename(arquivo)} fora do formato que o motor grava` };
  return { arquivo, existe: true, dados };
}

function lerFontes(arquivos) {
  return Object.fromEntries(Object.entries(FORMATOS).map(([nome, f]) => [nome, lerFonte(arquivos[nome], f)]));
}

const CONTAR = { sessoes: consumo.contarSessoes, tentativas: contarTentativas, falhas: contarFalhas };

// O que importar, o que está em conflito e o primeiro erro de leitura.
function planejar(h, fontes) {
  const plano = { importar: [], conflitos: [], erro: '' };
  for (const [nome, fonte] of Object.entries(fontes)) {
    if (!fonte.existe) continue;
    if (fonte.erro) { plano.erro ||= fonte.erro; continue; }
    if (CONTAR[nome](h) > 0) plano.conflitos.push(nome);
    else plano.importar.push(nome);
  }
  return plano;
}

function conferir(h, nome, fonte) {
  if (nome === 'sessoes') {
    const banco = consumo.somasDasSessoes(h);
    const arquivo = consumo.somasDoDiario(fonte.dados);
    if (!mesmo(banco, arquivo)) throw new Error(`conferência das sessões não fechou: banco ${safeStringify(banco)}, arquivo ${safeStringify(arquivo)}`);
    if (!mesmo(consumo.todasAsSessoes(h), fonte.dados)) throw new Error('conferência das sessões não fechou: linha diferente do arquivo');
    return;
  }
  const lido = nome === 'tentativas' ? todasAsTentativas(h) : todasAsFalhas(h);
  const n = nome === 'tentativas' ? Object.keys(fonte.dados).length : fonte.dados.length;
  const contado = nome === 'tentativas' ? Object.keys(lido).length : lido.length;
  if (contado !== n || !mesmo(lido, fonte.dados)) throw new Error(`conferência das ${nome} não fechou: ${contado} no banco, ${n} no arquivo`);
}

function inserirTodas(h, nome, fonte, inserirSessao) {
  if (nome === 'sessoes') for (const s of fonte.dados) inserirSessao(h, s);
  else if (nome === 'tentativas') for (const [chave, t] of Object.entries(fonte.dados)) gravarTentativa(h, chave, t);
  else for (const f of fonte.dados) inserirFalha(h, f);
}

// Importa e confere numa transação. Não renomeia nada. `inserirSessao` existe para o teste
// provar que a conferência desfaz tudo quando uma linha não entra.
function importarConsumo(h, fontes, { inserirSessao = consumo.inserirSessao } = {}) {
  const plano = planejar(h, fontes);
  if (plano.erro) return { ok: false, motivo: plano.erro, importados: [], conflitos: plano.conflitos };
  try {
    transacao(h, () => {
      for (const nome of plano.importar) inserirTodas(h, nome, fontes[nome], inserirSessao);
      for (const nome of plano.importar) conferir(h, nome, fontes[nome]);
    });
  } catch (err) {
    return { ok: false, motivo: err.message, importados: [], conflitos: plano.conflitos };
  }
  return { ok: true, importados: plano.importar, conflitos: plano.conflitos };
}

function destinoLivre(arquivo, dia) {
  const base = `${arquivo}.migrado-${dia}`;
  let destino = base;
  for (let n = 2; fs.existsSync(destino); n++) destino = `${base}-${n}`;
  return destino;
}

// Renomeia cada JSON importado. Devolve os erros (o dado já está no banco; o arquivo fica).
function renomearMigrados(fontes, importados, dia) {
  const erros = [];
  for (const nome of importados) {
    const { arquivo } = fontes[nome];
    try { fs.renameSync(arquivo, destinoLivre(arquivo, dia)); } catch (err) { erros.push(`${path.basename(arquivo)}: ${err.message}`); }
  }
  return erros;
}

const inserirSessaoPadrao = consumo.inserirSessao;

export { lerFontes, importarConsumo, renomearMigrados, inserirSessaoPadrao };
