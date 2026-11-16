// O que tem cara de segredo não passa da borda. O front não precisa de token, chave, senha
// nem credencial para nada: do segredo a tela só mostra a presença, que o motor manda como
// booleano (`tokenOk`, `temChave`, `hasCredential`). Se uma resposta ou o snapshot trouxer um
// segredo, por defeito do motor ou por alguém no caminho, ele é descartado aqui, antes de
// entrar no store, e não é devolvido, contado por nome nem registrado.
import { ehBooleano, ehObjeto, ehTexto } from './formas';

// Nome de campo que guarda segredo. `projectKeys` (as chaves de projeto do Jira) não casa:
// o padrão pede "api" antes de "key".
const NOME_DE_SEGREDO = /api[-_]?key|token|secret|segredo|senha|password|passwd|credential|credencial|authorization|private[-_]?key|chave/i;
// Valor com cara de segredo, qualquer que seja o nome do campo: os prefixos das chaves da
// Anthropic, dos tokens do GitHub, do Slack e do Atlassian, e um cabeçalho Bearer.
const VALOR_DE_SEGREDO = /^(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[abprs]-[A-Za-z0-9-]{8,}|ATATT[A-Za-z0-9_=-]{8,}|Bearer\s+\S{8,})/;
// Endereço com usuário (e talvez senha) antes do host.
const ENDERECO_COM_USUARIO = /^[a-z][a-z0-9+.-]*:\/\/[^/?#\s]*@/i;
const FUNDO_MAXIMO = 8;

export function valorDeSegredo(valor: unknown): boolean {
  return ehTexto(valor) && (VALOR_DE_SEGREDO.test(valor.trim()) || ENDERECO_COM_USUARIO.test(valor.trim()));
}

// Uma cópia do valor sem o que tem cara de segredo, e quantas coisas saíram. Sai o campo de
// nome suspeito cujo valor não é booleano (a presença do segredo é booleano, e fica), o texto
// com prefixo de chave ou de token, o endereço com usuário, e o que estiver fundo demais para
// ser conferido. Nada do que sai é devolvido, contado por nome ou registrado.
export function semSegredos(valor: unknown, fundo = 0): { limpo: unknown; descartados: number } {
  if (valorDeSegredo(valor)) return { limpo: undefined, descartados: 1 };
  if (Array.isArray(valor)) {
    if (fundo >= FUNDO_MAXIMO) return { limpo: [], descartados: valor.length ? 1 : 0 };
    const itens: unknown[] = [];
    let descartados = 0;
    for (const item of valor) {
      const lido = semSegredos(item, fundo + 1);
      descartados += lido.descartados;
      if (lido.limpo !== undefined || item === undefined) itens.push(lido.limpo);
    }
    return { limpo: itens, descartados };
  }
  if (!ehObjeto(valor)) return { limpo: valor, descartados: 0 };
  if (fundo >= FUNDO_MAXIMO) return { limpo: {}, descartados: Object.keys(valor).length ? 1 : 0 };
  const pares: Array<[string, unknown]> = [];
  let descartados = 0;
  for (const [nome, bruto] of Object.entries(valor)) {
    if (NOME_DE_SEGREDO.test(nome) && !ehBooleano(bruto)) {
      descartados += 1;
      continue;
    }
    const lido = semSegredos(bruto, fundo + 1);
    descartados += lido.descartados;
    if (lido.limpo !== undefined || bruto === undefined) pares.push([nome, lido.limpo]);
  }
  // fromEntries define propriedade própria: um campo "__proto__" não mexe no protótipo
  return { limpo: Object.fromEntries(pares), descartados };
}

// Texto que a tela mostra: o que tem cara de segredo conta como ausente.
export function textoSeguro(valor: unknown): string | undefined {
  return ehTexto(valor) && !valorDeSegredo(valor) ? valor : undefined;
}
