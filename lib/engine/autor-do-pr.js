// O autor de um PR que chegou sem ele (15/11/2026).
//
// A URL avulsa colada em Revisar, a postagem das sessões e o refazer por chave montam o item
// só com repositório e número. Enquanto existia a lista de Meus PRs, ela provava que o PR era
// da conta. Sem a lista, o item sem autor atravessava a porta de execução e o gate de postagem
// como se fosse de outra pessoa, e só a recusa do GitHub segurava o APPROVE no próprio PR.
//
// Uma leitura por item sem autor, com o token da conta dona. Falha de leitura não prova nada:
// o item segue sem autor, e falta de dado nunca bloqueia.
import io from '../io.js';

async function preencherAutor(engine, pr) {
  if (!pr || pr.author || !pr.url) return pr;
  if (typeof engine?.accountForPr !== 'function' || typeof engine.ghEnv !== 'function') return pr;
  const conta = engine.accountForPr(pr);
  if (!engine.tokenFor?.(conta)) return pr;
  const r = await io.run('gh', ['pr', 'view', pr.url, '--json', 'author'], { env: engine.ghEnv(conta) });
  const j = r.ok ? io.parseJson(r.stdout, null) : null;
  const login = String((j && j.author && j.author.login) || '');
  if (login) pr.author = login;
  return pr;
}

// Os itens de um lote, cada um com o autor que deu para ler. Devolve a mesma lista.
async function comAutor(engine, itens) {
  await Promise.all(itens.map((it) => preencherAutor(engine, it)));
  return itens;
}

export { preencherAutor, comAutor };
export default { preencherAutor, comAutor };
