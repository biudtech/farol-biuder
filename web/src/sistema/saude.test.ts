import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ContaRevisora, Saude } from '@/contratos/sistema';
import type { Saida } from '@/estado/app';
import { ROTULO_DO_ESTADO, resumoDaSaude, verificacaoDaConta, verificacaoDoCli, verificacoesDaSaude, verificacoesDosPerfis } from './saude';
import { nomeDaSessao, perguntaDeRevogar, textoDaLista, textoDaSaida } from './sessoes';

const raiz = (arquivo: string): string => fs.readFileSync(path.resolve(import.meta.dirname, '../../..', arquivo), 'utf8');

const SAUDE: Saude = {
  node: 'v24.22.1',
  gh: 'gh version 2.80.0',
  claude: '2.1.300 (Claude Code)',
  ghAuth: true,
  root: false,
  instanciaIsolada: false,
  claudeAuth: [{ id: 'plano', label: 'Assinatura', ready: true, tipo: 'assinatura' }, { id: 'api', ready: false, tipo: 'chave' }],
  claudePerfilPronto: true,
  claudePerfilTipo: 'assinatura',
  claudePerfilFalta: '',
  avaliacaoTecnica: { pronta: true, detalhe: 'ferramenta instalada e íntegra (eng-behaviour 0.17.0, commit ed3e1535cb84); 1 repositório declarado' },
  checkedAt: 1,
};

const linhas = (saude: Saude): string[] => verificacoesDaSaude(saude).map((v) => `${ROTULO_DO_ESTADO[v.estado]} · ${v.nome}: ${v.detalhe}`);

