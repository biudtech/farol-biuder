import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Pessoas } from '@/contratos/time';
import {
  CONTESTACOES_NO_PROMPT, TETO_DE_ENTRADAS, chaveDaPessoa, comPerfil, contestacoesDoAutor, dataDaEntrada, desfechoDaEntrada, enderecoDoTime, filtrarPorNome,
  avisoDeIlegiveis, lerEnderecoDoTime, marcaDoPerfil, markdownDosPontos, motivoQueImpedeSalvar, outrasQueDiferem, perfilDe, perfilLimpo,
  prDaEntrada, soComPerfil, textoDaCompetencia, textoDoPapel, textoDoPerfil, textoDoResultado,
  contagemDosDesfechos, iniciais, nomeDaPessoa, papelCurto, quantasPessoas, resumoDaCalibracao, tipoDoDesfecho,
  aprendizados, dominiosDoCartao, numerosDoCartao,
} from './time';

// O cartão de uma pessoa na grade do Time (redesenho, lote 4).
describe('o cartão de uma pessoa', () => {
  it('o que o Farol já aprendeu: os pontos mais recentes que o motor anotou, sem repetir, até o teto', () => {
    const autor = {
      login: 'ana',
      entries: [
        { date: '2026-11-18', bullets: ['Esquece o teste do caso vazio', ' Nomes claros '] },
        { date: '2026-11-10', bullets: [] },
        { date: '2026-11-01', bullets: ['Esquece o teste do caso vazio', 'PRs pequenos'] },
      ],
    };
    expect(aprendizados(autor)).toEqual(['Esquece o teste do caso vazio', 'Nomes claros']);
    expect(aprendizados(autor, 3)).toEqual(['Esquece o teste do caso vazio', 'Nomes claros', 'PRs pequenos']);
    expect(aprendizados({ login: 'bia', entries: [] })).toEqual([]);
    expect(aprendizados(undefined)).toEqual([]);
  });

  it('os domínios do perfil com o nível, na ordem da taxonomia, e o valor desconhecido cru', () => {
    expect(dominiosDoCartao({ dominios: { infra: 'basico', frontend: 'autoridade', novo: 'x' } })).toEqual(['Frontend: Autoridade', 'Infra/DevOps: Básico', 'novo: x']);
    expect(dominiosDoCartao({ papel: 'pleno' })).toEqual([]);
    expect(dominiosDoCartao(undefined)).toEqual([]);
  });

  it('os números de 30 dias saem só do que o motor mandou; sem os bloqueios, a caixa não aparece', () => {
    const n = { janelaDias: 30, prs: 14, aprovadosDePrimeira: 9, rodadas: 20, bloqueios: 4 };
    expect(numerosDoCartao(n)).toEqual([
      { rotulo: 'PRs revisados', valor: '14' },
      { rotulo: 'aprovados de primeira', valor: '9', tom: 'ok' },
      { rotulo: 'pedidos de mudança', valor: '4', tom: 'falha' },
    ]);
    const antigo = { janelaDias: 30, prs: 14, aprovadosDePrimeira: 9, rodadas: 20 };
    expect(numerosDoCartao(antigo).map((c) => c.rotulo)).toEqual(['PRs revisados', 'aprovados de primeira']);
    expect(numerosDoCartao(undefined)).toEqual([]);
  });
});

const RAIZ = path.resolve(import.meta.dirname, '../../..');

describe('o endereço do Time', () => {
  it('só o login do dossiê aberto mora nele', () => {
    expect(lerEnderecoDoTime(new URLSearchParams('autor=ana-souza'))).toBe('ana-souza');
    expect(lerEnderecoDoTime(new URLSearchParams('autor=%20ana%20&q=x'))).toBe('ana');
    expect(lerEnderecoDoTime(new URLSearchParams(''))).toBeNull();
    expect(lerEnderecoDoTime(new URLSearchParams('autor='))).toBeNull();
    expect(lerEnderecoDoTime(new URLSearchParams(`autor=${'a'.repeat(101)}`))).toBeNull();
  });

  it('escreve só o autor, e nada quando a lista está aberta', () => {
    expect(enderecoDoTime('ana')).toBe('autor=ana');
    expect(enderecoDoTime('dependabot[bot]')).toBe('autor=dependabot%5Bbot%5D');
    expect(enderecoDoTime(null)).toBe('');
  });
});

