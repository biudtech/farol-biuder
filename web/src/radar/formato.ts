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

const URL_DE_PR = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#]\S*)?$/;

// O PR que o campo de revisão sob demanda aceita: a chave e a URL canônica dele, montada do
// dono, do repositório e do número. O que vier depois (`/files`, query, fragmento) sai: o
// motor recebe sempre `https://github.com/<dono>/<repo>/pull/<n>`. Devolve null quando o
// texto não é a URL de um PR do GitHub.
export function prDaUrl(texto: string): { chave: string; url: string } | null {
  const partes = URL_DE_PR.exec(texto.trim());
  if (!partes) return null;
  const [, dono, repo, numero] = partes;
  return { chave: `${dono}/${repo}#${numero}`, url: `https://github.com/${dono}/${repo}/pull/${numero}` };
}

function instante(valor: number | string | null | undefined): number {
  if (typeof valor === 'number') return valor;
  return typeof valor === 'string' && valor ? Date.parse(valor) : Number.NaN;
}

// Um formatador por formato e fuso, criado uma vez: montar um Intl.DateTimeFormat custa caro,
// e o feed pede um por linha.
const FORMATADORES = new Map<string, Intl.DateTimeFormat>();

function formatador(nome: string, opcoes: Intl.DateTimeFormatOptions, fuso: string | undefined): Intl.DateTimeFormat {
  const chave = `${nome}|${fuso ?? ''}`;
  let f = FORMATADORES.get(chave);
  if (!f) {
    f = new Intl.DateTimeFormat('pt-BR', { ...opcoes, timeZone: fuso });
    FORMATADORES.set(chave, f);
  }
  return f;
}

const DIA_E_HORA: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };
const COM_ANO: Intl.DateTimeFormatOptions = { ...DIA_E_HORA, year: 'numeric' };
const SO_HORA: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };

function formatar(valor: number | string | null | undefined, nome: string, opcoes: Intl.DateTimeFormatOptions, fuso?: string): string {
  const ms = instante(valor);
  // 0 é o que o motor grava quando não sabe a hora
  if (!Number.isFinite(ms) || ms <= 0) return '';
  return formatador(nome, opcoes, fuso).format(ms);
}

// Dia, mês, hora e minuto, no fuso do navegador (o `fuso` existe para o teste). Vazio quando
// o motor não mandou a hora.
export function dataHora(valor: number | string | null | undefined, fuso?: string): string {
  return formatar(valor, 'dia', DIA_E_HORA, fuso);
}

// Com o ano: o Histórico guarda até 3.000 revisões e atravessa a virada do ano.
export function dataComAno(valor: number | string | null | undefined, fuso?: string): string {
  return formatar(valor, 'ano', COM_ANO, fuso);
}

export function hora(valor: number | string | null | undefined, fuso?: string): string {
  return formatar(valor, 'hora', SO_HORA, fuso);
}

// A chave de cada linha do feed na lista da tela: a hora da linha e a ordem dela entre as
// que têm a mesma hora. Não usa a posição no feed, que muda quando o motor corta as linhas
// antigas: com ela, toda linha trocaria de chave a cada linha nova.
export function chavesDoFeed(linhas: readonly { t: number }[]): string[] {
  const vistas = new Map<number, number>();
  return linhas.map((linha) => {
    const ordem = vistas.get(linha.t) ?? 0;
    vistas.set(linha.t, ordem + 1);
    return `${linha.t}:${ordem}`;
  });
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
  const posicao = detalhe.posicao !== undefined && detalhe.total !== undefined ? `, posição ${detalhe.posicao} de ${detalhe.total}` : '';
  return `Na fila de execução${posicao}. ${motivo}${vagas}.`;
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
