// O ritmo da revisão, sem React: com que frequência o motor olha o GitHub, se a rodada nova de um
// PR continua a conversa da anterior, e se a contestação do autor é analisada sozinha. São três
// preferências de topo de `config` (SETTINGS, lib/settings.js, na raiz), e POST /api/settings
// mescla por chave: o corpo leva só o que a pessoa alterou, e a resposta é conferida contra ele.
// Nenhuma das três muda o que o motor publica no GitHub.
import type { ConfigDoSistema } from '@/contratos/sistema';

// A faixa de `intervalSeconds` (o saneador da tabela, lib/settings.js): fora dela o motor ajusta
// para a ponta. O teste ao lado confere contra o motor.
export const INTERVALO_MINIMO = 180;
export const INTERVALO_MAXIMO = 3600;
export const INTERVALOS = [180, 300, 600, 900, 1800, 3600] as const;

export interface Ritmo {
  intervalSeconds: number;
  reReviewResume: boolean;
  autoPushback: boolean;
}

export const CHAVES_DO_RITMO = ['intervalSeconds', 'reReviewResume', 'autoPushback'] as const;
export type ChaveDoRitmo = (typeof CHAVES_DO_RITMO)[number];
export type CorpoDoRitmo = Partial<Ritmo>;

// As três chaves como o motor mandou, ou null se faltar alguma: sem o valor de agora a tela não
// tem de onde partir.
export function ritmoDe(config: ConfigDoSistema | undefined): Ritmo | null {
  if (!config) return null;
  const { intervalSeconds, reReviewResume, autoPushback } = config;
  if (intervalSeconds === undefined || reReviewResume === undefined || autoPushback === undefined) return null;
  return { intervalSeconds, reReviewResume, autoPushback };
}

export function marcaDoRitmo(r: Ritmo): string {
  return JSON.stringify([r.intervalSeconds, r.reReviewResume, r.autoPushback]);
}

export function corpoDoRitmo(antes: Ritmo, rascunho: Ritmo): CorpoDoRitmo {
  const corpo: Record<string, unknown> = {};
  for (const chave of CHAVES_DO_RITMO) if (rascunho[chave] !== antes[chave]) corpo[chave] = rascunho[chave];
  return corpo as CorpoDoRitmo;
}

export function textoDoIntervalo(segundos: number): string {
  if (segundos % 60 !== 0) return `${segundos} segundos`;
  const minutos = segundos / 60;
  if (minutos === 60) return '1 hora';
  return minutos === 1 ? '1 minuto' : `${minutos} minutos`;
}

export function intervaloValido(segundos: number): boolean {
  return Number.isInteger(segundos) && segundos >= INTERVALO_MINIMO && segundos <= INTERVALO_MAXIMO;
}

export const EFEITO_DO_INTERVALO = 'De quanto em quanto tempo o motor busca no GitHub os PRs pedidos à conta e os commits novos. Mais curto acha antes e gasta mais do limite do GitHub. Salvar faz o motor checar na hora.';
export const EFEITO_DA_RETOMADA = 'Na rodada de um commit novo, a sessão continua a conversa da rodada anterior em vez de reler o PR do zero: mais rápida e mais barata. A retomada depois de uma queda de rede vale sempre, ligada ou não.';
export const EFEITO_DA_CONTESTACAO = 'Quando o autor responde discordando de um apontamento, o motor abre uma sessão curta para classificar quem tinha razão e guarda isso no dossiê dele. Desligado, não gasta sessão com isso. Nada é publicado no PR por causa dela.';

const NOME_DA_CHAVE: Record<ChaveDoRitmo, string> = {
  intervalSeconds: 'checagem do GitHub',
  reReviewResume: 'retomada na rodada nova',
  autoPushback: 'análise da contestação',
};

function valorDaChave(chave: ChaveDoRitmo, valor: unknown): string {
  if (valor === undefined) return 'sem valor na resposta';
  if (chave === 'intervalSeconds') return typeof valor === 'number' ? `a cada ${textoDoIntervalo(valor)}` : String(valor);
  return valor === true ? 'ligada' : 'desligada';
}

export function textoDoRitmo(corpo: CorpoDoRitmo): string {
  return CHAVES_DO_RITMO.filter((chave) => corpo[chave] !== undefined).map((chave) => `${NOME_DA_CHAVE[chave]}: ${valorDaChave(chave, corpo[chave])}`).join('; ');
}

export function conflitosDoRitmo(conflitos: readonly string[], noMotor: Ritmo, rascunho: Ritmo): string[] {
  return CHAVES_DO_RITMO
    .filter((chave) => conflitos.includes(chave) && noMotor[chave] !== rascunho[chave])
    .map((chave) => `${NOME_DA_CHAVE[chave]}: no motor agora está "${valorDaChave(chave, noMotor[chave])}", e no seu formulário, "${valorDaChave(chave, rascunho[chave])}". Salvar grava o seu.`);
}

// A conferência do que voltou: cada chave enviada cujo valor gravado difere do pedido.
export function diferencasDoRitmo(corpo: CorpoDoRitmo, gravado: ConfigDoSistema): string[] {
  return CHAVES_DO_RITMO
    .filter((chave) => corpo[chave] !== undefined && gravado[chave] !== corpo[chave])
    .map((chave) => `${NOME_DA_CHAVE[chave]} ficou ${valorDaChave(chave, gravado[chave])}, e o pedido era ${valorDaChave(chave, corpo[chave])}`);
}

export function resumoDoRitmo(r: Ritmo | null): string {
  if (!r) return 'O motor não mandou';
  return `Checagem a cada ${textoDoIntervalo(r.intervalSeconds)}`;
}