describe('o perfil de uma pessoa', () => {
  const pessoas: Pessoas = { ana: { papel: 'senior', dominios: { dados: 'basico', backend: 'avancado' } }, bruno: {} };

  it('é achado pelo login em minúsculas, e só por propriedade própria', () => {
    expect(chaveDaPessoa('  Ana ')).toBe('ana');
    expect(perfilDe(pessoas, 'ANA')).toBe(pessoas.ana);
    expect(perfilDe(pessoas, 'caio')).toBeUndefined();
    expect(perfilDe(pessoas, 'constructor')).toBeUndefined();
    expect(perfilDe(undefined, 'ana')).toBeUndefined();
  });

  it('é escrito com os rótulos do motor, os domínios na ordem dele', () => {
    expect(textoDoPapel(pessoas.ana)).toBe('Sênior');
    expect(textoDaCompetencia(pessoas.ana)).toBe('Backend: Avançado, Dados: Básico');
    expect(textoDoPapel(undefined)).toBe('Não informado');
    expect(textoDaCompetencia({})).toBe('Não informada');
    expect(textoDoPerfil(pessoas.ana)).toBe('papel Sênior; Backend: Avançado; Dados: Básico');
    expect(textoDoPerfil({ dominios: { infra: 'autoridade' } })).toBe('sem papel; Infra/DevOps: Autoridade');
    expect(textoDoPerfil(undefined)).toBe('sem papel nem competência');
    expect(textoDoPerfil({ dominios: { backend: '' } })).toBe('sem papel nem competência');
  });

  it('valor que a tela não conhece aparece cru', () => {
    expect(textoDoPapel({ papel: 'papel_novo' })).toBe('papel_novo');
    expect(textoDaCompetencia({ dominios: { mobile: 'nivel_novo', backend: 'basico' } })).toBe('Backend: Básico, mobile: nivel_novo');
  });

  it('a marca não depende da ordem dos domínios nem de campo vazio', () => {
    expect(marcaDoPerfil({ papel: 'pleno', dominios: { dados: 'basico', backend: 'avancado' } }))
      .toBe(marcaDoPerfil({ dominios: { backend: 'avancado', dados: 'basico', infra: '' }, papel: 'pleno' }));
    expect(marcaDoPerfil(undefined)).toBe('');
    expect(marcaDoPerfil({})).toBe('');
    expect(marcaDoPerfil({ papel: 'pleno' })).not.toBe(marcaDoPerfil({ papel: 'senior' }));
  });

  it('perfilLimpo tira o vazio, e sem nada não há perfil', () => {
    expect(perfilLimpo({ papel: '', dominios: { backend: '', dados: 'basico' } })).toEqual({ dominios: { dados: 'basico' } });
    expect(perfilLimpo({ papel: '', dominios: {} })).toBeUndefined();
  });
});

