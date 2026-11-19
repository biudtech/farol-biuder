// O painel "De fora da fila" em frases. Sem React. O motor manda cada PR com o motivo e o
// detalhe (lib/engine/de-fora.js); aqui só se escreve: o motivo em destaque, o que aconteceu, e
// quando o PR volta à fila. Quando volta é a regra que o motor já tem para cada motivo (o
// destrave por commit ou pedido novo, a caducidade da label, a regra e o liga e desliga do
// Sistema), dita em texto, sem relógio e sem decidir nada.
import { MOTIVOS_DE_FORA, type Decisivo, type MotivoDeFora, type PrDeFora } from '@/contratos/de-fora';
import { dataHora, fraseDaParada } from './formato';

// A cor do destaque, que repete o título em texto: decisão de gente é o time trabalhando (ok),
// falha é perigo, o que depende de alguém mexer é aviso, e o resto é neutro.
export type TomDoMotivo = 'ok' | 'aviso' | 'falha' | 'neutro';

export interface FraseDoMotivo {
  tom: TomDoMotivo;
  titulo: string;
  detalhe: string;
  volta: string;
}

// O nome de cada filtro do painel.
export const ROTULO_DO_FILTRO: Readonly<Record<MotivoDeFora, string>> = {
  estacionado: 'Parado por falha',
  outra_conta: 'Outra conta revisando',
  decisao_de_gente: 'Revisado por gente',
  pedido_retirado: 'Pedido retirado',
  regra_manual: 'Regra: só no clique',
  auto_desligado: 'Revisar sozinho desligado',
  ignorado: 'Ignorado',
};

const NO_PROXIMO_COMMIT = 'Volta à fila no próximo commit.';

// Quantas horas a label `<conta>:revisando` de outra pessoa vale antes de o motor tratá-la como
// esquecida e voltar a revisar (SINAL_REVISAO_TTL_MS, lib/constants.js). O front não importa a
// constante do motor; o teste confere que as duas batem.
export const VALIDADE_DA_LABEL_HORAS = 3;

// Os tipos de parada que o destrave do motor não devolve sozinho (lib/engine/destrava.js): a
// sessão cancelada é decisão de alguém, e a parada sem motivo gravado não diz se foi cancelamento.
const PARADA_QUE_NAO_VOLTA = new Set(['cancelado', 'legado']);

const quando = (instante: number | string | undefined, fuso?: string): string => {
  const texto = dataHora(instante, fuso);
  return texto ? ` em ${texto}` : '';
};