describe('verificacoesDaSaude', () => {
  it('escreve cada verificação do diagnóstico com o estado em texto', () => {
    expect(linhas(SAUDE)).toEqual([
      'OK · Node: v24.22.1',
      'OK · GitHub CLI: gh version 2.80.0',
      'OK · Autenticação do GitHub: autenticado',
      'OK · Claude Code: 2.1.300 (Claude Code)',
      'OK · Usuário do sistema: usuário comum',
      'OK · Perfil do Claude que o motor usa: pronto (assinatura)',
      'OK · Perfil de assinatura: Assinatura: pronto',
      'Atenção · Perfil de chave de API: api: sem chave',
      'OK · Avaliação técnica: ferramenta instalada e íntegra (eng-behaviour 0.17.0, commit ed3e1535cb84); 1 repositório declarado',
      'OK · Escrita no GitHub: instância normal: o motor publica pelos gates',
    ]);
  });

  it('o que falta pede atenção, com o motivo', () => {
    const torto = linhas({ ...SAUDE, gh: undefined, claude: undefined, ghAuth: false, root: true, instanciaIsolada: true, claudePerfilPronto: false, claudePerfilFalta: 'login', claudeAuth: [] });
    expect(torto).toContain('Atenção · GitHub CLI: não detectado');
    expect(torto).toContain('Atenção · Autenticação do GitHub: sem autenticação');
    expect(torto).toContain('Atenção · Claude Code: não detectado');
    expect(torto.find((l) => l.includes('Usuário do sistema'))).toContain('rodando como root');
    expect(torto.find((l) => l.includes('Perfil do Claude que o motor usa'))).toContain('sem login');
    expect(torto.find((l) => l.includes('Escrita no GitHub'))).toContain('instância isolada');
    expect(linhas({ ...SAUDE, claudePerfilPronto: false, claudePerfilFalta: 'perfil' }).join('\n')).toContain('não há perfil do Claude utilizável');
    expect(linhas({ ...SAUDE, claudePerfilPronto: false, claudePerfilFalta: 'outra' }).join('\n')).toContain('sem dizer o que falta');
    // a avaliação técnica que não roda pede atenção com o texto do motor, sem a tela remontar
    const semFerramenta = 'ferramenta ausente (eng-behaviour 0.17.0, commit ed3e1535cb84 não instalada); 2 repositórios declarados: a avaliação técnica dos repositórios declarados falha';
    expect(linhas({ ...SAUDE, avaliacaoTecnica: { pronta: false, detalhe: semFerramenta } })).toContain(`Atenção · Avaliação técnica: ${semFerramenta}`);
  });

  it('o que o motor não mandou aparece como sem dado, não como certo', () => {
    const vazio = verificacoesDaSaude({ claudeAuth: [] });
    expect(vazio.find((v) => v.nome === 'Autenticação do GitHub')?.estado).toBe('sem-dado');
    expect(vazio.find((v) => v.nome === 'Usuário do sistema')?.estado).toBe('sem-dado');
    expect(vazio.find((v) => v.nome === 'Perfil do Claude que o motor usa')?.estado).toBe('sem-dado');
    expect(vazio.find((v) => v.nome === 'Avaliação técnica')).toEqual({ nome: 'Avaliação técnica', estado: 'sem-dado', detalhe: 'O motor não informou.' });
    expect(vazio.some((v) => v.nome === 'Escrita no GitHub')).toBe(false);
  });

  it('os rótulos são os que o motor usa no diagnóstico dele (lib/engine/diagnostico.js)', () => {
    const fonte = raiz('lib/engine/diagnostico.js');
    for (const rotulo of ['Node', 'GitHub CLI', 'Autenticação do GitHub', 'Claude Code', 'Usuário do sistema', 'Avaliação técnica']) expect(fonte).toContain(`sinal('${rotulo}'`);
    for (const detalhe of ['não detectado', 'autenticado', 'sem autenticação', 'usuário comum', 'sem chave', 'sem login']) expect(fonte).toContain(`'${detalhe}'`);
    // o detalhe da avaliação técnica é o texto do motor, que mora em lib/technical-review/estado.js
    const estado = raiz('lib/technical-review/estado.js');
    for (const trecho of ['ferramenta instalada e íntegra', 'ferramenta ausente', 'ferramenta com identidade não comprovada', 'repositórios declarados', 'cadastro de repositórios ilegível']) expect(estado).toContain(trecho);
  });

  it('o resumo conta quantas pedem atenção', () => {
    expect(resumoDaSaude(verificacoesDaSaude(SAUDE))).toBe('10 verificações, 1 pede atenção.');
    expect(resumoDaSaude(verificacoesDaSaude({ ...SAUDE, claudeAuth: [] }))).toBe('8 verificações, nenhuma pede atenção.');
    expect(resumoDaSaude(verificacoesDaSaude({ ...SAUDE, ghAuth: false }))).toBe('10 verificações, 2 pedem atenção.');
    expect(resumoDaSaude([])).toBe('Sem verificação para mostrar.');
  });
});

describe('as outras verificações', () => {
  it('a versão do Claude Code, como o motor a avaliou', () => {
    expect(verificacaoDoCli(undefined)).toBeNull();
    expect(verificacaoDoCli({ instalada: '2.1.300', maisRecente: '2.1.300', atualizada: true, atrasada: false })).toMatchObject({ estado: 'ok', detalhe: '2.1.300 é a mais recente' });
    expect(verificacaoDoCli({ instalada: '2.1.268', maisRecente: '2.1.300', atualizada: false, atrasada: true })).toMatchObject({ estado: 'atencao' });
    expect(verificacaoDoCli({ instalada: '2.1.299', maisRecente: '2.1.300', atualizada: false, atrasada: false })).toMatchObject({ estado: 'ok' });
    expect(verificacaoDoCli({ instalada: '2.1.299', indisponivel: true })).toMatchObject({ estado: 'sem-dado' });
    expect(verificacaoDoCli({})).toMatchObject({ estado: 'sem-dado' });
  });

  it('o monitoramento da conta: sem conta, sem organização, sem token, no limite e vigiando', () => {
    const quando = (ms: number) => `hora ${ms}`;
    const conta: ContaRevisora = { user: 'farol-bot', owners: ['biudtech', 'acme'], tokenOk: true, limiteGhAte: 0, regrasDeReview: 0 };
    expect(verificacaoDaConta(undefined, quando).estado).toBe('sem-dado');
    expect(verificacaoDaConta({ ...conta, user: '' }, quando).detalhe).toContain('ainda não tem conta revisora');
    expect(verificacaoDaConta({ ...conta, owners: [] }, quando).detalhe).toContain('sem organização monitorada');
    expect(verificacaoDaConta({ ...conta, tokenOk: false }, quando).detalhe).toContain('sem token no gh');
    expect(verificacaoDaConta({ ...conta, limiteGhAte: 99 }, quando).detalhe).toContain('voltam em hora 99');
    expect(verificacaoDaConta(conta, quando)).toEqual({ nome: 'Monitoramento da conta', estado: 'ok', detalhe: '@farol-bot vigiando biudtech, acme' });
  });

  it('o perfil padrão que o motor não consegue usar', () => {
    expect(verificacoesDosPerfis(undefined)).toEqual([]);
    expect(verificacoesDosPerfis({ problemas: [{ profileId: 'x', code: 'perfil-inexistente' }, { profileId: 'y', code: 'outro' }], uso: {} })).toEqual([
      { nome: 'Perfil padrão do Claude (x)', estado: 'atencao', detalhe: 'o perfil padrão apontado na configuração não existe' },
      { nome: 'Perfil padrão do Claude (y)', estado: 'atencao', detalhe: 'outro' },
    ]);
    // os códigos são os do motor
    const fonte = raiz('lib/engine/perfil-claude.js');
    expect(fonte).toContain("INEXISTENTE: 'perfil-inexistente'");
    expect(fonte).toContain("INVALIDO: 'perfil-invalido'");
  });
});

