// A conta revisora e a política dela, sem React. A política decide o que o motor PUBLICA
// sozinho no GitHub (lib/engine/contas-config.js e lib/engine/approval-policy.js, na raiz): a
// tela mostra o que cada valor faz, monta a operação de POST /api/accounts/edit só com o campo
// que mudou e diz, antes do envio, toda mudança que amplia a publicação automática.
//
// A rota aplica a operação sobre a config atual do motor (aplicarEdicao): cada campo de
// `campos` troca o valor que a conta tem, e `owners` troca a lista inteira de organizações.
// Campo que não vai não muda. Campo vazio apagaria o valor e o motor regravaria o padrão (que
// publica sozinho): por isso a tela nunca manda campo vazio.
//
// O que vai é o que A PESSOA alterou nesta edição (camposAlterados): a diferença entre o
// rascunho e o valor que ela viu ao começar a editar. Se outra pessoa mudou outro campo no
// motor nesse meio, ele não vai no corpo e não é revertido.
import type { ContaRevisora } from '@/contratos/sistema';
import type { Refeito } from './rascunho';

// Os valores de cada campo da política (DOMINIO_DA_POLITICA, lib/settings.js). O teste ao lado
// confere contra o motor.
export const DOMINIO_DA_POLITICA = {
  autoReview: [true, false],
  onClean: ['approve', 'wait'],
  onCaveats: ['approve', 'wait'],
  onReject: ['request_changes', 'wait'],
} as const;

export type Desfecho = 'onClean' | 'onCaveats' | 'onReject';

