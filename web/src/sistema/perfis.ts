// Os perfis do Claude na ordem em que o motor os usa, e o Subir na ordem, sem React.
//
// A ordem é a do motor (candidatosDaConta, lib/engine/perfil-claude.js, na raiz): o padrão
// (`claudeProfileId`) primeiro, depois os demais na ordem da lista. A sessão usa o primeiro que
// não está no limite do plano (escolherPerfil, lib/engine/limite-plano.js). A tela só reproduz
// essa ordem para mostrar; quem escolhe é o motor.
//
// Subir na ordem troca o perfil de lugar com o de cima. O motor só conhece a ordem pela lista
// inteira (`claudeProfiles`) e pelo padrão (`claudeProfileId`), e POST /api/settings troca a lista
// inteira. Por isso este é o ÚNICO lugar da tela que monta `claudeProfiles`, e o corpo leva só
// `id`, `label`, `kind` e, no perfil de chave, `baseUrl`: nunca a chave (que a tela não tem) nem
// a pasta. O motor repõe as duas que já guardava (patchDaTela, lib/engine/chave-do-perfil.js) e
// recusa o salvar que mudaria o endereço de uma chave sem a chave de novo (recusaDoEndereco).
// Sem a lista inteira lida, a tela não monta o corpo: perfil descartado na borda sumiria do motor.
import type { ConfigDoSistema, PerfilDoClaude } from '@/contratos/sistema';

export const TIPOS_DE_PERFIL = ['dir', 'apikey'] as const;

// O perfil como vai no corpo do Subir na ordem.
export interface PerfilNaOrdem {
  id: string;
  label: string;
  kind: (typeof TIPOS_DE_PERFIL)[number];
  baseUrl?: string;
}

export interface CorpoDaOrdem {
  claudeProfileId: string;
  claudeProfiles: PerfilNaOrdem[];
}

// O padrão que vale: o `claudeProfileId` quando ele está na lista, senão nenhum (o motor usa o
// primeiro utilizável da lista).
export function idDoPadrao(config: ConfigDoSistema | undefined): string | null {
  const lista = config?.claudeProfiles ?? [];
  const id = config?.claudeProfileId;
  return id && lista.some((p) => p.id === id) ? id : null;
}

export function ordemDeUso(config: ConfigDoSistema | undefined): PerfilDoClaude[] {
  const lista = config?.claudeProfiles ?? [];
  const padrao = idDoPadrao(config);
  const primeiro = lista.find((p) => p.id === padrao);
  return primeiro ? [primeiro, ...lista.filter((p) => p !== primeiro)] : [...lista];
}

// Por que a tela não oferece Subir na ordem agora, ou null quando pode.
export function impedimentoDaOrdem(config: ConfigDoSistema | undefined): string | null {
  const lista = config?.claudeProfiles;
  if (!lista) return 'O motor não mandou a lista de perfis.';
  if (config.segredosDescartados || config.perfisIlegiveis) return 'Parte da lista de perfis chegou fora da forma e ficou de fora desta tela: mudar a ordem daqui tiraria esses perfis do motor. Mude a ordem pela API ou pelo arquivo de configuração.';
  if (lista.some((p) => !(TIPOS_DE_PERFIL as readonly string[]).includes(p.kind ?? ''))) return 'Há perfil de tipo que esta tela não conhece: mudar a ordem daqui poderia apagá-lo.';
  return null;
}

function paraOCorpo(p: PerfilDoClaude): PerfilNaOrdem {
  const kind = p.kind === 'apikey' ? 'apikey' : 'dir';
  const perfil: PerfilNaOrdem = { id: p.id, label: p.label ?? '', kind };
  if (kind === 'apikey') perfil.baseUrl = p.baseUrl ?? '';
  return perfil;
}

// O corpo que sobe o perfil `id` um lugar na ordem de uso, ou null quando não há o que subir
// (o perfil já é o primeiro, ou não está na lista) ou quando a tela não pode montar a lista.
export function corpoDeSubir(config: ConfigDoSistema | undefined, id: string): CorpoDaOrdem | null {
  if (impedimentoDaOrdem(config)) return null;
  const ordem = ordemDeUso(config);
  const i = ordem.findIndex((p) => p.id === id);
  if (i <= 0) return null;
  const nova = [...ordem];
  [nova[i - 1], nova[i]] = [nova[i] as PerfilDoClaude, nova[i - 1] as PerfilDoClaude];
  return { claudeProfileId: (nova[0] as PerfilDoClaude).id, claudeProfiles: nova.map(paraOCorpo) };
}

// A conferência do que voltou: a ordem de uso gravada é a pedida?
export function diferencaDaOrdem(corpo: CorpoDaOrdem, gravado: ConfigDoSistema): string | null {
  if (!gravado.claudeProfiles) return null;
  const pedida = corpo.claudeProfiles.map((p) => p.id);
  const ficou = ordemDeUso(gravado).map((p) => p.id);
  if (pedida.join('\u0000') === ficou.join('\u0000')) return null;
  return `a ordem ficou ${ficou.join(', ') || 'vazia'}, e o pedido era ${pedida.join(', ')}`;
}

export const nomeDoPerfil = (perfil: Pick<PerfilDoClaude, 'id' | 'label'>): string => perfil.label || perfil.id;
