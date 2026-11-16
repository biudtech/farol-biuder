// A consulta do Histórico: o que mora no endereço da página (busca, filtros, página e a
// revisão aberta), o pedido que isso vira no motor e as frases do resultado. Sem React.
//
// A busca e os filtros são do motor (lib/engine/historico-paginado.js, na raiz): a tela manda
// o que a pessoa escolheu e mostra o que voltou. Valor de filtro que a tela não conhece segue
// como veio no endereço, e quem recusa é o motor, dizendo o campo.
import { ehNumero, ehObjeto, ehTexto } from '@/contratos/formas';
import type { Resultado } from '@/transporte/cliente';

export interface Consulta {
  pagina: number;
  q: string;
  // approve, request_changes, comment ou skip; vazio é sem filtro
  veredito: string;
  repo: string;
}

// A revisão aberta no detalhe: o id do item e a chave do PR dele. A chave existe porque o
// motor só busca uma revisão pela chave do PR (GET /api/decision?key=).
export interface DetalheAberto {
  id: string;
  chave: string;
}

export const CONSULTA_VAZIA: Consulta = Object.freeze({ pagina: 1, q: '', veredito: '', repo: '' });

// o mesmo teto do motor para `q` e `repo`
export const TETO_DA_BUSCA = 200;

// só dígitos, até nove: é o que o motor aceita em `page`
const PAGINA = /^[1-9]\d{0,8}$/;

export function lerEndereco(params: Pick<URLSearchParams, 'get'>): { consulta: Consulta; detalhe: DetalheAberto | null } {
  const pagina = params.get('pagina') ?? '';
  const id = params.get('id') ?? '';
  return {
    consulta: {
      pagina: PAGINA.test(pagina) ? Number(pagina) : 1,
      q: params.get('q') ?? '',
      veredito: params.get('veredito') ?? '',
      repo: params.get('repo') ?? '',
    },
    detalhe: id ? { id, chave: params.get('pr') ?? '' } : null,
  };
}

// A query string da tela (sem o `?`), só com o que não é padrão.
export function enderecoDa(consulta: Consulta, detalhe: DetalheAberto | null): string {
  const params = new URLSearchParams();
  if (consulta.q) params.set('q', consulta.q);
  if (consulta.veredito) params.set('veredito', consulta.veredito);
  if (consulta.repo) params.set('repo', consulta.repo);
  if (consulta.pagina > 1) params.set('pagina', String(consulta.pagina));
  if (detalhe) {
    params.set('id', detalhe.id);
    if (detalhe.chave) params.set('pr', detalhe.chave);
  }
  return params.toString();
}

export function temFiltro(consulta: Consulta): boolean {
  return consulta.q !== '' || consulta.veredito !== '' || consulta.repo !== '';
}

// GET /api/decisions com os nomes da rota. O tamanho da página fica no padrão do motor (30).
export function caminhoDaPagina(consulta: Consulta): string {
  const params = new URLSearchParams({ page: String(consulta.pagina) });
  if (consulta.q) params.set('q', consulta.q);
  if (consulta.veredito) params.set('veredito', consulta.veredito);
  if (consulta.repo) params.set('repo', consulta.repo);
  return `/api/decisions?${params.toString()}`;
}

export function caminhoDoDetalhe(chave: string): string {
  return `/api/decision?${new URLSearchParams({ key: chave }).toString()}`;
}

// O que a região viva anuncia depois de cada carga.
export function textoDoResultado(pagina: { total: number; page: number; pages: number }): string {
  if (pagina.total === 0) return 'Nenhuma revisão';
  return `${pagina.total} ${pagina.total === 1 ? 'revisão' : 'revisões'}, página ${pagina.page} de ${pagina.pages}`;
}

export function textoDoVazio(consulta: Consulta): string {
  return temFiltro(consulta)
    ? 'Nenhuma revisão passa pela busca e pelos filtros escolhidos.'
    : 'O motor ainda não resolveu nenhuma revisão.';
}

// Como a tela chama cada parâmetro que o motor pode recusar (CAMPOS, historico-paginado.js).
const CAMPO_RECUSADO: Record<string, string> = {
  page: 'a página pedida',
  pageSize: 'o tamanho da página',
  q: 'a busca',
  veredito: 'o filtro de desfecho',
  repo: 'o filtro de repositório',
};

type Falha = Extract<Resultado<never>, { ok: false }>;

// A frase de uma leitura que falhou. Vazia no cancelamento, que não é erro.
export function mensagemDaFalha(falha: Falha): string {
  switch (falha.falha) {
    case 'cancelado': return '';
    case 'rede': return 'Não deu para falar com o motor (falha de rede).';
    case 'nao_autenticado': return 'A sessão deste navegador não vale mais no motor. Pareie de novo.';
    case 'resposta_invalida': return 'O motor respondeu fora do formato esperado.';
    case 'recusado': {
      const detalhe = falha.detalhe;
      if (detalhe?.codigo !== 'parametro_invalido') return `O motor recusou o pedido (HTTP ${falha.status}${detalhe ? `, ${detalhe.codigo}` : ''}).`;
      if (detalhe.campo === undefined) return 'O motor recusou um parâmetro do pedido e não disse qual.';
      const nome = Object.hasOwn(CAMPO_RECUSADO, detalhe.campo) ? CAMPO_RECUSADO[detalhe.campo] : undefined;
      return nome ? `O motor recusou ${nome} (campo "${detalhe.campo}").` : `O motor recusou o campo "${detalhe.campo}".`;
    }
  }
}

// A recusa é de parâmetro: mudar a busca ou os filtros resolve, tentar de novo não.
export function ehRecusaDeParametro(falha: Falha): boolean {
  return falha.falha === 'recusado' && falha.detalhe?.codigo === 'parametro_invalido';
}

export function textoDaDuracao(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return 'menos de 1 s';
  const segundos = Math.round(ms / 1000);
  if (segundos < 60) return `${segundos} s`;
  const resto = segundos % 60;
  return resto ? `${Math.floor(segundos / 60)} min ${resto} s` : `${Math.floor(segundos / 60)} min`;
}

// A marca das resolvidas do snapshot (`decisions.resolved`, as 30 mais recentes, a mais nova
// primeiro): o id e a hora da primeira. Serve só para a tela perceber que entrou revisão nova
// desde a última carga da lista. null quando o snapshot ainda não trouxe a chave.
export function marcaDasResolvidas(resolvidas: readonly unknown[] | undefined): string | null {
  if (!resolvidas) return null;
  if (resolvidas.length === 0) return 'vazio';
  const topo = resolvidas[0];
  if (!ehObjeto(topo)) return '@';
  return `${ehTexto(topo.id) ? topo.id : ''}@${ehNumero(topo.resolvedAt) ? topo.resolvedAt : ''}`;
}
