// O Refazer login do perfil de assinatura, sem React (decisão 3 do redesenho de 19/11/2026: o
// login da assinatura passa a ser feito pela tela, pelo fluxo que o motor já tem,
// lib/engine/login-web.js, na raiz). O motor abre o `claude auth login` na pasta do perfil e
// devolve o endereço da página de autorização da Anthropic; a pessoa abre o endereço em
// qualquer navegador, copia o código que a página mostra e cola aqui; o código vai só no corpo
// de um POST e o motor o entrega ao Claude Code. Um login por vez no motor, aberto por tempo
// limitado. Só o perfil de assinatura (`kind: "dir"`) entra por login: o de chave de API
// continua só pela API do motor.

export const ROTA_DO_INICIO_DO_LOGIN = '/api/claude/login-web/start';
export const ROTA_DO_CODIGO_DO_LOGIN = '/api/claude/login-web/code';
export const ROTA_DO_FIM_DO_LOGIN = '/api/claude/login-web/cancel';

export function entraPorLogin(kind: string | undefined): boolean {
  return kind === 'dir';
}

// A frase de cada recusa do motor, pelo código (lib/engine/login-web.js). O motivo que o motor
// manda vai junto quando há.
const RECUSAS: Record<string, string> = {
  'sem-login': 'Este perfil não entra por login do Claude.',
  'login-em-curso': 'Já há um login do Claude aberto neste motor.',
  'sem-link': 'O Claude Code não mostrou o link de login.',
  expirou: 'Este login não está mais aberto: comece de novo.',
  'codigo-invalido': 'O código não tem a forma que a página de login mostra: cole o código inteiro.',
  'sem-resposta': 'O Claude Code não respondeu ao código: comece de novo.',
  recusado: 'O Claude Code não aceitou o código: comece de novo e cole o código da página nova.',
};

export function fraseDaRecusaDoLogin(code: string | undefined, motivo: string | undefined): string {
  const conhecida = code && Object.hasOwn(RECUSAS, code) ? RECUSAS[code] : undefined;
  if (conhecida && motivo) return `${conhecida} O motor disse: ${motivo}.`;
  if (conhecida) return conhecida;
  return motivo ? `O motor recusou: ${motivo}.` : 'O motor recusou o login e não disse o motivo.';
}

export const PASSOS_DO_LOGIN = 'Abra o endereço abaixo em qualquer navegador, entre com a conta do Claude deste perfil e copie o código que a página mostra no fim. Cole o código aqui: ele vai só para o motor, que o entrega ao Claude Code, e não fica nesta tela.';
export const SO_PELA_API = 'Este perfil usa chave de API: não tem login para refazer. A chave entra e muda só pela API do motor (POST /api/settings com claudeProfiles), nunca por esta tela, e não volta em resposta nenhuma.';
