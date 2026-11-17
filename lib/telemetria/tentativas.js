// As tentativas de sessão abertas (o que era usage-tentativas.json) no banco: uma linha por
// tentativa, pela chave que o JSON usava (o attemptId), na ordem em que abriram. Abrir é um
// INSERT, o parcial e o id do provedor são UPSERT da mesma linha, fechar é um DELETE: nada
// regrava o conjunto inteiro. O formato do objeto é o de lib/engine/usage-tentativas.js.
import { paraLinha, deLinha, sqlDeInsercao } from './mapa.js';

const CAMPOS = [
  ['attemptId', 'attempt_id', 'texto'], ['sessionId', 'session_id', 'texto'], ['kind', 'kind', 'texto'],
  ['account', 'account', 'texto'], ['profileId', 'profile_id', 'texto'], ['model', 'model', 'texto'],
  ['providerSessionId', 'provider_session_id', 'texto'], ['ref', 'ref', 'texto'], ['provedor', 'provedor', 'texto'],
  ['abertaEm', 'aberta_em', 'numero'], ['parcial', 'parcial', 'json'], ['parcialEm', 'parcial_em', 'numero'],
];
const ATUALIZAR = CAMPOS.map((c) => `${c[1]} = excluded.${c[1]}`).concat('extra = excluded.extra').join(', ');
const GRAVAR = `${sqlDeInsercao('tentativas', CAMPOS, ['chave'])} ON CONFLICT (chave) DO UPDATE SET ${ATUALIZAR}`;

function gravarTentativa(h, chave, tentativa) {
  const { colunas, extra } = paraLinha(CAMPOS, tentativa);
  h.db.prepare(GRAVAR).run({ ...colunas, chave, extra });
}

function obterTentativa(h, chave) {
  const l = h.db.prepare('SELECT * FROM tentativas WHERE chave = :chave').get({ chave });
  return l ? deLinha(CAMPOS, l) : undefined;
}

function apagarTentativa(h, chave) { return h.db.prepare('DELETE FROM tentativas WHERE chave = :chave').run({ chave }).changes > 0; }

// { chave: tentativa }, na ordem de abertura, como o objeto `tentativas` do JSON
function todasAsTentativas(h) {
  return Object.fromEntries(h.db.prepare('SELECT * FROM tentativas ORDER BY seq').all().map((l) => [l.chave, deLinha(CAMPOS, l)]));
}

function contarTentativas(h) { return h.db.prepare('SELECT COUNT(*) AS n FROM tentativas').get().n; }

export { gravarTentativa, obterTentativa, apagarTentativa, todasAsTentativas, contarTentativas };