describe('comPerfil: o corpo de people em POST /api/settings', () => {
  const cru = { ana: { papel: 'senior' }, bruno: { papel: 'junior', dominios: { frontend: 'basico' } } };

  it('manda a lista inteira, com a pessoa alterada', () => {
    expect(comPerfil(cru, 'Ana', { papel: 'techlead', dominios: { backend: 'autoridade', dados: '' } })).toEqual({
      bruno: { papel: 'junior', dominios: { frontend: 'basico' } },
      ana: { papel: 'techlead', dominios: { backend: 'autoridade' } },
    });
  });

  it('as outras pessoas voltam como vieram: forma errada, valor torto e campo desconhecido', () => {
    const torto = { ana: { papel: 4 }, bruno: 'x', caio: null, dora: { papel: 'senior', squad: 'plataforma', dominios: { backend: 2 } }, eva: { papel: 'pleno' } };
    const corpo = comPerfil(torto, 'eva', { papel: 'senior' });
    expect(corpo).toEqual({ ana: { papel: 4 }, bruno: 'x', caio: null, dora: { papel: 'senior', squad: 'plataforma', dominios: { backend: 2 } }, eva: { papel: 'senior' } });
    // a mesma referência: nada das outras é remontado
    expect(corpo.dora).toBe(torto.dora);
  });

  it('pessoa degradada na leitura não some do corpo quando outra é editada', () => {
    expect(comPerfil({ ana: { papel: 4 } }, 'bruno', { papel: 'pleno' })).toEqual({ ana: { papel: 4 }, bruno: { papel: 'pleno' } });
  });

  it('na pessoa editada o campo que a tela não conhece fica, e papel e domínios são trocados', () => {
    expect(comPerfil({ ana: { papel: 'senior', squad: 'plataforma', dominios: { backend: 2, dados: 'basico' } } }, 'ana', { papel: '', dominios: { dados: 'avancado' } }))
      .toEqual({ ana: { squad: 'plataforma', dominios: { dados: 'avancado' } } });
  });

  it('login com maiúsculas entra pela chave em minúsculas, que é a do motor', () => {
    expect(comPerfil(cru, 'Caio-Lima', { papel: 'pleno' })).toEqual({ ...cru, 'caio-lima': { papel: 'pleno' } });
    // entrada da mesma pessoa em outra caixa é trocada, não duplicada
    expect(comPerfil({ 'Ana-Souza': { papel: 'junior', squad: 'x' }, bruno: { papel: 'junior' } }, 'Ana-Souza', { papel: 'senior' }))
      .toEqual({ bruno: { papel: 'junior' }, 'ana-souza': { papel: 'senior', squad: 'x' } });
  });

  it('perfil que ficou vazio tira a pessoa do mapa', () => {
    expect(comPerfil(cru, 'ana', { papel: '', dominios: {} })).toEqual({ bruno: cru.bruno });
  });

  it('não muda o mapa que recebeu', () => {
    const antes = JSON.stringify(cru);
    comPerfil(cru, 'ana', { papel: 'pleno' });
    expect(JSON.stringify(cru)).toBe(antes);
  });

  it('um login "__proto__" vira propriedade própria', () => {
    const corpo = comPerfil({}, '__proto__', { papel: 'pleno' });
    expect(Object.hasOwn(corpo, '__proto__')).toBe(true);
    expect(({} as { papel?: string }).papel).toBeUndefined();
  });
});

describe('outrasQueDiferem: a conferência da resposta de um salvar', () => {
  const enviado = { ana: { papel: 'senior' }, bruno: { papel: 'junior', dominios: { frontend: 'basico' } }, caio: { papel: 4 } };

  it('nada difere quando o motor devolve o que recebeu, em qualquer ordem de chaves', () => {
    expect(outrasQueDiferem(enviado, { caio: { papel: 4 }, bruno: { dominios: { frontend: 'basico' }, papel: 'junior' }, ana: { papel: 'pleno' } }, 'Ana')).toEqual([]);
  });

  it('diz quem mudou, quem saiu e quem apareceu, sem contar a pessoa editada', () => {
    expect(outrasQueDiferem(enviado, { ana: { papel: 'senior' }, bruno: { papel: 'junior' }, dora: { papel: 'pleno' } }, 'ana')).toEqual(['bruno', 'caio', 'dora']);
  });
});

describe('fatias', () => {
  const autores = [{ login: 'ana-souza', name: 'Ana Souza', entries: [] }, { login: 'joao', name: 'João Pedro', entries: [] }, { login: 'Bia', entries: [] }];

  it('a busca acha por nome ou login, sem caixa e sem acento, e mantém a ordem', () => {
    expect(filtrarPorNome(autores, '')).toBe(autores);
    expect(filtrarPorNome(autores, '   ')).toBe(autores);
    expect(filtrarPorNome(autores, 'JOAO').map((a) => a.login)).toEqual(['joao']);
    expect(filtrarPorNome(autores, 'pedro joão').map((a) => a.login)).toEqual(['joao']);
    expect(filtrarPorNome(autores, 'a').map((a) => a.login)).toEqual(['ana-souza', 'joao', 'Bia']);
    expect(filtrarPorNome(autores, 'bia')).toHaveLength(1);
    expect(filtrarPorNome(autores, 'ana pedro')).toHaveLength(0);
  });

  it('soComPerfil: quem tem perfil gravado e não tem dossiê', () => {
    expect(soComPerfil({ bia: { papel: 'pleno' }, caio: { papel: 'junior' }, 'ana-souza': {} }, autores)).toEqual(['caio']);
    expect(soComPerfil(undefined, autores)).toEqual([]);
  });

  it('contestacoesDoAutor: as do autor, pelo campo author, sem caixa', () => {
    const registros = {
      'dono/repo#1': { outcome: 'we_right', author: 'ana-souza' },
      'dono/repo#2': { outcome: 'mixed', author: 'joao' },
      'dono/repo#3': { outcome: 'author_right', author: 'Ana-Souza' },
      'dono/repo#4': { outcome: 'mixed' },
    };
    expect(contestacoesDoAutor(registros, 'ANA-souza').map((c) => c.chave)).toEqual(['dono/repo#1', 'dono/repo#3']);
    expect(contestacoesDoAutor(undefined, 'ana')).toEqual([]);
  });
});

