// O estado da avaliação técnica para quem opera: a ferramenta fixada e o cadastro de
// repositórios. É o que o diagnóstico (`doctor.avaliacaoTecnica`, lib/engine/diagnostico.js)
// mostra e o que o boot escreve no farol.log.
//
// Só lê: confere a ferramenta pelo mesmo `requireTool` que a avaliação usa (lib/technical-review/
// toolchain.js) e conta os repositórios do cadastro. Nenhum caminho de arquivo sai daqui.
//
// O que cada combinação faz, conferido em runtime.js, prompt.js, verdict.js e publication.js:
// - repositório fora do cadastro: a revisão roda sem avaliação técnica, e a aprovação leva a
//   ressalva "sem declaração técnica";
// - repositório no cadastro, ferramenta fora: a avaliação falha com a causa `tool`, nenhuma regra
//   é avaliada, a sessão recebe "não conclua pela aprovação" (prompt.js) e a aprovação, se sair,
//   não sai limpa (a falha de execução é ressalva da rodada; a publicação a aceita enquanto o
//   perfil e o pino forem os da rodada, test/publicacao-prova-atual.test.js);
// - cadastro ilegível: a avaliação falha com a causa `profile` para todo repositório, e a publicação
//   recusa o APPROVE (`technical_review`, test/sem-declaracao-tecnica.test.js).
import { TOOL } from './verdict.js';
import { requireTool } from './toolchain.js';
import { resumoDoCadastro } from './profiles.js';
import { modoHospedado } from '../instancia-hospedada.js';

const NAO_INSTALADA = 'ferramenta técnica fixada não instalada';

async function estadoDaFerramenta(verify = requireTool) {
  try { await verify(); return 'integra'; }
  catch (error) { return error?.message === NAO_INSTALADA ? 'ausente' : 'nao-comprovada'; }
}

async function estadoDaAvaliacaoTecnica({ verify = requireTool, cadastro = resumoDoCadastro } = {}) {
  const lido = cadastro();
  return { ferramenta: await estadoDaFerramenta(verify), versao: TOOL.version, commit: TOOL.commit,
    cadastro: lido.estado, repositorios: lido.repositorios };
}

const pino = (estado) => `${TOOL.pacote} ${estado.versao}, commit ${String(estado.commit).slice(0, 12)}`;

// Os textos, fonte única: o diagnóstico, o log do boot e o front (que os repete, com teste que
// confere contra este arquivo) dizem o mesmo.
function textoDaFerramenta(estado) {
  if (estado.ferramenta === 'integra') return `ferramenta instalada e íntegra (${pino(estado)})`;
  if (estado.ferramenta === 'ausente') return `ferramenta ausente (${pino(estado)} não instalada)`;
  return `ferramenta com identidade não comprovada (esperada: ${pino(estado)})`;
}

function textoDoCadastro(estado) {
  if (estado.cadastro === 'ilegivel') return 'cadastro de repositórios ilegível';
  if (estado.cadastro === 'ausente') return 'cadastro de repositórios ausente (nenhum repositório declarado)';
  if (!estado.repositorios) return 'nenhum repositório declarado no cadastro';
  return estado.repositorios === 1 ? '1 repositório declarado' : `${estado.repositorios} repositórios declarados`;
}

// A avaliação roda para alguém: ferramenta íntegra e pelo menos um repositório declarado.
function avaliacaoPronta(estado) {
  return estado.ferramenta === 'integra' && estado.cadastro === 'legivel' && estado.repositorios > 0;
}

// O efeito do que falta, em uma frase; vazio quando está pronta.
function efeitoDoEstado(estado) {
  if (estado.cadastro === 'ilegivel') return 'a avaliação técnica falha para todo repositório, e a publicação recusa toda aprovação até o cadastro ser corrigido';
  if (!estado.repositorios) return 'nenhum repositório é avaliado, e toda aprovação sai com a ressalva de repositório sem declaração técnica';
  if (estado.ferramenta !== 'integra') return 'a avaliação técnica dos repositórios declarados falha: nenhuma regra é avaliada, a sessão de revisão é orientada a não aprovar e nenhuma aprovação deles sai como limpa, até a ferramenta íntegra ser instalada';
  return '';
}

function textoDoEstado(estado) {
  const efeito = efeitoDoEstado(estado);
  return `${textoDaFerramenta(estado)}; ${textoDoCadastro(estado)}${efeito ? `: ${efeito}` : ''}`;
}

// A linha do boot. WARN quando há o que avaliar e a avaliação não roda (repositórios declarados
// sem a ferramenta íntegra) ou quando o cadastro não abre; INFO nos outros casos. Na instância
// hospedada o WARN diz o comando da instalação dentro do container.
function linhaDoBoot(estado, modo = modoHospedado()) {
  const quebrada = estado.cadastro === 'ilegivel' || (estado.repositorios > 0 && estado.ferramenta !== 'integra');
  let comoResolver = '';
  if (quebrada && estado.cadastro !== 'ilegivel') {
    comoResolver = modo?.ligada
      ? ' Instale no volume, dentro do container e como o usuário do motor: node lib/technical-review/setup.js (docs/HOSPEDAGEM.md).'
      : ' Instale com: node lib/technical-review/setup.js (docs/CONFIGURATION.md).';
  }
  return { nivel: quebrada ? 'WARN' : 'INFO', texto: `avaliação técnica: ${textoDoEstado(estado)}.${comoResolver}` };
}

// Uma linha por boot no farol.log, com o estado que o diagnóstico acabou de medir. Na instância
// hospedada o WARN vai também ao stderr, que é o log do container.
function registrarNoBoot(engine, estado, modo = modoHospedado()) {
  if (!estado) return null;
  const linha = linhaDoBoot(estado, modo);
  engine.log(linha.nivel, linha.texto);
  if (linha.nivel === 'WARN' && modo?.ligada) console.error(`[farol] ${linha.texto}`);
  return linha;
}

export { estadoDaAvaliacaoTecnica, textoDaFerramenta, textoDoCadastro, textoDoEstado, efeitoDoEstado, avaliacaoPronta, linhaDoBoot, registrarNoBoot };
