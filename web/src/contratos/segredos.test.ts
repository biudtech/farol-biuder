import { describe, expect, it } from 'vitest';
import { NOMES_DE_SEGREDO, SEGREDO_OMITIDO, mascararSegredos, nomeDeSegredo, semSegredos, temFormatoDeSegredo, textoSeguro, textoSemSegredo } from './segredos';

// Valores com cara de segredo, montados em pedaços para o arquivo não parecer ter um.
const junta = (...partes: string[]): string => partes.join('');
const CHAVE_DA_ANTHROPIC = junta('sk', '-ant-', 'api03-', 'A1b2C3d4E5f6G7h8I9j0');
const CHAVE_SK = junta('sk', '-', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8');
const TOKEN_DO_GITHUB = junta('gh', 'p_', 'a1B2c3D4'.repeat(4));
const PAT_DO_GITHUB = junta('github', '_pat_', '11ABCDEFG0', 'a1B2c3D4e5F6_g7H8');
const TOKEN_DO_GITLAB = junta('gl', 'pat-', 'a1B2c3D4e5F6g7H8i9J0');
const TOKEN_DO_SLACK = junta('xo', 'xb-', '123456789012-abcdefABCDEF');
const TOKEN_DO_ATLASSIAN = junta('AT', 'ATT', 'x9Y8'.repeat(6));
const CHAVE_DA_AWS = junta('AK', 'IA', 'ABCDEFGHIJKLMNOP');
const CHAVE_TEMPORARIA_DA_AWS = junta('AS', 'IA', 'ABCDEFGHIJKLMNOP');
const JWT = junta('ey', 'JhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV');
const PEM = junta('-----BEGIN RSA ', 'PRIVATE KEY-----', '\nMIIEowIBAAKCAQEA\n', '-----END RSA ', 'PRIVATE KEY-----');
const SENHA = 'correto-cavalo-bateria';

const FORMATOS: Array<[string, string]> = [
  ['chave da Anthropic', CHAVE_DA_ANTHROPIC],
  ['chave sk- no formato de chave', CHAVE_SK],
  ['token do GitHub', TOKEN_DO_GITHUB],
  ['token gho_ do GitHub', TOKEN_DO_GITHUB.replace('ghp_', 'gho_')],
  ['token ghs_ do GitHub', TOKEN_DO_GITHUB.replace('ghp_', 'ghs_')],
  ['token ghu_ do GitHub', TOKEN_DO_GITHUB.replace('ghp_', 'ghu_')],
  ['PAT do GitHub', PAT_DO_GITHUB],
  ['token do GitLab', TOKEN_DO_GITLAB],
  ['token do Slack', TOKEN_DO_SLACK],
  ['token do Atlassian', TOKEN_DO_ATLASSIAN],
  ['chave da AWS', CHAVE_DA_AWS],
  ['chave temporária da AWS', CHAVE_TEMPORARIA_DA_AWS],
  ['JWT', JWT],
  ['bloco PEM', PEM],
];

describe('nomeDeSegredo: o nome do campo', () => {
  it('casa o nome exato e o que termina num nome da tabela, palavra a palavra', () => {
    for (const nome of [
      'token', 'Token', 'TOKEN', 'ghToken', 'gh_token', 'github-token', 'accessToken', 'refresh_token',
      'apiKey', 'api_key', 'apikey', 'anthropicApiKey', 'ANTHROPIC_API_KEY', 'privateKey', 'accessKey', 'secretKey',
      'secret', 'clientSecret', 'segredo', 'password', 'passwd', 'senha', 'senhaDoBanco_senha',
      'credential', 'credencial', 'jiraCredential', 'authorization', 'Authorization', 'chaveDeApi',
    ]) expect(nomeDeSegredo(nome), nome).toBe(true);
  });

  it('não casa contagem nem identificador que só contém o pedaço', () => {
    for (const nome of [
      'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'tokens', 'tokenOk', 'tokenizer', 'tokenCount',
      'chaveDoCard', 'chave', 'temChave', 'secretaria', 'secretariaDeEstado', 'senhaOk',
      'key', 'keys', 'cardKey', 'projectKeys', 'apiKeyMode', 'hasCredentialFlag', 'credentials', 'id', 'label',
    ]) expect(nomeDeSegredo(nome), nome).toBe(false);
  });

  it('a tabela é uma só, e cada entrada é uma sequência de palavras em minúsculas', () => {
    expect(NOMES_DE_SEGREDO.length).toBeGreaterThan(10);
    for (const fim of NOMES_DE_SEGREDO) for (const palavra of fim) expect(palavra).toMatch(/^[a-z]+$/);
  });
});

describe('formato de credencial no valor', () => {
  it.each(FORMATOS)('%s: casa sozinho, no meio de um texto e em outra posição', (_nome, segredo) => {
    expect(temFormatoDeSegredo(segredo)).toBe(true);
    expect(temFormatoDeSegredo(`o motor respondeu ${segredo} na linha 3`)).toBe(true);
    expect(mascararSegredos(`antes ${segredo} depois`)).toBe(`antes ${SEGREDO_OMITIDO} depois`);
  });

  it('Bearer e Basic, em qualquer caixa, seguidos de credencial: só a credencial sai', () => {
    expect(mascararSegredos('Authorization: Bearer abcDEF123456ghiJKL789')).toBe(`Authorization: Bearer ${SEGREDO_OMITIDO}`);
    expect(mascararSegredos('authorization: bearer abcDEF123456ghiJKL789')).toBe(`authorization: bearer ${SEGREDO_OMITIDO}`);
    expect(mascararSegredos('BASIC dXN1YXJpbzpzZW5oYS1sb25nYQ==')).toBe(`BASIC ${SEGREDO_OMITIDO}`);
    expect(mascararSegredos('header Basic dXN1YXJpbzpzZW5oYQ== enviado')).toBe(`header Basic ${SEGREDO_OMITIDO} enviado`);
  });

  it('endereço com usuário e senha, em qualquer posição: só o par sai', () => {
    expect(mascararSegredos(`https://ana:${SENHA}@proxy.exemplo.com/v1`)).toBe(`https://${SEGREDO_OMITIDO}@proxy.exemplo.com/v1`);
    expect(mascararSegredos(`falha ao clonar https://x-access-token:abc123@github.com/dono/repo.git`)).toBe(`falha ao clonar https://${SEGREDO_OMITIDO}@github.com/dono/repo.git`);
  });

  it('o que parece e não é passa como veio', () => {
    for (const texto of [
      'sk-anthropic-1', 'sk-1', 'sk-ant', 'sk-proj-curta', 'perfil sk-anthropic-1 pronto',
      'autenticação basic authentication habilitada', 'Bearer token ausente', 'bearer', 'Basic',
      'https://api.anthropic.com', 'https://biud.atlassian.net/browse/BT-1', 'ssh://git@github.com/dono/repo.git', 'mailto:ana@biud.com.br', 'ana@biud.com.br',
      'eyJ', 'eyJhbGciOi.curto.x', 'AKIA', 'AKIAcurta', 'ghp_curto', 'glpat-curto', 'xoxb-1', 'ATATTcurto',
      'gh version 2.80.0', '2.1.300 (Claude Code)', 'dono/repo#12', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6',
      '-----BEGIN CERTIFICATE-----', 'opus', 'claude-opus-5-5',
    ]) {
      expect(temFormatoDeSegredo(texto), texto).toBe(false);
      expect(mascararSegredos(texto)).toBe(texto);
    }
  });
});

describe('textoSemSegredo: curto sai inteiro, longo só perde o trecho', () => {
  it('texto sem credencial passa igual, curto ou longo', () => {
    expect(textoSemSegredo('Assinatura')).toBe('Assinatura');
    const longo = 'linha de log comum. '.repeat(40);
    expect(textoSemSegredo(longo)).toBe(longo);
  });

  it('texto curto com credencial é descartado inteiro', () => {
    expect(textoSemSegredo(TOKEN_DO_GITHUB)).toBeUndefined();
    expect(textoSemSegredo(`rótulo ${TOKEN_DO_GITHUB}`)).toBeUndefined();
    expect(textoSeguro(`https://u:${SENHA}@proxy.exemplo.com`)).toBeUndefined();
    expect(textoSeguro(7)).toBeUndefined();
  });

  it('texto longo (um review, um diagnóstico, um erro do motor) fica, com o trecho trocado', () => {
    const review = `## Review\n\n${'O código lê a variável de ambiente e segue. '.repeat(8)}\n\nNo log apareceu ${TOKEN_DO_GITHUB} e o cabeçalho Bearer abcDEF123456ghiJKL789 junto.\n\n${'Mais contexto. '.repeat(5)}`;
    const lido = textoSemSegredo(review);
    expect(lido).toBeDefined();
    expect(lido).not.toContain(TOKEN_DO_GITHUB);
    expect(lido).not.toContain('abcDEF123456ghiJKL789');
    expect(lido).toContain(`No log apareceu ${SEGREDO_OMITIDO} e o cabeçalho Bearer ${SEGREDO_OMITIDO} junto.`);
    expect(lido).toContain('## Review');
    expect(lido?.length).toBeGreaterThan(300);
  });
});

describe('semSegredos', () => {
  it('por nome, só texto sai: número e booleano nunca são segredo', () => {
    const lido = semSegredos({
      id: 'p1', apiKey: 'qualquer-texto', token: 'outro', senha: SENHA, tokenOk: false, temChave: true, hasCredential: true,
      inputTokens: 1200, outputTokens: 40, cacheReadTokens: 9, cacheCreationTokens: 0, tokens: 1249, token_count: 3,
    });
    expect(lido).toEqual({
      limpo: { id: 'p1', tokenOk: false, temChave: true, hasCredential: true, inputTokens: 1200, outputTokens: 40, cacheReadTokens: 9, cacheCreationTokens: 0, tokens: 1249, token_count: 3 },
      descartados: 3,
    });
  });

  it('número ou booleano num campo de nome de segredo passa (é contagem ou presença)', () => {
    expect(semSegredos({ token: 3, secret: false, password: null })).toEqual({ limpo: { token: 3, secret: false, password: null }, descartados: 0 });
  });

  it('identificador legítimo com texto passa: chaveDoCard, secretaria, tokenizer, key, keys, cardKey, projectKeys', () => {
    const valor = { chaveDoCard: 'BT-12', secretaria: 'SEFAZ', tokenizer: 'cl100k', key: 'dono/repo#1', keys: ['a', 'b'], cardKey: 'BT-9', projectKeys: ['BT', 'BUGS'], tokens: 'muitos' };
    expect(semSegredos(valor)).toEqual({ limpo: valor, descartados: 0 });
  });

  it('objeto num campo de nome de segredo é percorrido: o segredo de dentro sai, o resto fica', () => {
    expect(semSegredos({ credential: { email: 'bot@biud.com.br', token: 'abc' } })).toEqual({ limpo: { credential: { email: 'bot@biud.com.br' } }, descartados: 1 });
  });

  it.each(FORMATOS)('por valor, %s sai qualquer que seja o nome do campo', (_nome, segredo) => {
    const lido = semSegredos({ label: segredo, nota: `veja ${segredo}`, lista: ['ok', segredo] });
    expect(lido).toEqual({ limpo: { lista: ['ok'] }, descartados: 3 });
  });

  it('item de lista com id que parece chave e não é não some: sk-anthropic-1', () => {
    const perfis = [{ id: 'sk-anthropic-1', label: 'Chave da Anthropic 1', kind: 'apikey', temChave: true }, { id: 'plano', kind: 'dir' }];
    expect(semSegredos(perfis)).toEqual({ limpo: perfis, descartados: 0 });
  });

  it('texto longo fica com o trecho trocado, e não conta como descartado', () => {
    const erro = `${'falha ao postar o review: o gh respondeu 401. '.repeat(6)}cabeçalho enviado: Authorization: Bearer abcDEF123456ghiJKL789`;
    const lido = semSegredos({ error: erro });
    expect(lido.descartados).toBe(0);
    expect((lido.limpo as { error: string }).error).toContain(`Bearer ${SEGREDO_OMITIDO}`);
    expect(JSON.stringify(lido.limpo)).not.toContain('abcDEF123456ghiJKL789');
  });

  it('o que está fundo demais para conferir sai inteiro, e o protótipo não é mexido', () => {
    let fundo: unknown = { apiKey: CHAVE_DA_ANTHROPIC };
    for (let i = 0; i < 12; i += 1) fundo = { dentro: fundo };
    expect(JSON.stringify(semSegredos(fundo).limpo)).not.toContain(CHAVE_DA_ANTHROPIC);
    const comProto = semSegredos(JSON.parse('{"__proto__":{"apiKey":"x"},"id":"p1"}'));
    expect(Object.getPrototypeOf(comProto.limpo)).toBe(Object.prototype);
    expect(({} as { apiKey?: string }).apiKey).toBeUndefined();
  });

  it('valor que não é objeto, lista nem texto passa como veio', () => {
    expect(semSegredos(3)).toEqual({ limpo: 3, descartados: 0 });
    expect(semSegredos(null)).toEqual({ limpo: null, descartados: 0 });
    expect(semSegredos('texto comum')).toEqual({ limpo: 'texto comum', descartados: 0 });
  });
});
