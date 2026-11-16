// O teto de gasto de um perfil do Claude, sem React. O teto mora dentro do perfil, em
// `config.claudeProfiles`, e POST /api/settings troca a lista INTEIRA de perfis pelo que chega
// (updateSettings, server.js, e normalizeClaudeProfiles, lib/parse.js, na raiz). Por isso o
// corpo sai da lista crua que o motor mandou, só com os três campos do teto do perfil editado
// alterados; os outros perfis, e os outros campos dele, voltam como vieram.
//
// A lista crua não tem a chave de API (o motor manda só `temChave`) nem precisa dela: perfil
// de chave que chega sem chave mantém a guardada (comChaveGuardada,
// lib/engine/chave-do-perfil.js), e a pasta do perfil de assinatura é a do arquivo
// (semPastaDaTela, lib/engine/pasta-do-perfil.js). Nenhum segredo é reenviado.
import { ehObjeto, ehTexto, mesmoJson } from '@/contratos/formas';
import type { PerfilDoClaude, PerfisCrus } from '@/contratos/sistema';
import { dataAceita } from '@/consumo/consulta';
import { diaPorExtenso, dolar } from '@/consumo/formato';

// Os três campos do teto que a tela edita. `null` é sem teto (o campo sai do perfil), zero é
// teto válido, e a data vazia é sem data de corte.
export interface Teto {
  budgetDaily: number | null;
  budgetTotal: number | null;
  budgetSince: string;
}

export function tetoDoPerfil(perfil: Pick<PerfilDoClaude, 'budgetDaily' | 'budgetTotal' | 'budgetSince'>): Teto {
  return { budgetDaily: perfil.budgetDaily ?? null, budgetTotal: perfil.budgetTotal ?? null, budgetSince: perfil.budgetSince ?? '' };
}

export function mesmoTeto(a: Teto, b: Teto): boolean {
  return a.budgetDaily === b.budgetDaily && a.budgetTotal === b.budgetTotal && a.budgetSince === b.budgetSince;
}

// O que está nos campos do formulário: texto, como foi digitado.
export interface RascunhoDoTeto {
  diario: string;
  total: string;
  desde: string;
}

const emTexto = (valor: number | null): string => (valor === null ? '' : String(valor).replace('.', ','));

export function rascunhoDoTeto(teto: Teto): RascunhoDoTeto {
  return { diario: emTexto(teto.budgetDaily), total: emTexto(teto.budgetTotal), desde: teto.budgetSince };
}

// O teto que o motor aceita (tetoValido, lib/parse.js): número finito, de zero para cima.
// Aqui, com até seis dígitos antes da vírgula e duas casas, com vírgula ou ponto.
const VALOR = /^\d{1,6}(?:[.,]\d{1,2})?$/;

function valorEmDolar(texto: string): number | null | undefined {
  const limpo = texto.trim();
  if (limpo === '') return null;
  return VALOR.test(limpo) ? Number(limpo.replace(',', '.')) : undefined;
}

export interface ErrosDoTeto {
  diario?: string;
  total?: string;
  desde?: string;
}

const ERRO_DE_VALOR = 'Use um valor em dólar de zero para cima, com até duas casas (12 ou 12,50). Vazio é sem teto.';

// O rascunho lido: o teto, ou o erro de cada campo que não dá para mandar.
export function lerRascunhoDoTeto(rascunho: RascunhoDoTeto): { teto: Teto; erros: null } | { teto: null; erros: ErrosDoTeto } {
  const diario = valorEmDolar(rascunho.diario);
  const total = valorEmDolar(rascunho.total);
  const desde = rascunho.desde.trim();
  const erros: ErrosDoTeto = {};
  if (diario === undefined) erros.diario = ERRO_DE_VALOR;
  if (total === undefined) erros.total = ERRO_DE_VALOR;
  // o motor descartaria calado a data que não existe (dataDeOrcamento, lib/parse.js)
  if (desde !== '' && !dataAceita(desde)) erros.desde = 'Use um dia que existe, no formato AAAA-MM-DD. Vazio é sem data de corte.';
  if (diario === undefined || total === undefined || erros.desde) return { teto: null, erros };
  return { teto: { budgetDaily: diario, budgetTotal: total, budgetSince: desde }, erros: null };
}

// A marca do rascunho: dois textos que dão o mesmo teto têm a mesma marca ("12,5" e "12.50").
export function marcaDoRascunho(rascunho: RascunhoDoTeto): string {
  const lido = lerRascunhoDoTeto(rascunho);
  return lido.teto ? JSON.stringify([lido.teto.budgetDaily, lido.teto.budgetTotal, lido.teto.budgetSince]) : `!${JSON.stringify(rascunho)}`;
}

function idDoPerfil(bruto: unknown): string | undefined {
  return ehObjeto(bruto) && ehTexto(bruto.id) ? bruto.id : undefined;
}

