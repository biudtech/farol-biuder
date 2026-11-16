// A busca do Sistema. Extraído de ui/telas/sistema.js: o índice e o filtro são puros, a tela só
// desenha.

import { sysNorm } from './comum.js';

/* Índice da busca do Sistema. Casar por textContent da seção inteira, como era antes,
   acendia meia dúzia de seções ao mesmo tempo (o termo "conta" aparece em quase todas)
   e empilhava tudo na vertical. Com índice, o resultado é uma lista curta que aponta
   pra UMA linha. 'at' é o seletor do alvo, e todo alvo tem que existir no HTML. */
export const SYS_INDEX = [
  { sec: 'overview', at: '#setupManager', title: 'Configuração e retomada', hint: 'onboarding, começar, roteiro, configurar, retomar' },
  { sec: 'overview', at: '#doctor', title: 'Saúde do ambiente', hint: 'doctor, gh, claude, git bash, diagnóstico' },
  { sec: 'accounts', at: '#accountsManager', title: 'Contas do GitHub', hint: 'conta, identidade, cor, silenciar, política, token, usuário, login, gh' },
  // as organizações monitoradas são da conta (a seção Conexões, que as repetia sem efeito, saiu em 03/10/2026)
  { sec: 'accounts', at: '#accountsManager', title: 'Organizações monitoradas (por conta)', hint: 'org, organização, owners, repositórios' },
  // revisar e aprovar sozinho são da conta desde 30/09/2026: a busca leva ao cartão dela
  { sec: 'accounts', at: '#accountsManager', title: 'Revisar e aprovar sozinho (por conta)', hint: 'auto review, revisão na hora, fila, auto approve, ressalva, aprovação, reprovar' },
  { sec: 'automation', at: '#sys-row-pushback', title: 'Reconhecer quando o autor contesta a revisão', hint: 'pushback, contestação, autor, desfecho' },
  { sec: 'plans', at: '#sys-row-modelo', title: 'Modelo das sessões autônomas', hint: 'opus, sonnet, fable, auto, best, modelo, esforço, limite do plano' },
  { sec: 'automation', at: '#sys-row-paralelas', title: 'Revisões paralelas por conta', hint: 'paralelo, simultâneo, série, fila, velocidade' },
  { sec: 'automation', at: '#sys-row-teto-global', title: 'Teto total desta instalação', hint: 'teto, total, global, paralelismo, simultâneo, instalação' },
  { sec: 'plans', at: '#sys-row-esforco', title: 'Esforço de raciocínio', hint: 'effort, pensar, raciocínio, alto, baixo, xhigh' },
  { sec: 'automation', at: '#sys-row-intervalo', title: 'Intervalo de checagem', hint: 'polling, minutos, frequência' },
  { sec: 'plans', at: '#claudeProfilesManager', title: 'Perfis de IA e chaves', hint: 'claude, chave de API, perfil, proxy, url base, assinatura' },
  { sec: 'prefs', at: '#sys-row-sound', title: 'Som ao chegar PR novo', hint: 'som, aviso, notificação' },
  { sec: 'prefs', at: '#rowAutostart', title: 'Iniciar com o sistema', hint: 'autostart, inicialização, segundo plano, iniciar com o Windows, iniciar com o macOS, login' },
  { sec: 'diag', at: '#sys-row-spawns', title: 'Registrar processos (diagnóstico)', hint: 'spawns, terminal piscando, debug' },
  { sec: 'diag', at: '#sys-row-log', title: 'Log de falhas', hint: 'log, erro, falha' },
  { sec: 'about', at: '#aboutPrivacy', title: 'Privacidade', hint: 'dados, telemetria, coleta, local, privacidade' },
  { sec: 'about', at: '#aboutLicense', title: 'Licença', hint: 'mit, licença, open source, garantia' },
  { sec: 'about', at: '#aboutCredits', title: 'Créditos', hint: 'contribuidores, autores, idealizador, mantenedor, quem fez' },
];

// Itens do índice cujo texto (título, dica e nome da seção) contém a consulta, na ordem do índice.
export function buscarNoSistema(indice, query, nomeDaSecao) {
  const q = sysNorm(query).trim();
  if (!q) return [];
  return indice.filter((e) => sysNorm(`${e.title} ${e.hint} ${nomeDaSecao(e.sec)}`).includes(q));
}

export default { SYS_INDEX, buscarNoSistema };
