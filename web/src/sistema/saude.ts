// A saúde do motor em linhas, sem React. A tela não mede nada: escreve o que o diagnóstico do
// motor mediu (a chave `doctor` do snapshot e GET /api/doctor), uma verificação por linha, com
// o estado dito em texto. Os rótulos e os detalhes são os de `ambienteDoDoctor`
// (lib/engine/diagnostico.js, na raiz), que é como o próprio motor escreve o diagnóstico; o
// teste ao lado confere os rótulos contra aquele arquivo.
import type { ContaRevisora, PerfisDoClaude, Saude, VersaoDoCli } from '@/contratos/sistema';

// ok: o motor mediu e está certo. atencao: mediu e não está. sem-dado: o motor não mandou.
export type EstadoDaVerificacao = 'ok' | 'atencao' | 'sem-dado';

export interface Verificacao {
  nome: string;
  estado: EstadoDaVerificacao;
  detalhe: string;
}

export const ROTULO_DO_ESTADO: Record<EstadoDaVerificacao, string> = { ok: 'OK', atencao: 'Atenção', 'sem-dado': 'Sem dado' };

const presenca = (nome: string, valor: string | undefined, falta: string): Verificacao => (
  valor ? { nome, estado: 'ok', detalhe: valor } : { nome, estado: 'atencao', detalhe: falta }
);

function booleano(nome: string, valor: boolean | undefined, certo: boolean, seCerto: string, seErrado: string): Verificacao {
  if (valor === undefined) return { nome, estado: 'sem-dado', detalhe: 'O motor não informou.' };
  return valor === certo ? { nome, estado: 'ok', detalhe: seCerto } : { nome, estado: 'atencao', detalhe: seErrado };
}

const FALTA_NO_PERFIL: Record<string, string> = {
  perfil: 'não há perfil do Claude utilizável na configuração: nenhuma sessão de revisão abre',
  login: 'o perfil de assinatura que o motor usa está sem login: nenhuma sessão de revisão abre',
};

const TIPO_DO_PERFIL: Record<string, string> = { chave: 'chave de API', assinatura: 'assinatura' };

function perfilEmUso(saude: Saude): Verificacao {
  const nome = 'Perfil do Claude que o motor usa';
  if (saude.claudePerfilPronto === undefined) return { nome, estado: 'sem-dado', detalhe: 'O motor não informou.' };
  if (saude.claudePerfilPronto) {
    const tipo = TIPO_DO_PERFIL[saude.claudePerfilTipo ?? ''];
    return { nome, estado: 'ok', detalhe: tipo ? `pronto (${tipo})` : 'pronto' };
  }
  return { nome, estado: 'atencao', detalhe: FALTA_NO_PERFIL[saude.claudePerfilFalta ?? ''] ?? 'o motor disse que o perfil não está pronto, sem dizer o que falta' };
}

// A ferramenta da avaliação técnica e o cadastro de repositórios, numa linha, com o texto do
// motor (sinalDaAvaliacaoTecnica, lib/engine/diagnostico.js).
function avaliacaoTecnica(saude: Saude): Verificacao {
  const nome = 'Avaliação técnica';
  if (!saude.avaliacaoTecnica) return { nome, estado: 'sem-dado', detalhe: 'O motor não informou.' };
  return { nome, estado: saude.avaliacaoTecnica.pronta ? 'ok' : 'atencao', detalhe: saude.avaliacaoTecnica.detalhe };
}

const MINUTO_MS = 60000;

// Quanto tempo, por extenso curto: minutos até uma hora, horas até dois dias, depois dias.
export function duracaoCurta(ms: number): string {
  const minutos = Math.max(0, Math.floor(ms / MINUTO_MS));
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 48) return `${horas} h`;
  return `${Math.floor(horas / 24)} dias`;
}

const GB = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const emGb = (bytes: number): string => `${GB.format(bytes / 1e9)} GB`;
// Abaixo disto o disco da pasta de dados pede atenção: o banco, o cache das fontes e o log moram lá.
export const DISCO_EM_ATENCAO = 0.1;