describe('sessões e Sair', () => {
  it('o nome da sessão: o rótulo, ou sem nome, e a atual é dita', () => {
    expect(nomeDaSessao({ rotulo: ' Notebook ', atual: false })).toBe('"Notebook"');
    expect(nomeDaSessao({ rotulo: '', atual: false })).toBe('sem nome');
    expect(nomeDaSessao({ rotulo: 'Notebook', atual: true })).toBe('"Notebook" (este navegador)');
  });

  it('revogar a atual avisa que este navegador volta ao pareamento; a outra, que este continua', () => {
    const atual = perguntaDeRevogar({ rotulo: 'Notebook', atual: true });
    expect(atual.titulo).toBe('Revogar a sessão deste navegador?');
    expect(atual.texto).toContain('esta tela volta ao pareamento');
    expect(atual.texto).toContain('node tools/farol-parear.js');
    expect(atual.confirmar).toBe('Revogar e voltar ao pareamento');
    const outra = perguntaDeRevogar({ rotulo: 'Celular', atual: false });
    expect(outra.titulo).toBe('Revogar a sessão "Celular"?');
    expect(outra.texto).toContain('Este navegador continua pareado');
    expect(outra.confirmar).toBe('Revogar a sessão');
  });

  it('o Sair diz se a sessão foi revogada no motor ou só esquecida aqui', () => {
    expect(textoDaSaida('revogada')).toContain('o motor revogou a sessão');
    // prazo vencido ou rede caída depois de o pedido de revogação sair: a tela não afirma nada
    const incerta = textoDaSaida('nao-confirmada');
    expect(incerta).toContain('não deu para confirmar se o motor revogou a sessão');
    expect(incerta).not.toContain('continua valendo');
    expect(incerta).not.toContain('o motor revogou a sessão deste navegador');
    expect(incerta).toContain('--revogar-todas');
    for (const saida of ['sem-resposta', 'recusada', 'nao-encontrada'] satisfies Saida[]) {
      const texto = textoDaSaida(saida);
      expect(texto).toContain('continua valendo no motor até expirar');
      expect(texto).toContain('--revogar-todas');
      expect(texto).not.toContain('revogou a sessão deste navegador');
    }
    expect(textoDaSaida('sem-resposta')).toContain('não deu para falar com o motor');
    expect(textoDaSaida('nao-encontrada')).toContain('não listou a sessão');
  });

  it('a contagem da lista', () => {
    expect([0, 1, 3].map(textoDaLista)).toEqual(['Nenhuma sessão pareada', '1 sessão pareada', '3 sessões pareadas']);
  });
});