describe('a entrada de memória', () => {
  it('o dia vira dia/mês/ano, sem conta de fuso', () => {
    expect(dataDaEntrada('2026-11-16')).toBe('16/11/2026');
    expect(dataDaEntrada('ontem')).toBe('ontem');
    expect(dataDaEntrada('')).toBe('');
    expect(dataDaEntrada(undefined)).toBe('');
  });

  it('o desfecho usa os rótulos do Histórico, e o desconhecido aparece cru', () => {
    expect(desfechoDaEntrada('APPROVE')).toBe('Aprovação');
    expect(desfechoDaEntrada('REQUEST CHANGES')).toBe(desfechoDaEntrada('REQUEST_CHANGES'));
    expect(desfechoDaEntrada('REQUEST CHANGES')).toBe('Pedido de mudanças');
    expect(desfechoDaEntrada('COMMENT')).toBe('Comentário');
    expect(desfechoDaEntrada('OUTRO')).toBe('OUTRO');
    expect(desfechoDaEntrada('constructor')).toBe('constructor');
    expect(desfechoDaEntrada(undefined)).toBe('');
  });

  it('o PR é dito por extenso quando a referência é a chave inteira', () => {
    expect(prDaEntrada('dono/repo#12')).toBe('PR #12 de dono/repo');
    expect(prDaEntrada('repo#12')).toBe('repo#12');
    expect(prDaEntrada(undefined)).toBe('');
  });

  it('os pontos voltam a ser uma lista de markdown, um por linha', () => {
    expect(markdownDosPontos(['Usou `Map`.', 'Duas\nlinhas'])).toBe('- Usou `Map`.\n- Duas linhas');
    expect(markdownDosPontos([])).toBe('');
  });

  it('o número de contestações que entram no prompt é o do motor', () => {
    const fonte = fs.readFileSync(path.join(RAIZ, 'lib/engine/review-prompt.js'), 'utf8');
    const corte = /pushbacksFor\(login\)\.slice\(0, (\d+)\)/.exec(fonte);
    expect(corte?.[1]).toBe(String(CONTESTACOES_NO_PROMPT));
  });

  it('o teto de entradas é o do motor', () => {
    const fonte = fs.readFileSync(path.join(RAIZ, 'lib/engine/decision.js'), 'utf8');
    const corte = /blocks\.slice\(0, (\d+)\)/.exec(fonte);
    expect(corte?.[1]).toBe(String(TETO_DE_ENTRADAS));
  });
});

describe('frases', () => {
  it('o resultado da lista', () => {
    expect(textoDoResultado(0, 0, '')).toBe('Ninguém no Time');
    expect(textoDoResultado(1, 1, '')).toBe('1 pessoa');
    expect(textoDoResultado(4, 4, ' ')).toBe('4 pessoas');
    expect(textoDoResultado(4, 1, 'ana')).toBe('1 de 4 pessoas passa pela busca');
    expect(textoDoResultado(4, 2, 'a')).toBe('2 de 4 pessoas passam pela busca');
    expect(textoDoResultado(4, 0, 'zzz')).toBe('Ninguém passa pela busca, de 4 pessoas');
  });

  it('o salvar só é oferecido com a lista de perfis e com o estado desta conexão já chegado', () => {
    expect(motivoQueImpedeSalvar({ cru: {}, conexao: 'conectado', emDia: true })).toBeNull();
    expect(motivoQueImpedeSalvar({ cru: undefined, conexao: 'conectado', emDia: true })).toMatch(/não mandou a lista de perfis/);
    expect(motivoQueImpedeSalvar({ cru: {}, conexao: 'reconectando', emDia: false })).toMatch(/conexão: reconectando/);
    expect(motivoQueImpedeSalvar({ cru: {}, conexao: 'sem-motor', emDia: false })).toMatch(/sem resposta do motor/);
    // conectado no HTTP 200, ainda com o snapshot de antes da queda
    expect(motivoQueImpedeSalvar({ cru: {}, conexao: 'conectado', emDia: false })).toMatch(/o estado dele ainda não chegou/);
  });

  it('perfil ilegível vira aviso, não trava', () => {
    expect(avisoDeIlegiveis(0)).toBeNull();
    expect(avisoDeIlegiveis(2)).toMatch(/^2 perfil\(is\) chegaram do motor com campo ou formato que esta tela não lê/);
  });
});

