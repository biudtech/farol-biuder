// O que a tela Time lê do motor (os arquivos citados ficam na raiz do repositório):
// - GET /api/team: os dossiês por autor (parseTeam, lib/workspace.js), a lista inteira, sem
//   página nem filtro, na ordem do motor (a entrada mais recente primeiro);
// - `config.people` do snapshot: o papel e a competência de cada pessoa (parsePeople,
//   lib/parse.js), por login em minúsculas.
//
// Do autor só o `login` é exigido; todo outro campo de forma errada conta como ausente. É dado
// sobre pessoas: o que é descartado aqui é só contado, nunca escrito em registro nenhum.
import { campo, ehObjeto, ehTexto, lerItens, mesmoJson, semAusentes, type Leitor, type LeitorDeItem } from './formas';
import { lerConfigDoSistema, type ConfigDoSistema } from './sistema';

// Uma entrada do dossiê: o motor grava uma por revisão resolvida (writeMemory,
// lib/engine/decision.js), com o dia (AAAA-MM-DD, em UTC), o PR (`dono/repo#n`), o que foi
// publicado e os pontos que a sessão anotou sobre o trabalho (o motor grava os que vierem).
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

// `config.people` como o motor mandou, sem conferir nem tirar nada. É deste mapa que sai o
// corpo de um salvar (comPerfil, src/time/time.ts): o motor troca a lista inteira pelo que
// chega, então o que a tela não entende volta para ele como veio, em vez de sumir.
export type PessoasCruas = Readonly<Record<string, unknown>>;

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

// O mapa de perfis, e quantas pessoas a tela não leu inteiras: a que não é objeto (fica de
// fora) e a que perdeu alguma coisa na leitura (campo que a tela não conhece, valor de forma
// errada), que entra com o que deu para ler. `undefined` quando não é mapa.
export function lerPessoas(v: unknown): { pessoas: Pessoas; ilegiveis: number } | undefined {
  if (!ehObjeto(v)) return undefined;
  const boas: Array<[string, Pessoa]> = [];
  let ilegiveis = 0;
  for (const [login, bruta] of Object.entries(v)) {
    const pessoa = lerPessoa(bruta);
    if (pessoa) boas.push([login, pessoa]);
    if (!pessoa || !mesmoJson(pessoa, bruta)) ilegiveis += 1;
  }
  // fromEntries define propriedade própria: um login "__proto__" não mexe no protótipo
  return { pessoas: Object.fromEntries(boas), ilegiveis };
}

// A chave `config` do snapshot: os perfis de review do Time e o que a tela Sistema usa
// (ConfigDoSistema, ./sistema). O resto da config do motor (configParaFora,
// lib/engine/chave-do-perfil.js) não é guardado: entra aqui quando uma tela precisar.
export interface ConfigDoMotor extends ConfigDoSistema {
  // os perfis lidos, para mostrar; ausente quando o motor não mandou o mapa, ou mandou em
  // outra forma
  people?: Pessoas;
  // o mesmo mapa como veio, para montar o corpo de um salvar
  peopleCru?: PessoasCruas;
  // Não vem do motor: quantas pessoas a tela não leu inteiras. A tela avisa; o salvar segue
  // aberto, porque o corpo sai do mapa cru e não tira ninguém.
  peopleIlegiveis?: number;
}

export const lerConfig: Leitor<ConfigDoMotor> = (valor, registrar) => {
  if (!ehObjeto(valor)) return undefined;
  const config: ConfigDoMotor = lerConfigDoSistema(valor, registrar);
  const lido = lerPessoas(valor.people);
  if (!lido || !ehObjeto(valor.people)) return config;
  // só a contagem vai ao registro: nem login nem valor
  if (lido.ilegiveis) registrar(`snapshot: ${lido.ilegiveis} perfil(is) de "config.people" com campo ou forma que a tela não lê`);
  config.people = lido.pessoas;
  config.peopleCru = valor.people;
  if (lido.ilegiveis) config.peopleIlegiveis = lido.ilegiveis;
  return config;
};