// A saúde do próprio motor (doctor.saude): há quanto tempo está no ar, o commit em execução, o
// disco da pasta de dados e a telemetria gravando. O tempo no ar é contado até a hora da medição,
// não até agora: a tela não tem relógio, e o diagnóstico diz quando foi feito.
export function verificacoesDoMotor(saude: Saude, quando: (ms: number) => string): Verificacao[] {
  const m = saude.motor;
  if (!m) return [];
  const linhas: Verificacao[] = [];
  if (m.noArDesde) {
    const ate = m.medidoEm ?? m.noArDesde;
    linhas.push({ nome: 'Motor', estado: 'ok', detalhe: `no ar há ${duracaoCurta(ate - m.noArDesde)}, desde ${quando(m.noArDesde)}` });
  }
  linhas.push(m.commit
    ? { nome: 'Commit do motor', estado: 'ok', detalhe: `commit ${m.commit.slice(0, 7)}` }
    : { nome: 'Commit do motor', estado: 'sem-dado', detalhe: 'o motor não achou o git do código (a imagem do container não leva a pasta .git)' });
  if (m.disco) {
    const livre = m.disco.livreBytes / m.disco.totalBytes;
    const detalhe = `${Math.floor(livre * 100)}% livre (${emGb(m.disco.livreBytes)} de ${emGb(m.disco.totalBytes)})`;
    linhas.push({ nome: 'Disco da pasta de dados', estado: livre < DISCO_EM_ATENCAO ? 'atencao' : 'ok', detalhe });
  } else {
    linhas.push({ nome: 'Disco da pasta de dados', estado: 'sem-dado', detalhe: 'O motor não conseguiu medir.' });
  }
  if (m.telemetria) {
    const { consumoNoBanco, historicoNoBanco, ultimaEscritaEm } = m.telemetria;
    const ultima = ultimaEscritaEm ? `última escrita em ${quando(ultimaEscritaEm)}` : 'sem escrita registrada';
    const fora = [consumoNoBanco ? '' : 'o consumo', historicoNoBanco ? '' : 'o histórico'].filter(Boolean).join(' e ');
    linhas.push(fora
      ? { nome: 'Telemetria', estado: 'atencao', detalhe: `${fora} fora do banco, nos arquivos JSON (o banco não abriu nesta subida); ${ultima}` }
      : { nome: 'Telemetria', estado: 'ok', detalhe: `gravando no banco; ${ultima}` });
  }
  return linhas;
}

// As verificações do diagnóstico, na ordem do motor.
export function verificacoesDaSaude(saude: Saude): Verificacao[] {
  const linhas: Verificacao[] = [
    presenca('Node', saude.node, 'não detectado'),
    presenca('GitHub CLI', saude.gh, 'não detectado'),
    booleano('Autenticação do GitHub', saude.ghAuth, true, 'autenticado', 'sem autenticação'),
    presenca('Claude Code', saude.claude, 'não detectado'),
    booleano('Usuário do sistema', saude.root, false, 'usuário comum', 'rodando como root: o Claude Code recusa a sessão de revisão'),
    perfilEmUso(saude),
  ];
  for (const perfil of saude.claudeAuth) {
    const tipo = perfil.tipo === 'chave' ? 'chave de API' : perfil.tipo === 'assinatura' ? 'assinatura' : 'tipo não informado';
    const falta = perfil.tipo === 'chave' ? 'sem chave' : 'sem login';
    linhas.push(booleano(`Perfil de ${tipo}: ${perfil.label || perfil.id || 'sem nome'}`, perfil.ready, true, 'pronto', falta));
  }
  linhas.push(avaliacaoTecnica(saude));
  if (saude.instanciaIsolada !== undefined) {
    // não é falha: é o modo em que o motor foi posto
    linhas.push(saude.instanciaIsolada
      ? { nome: 'Escrita no GitHub', estado: 'atencao', detalhe: 'instância isolada: o motor recusa review e label no GitHub, salvo liberação por arquivo' }
      : { nome: 'Escrita no GitHub', estado: 'ok', detalhe: 'instância normal: o motor publica pelos gates' });
  }
  return linhas;
}

// A versão do Claude Code contra a publicada (avaliarVersao, lib/engine/versao-claude.js).
// Os apelidos de modelo apontam para onde o Claude Code instalado manda: atrasado, o motor
// roda um modelo anterior sem dizer.
export function verificacaoDoCli(cli: VersaoDoCli | undefined): Verificacao | null {
  if (!cli) return null;
  const nome = 'Versão do Claude Code';
  if (cli.indisponivel) return { nome, estado: 'sem-dado', detalhe: `instalada ${cli.instalada ?? 'desconhecida'}; o motor não conseguiu comparar com a versão publicada` };
  if (cli.atualizada) return { nome, estado: 'ok', detalhe: `${cli.instalada ?? ''} é a mais recente`.trim() };
  if (cli.atrasada) return { nome, estado: 'atencao', detalhe: `instalada ${cli.instalada ?? 'desconhecida'}, e a publicada é ${cli.maisRecente ?? 'mais nova'}: os apelidos de modelo podem apontar para uma versão anterior` };
  if (cli.atualizada === false) return { nome, estado: 'ok', detalhe: `instalada ${cli.instalada ?? 'desconhecida'}; saiu a ${cli.maisRecente ?? 'seguinte'} há pouco, dentro da tolerância do motor` };
  return { nome, estado: 'sem-dado', detalhe: 'O motor não informou.' };
}

