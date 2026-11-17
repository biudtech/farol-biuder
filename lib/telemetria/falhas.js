// Os motivos de falha por sessão (o que era falhas-sessao.json) no banco, na ordem da lista que
// lib/engine/falhas.js mantém. Registrar é apagar a linha de mesmo id (a repetição fundida sobe
// para o fim com o id do registro anterior) e inserir no fim, cortando o que passa do teto, numa
// transação: o resultado é a mesma lista que o JSON guardava, sem regravá-la inteira.
import { paraLinha, deLinha, sqlDeInsercao } from './mapa.js';
import { transacao } from './banco.js';

const CAMPOS = [
  ['id', 'id', 'texto'], ['at', 'at', 'numero'], ['sessionId', 'session_id', 'texto'], ['attemptId', 'attempt_id', 'texto'],
  ['cliSessionId', 'cli_session_id', 'texto'], ['kind', 'kind', 'texto'], ['account', 'account', 'texto'],
  ['ref', 'ref', 'texto'], ['classe', 'classe', 'texto'], ['motivo', 'motivo', 'texto'],
];
const INSERIR = sqlDeInsercao('falhas', CAMPOS);

function inserirFalha(h, registro) {
  const { colunas, extra } = paraLinha(CAMPOS, registro);
  h.db.prepare(INSERIR).run({ ...colunas, extra });
}

// `substitui`: o registro fundiu uma repetição e herdou o id do anterior, que sai da lista.
function gravarFalha(h, registro, maximo, substitui) {
  transacao(h, () => {
    if (substitui) h.db.prepare('DELETE FROM falhas WHERE seq = (SELECT MIN(seq) FROM falhas WHERE id = :id)').run({ id: registro.id });
    inserirFalha(h, registro);
    h.db.prepare('DELETE FROM falhas WHERE seq NOT IN (SELECT seq FROM falhas ORDER BY seq DESC LIMIT :maximo)').run({ maximo });
  });
}

function todasAsFalhas(h) { return h.db.prepare('SELECT * FROM falhas ORDER BY seq').all().map((l) => deLinha(CAMPOS, l)); }

function contarFalhas(h) { return h.db.prepare('SELECT COUNT(*) AS n FROM falhas').get().n; }

export { inserirFalha, gravarFalha, todasAsFalhas, contarFalhas };
