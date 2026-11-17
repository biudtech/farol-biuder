// "Postadas hoje": das resolvidas que o snapshot traz (`decisions.resolved`, as 30 mais
// recentes, a mais nova primeiro), as que o motor conta como publicadas e que foram resolvidas
// no dia de hoje, no fuso do navegador. Sem React. Nada aqui decide: o desfecho, a hora e o
// que foi publicado chegam prontos; esta tela só corta pelo dia e escreve.
//
// O item é lido pelo mesmo leitor do Histórico (lerRevisao), e o que conta como publicado é a
// mesma régua dele e do motor (foiPublicado, PUBLICADOS de lib/engine/historico-paginado.js).
import { lerRevisao } from '@/contratos/historico';
import type { Tom } from '@/componentes/ui';
import { CONSULTA_VAZIA, enderecoDa } from '@/historico/consulta';
import { ROTULO_DA_ACAO, foiPublicado, textoDoStatus } from '@/historico/rotulos';
import { dia, horaCurta, linkDoPr } from './formato';

export interface Postada {
  id: string;
  chave: string;
  // o título do PR, ou a chave quando o motor não mandou
  titulo: string;
  // hora e minuto da resolução
  hora: string;
  tom: Tom;
  // o que a bolinha quer dizer, em texto (para o leitor de tela)
  rotulo: string;
  // o que saiu no PR e como a revisão foi resolvida, numa frase
  desfecho: string;
  // a revisão aberta no Histórico
  endereco: string;
  // o link do PR, só quando é do GitHub por HTTPS
  url: string | null;
}

// A cor de cada coisa publicada: aprovado verde, pediu mudanças vermelho, comentado âmbar.
const DA_ACAO: Record<string, { tom: Tom; rotulo: string }> = {
  approve: { tom: 'ok', rotulo: 'Aprovado' },
  request_changes: { tom: 'ruim', rotulo: 'Pediu mudanças' },
  comment: { tom: 'aviso', rotulo: 'Comentado' },
};

// O endereço da revisão aberta no Histórico, como a consulta dele monta (src/historico/consulta.ts).
export function enderecoDaRevisao(id: string, chave: string): string {
  return `/historico?${enderecoDa(CONSULTA_VAZIA, { id, chave })}`;
}

// `agora` e `fuso` existem para o teste: a tela usa o relógio e o fuso do navegador.
// `ilegiveis`: itens que o motor mandou e que o leitor descartou (sem id ou sem chave). Não dá
// para saber se eram de hoje: a tela avisa que existem, para a lista vazia não esconder nada.
export function postadasDeHoje(resolvidas: readonly unknown[], agora: number = Date.now(), fuso?: string): { postadas: Postada[]; ilegiveis: number } {
  const hoje = dia(agora, fuso);
  const postadas: Postada[] = [];
  let ilegiveis = 0;
  for (const bruto of resolvidas) {
    const r = lerRevisao(bruto);
    if (!r) {
      ilegiveis += 1;
      continue;
    }
    if (!foiPublicado(r.action) || !hoje || dia(r.resolvedAt, fuso) !== hoje) continue;
    const acao = r.action as string;
    const marca = Object.hasOwn(DA_ACAO, acao) ? DA_ACAO[acao] : undefined;
    if (!marca) continue;
    postadas.push({
      id: r.id,
      chave: r.key,
      titulo: r.pr?.title || r.key,
      hora: horaCurta(r.resolvedAt, fuso),
      tom: marca.tom,
      rotulo: marca.rotulo,
      desfecho: `${ROTULO_DA_ACAO[acao] ?? acao}. ${textoDoStatus(r.status)}.`,
      endereco: enderecoDaRevisao(r.id, r.key),
      url: linkDoPr(r.pr?.url),
    });
  }
  return { postadas, ilegiveis };
}