describe('a linha e o dossiê no desenho enxuto', () => {
  it('o nome é o do dossiê, ou o login quando o motor não traz nome', () => {
    expect(nomeDaPessoa('ana-souza', { name: 'Ana Souza' })).toBe('Ana Souza');
    expect(nomeDaPessoa('bruno', { name: '  ' })).toBe('bruno');
    expect(nomeDaPessoa('caio', undefined)).toBe('caio');
  });

  it('as iniciais saem da primeira e da última parte do nome, ou das duas primeiras letras', () => {
    expect(iniciais('Ana Souza')).toBe('AS');
    expect(iniciais('Maria da Silva')).toBe('MS');
    expect(iniciais('arturReiman')).toBe('AR');
    expect(iniciais('thiagopcdev')).toBe('TH');
    expect(iniciais('joao-oliveira-biud')).toBe('JB');
    expect(iniciais('dependabot[bot]')).toBe('DB');
    expect(iniciais('Érica')).toBe('ÉR');
    expect(iniciais('x')).toBe('X');
    expect(iniciais('---')).toBe('?');
  });

  it('o papel curto diz "Sem papel" quando não há', () => {
    expect(papelCurto({ papel: 'senior' })).toBe('Sênior');
    expect(papelCurto({ dominios: { backend: 'basico' } })).toBe('Sem papel');
    expect(papelCurto(undefined)).toBe('Sem papel');
  });

  it('o resumo da calibração junta o papel e as competências', () => {
    expect(resumoDaCalibracao({ papel: 'senior', dominios: { dados: 'basico', backend: 'avancado' } })).toBe('Sênior · Backend: Avançado · Dados: Básico');
    expect(resumoDaCalibracao({ dominios: { backend: 'avancado' } })).toBe('sem papel · Backend: Avançado');
    expect(resumoDaCalibracao(undefined)).toBe('sem papel nem competência');
  });

  it('os desfechos das entradas listadas são somados pela leitura do motor', () => {
    expect(tipoDoDesfecho('APPROVE')).toBe('aprovacao');
    expect(tipoDoDesfecho('REQUEST CHANGES')).toBe('mudancas');
    expect(tipoDoDesfecho('REQUEST_CHANGES')).toBe('mudancas');
    expect(tipoDoDesfecho('COMMENT')).toBe('comentario');
    expect(tipoDoDesfecho('novo')).toBe('outro');
    expect(tipoDoDesfecho(undefined)).toBe('outro');
    expect(contagemDosDesfechos([{ verdict: 'APPROVE' }, { verdict: 'APPROVE' }, { verdict: 'REQUEST CHANGES' }, {}])).toEqual({ aprovacao: 2, mudancas: 1, comentario: 0, outro: 1 });
  });

  it('a contagem de pessoas', () => {
    expect(quantasPessoas(1)).toBe('1 pessoa');
    expect(quantasPessoas(10)).toBe('10 pessoas');
  });
});

describe('a cor do desfecho da entrada é a do Histórico', () => {
  it('cada veredito do dossiê vira o action do Histórico, e tomDoDesfecho dá a mesma cor nas duas telas', async () => {
    const { acaoDaEntrada } = await import('./time');
    const { tomDoDesfecho } = await import('@/historico/rotulos');
    const cor = (v: string | undefined) => tomDoDesfecho({ action: acaoDaEntrada(v) });
    expect(cor('APPROVE')).toBe(tomDoDesfecho({ action: 'approve' }));
    expect(cor('REQUEST CHANGES')).toBe(tomDoDesfecho({ action: 'request_changes' }));
    expect(cor('REQUEST_CHANGES')).toBe('ruim');
    expect(cor('COMMENT')).toBe('aviso');
    expect(cor('outra coisa')).toBe('neutro');
    expect(cor(undefined)).toBe('neutro');
  });
});