// A lista de perfis para o corpo de `claudeProfiles`: a crua, com os três campos do teto do
// perfil `id` trocados. `null` quando o perfil não está na lista exatamente uma vez: aí não
// há como montar o corpo sem arriscar outro perfil.
export function comTeto(cru: PerfisCrus, id: string, teto: Teto): unknown[] | null {
  if (cru.filter((bruto) => idDoPerfil(bruto) === id).length !== 1) return null;
  return cru.map((bruto) => {
    if (!ehObjeto(bruto) || bruto.id !== id) return bruto;
    const perfil: Record<string, unknown> = { ...bruto };
    delete perfil.budgetDaily;
    delete perfil.budgetTotal;
    delete perfil.budgetSince;
    if (teto.budgetDaily !== null) perfil.budgetDaily = teto.budgetDaily;
    if (teto.budgetTotal !== null) perfil.budgetTotal = teto.budgetTotal;
    if (teto.budgetSince) perfil.budgetSince = teto.budgetSince;
    return perfil;
  });
}

function tetoDoCru(bruto: unknown): Teto {
  const perfil = ehObjeto(bruto) ? bruto : {};
  return {
    budgetDaily: typeof perfil.budgetDaily === 'number' ? perfil.budgetDaily : null,
    budgetTotal: typeof perfil.budgetTotal === 'number' ? perfil.budgetTotal : null,
    budgetSince: ehTexto(perfil.budgetSince) ? perfil.budgetSince : '',
  };
}

export interface ConferenciaDoTeto {
  // o perfil editado ficou com o teto pedido
  igual: boolean;
  // o teto que ficou gravado no perfil editado; null se ele saiu da lista
  gravado: Teto | null;
  // os ids dos outros perfis que ficaram diferentes do que a tela enviou, saíram da lista ou
  // apareceram sem ter sido enviados
  outros: string[];
}

// A conferência do que voltou de um salvar: a lista que a resposta diz que ficou gravada
// contra a enviada, perfil a perfil. As duas são a projeção que o motor manda para fora (sem
// chave, com `temChave`), então perfil que não foi editado tem de voltar igual.
export function conferirTeto(enviado: PerfisCrus, gravado: PerfisCrus, id: string, pedido: Teto): ConferenciaDoTeto {
  const doGravado = gravado.find((bruto) => idDoPerfil(bruto) === id);
  const ficou = doGravado === undefined ? null : tetoDoCru(doGravado);
  const ids = [...new Set([...enviado, ...gravado].map(idDoPerfil).filter((outro): outro is string => outro !== undefined && outro !== id))];
  const outros = ids.filter((outro) => {
    const a = enviado.filter((bruto) => idDoPerfil(bruto) === outro);
    const b = gravado.filter((bruto) => idDoPerfil(bruto) === outro);
    return a.length !== 1 || b.length !== 1 || !mesmoJson(a[0], b[0]);
  });
  return { igual: ficou !== null && mesmoTeto(ficou, pedido), gravado: ficou, outros };
}

// O teto numa frase: "US$ 20,00 por dia; US$ 300,00 no total, contado desde 01/11/2026".
export function textoDoTeto(teto: Teto): string {
  const partes: string[] = [];
  if (teto.budgetDaily !== null) partes.push(`${dolar(teto.budgetDaily)} por dia`);
  if (teto.budgetTotal !== null) partes.push(`${dolar(teto.budgetTotal)} no total, contado ${teto.budgetSince ? `desde ${diaPorExtenso(teto.budgetSince)}` : 'desde o começo do registro do motor'}`);
  if (!partes.length) return teto.budgetSince ? `sem teto (data de corte ${diaPorExtenso(teto.budgetSince)})` : 'sem teto';
  return partes.join('; ');
}

// O que a mudança faz, para a pergunta de confirmação. O motor compara o gasto do perfil com
// o teto antes de cada sessão automática (budgetBlockedFor, lib/engine/usage.js): teto mais
// baixo, novo ou zerado pode pausar na hora; teto mais alto ou retirado pode soltar o que
// estava pausado.
export function efeitosDoTeto(antes: Teto, depois: Teto): string[] {
  const saida: string[] = [];
  const campos: Array<['budgetDaily' | 'budgetTotal', string]> = [['budgetDaily', 'do dia'], ['budgetTotal', 'total']];
  for (const [campo, nome] of campos) {
    const de = antes[campo];
    const para = depois[campo];
    if (de === para) continue;
    if (para === 0) saida.push(`O teto ${nome} fica em zero: as revisões automáticas deste perfil param já, porque qualquer gasto passa do teto.`);
    else if (para !== null && (de === null || para < de)) saida.push(`O teto ${nome} ${de === null ? 'passa a existir' : 'baixa'} (${dolar(para)}): se o gasto que o motor já contou chegar a ele, as revisões automáticas deste perfil pausam.`);
    else if (para === null) saida.push(`O teto ${nome} sai: o motor deixa de pausar as revisões automáticas deste perfil por esse limite, e o que estava pausado por ele volta a rodar.`);
    else saida.push(`O teto ${nome} sobe (${dolar(para)}): revisões automáticas pausadas por esse limite podem voltar a rodar.`);
  }
  if (antes.budgetSince !== depois.budgetSince) {
    saida.push(depois.budgetSince
      ? `A data de corte passa a ser ${diaPorExtenso(depois.budgetSince)}: o teto total conta só o gasto desse dia em diante.`
      : 'A data de corte sai: o teto total passa a contar todo o gasto que o motor registrou.');
  }
  return saida;
}