// "bia", "bia e caio", "bia, caio e davi"
function lista(nomes: readonly string[]): string {
  if (nomes.length < 2) return nomes[0] ?? '';
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

const VERBO: Record<string, { titulo: string; curto: string }> = {
  APPROVED: { titulo: 'aprovou este commit', curto: 'aprovou' },
  CHANGES_REQUESTED: { titulo: 'pediu mudanças neste commit', curto: 'pediu mudanças' },
};

function verbo(d: Decisivo) {
  return d.estado && Object.hasOwn(VERBO, d.estado) ? VERBO[d.estado] : undefined;
}

function decisaoDeGente(item: PrDeFora, fuso?: string): FraseDoMotivo {
  const decisivos = item.detalhe.decisivos ?? [];
  const [primeiro] = decisivos;
  const base = { tom: 'ok' as const, volta: NO_PROXIMO_COMMIT };
  if (!primeiro) return { ...base, titulo: 'Uma pessoa já revisou este commit', detalhe: 'Uma pessoa aprovou ou pediu mudanças neste commit. O Farol não revisa por cima.' };
  const titulo = `${primeiro.quem} ${verbo(primeiro)?.titulo ?? 'revisou este commit'}`;
  if (decisivos.length === 1) {
    const head = item.head ? ` o head ${item.head.slice(0, 7)}` : ' este commit';
    return { ...base, titulo, detalhe: `${primeiro.quem} ${verbo(primeiro)?.curto ?? 'revisou'}${head}${quando(primeiro.em, fuso)}. O Farol não revisa por cima.` };
  }
  const partes = decisivos.map((d) => `${d.quem} ${verbo(d)?.curto ?? 'revisou'}`);
  return { ...base, titulo, detalhe: `${lista(partes)} neste commit. O Farol não revisa por cima.` };
}

function outraConta(item: PrDeFora, fuso?: string): FraseDoMotivo {
  const quem = lista(item.quem ?? []);
  const base = { tom: 'neutro' as const, titulo: 'Outra conta está revisando' };
  if (item.detalhe.fonte === 'saida_de_cena') {
    return {
      ...base,
      detalhe: `${quem || 'Outra conta'} já ${item.quem && item.quem.length > 1 ? 'estavam' : 'estava'} revisando este commit, e o Farol saiu de cena.`,
      volta: NO_PROXIMO_COMMIT,
    };
  }
  return {
    ...base,
    detalhe: `O PR está com a label de revisão de ${quem || 'outra conta'}${item.desde ? ` desde ${dataHora(item.desde, fuso)}` : ''}.`,
    volta: `Volta sozinho se a label sair sem review naquele commit, ou depois de o Farol ver a label por ${VALIDADE_DA_LABEL_HORAS} horas, quando ela vale como esquecida.`,
  };
}

// `source` é a origem que o motor manda (regraDoPr, lib/engine/review-scope.js).
function regraManual(item: PrDeFora): string {
  const { source, organization, author } = item.detalhe;
  if (source === 'autor' && author) return `A regra do autor ${author} manda revisar só no clique.`;
  if (source === 'escopo_desconhecido') return 'Há regra de revisão na conta, mas não deu para saber a organização deste PR. Na dúvida, só no clique.';
  if (source === 'autor_desconhecido') return 'A organização deste PR tem regra por autor, mas não deu para saber o autor deste PR. Na dúvida, só no clique.';
  if (organization) return `A regra da organização ${organization} manda revisar só no clique.`;
  return 'Uma regra da conta manda revisar só no clique.';
}

// O motivo em destaque, o que aconteceu e quando volta. `fuso` existe para o teste: a tela usa o
// do navegador.
export function fraseDoMotivo(item: PrDeFora, fuso?: string): FraseDoMotivo {
  switch (item.motivo) {
    case 'decisao_de_gente': return decisaoDeGente(item, fuso);
    case 'outra_conta': return outraConta(item, fuso);
    case 'estacionado': {
      const frase = fraseDaParada(item.detalhe.tipo, item.detalhe.motivo);
      // "falhou várias vezes seguidas" já é o verbo; o resto pede o "parou"
      const comeco = item.detalhe.tipo === 'esgotado' ? 'A revisão automática' : 'A revisão automática parou:';
      const detalhe = `${comeco} ${frase}${quando(item.desde, fuso)}.`;
      const volta = PARADA_QUE_NAO_VOLTA.has(item.detalhe.tipo ?? 'legado')
        ? 'Não volta sozinho: Revisar mesmo assim abre a revisão.'
        : 'Volta sozinho com commit novo ou pedido novo de revisão.';
      return { tom: 'falha', titulo: 'Parado por falha', detalhe, volta };
    }
    case 'pedido_retirado':
      return {
        tom: 'aviso', titulo: 'Pedido de revisão retirado',
        detalhe: `O pedido de revisão à conta foi retirado${quando(item.desde, fuso)}.`,
        volta: 'Volta quando a revisão for pedida de novo.',
      };
    case 'regra_manual':
      return { tom: 'aviso', titulo: 'Regra: só no clique', detalhe: regraManual(item), volta: 'Não volta sozinho: a regra muda no Sistema.' };
    case 'auto_desligado':
      return {
        tom: 'aviso', titulo: 'Revisar sozinho está desligado',
        detalhe: 'A conta revisora está com o revisar sozinho desligado.',
        volta: 'Volta quando o revisar sozinho for ligado no Sistema.',
      };
    case 'ignorado':
      return {
        tom: 'neutro', titulo: 'Ignorado',
        detalhe: 'Alguém pediu para o Farol ignorar este PR.',
        volta: 'Não volta sozinho: Revisar mesmo assim abre a revisão.',
      };
  }
}

export interface ContagemDoMotivo {
  motivo: MotivoDeFora;
  rotulo: string;
  n: number;
}

// Os filtros do painel: um por motivo com PR, na ordem de precedência do motor.
export function contarPorMotivo(itens: readonly PrDeFora[]): ContagemDoMotivo[] {
  return MOTIVOS_DE_FORA
    .map((motivo) => ({ motivo, rotulo: ROTULO_DO_FILTRO[motivo], n: itens.filter((i) => i.motivo === motivo).length }))
    .filter((c) => c.n > 0);
}

export function filtrarDeFora(itens: readonly PrDeFora[], motivo: MotivoDeFora | null): readonly PrDeFora[] {
  return motivo === null ? itens : itens.filter((i) => i.motivo === motivo);
}
