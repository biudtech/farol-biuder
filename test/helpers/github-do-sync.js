// O GitHub falso do sync por herança: a consulta GraphQL da procedência, as comparações de três
// pontos, as refs das branches contínuas e a lista das bancadas. Reusado pelos testes do sync.
const sha = (prefixo) => (prefixo + '0'.repeat(40)).slice(0, 40);

const FOTO = '158c3d8' + '0'.repeat(33);
const P1 = '9c5f4d1' + '0'.repeat(33);
const HEAD_DO_SYNC = 'e1a2b3c' + '0'.repeat(33);
const BASE_PONTA = 'bade000' + '0'.repeat(33);
const PONTA_DA_HOMOLOGATION = '40e0000' + '0'.repeat(33);

// um commit que entrou na origem por um PR mesclado nela
function commitDaOrigem(n, base = 'homologation', prs) {
  return { oid: sha(`c0${String(n).padStart(3, '0')}`), pais: [sha(`c1${String(n).padStart(3, '0')}`)],
    mensagem: `feat: entrega ${n}`, prs: prs || [{ number: 100 + n, base }] };
}

// o merge commit do próprio sync, na branch de trabalho
function mergeDoSync({ primeiroPai = P1, foto = FOTO, mensagem = "Merge branch 'homologation' into sync/homologation-into-development-20261124", oid } = {}) {
  return { oid: oid || HEAD_DO_SYNC, pais: [primeiroPai, foto], mensagem, prs: [] };
}

function cenarioDoSync(over = {}) {
  const head = over.head || HEAD_DO_SYNC;
  return {
    repo: 'acme/api', numero: 1, head, headRef: 'sync/homologation-into-development-20261124',
    base: 'development', baseOid: BASE_PONTA, cross: false,
    commits: [commitDaOrigem(1), mergeDoSync()],
    refs: { homologation: PONTA_DA_HOMOLOGATION },
    // os PRs mesclados associados ao commit da foto: por padrão, a foto é o merge commit de um PR
    // mesclado na homologation (como o #1480 no engine-ai#1489)
    prsDaFoto: [{ number: 1480, base: 'homologation', mergeCommit: FOTO }],
    comparacoes: {
      // o primeiro pai do merge está na linhagem da base
      [`${P1}...${BASE_PONTA}`]: { behind: 0, mergeBase: P1, files: [] },
      // a foto é ancestral da ponta da homologation
      [`${FOTO}...${PONTA_DA_HOMOLOGATION}`]: { behind: 0, mergeBase: FOTO, files: [] },
      // o head contém a foto, e nada difere dela
      [`${FOTO}...${head}`]: { behind: 0, mergeBase: FOTO, files: [] },
      // a base no momento do merge não mexeu em nada desde o ancestral comum com a foto
      [`${FOTO}...${P1}`]: { behind: 2, mergeBase: sha('a0c0'), files: [] },
    },
    falhas: [],
    chamadas: [],
    ...over,
  };
}

const ok = (dado) => ({ ok: true, code: 0, stdout: typeof dado === 'string' ? dado : JSON.stringify(dado), stderr: '' });
const naoAchou = () => ({ ok: false, code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' });

function dadosDaConsulta(c) {
  return {
    number: c.numero, headRefName: c.headRef, baseRefName: c.base, headRefOid: c.headRefOid || c.head,
    baseRefOid: c.baseOid, isCrossRepository: c.cross, total: c.total ?? c.commits.length, commits: c.commits,
  };
}

// Responde só ao que é do sync; o resto devolve undefined, para quem compõe o stub responder.
function respostaDoSync(c, args) {
  const sub = (args || []).join(' ');
  const doSync = (sub.startsWith('api graphql') && (sub.includes('parents') || sub.includes('mergeCommit'))) || sub.includes('/compare/')
    || sub.includes('/git/ref/heads/') || sub.includes('/git/matching-refs/heads/release_');
  if (!doSync) return undefined;
  c.chamadas.push(sub);
  if (c.falhas.some((f) => sub.includes(f))) return { ok: false, code: 1, stdout: '', stderr: 'HTTP 502' };
  if (sub.startsWith('api graphql') && sub.includes('mergeCommit')) return ok(c.prsDaFoto);
  if (sub.startsWith('api graphql')) return ok(dadosDaConsulta(c));
  const comparacao = /compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})/.exec(sub);
  if (comparacao) {
    const dado = c.comparacoes[`${comparacao[1]}...${comparacao[2]}`];
    if (!dado) return naoAchou();
    const files = (dado.files || []).map((f) => typeof f === 'string' ? { filename: f } : f);
    return ok({ base: comparacao[1], ...dado, files });
  }
  if (sub.includes('/git/matching-refs/heads/release_')) return ok(Object.keys(c.refs).filter((n) => n.startsWith('release_')));
  const ref = /\/git\/ref\/heads\/(\S+)/.exec(sub);
  if (ref && c.refs[ref[1]]) return ok({ sha: c.refs[ref[1]] });
  return naoAchou();
}

function stubDoSync(cenario, resto = async () => ({ ok: true, code: 0, stdout: '', stderr: '' })) {
  return async (cmd, args, opts) => respostaDoSync(cenario, args) ?? resto(cmd, args, opts);
}

export { FOTO, P1, HEAD_DO_SYNC, BASE_PONTA, PONTA_DA_HOMOLOGATION, sha, commitDaOrigem, mergeDoSync, cenarioDoSync, stubDoSync, respostaDoSync };
