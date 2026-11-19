// Os assuntos da tela Sistema e a rota de cada um, sem React (desenho de 19/11/2026, decisão 4:
// a rota guarda o assunto aberto, para o link funcionar). O menu à esquerda lista os assuntos
// nesta ordem, e `/sistema` sem assunto abre o primeiro. Assunto que não existe é página que não
// existe (404), e não um assunto qualquer aberto no lugar. São os sete do desenho aprovado: a
// saúde do motor e a rede saíram da tela por decisão do dono, e o diagnóstico continua no motor,
// pela API (GET /api/doctor e GET /api/diagnostics).

export const ROTA_DO_SISTEMA = '/sistema';

export const ASSUNTOS = [
  { id: 'conta', nome: 'Conta revisora' },
  { id: 'regras', nome: 'Regras por organização e autor' },
  { id: 'padroes', nome: 'Padrões do time' },
  { id: 'claude', nome: 'Claude' },
  { id: 'jira', nome: 'Jira' },
  { id: 'ritmo', nome: 'Ritmo da revisão' },
  { id: 'acesso', nome: 'Quem está conectado' },
] as const;

export type IdDoAssunto = (typeof ASSUNTOS)[number]['id'];

export interface AssuntoAberto {
  id: IdDoAssunto;
  // o endereço nomeia o assunto (`/sistema/claude`); sem ele (`/sistema`) o primeiro abre por
  // padrão, e no celular a tela mostra a lista dos assuntos primeiro
  explicito: boolean;
}

const IDS: readonly string[] = ASSUNTOS.map((a) => a.id);

function ehAssunto(valor: string): valor is IdDoAssunto {
  return IDS.includes(valor);
}

export function rotaDoAssunto(id: IdDoAssunto): string {
  return `${ROTA_DO_SISTEMA}/${id}`;
}

export function nomeDoAssunto(id: IdDoAssunto): string {
  return ASSUNTOS.find((a) => a.id === id)?.nome ?? id;
}

// O assunto dos segmentos da rota depois de `/sistema` (o `[[...assunto]]` do Next), ou null
// quando o endereço não é de assunto nenhum. Tolera o que vier torto: não lista, item que não
// é texto, mais de um segmento.
export function assuntoDosSegmentos(segmentos: unknown): AssuntoAberto | null {
  if (segmentos === undefined) return { id: ASSUNTOS[0].id, explicito: false };
  if (!Array.isArray(segmentos)) return null;
  if (!segmentos.length) return { id: ASSUNTOS[0].id, explicito: false };
  const [primeiro] = segmentos;
  if (segmentos.length > 1 || typeof primeiro !== 'string' || !ehAssunto(primeiro)) return null;
  return { id: primeiro, explicito: true };
}

// O assunto do caminho da página (`usePathname`), ou null fora da tela Sistema ou com assunto
// que não existe. A barra final e a busca não contam.
export function assuntoDoCaminho(caminho: unknown): AssuntoAberto | null {
  if (typeof caminho !== 'string') return null;
  const limpo = caminho.split(/[?#]/)[0]?.replace(/\/+$/, '') ?? '';
  if (limpo === ROTA_DO_SISTEMA) return assuntoDosSegmentos([]);
  if (!limpo.startsWith(`${ROTA_DO_SISTEMA}/`)) return null;
  return assuntoDosSegmentos(limpo.slice(ROTA_DO_SISTEMA.length + 1).split('/'));
}
