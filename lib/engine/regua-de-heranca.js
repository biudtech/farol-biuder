// A régua comum de herança (24/11/2026): o que o diff tem de diferente de uma foto (um commit da
// branch de origem) e o que a base mexeu desde o ancestral comum com essa foto. Nasceu dentro da
// herança da production (heranca-de-producao.js, biud-frontend#1822) e saiu para cá quando o sync
// por herança (sync-por-heranca.js) passou a precisar da mesma régua com outra origem.
//
// Todos os lados são SHAs fixos: refs não se movem entre as duas comparações. A comparação do
// GitHub lista no máximo 300 arquivos; no teto, não dá para saber o que ficou de fora, e a
// resposta é null (falta de dado nunca vira herança).
import io from '../io.js';
import { SHA } from '../review-source/contract.js';

const TETO_DA_COMPARACAO = 300;

// null: não deu para ler; NAO_EXISTE: o GitHub disse 404
const NAO_EXISTE = Symbol('nao-existe');
async function ler(engine, conta, args) {
  let env;
  try { env = engine.ghEnv(conta); } catch { return null; /* sem credencial para ler */ }
  const r = await io.run('gh', ['api', ...args], { env });
  if (!r.ok) return /HTTP 404|Not Found/i.test(String(r.stderr || '')) ? NAO_EXISTE : null;
  return io.parseJson(r.stdout, null);
}

function arquivosDe(comparacao) {
  const files = comparacao?.files;
  if (!Array.isArray(files) || files.length >= TETO_DA_COMPARACAO
    || files.some((f) => !f || typeof f.filename !== 'string' || !f.filename
      || (f.previous_filename != null && typeof f.previous_filename !== 'string'))) return null;
  return files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean));
}

const COMPARACAO = '{base: .base_commit.sha, mergeBase: .merge_base_commit.sha, behind: .behind_by, files: [.files[] | {filename, previous_filename}]}';

// A comparação de três pontos `de...para`, ou null quando não deu para ler (404 inclusive).
async function comparar(engine, conta, repo, de, para) {
  const r = await ler(engine, conta, [`repos/${repo}/compare/${de}...${para}?per_page=1`, '--jq', COMPARACAO]);
  return r && r !== NAO_EXISTE && typeof r === 'object' ? r : null;
}

// `de` é ancestral de `para`: nada de `de` falta em `para` e o ancestral comum é o próprio `de`.
// Só então a comparação de três pontos é a diferença contra a ponta.
function ehAncestral(comparacao, de) {
  return !!comparacao && comparacao.behind === 0 && comparacao.base === de && comparacao.mergeBase === de;
}

// O que difere da foto no head (o head tem de conter a foto) e o que a base da resolução mexeu
// desde o ancestral comum com a foto. null quando qualquer lado não deu para saber.
async function compararComAFoto(engine, conta, repo, { foto, head, baseDaResolucao }) {
  if (![foto, head, baseDaResolucao].every((s) => SHA.test(s || ''))) return null;
  const doHead = await comparar(engine, conta, repo, foto, head);
  if (!ehAncestral(doHead, foto)) return null;
  const daBase = await comparar(engine, conta, repo, foto, baseDaResolucao);
  if (daBase?.base !== foto || !SHA.test(daBase.mergeBase || '')) return null;
  const diferemDaFoto = arquivosDe(doHead);
  const mexidosNaBase = arquivosDe(daBase);
  if (!diferemDaFoto || !mexidosNaBase) return null;
  return { diferemDaFoto, mexidosNaBase };
}

export { TETO_DA_COMPARACAO, NAO_EXISTE, ler, comparar, arquivosDe, ehAncestral, compararComAFoto };