// O monitoramento da conta, como o motor o vê: organizações, token e limite do GitHub.
export function verificacaoDaConta(conta: ContaRevisora | undefined, quando: (ms: number) => string): Verificacao {
  const nome = 'Monitoramento da conta';
  if (!conta) return { nome, estado: 'sem-dado', detalhe: 'O motor não mandou a conta revisora.' };
  if (!conta.user) return { nome, estado: 'atencao', detalhe: 'o motor ainda não tem conta revisora (o gh não foi detectado)' };
  if (!conta.owners.length) return { nome, estado: 'atencao', detalhe: `@${conta.user} sem organização monitorada: nenhuma busca é feita, e a fila fica vazia sem erro` };
  if (conta.tokenOk === false) return { nome, estado: 'atencao', detalhe: `@${conta.user} sem token no gh: as buscas são puladas e nada é publicado` };
  if (conta.limiteGhAte && conta.limiteGhAte > 0) return { nome, estado: 'atencao', detalhe: `@${conta.user} no limite de requisições do GitHub: as buscas voltam em ${quando(conta.limiteGhAte)}` };
  return { nome, estado: 'ok', detalhe: `@${conta.user} vigiando ${conta.owners.join(', ')}` };
}

const NOME_DO_PROBLEMA: Record<string, string> = {
  'perfil-inexistente': 'o perfil padrão apontado na configuração não existe',
  'perfil-invalido': 'o perfil padrão apontado na configuração está incompleto (sem chave, ou com a pasta fora do HOME do Farol)',
};

// Perfil apontado que a resolução do motor não usa (problemasDePerfil,
// lib/engine/perfil-claude.js).
export function verificacoesDosPerfis(perfis: PerfisDoClaude | undefined): Verificacao[] {
  return (perfis?.problemas ?? []).map((problema) => ({
    nome: `Perfil padrão do Claude (${problema.profileId})`,
    estado: 'atencao' as const,
    detalhe: NOME_DO_PROBLEMA[problema.code] ?? problema.code,
  }));
}

// O resumo que a região viva anuncia: quantas verificações pedem atenção.
export function resumoDaSaude(verificacoes: readonly Verificacao[]): string {
  const atencao = verificacoes.filter((v) => v.estado === 'atencao').length;
  if (!verificacoes.length) return 'Sem verificação para mostrar.';
  if (atencao === 0) return `${verificacoes.length} verificações, nenhuma pede atenção.`;
  return `${verificacoes.length} verificações, ${atencao} ${atencao === 1 ? 'pede' : 'pedem'} atenção.`;
}

// As verificações que, fora do certo, param a revisão de vez: sem elas nenhuma sessão abre ou
// nada é publicado. Na tela viram problema (vermelho); as outras que pedem atenção, aviso.
const GRAVES = new Set(['GitHub CLI', 'Autenticação do GitHub', 'Claude Code', 'Usuário do sistema', 'Perfil do Claude que o motor usa']);

export function ehGrave(verificacao: Verificacao): boolean {
  return verificacao.estado === 'atencao' && GRAVES.has(verificacao.nome);
}

// Todas as linhas da seção Saúde, na ordem da tela: o diagnóstico, a versão do Claude Code, os
// perfis apontados com problema e o monitoramento da conta.
export function todasAsVerificacoes(
  saude: Saude | null | undefined,
  cli: VersaoDoCli | undefined,
  perfis: PerfisDoClaude | undefined,
  conta: ContaRevisora | undefined,
  quando: (ms: number) => string,
): Verificacao[] {
  const daVersao = verificacaoDoCli(cli);
  return [
    ...(saude ? verificacoesDoMotor(saude, quando) : []),
    ...(saude ? verificacoesDaSaude(saude) : []),
    ...(daVersao ? [daVersao] : []),
    ...verificacoesDosPerfis(perfis),
    verificacaoDaConta(conta, quando),
  ];
}
