// Como o Radar escreve o que o motor manda: nomes, datas, rótulos e frases. Só formata: a
// ordem, a elegibilidade, o veredito e o motivo chegam prontos no snapshot.
import type { DetalheDaEspera, Estacionado, Pendencia, TipoDeMotivo } from '@/contratos/radar';

// Lê um mapa de rótulos por um valor que veio do motor: só propriedade própria vale, para um
// valor como "constructor" não achar o que o protótipo tem.
function proprio<T>(mapa: Record<string, T>, chave: string | undefined): T | undefined {
  return chave !== undefined && Object.hasOwn(mapa, chave) ? mapa[chave] : undefined;
}

const CHAVE_DE_PR = /^([^#\s]+\/[^#\s]+)#(\d+)$/;

// 'dono/repo#12' vira 'PR #12 de dono/repo': é o nome que os botões dizem em voz alta.
export function nomeDoPr(chave: string): string {
  const partes = CHAVE_DE_PR.exec(chave);
  return partes ? `PR #${partes[2]} de ${partes[1]}` : `PR ${chave}`;
}

// A URL só vira link quando aponta para o GitHub por HTTPS. Qualquer outra coisa (outro
// esquema, outro host, um host que só começa parecido) fica como texto.
export function linkDoPr(url: string | undefined): string | null {
  return typeof url === 'string' && url.startsWith('https://github.com/') ? url : null;
}

const URL_DE_PR = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:[/?#]\S*)?$/;

// A URL que o campo de revisão sob demanda aceita. Devolve a chave do PR, ou null.
export function chaveDaUrlDePr(texto: string): string | null {
  const partes = URL_DE_PR.exec(texto.trim());
  return partes ? `${partes[1]}#${partes[2]}` : null;
}

function instante(valor: number | string | null | undefined): number {
  if (typeof valor === 'number') return valor;
  return typeof valor === 'string' && valor ? Date.parse(valor) : Number.NaN;
}

function formatar(valor: number | string | null | undefined, opcoes: Intl.DateTimeFormatOptions, fuso?: string): string {
  const ms = instante(valor);
  // 0 é o que o motor grava quando não sabe a hora
  if (!Number.isFinite(ms) || ms <= 0) return '';
  return new Intl.DateTimeFormat('pt-BR', { ...opcoes, timeZone: fuso }).format(ms);
}

// Dia, mês, hora e minuto, no fuso do navegador (o `fuso` existe para o teste). Vazio quando
// o motor não mandou a hora.
export function dataHora(valor: number | string | null | undefined, fuso?: string): string {
  return formatar(valor, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }, fuso);
}

export function hora(valor: number | string | null | undefined, fuso?: string): string {
  return formatar(valor, { hour: '2-digit', minute: '2-digit', second: '2-digit' }, fuso);
}

// De quem é cada motivo de uma pendência (REASON_KINDS, lib/engine/public-review.js).
export const ROTULO_DO_MOTIVO: Record<TipoDeMotivo, string> = {
  gate: 'Regra do motor',
  content: 'Ponto da revisão',
  infra: 'Falha ao publicar',
};

const PARECER: Record<string, string> = {
  approve: 'Parecer da revisão: aprovar',
  request_changes: 'Parecer da revisão: pedir mudanças',
};

export function textoDoParecer(veredito: string | undefined): string {
  return proprio(PARECER, veredito) ?? '';
}

export function textoDaRetentativa(tentativa: NonNullable<Pendencia['postRetry']>): string {
  return tentativa.exhausted
    ? `A publicação falhou e o motor desistiu de tentar sozinho depois de ${tentativa.attempts} tentativa(s).`
    : 'A publicação falhou e o motor está tentando de novo sozinho.';
}

// Os motivos de espera que o agendador grava (esperaParaTela, lib/engine/headless-fila.js).
const MOTIVO_DA_ESPERA: Record<string, string> = {
  'aguardando-agendador': 'Aguardando a próxima passagem do agendador',
  'limite-conta': 'Limite de revisões simultâneas da conta atingido',
  'limite-global': 'Limite total de revisões simultâneas atingido',
};

export function textoDaEspera(detalhe: DetalheDaEspera | undefined): string {
  if (!detalhe) return 'Na fila de execução.';
  const motivo = proprio(MOTIVO_DA_ESPERA, detalhe.motivo) ?? 'Motivo da espera ainda não confirmado pelo agendador';
  const vagas = detalhe.ocupadas !== undefined && detalhe.limite !== undefined ? ` (${detalhe.ocupadas}/${detalhe.limite})` : '';
  return `Na fila de execução, posição ${detalhe.posicao} de ${detalhe.total}. ${motivo}${vagas}.`;
}

// Os tipos de parada que o motor grava (parkedParaUi, lib/engine/review.js). Tipo que este
// front não conhece cai na frase de falha, com o motivo que o motor mandou.
const PARADA: Record<string, (motivo: string) => string> = {
  cancelado: () => 'a última sessão foi cancelada',
  autenticacao: () => 'a credencial usada na revisão expirou (renove o login do perfil do Claude)',
  'label-retirada': () => 'a label de revisão foi retirada do PR',
  orcamento: (motivo) => (motivo ? `o orçamento estourou (${motivo})` : 'o orçamento estourou'),
  esgotado: (motivo) => (motivo ? `falhou várias vezes seguidas (último erro: ${motivo})` : 'falhou várias vezes seguidas'),
  legado: () => 'parou sem motivo registrado',
};

export function textoDoEstacionado(parada: Estacionado, fuso?: string): string {
  const motivo = parada.motivo.trim();
  const frase = proprio(PARADA, parada.tipo)?.(motivo) ?? (motivo ? `falhou (${motivo})` : 'falhou');
  const quando = dataHora(parada.at, fuso);
  return `Revisão automática parada${quando ? ` em ${quando}` : ''}: ${frase}. Ela não relança sozinha.`;
}
