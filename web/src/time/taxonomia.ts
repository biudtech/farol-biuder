// Os valores que o motor aceita no perfil de uma pessoa: os papéis, os domínios e os níveis
// de competência, com o rótulo de cada um. É cópia de lib/taxonomy.js (na raiz): o motor não
// manda essas listas, e o teste ao lado lê aquele arquivo e reprova se uma chave ou um rótulo
// divergir. Valor fora daqui o motor descarta ao gravar (parsePeople, lib/parse.js).

export type Opcao = readonly [valor: string, rotulo: string];

// PAPEL_LEVELS e PAPEL_LABEL
export const PAPEIS: readonly Opcao[] = [
  ['estagio', 'Estágio'],
  ['junior', 'Júnior'],
  ['pleno', 'Pleno'],
  ['senior', 'Sênior'],
  ['techlead', 'Tech Lead'],
  ['arquiteto', 'Arquiteto'],
  ['especialista', 'Especialista'],
  ['dono_produto', 'Dono do produto'],
];

// DOMAINS e DOMAIN_LABEL
export const DOMINIOS: readonly Opcao[] = [
  ['backend', 'Backend'],
  ['frontend', 'Frontend'],
  ['dados', 'Dados'],
  ['infra', 'Infra/DevOps'],
];

// DOMAIN_LEVELS e DOMAIN_LEVEL_LABEL
export const NIVEIS: readonly Opcao[] = [
  ['basico', 'Básico'],
  ['intermediario', 'Intermediário'],
  ['avancado', 'Avançado'],
  ['autoridade', 'Autoridade'],
];

// O rótulo de um valor, ou o próprio valor quando a tabela não o conhece.
function rotulo(opcoes: readonly Opcao[], valor: string): string {
  return opcoes.find(([v]) => v === valor)?.[1] ?? valor;
}

export const rotuloDoPapel = (valor: string): string => rotulo(PAPEIS, valor);
export const rotuloDoDominio = (valor: string): string => rotulo(DOMINIOS, valor);
export const rotuloDoNivel = (valor: string): string => rotulo(NIVEIS, valor);

export function ehConhecido(opcoes: readonly Opcao[], valor: string): boolean {
  return opcoes.some(([v]) => v === valor);
}