// O valor de cada desfecho com que o motor publica sozinho; o outro é `wait`.
export const PUBLICA: Record<Desfecho, string> = { onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' };

// O que o seletor de cada desfecho oferece: só publicar. O revisor é autônomo e nunca espera
// (desenho de 17/11/2026): a tela não oferece nem manda `wait`. Uma conta que chega do motor
// com `wait` (posto por arquivo ou por API) mostra o valor como está, numa opção desabilitada,
// e a tela só deixa trocar para publicar.
export const OPCOES_DA_TELA: Record<Desfecho, readonly string[]> = { onClean: ['approve'], onCaveats: ['approve'], onReject: ['request_changes'] };

// Duas regras do motor que valem sempre e que o desenho mostra junto da política (17/11/2026). Não
// são configuração: nenhuma chave do config.json as desliga, e por isso a tela as escreve como
// texto, nunca como caixa de marcar. A fonte de cada uma é o motor:
//   - o check obrigatório que também falha no commit atual da base é herdado e não pesa, com ou
//     sem a espera do CI (`separarHerdados`, lib/engine/checks-exigidos.js);
//   - no PR de sincronização entre branches contínuas sem defeito, a falta de card e os itens de
//     processo não são ressalva, e o resultado é limpo (lib/engine/pr-de-sincronizacao.js).
export const REGRAS_FIXAS: readonly { titulo: string; efeito: string }[] = [
  { titulo: 'Check que já falha na base não segura', efeito: 'O check obrigatório que também falha no commit atual da base é herdado e não pesa na decisão.' },
  { titulo: 'Merge-back sem commit próprio sai limpo', efeito: 'No PR de sincronização entre branches contínuas, sem defeito, a falta de card e os itens de processo não viram ressalva.' },
];

export const ROTULO_DO_DESFECHO: Record<Desfecho, string> = {
  onClean: 'Quando a revisão sai limpa (aprovável sem ressalvas)',
  onCaveats: 'Quando a revisão sai com ressalvas (aprovável, com pontos de atenção)',
  onReject: 'Quando a revisão reprova',
};

// O que o motor faz com cada valor, numa linha. O que é limpo, ressalva e reprovação quem
// decide é o motor, depois dos gates; aqui só se escreve o que a política manda fazer.
export function efeitoDoDesfecho(campo: Desfecho, valor: string | undefined): string {
  if (valor === 'wait') return 'Esperar (definido no motor): o motor não publica este desfecho sozinho, e esta tela não tem decisão a oferecer para o PR que fica esperando. Daqui só dá para trocar para publicar; voltar a esperar é só pelo arquivo de configuração ou pela API.';
  if (valor !== PUBLICA[campo]) return 'O motor mandou um valor que esta tela não conhece: ela não diz o que ele faz.';
  if (campo === 'onReject') return 'Publica sozinho o pedido de mudanças (REQUEST_CHANGES) no GitHub, pela conta revisora: o PR fica bloqueado até o autor tratar.';
  return campo === 'onClean'
    ? 'Publica sozinho a aprovação (APPROVE) no GitHub, pela conta revisora.'
    : 'Publica sozinho a aprovação (APPROVE) no GitHub, pela conta revisora, mesmo com ressalvas.';
}

export function rotuloDoValor(campo: Desfecho, valor: string): string {
  if (valor === 'wait') return 'Esperar (definido no motor)';
  if (valor === PUBLICA[campo]) return campo === 'onReject' ? 'Publicar o pedido de mudanças sozinho' : 'Publicar a aprovação sozinho';
  return `${valor} (valor que esta tela não conhece)`;
}

export function efeitoDaRevisaoAutomatica(ligada: boolean | undefined): string {
  if (ligada === true) return 'Ligada: o motor abre sozinho a sessão de revisão de todo PR pedido à conta. O que a revisão concluir segue os três desfechos abaixo.';
  if (ligada === false) return 'Desligada: o PR pedido à conta só entra na fila, e a revisão espera o seu clique em Revisar agora. Uma regra de review por organização ou autor marcada como automática ainda revisa sozinha.';
  return 'O motor não mandou este campo.';
}

// O que está no formulário. Os desfechos são texto para caber o valor que a tela não conhece.
export interface RascunhoDaConta {
  owners: string[];
  autoReview: boolean | undefined;
  onClean: string;
  onCaveats: string;
  onReject: string;
}

export function rascunhoDaConta(conta: ContaRevisora): RascunhoDaConta {
  return { owners: [...conta.owners], autoReview: conta.autoReview, onClean: conta.onClean ?? '', onCaveats: conta.onCaveats ?? '', onReject: conta.onReject ?? '' };
}

// Dois rascunhos são o mesmo quando têm a mesma marca. A ordem das organizações conta: é a
// lista que o motor guarda.
export function marcaDaConta(rascunho: RascunhoDaConta): string {
  return JSON.stringify([rascunho.owners, rascunho.autoReview ?? null, rascunho.onClean, rascunho.onCaveats, rascunho.onReject]);
}

// O nome de uma organização (ou usuário) do GitHub: letras, dígitos e hífen, até 39, sem
// hífen nas pontas.
const ORGANIZACAO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export function organizacaoValida(texto: string): boolean {
  return ORGANIZACAO.test(texto.trim());
}

const semCaixa = (texto: string): string => texto.trim().toLowerCase();

export function temOrganizacao(owners: readonly string[], org: string): boolean {
  return owners.some((outra) => semCaixa(outra) === semCaixa(org));
}

// Os campos que `POST /api/accounts/edit` recebe em `campos`.
export interface CamposDaConta {
  owners?: string[];
  autoReview?: boolean;
  onClean?: string;
  onCaveats?: string;
  onReject?: string;
}

const mesmaLista = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((item, i) => item === b[i]);

// As organizações que vão no corpo: a lista ATUAL do motor, com o que a pessoa acrescentou e
// sem o que ela tirou nesta edição (a diferença entre o rascunho e a lista que ela viu ao
// começar). A organização que outra pessoa pôs ou tirou nesse meio fica como o motor a tem.
export function organizacoesMescladas(vistas: readonly string[], rascunho: readonly string[], atuais: readonly string[]): string[] {
  const tiradas = vistas.filter((org) => !temOrganizacao(rascunho, org));
  const postas = rascunho.filter((org) => !temOrganizacao(vistas, org));
  const mantidas = atuais.filter((org) => !temOrganizacao(tiradas, org));
  return [...mantidas, ...postas.filter((org) => !temOrganizacao(mantidas, org))];
}

const DESFECHOS_EM_ORDEM = ['onClean', 'onCaveats', 'onReject'] as const;

// Os campos que A PESSOA alterou nesta edição: a diferença entre o rascunho e o valor que ela
// viu ao começar (`visto`), nunca a diferença contra a conta de agora. Campo que outra pessoa
// mudou no motor nesse meio não entra, e por isso não é revertido. Só valor do domínio, e só
// o que ainda difere do motor (`conta`), e nunca `wait` (OPCOES_DA_TELA). Com o "limpo" em
// espera (vindo do motor) o "com ressalvas" não vai: o motor o põe em espera sozinho (o com
// ressalvas nunca é mais permissivo que o limpo), e recusaria o pedido de aprovar.
export function camposAlterados(visto: RascunhoDaConta, rascunho: RascunhoDaConta, conta: ContaRevisora): CamposDaConta {
  const campos: CamposDaConta = {};
  if (!mesmaLista(visto.owners, rascunho.owners)) {
    const mescladas = organizacoesMescladas(visto.owners, rascunho.owners, conta.owners);
    if (!mesmaLista(mescladas, conta.owners)) campos.owners = mescladas;
  }
  if (rascunho.autoReview !== undefined && rascunho.autoReview !== visto.autoReview && rascunho.autoReview !== conta.autoReview) campos.autoReview = rascunho.autoReview;
  for (const campo of DESFECHOS_EM_ORDEM) {
    const valor = rascunho[campo];
    if (valor === visto[campo] || valor === (conta[campo] ?? '') || !OPCOES_DA_TELA[campo].includes(valor)) continue;
    if (campo === 'onCaveats' && rascunho.onClean === 'wait') continue;
    campos[campo] = valor;
  }
  return campos;
}

export type CampoEmConflito = 'autoReview' | Desfecho;

// O rascunho refeito sobre o valor novo do motor (useRascunho): o campo que a pessoa não tocou
// passa a ser o do motor; o que ela tocou fica com o valor dela, e entra em `conflitos` quando
// o motor também o mudou, para outro valor. As organizações são mescladas.
export function refazerConta(visto: RascunhoDaConta, rascunho: RascunhoDaConta, novo: RascunhoDaConta): Refeito<RascunhoDaConta> {
  const valor: RascunhoDaConta = { ...novo, owners: organizacoesMescladas(visto.owners, rascunho.owners, novo.owners) };
  const conflitos: CampoEmConflito[] = [];
  for (const campo of ['autoReview', ...DESFECHOS_EM_ORDEM] as const) {
    if (rascunho[campo] === visto[campo]) continue;
    if (campo === 'autoReview') valor.autoReview = rascunho.autoReview;
    else valor[campo] = rascunho[campo];
    if (novo[campo] !== visto[campo] && novo[campo] !== rascunho[campo]) conflitos.push(campo);
  }
  return { valor, conflitos };
}

const NOME_DO_CONFLITO: Record<CampoEmConflito, string> = {
  autoReview: 'Revisão automática',
  onClean: 'Revisão limpa',
  onCaveats: 'Revisão com ressalvas',
  onReject: 'Revisão reprovada',
};

function valorPorExtenso(campo: CampoEmConflito, valor: boolean | string | undefined): string {
  if (campo === 'autoReview') return valor === true ? 'ligada' : valor === false ? 'desligada' : 'sem valor';
  return typeof valor === 'string' && valor !== '' ? rotuloDoValor(campo, valor).toLowerCase() : 'sem valor';
}

// O campo que a pessoa e o motor mudaram, cada um para um valor: a tela mostra os dois. Só
// enquanto os dois ainda diferem.
export function textosDosConflitos(conflitos: readonly string[], conta: ContaRevisora, rascunho: RascunhoDaConta): string[] {
  const saida: string[] = [];
  for (const campo of ['autoReview', ...DESFECHOS_EM_ORDEM] as const) {
    if (!conflitos.includes(campo)) continue;
    const doMotor = campo === 'autoReview' ? conta.autoReview : conta[campo];
    const seu = rascunho[campo];
    if ((doMotor ?? '') === (seu ?? '')) continue;
    saida.push(`${NOME_DO_CONFLITO[campo]}: no motor agora está "${valorPorExtenso(campo, doMotor)}", e no seu formulário, "${valorPorExtenso(campo, seu)}". Salvar grava o seu.`);
  }
  return saida;
}

// O que a tela diz do "com ressalvas" quando o "limpo" está em espera (só pode vir do motor:
// a tela não oferece esperar). O campo do formulário não é mexido: trocar o limpo para
// publicar libera este campo com o valor que ele tinha.
export function notaDasRessalvasTravadas(rascunho: RascunhoDaConta): string {
  const base = 'Esperar (definido no motor): com a revisão limpa em espera, o motor põe esta em espera também (o com ressalvas nunca é mais permissivo que o limpo). Troque a limpa para publicar para liberar este campo.';
  if (rascunho.onCaveats !== 'approve') return base;
  return `${base} Este campo está em "publicar a aprovação sozinho" no formulário e é mostrado em espera enquanto a limpa esperar.`;
}

// O resumo da política na linha fechada: o que o motor faz sozinho hoje.
// Quantos dos três desfechos estão em espera (`wait`, que só se põe por arquivo ou API).
export function desfechosEmEspera(conta: Pick<ContaRevisora, 'onClean' | 'onCaveats' | 'onReject'>): number {
  return DESFECHOS_EM_ORDEM.filter((campo) => conta[campo] === 'wait').length;
}

export function resumoDaPolitica(conta: Pick<ContaRevisora, 'autoReview' | 'onClean' | 'onCaveats' | 'onReject'>): string {
  if (conta.autoReview === false) return 'revisão automática desligada';
  const esperando = desfechosEmEspera(conta);
  if (esperando) return `${esperando} ${esperando === 1 ? 'desfecho espera' : 'desfechos esperam'}, definido no motor`;
  if (conta.autoReview === true && DESFECHOS_EM_ORDEM.every((campo) => conta[campo] === PUBLICA[campo])) return 'publica sozinho';
  return 'política incompleta';
}

// O corpo de POST /api/accounts/edit: a operação de editar, com a conta e os campos.
export function corpoDaConta(user: string, campos: CamposDaConta): { tipo: 'editar'; user: string; campos: CamposDaConta } {
  return { tipo: 'editar', user, campos };
}

// Cada mudança dos campos que AMPLIA o que o motor faz ou publica sozinho, com o efeito
// exato: ligar a revisão automática, trocar o esperar que veio do motor por publicar e
// acrescentar organização. A que reduz (desligar a revisão automática, tirar organização) não
// entra: essa não pede confirmação.
export function ampliacoesDaConta(conta: ContaRevisora, campos: CamposDaConta): string[] {
  const quem = `@${conta.user}`;
  const saida: string[] = [];
  if (campos.autoReview === true && conta.autoReview !== true) {
    saida.push(`Revisão automática ligada: o motor passa a abrir sozinho a sessão de revisão de todo PR pedido a ${quem} nas organizações monitoradas, e o resultado de cada revisão é tratado pelos três desfechos da política, sem clique.`);
  }
  if (campos.onClean === 'approve' && conta.onClean !== 'approve') {
    saida.push(`Revisão limpa: o motor passa a publicar sozinho a aprovação (APPROVE) no GitHub, pela conta ${quem}, em todo PR cuja revisão sair aprovável sem ressalvas.`);
  }
  if (campos.onCaveats === 'approve' && conta.onCaveats !== 'approve') {
    saida.push(`Revisão com ressalvas: o motor passa a publicar sozinho a aprovação (APPROVE) pela conta ${quem} também quando a revisão sair aprovável com ressalvas.`);
  }
  if (campos.onReject === 'request_changes' && conta.onReject !== 'request_changes') {
    saida.push(`Revisão reprovada: o motor passa a publicar sozinho o pedido de mudanças (REQUEST_CHANGES) pela conta ${quem}, o que bloqueia o PR até o autor tratar.`);
  }
  for (const org of campos.owners ?? []) {
    if (temOrganizacao(conta.owners, org)) continue;
    saida.push(`Organização ${org}: o motor passa a buscar os PRs pedidos a ${quem} em ${org} e a tratá-los pela política da conta, inclusive revisando e publicando sozinho onde ela mandar.`);
  }
  return saida;
}

const NOME_DO_CAMPO: Record<keyof CamposDaConta, string> = {
  owners: 'organizações monitoradas',
  autoReview: 'revisão automática',
  onClean: 'revisão limpa',
  onCaveats: 'revisão com ressalvas',
  onReject: 'revisão reprovada',
};

function valorDoCampo(campo: keyof CamposDaConta, campos: CamposDaConta): string {
  if (campo === 'owners') return campos.owners?.length ? campos.owners.join(', ') : 'nenhuma';
  if (campo === 'autoReview') return campos.autoReview ? 'ligada' : 'desligada';
  return campos[campo] === 'wait' ? 'esperar' : 'publicar sozinho';
}

// O pedido numa frase, para o resultado: "revisão limpa: publicar sozinho; organizações
// monitoradas: biudtech, acme".
export function textoDosCampos(campos: CamposDaConta): string {
  return (Object.keys(NOME_DO_CAMPO) as Array<keyof CamposDaConta>)
    .filter((campo) => campos[campo] !== undefined)
    .map((campo) => `${NOME_DO_CAMPO[campo]}: ${valorDoCampo(campo, campos)}`)
    .join('; ');
}

// O nome que a tela dá a um campo que o motor disse ter ignorado.
export function nomeDoCampoDaConta(campo: string): string {
  return Object.hasOwn(NOME_DO_CAMPO, campo) ? NOME_DO_CAMPO[campo as keyof CamposDaConta] : campo;
}

// O que a tela diz do token do GitHub: só a presença, que é o que o motor manda.
export function textoDoToken(tokenOk: boolean | undefined): string {
  if (tokenOk === true) return 'Presente: o motor tem token do gh para esta conta.';
  if (tokenOk === false) return 'Ausente: o motor não tem token do gh para esta conta. Sem ele as buscas são puladas e nada é publicado.';
  return 'O motor não informou.';
}

function lista(itens: readonly string[]): string {
  if (itens.length <= 1) return itens.join('');
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

// A política inteira numa frase, como o motor a aplica hoje (do valor do motor, não do
// rascunho): quem revisa, onde, o que publica em cada desfecho e se há exceção por regra.
export function fraseDaPolitica(conta: Pick<ContaRevisora, 'user' | 'owners' | 'autoReview' | 'onClean' | 'onCaveats' | 'onReject' | 'regras'>): string {
  if (!conta.user) return 'Sem conta revisora, o motor não revisa nada.';
  const onde = conta.owners.length ? `nas organizações ${lista(conta.owners)}` : 'em organização nenhuma (a lista está vazia, e a fila fica vazia)';
  const n = conta.regras.length;
  const excecoes = !n ? '' : n === 1 ? ' A regra por organização e autor vem antes disto.' : ` As ${n} regras por organização e autor vêm antes disto.`;
  if (conta.autoReview === false) {
    return `A revisão automática está desligada: os PRs pedidos a @${conta.user} ${onde} só são revisados no clique.${excecoes}`;
  }
  const esperando = desfechosEmEspera(conta);
  const desfechos = esperando
    ? `${esperando} ${esperando === 1 ? 'desfecho espera' : 'desfechos esperam'} (definido no motor), e o resto é publicado sozinho`
    : 'aprova sozinho o que sai limpo ou com ressalvas e pede mudanças sozinho quando acha defeito, sempre depois dos gates do motor';
  return `O Farol revisa sozinho todo PR pedido a @${conta.user} ${onde}: ${desfechos}.${excecoes}`;
}
