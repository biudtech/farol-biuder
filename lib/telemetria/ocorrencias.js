// As ocorrências da revisão no banco (24/11/2026): a revisão que terminou sem publicar e sem
// decisão no histórico, com o motivo dito em português (lib/engine/ocorrencias-da-revisao.js).
// Inserir é uma linha nova no fim, cortando o que passa do teto (as mais antigas saem), numa
// transação. A leitura é pelo período (`at`), da mais nova para a mais antiga.
import { paraLinha, deLinha, sqlDeInsercao } from './mapa.js';
import { transacao } from './banco.js';

const CAMPOS = [
  ['at', 'at', 'inteiro'], ['ref', 'ref', 'texto'], ['sessao', 'sessao', 'texto'],
  ['tipo', 'tipo', 'texto'], ['motivo', 'motivo', 'texto'], ['texto', 'texto', 'texto'],
];
const INSERIR = sqlDeInsercao('ocorrencias', CAMPOS);

function inserirOcorrencia(h, registro, maximo) {
  const { colunas, extra } = paraLinha(CAMPOS, registro);
  transacao(h, () => {
    h.db.prepare(INSERIR).run({ ...colunas, extra });
    h.db.prepare('DELETE FROM ocorrencias WHERE seq NOT IN (SELECT seq FROM ocorrencias ORDER BY seq DESC LIMIT :maximo)').run({ maximo });
  });
}

function ocorrenciasEntre(h, desde, ate, limite) {
  return h.db.prepare('SELECT * FROM ocorrencias WHERE at >= :desde AND at <= :ate ORDER BY at DESC, seq DESC LIMIT :limite')
    .all({ desde, ate, limite }).map((l) => deLinha(CAMPOS, l));
}

function contarOcorrencias(h) { return h.db.prepare('SELECT COUNT(*) AS n FROM ocorrencias').get().n; }

export { inserirOcorrencia, ocorrenciasEntre, contarOcorrencias };
