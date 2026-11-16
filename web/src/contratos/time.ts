// O que a tela Time lê do motor (os arquivos citados ficam na raiz do repositório):
// - GET /api/team: os dossiês por autor (parseTeam, lib/workspace.js), a lista inteira, sem
//   página nem filtro, na ordem do motor (a entrada mais recente primeiro);
// - `config.people` do snapshot: o papel e a competência de cada pessoa (parsePeople,
//   lib/parse.js), por login em minúsculas.
//
// Do autor só o `login` é exigido; todo outro campo de forma errada conta como ausente. É dado
// sobre pessoas: o que é descartado aqui é só contado, nunca escrito em registro nenhum.
import { campo, ehObjeto, ehTexto, lerItens, semAusentes, type Leitor, type LeitorDeItem } from './formas';

// Uma entrada do dossiê: o motor grava uma por revisão resolvida (writeMemory,
// lib/engine/decision.js), com o dia (AAAA-MM-DD, em UTC), o PR (`dono/repo#n`), o que foi
// publicado e até dois pontos factuais sobre o trabalho.
export interface EntradaDeMemoria {
  date?: string;
  ref?: string;
  verdict?: string;
  bullets: string[];
}

export interface Autor {
  // o nome do arquivo do dossiê, que é o login do GitHub como o motor o recebeu
  login: string;
  // só quando o título do dossiê traz um nome entre parênteses; senão o motor repete o login
  name?: string;
  entries: EntradaDeMemoria[];
}

export interface Time {
  autores: Autor[];
  // Não vem do motor: quantos autores chegaram sem login e ficaram de fora.
  descartados: number;
}

function lerEntrada(v: unknown): EntradaDeMemoria | undefined {
  if (!ehObjeto(v)) return undefined;
  return semAusentes({
    date: campo(v.date, ehTexto) || undefined,
    ref: campo(v.ref, ehTexto) || undefined,
    verdict: campo(v.verdict, ehTexto) || undefined,
    bullets: Array.isArray(v.bullets) ? v.bullets.filter((b): b is string => ehTexto(b) && b.trim() !== '') : [],
  });
}

export const lerAutor: LeitorDeItem<Autor> = (v) => {
  if (!ehObjeto(v) || !ehTexto(v.login) || !v.login.trim()) return undefined;
  const entries: EntradaDeMemoria[] = [];
  for (const bruta of Array.isArray(v.entries) ? v.entries : []) {
    const entrada = lerEntrada(bruta);
    if (entrada) entries.push(entrada);
  }
  const nome = campo(v.name, ehTexto);
  return semAusentes({ login: v.login, name: nome && nome !== v.login ? nome : undefined, entries });
};

// A resposta 200 de GET /api/team: a lista crua, sem envelope.
export function lerTime(bruto: unknown): Time | null {
  const lido = lerItens(bruto, lerAutor);
  return lido ? { autores: lido.itens, descartados: lido.descartados } : null;
}

// O perfil de review de uma pessoa. Os valores aceitos são os de lib/taxonomy.js (a cópia
// conferida está em src/time/taxonomia.ts); valor que a tela não conhece segue como veio.
export interface Pessoa {
  papel?: string;
  // domínio para nível
  dominios?: Record<string, string>;
}

export type Pessoas = Record<string, Pessoa>;

function lerPessoa(v: unknown): Pessoa | undefined {
  if (!ehObjeto(v)) return undefined;
  const dominios = ehObjeto(v.dominios)
    ? Object.fromEntries(Object.entries(v.dominios).filter((par): par is [string, string] => ehTexto(par[1]) && par[1] !== ''))
    : {};
  return semAusentes({
    papel: campo(v.papel, ehTexto) || undefined,
    dominios: Object.keys(dominios).length ? dominios : undefined,
  });
}

// O mapa de perfis, e quantas entradas não deu para ler. `undefined` quando não é mapa.
export function lerPessoas(v: unknown): { pessoas: Pessoas; ilegiveis: number } | undefined {
  if (!ehObjeto(v)) return undefined;
  const boas: Array<[string, Pessoa]> = [];
  let ilegiveis = 0;
  for (const [login, bruta] of Object.entries(v)) {
    const pessoa = lerPessoa(bruta);
    if (pessoa) boas.push([login, pessoa]);
    else ilegiveis += 1;
  }
  // fromEntries define propriedade própria: um login "__proto__" não mexe no protótipo
  return { pessoas: Object.fromEntries(boas), ilegiveis };
}

// A chave `config` do snapshot, só com o que as telas já leem. O resto da config do motor
// (configParaFora, lib/engine/chave-do-perfil.js) entra aqui quando uma tela precisar.
export interface ConfigDoMotor {
  // ausente quando o motor não mandou o mapa de perfis, ou mandou em outra forma
  people?: Pessoas;
  // Não vem do motor: perfis que chegaram em forma que a tela não lê. Com isto acima de
  // zero a tela não salva perfil, porque o salvar manda a lista inteira e os apagaria.
  peopleIlegiveis?: number;
}

export const lerConfig: Leitor<ConfigDoMotor> = (valor, registrar) => {
  if (!ehObjeto(valor)) return undefined;
  const lido = lerPessoas(valor.people);
  if (!lido) return {};
  if (lido.ilegiveis) registrar(`snapshot: ${lido.ilegiveis} perfil(is) de "config.people" com forma inesperada, descartado(s)`);
  return lido.ilegiveis ? { people: lido.pessoas, peopleIlegiveis: lido.ilegiveis } : { people: lido.pessoas };
};
