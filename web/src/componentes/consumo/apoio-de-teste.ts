// Apoio dos testes do Consumo: o que o motor emite, escrito na forma dele. Não entra na tela.
// A navegação de mentira é a do Histórico (../historico/apoio-de-teste).

// Uma soma de recorte, como zero() de lib/usage/report.js a monta.
export function somaDoMotor(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    attempts: 0, ok: 0, erro: 0, cancelada: 0, interrompida: 0, parcial: 0, descartada: 0, desconhecido: 0,
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
    costUsd: 0, estimatedUsd: 0, unknownCost: 0, apiUsd: 0, apiEstimatedUsd: 0, apiUnknown: 0, subscription: 0, unknownBilling: 0,
    ...extra,
  };
}

// Uma tentativa do diário, como normalizeActivity (lib/usage/activity.js) a monta.
export function tentativaDoMotor(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: '5:local|3:rev|0:|6:review|38:a-1', identified: true, attemptId: '', at: Date.UTC(2026, 10, 15, 14, 30), day: '2026-11-15',
    kind: 'review', status: 'ok', account: 'rev', profile: '', ref: 'dono/repo#12', pr: 'dono/repo#12', device: 'local',
    model: 'Sonnet 5', provider: 'claude', billing: 'dir', costUsd: 1.5, costSource: 'medido', duration: 0, durationKnown: false, modelParts: null,
    inputTokens: 1200, outputTokens: 340, cacheReadTokens: 90000, cacheCreationTokens: 2500,
    ...extra,
  };
}

// Uma operação do diário (groupActivity): a tentativa mais recente, com todas em `attempts`.
export function operacaoDoMotor(n: number, extra: Record<string, unknown> = {}, anteriores: Array<Record<string, unknown>> = []): Record<string, unknown> {
  const ultima = tentativaDoMotor({ key: `op-${n}`, ref: `dono/repo#${n}`, pr: `dono/repo#${n}`, ...extra });
  return { ...ultima, attempts: [...anteriores.map((a) => tentativaDoMotor({ key: `op-${n}`, ref: `dono/repo#${n}`, pr: `dono/repo#${n}`, ...a })), ultima], completedInRange: true };
}

// A resposta 200 de GET /api/usage (activityReport): 30 dias, três com execução.
export function relatorioDoMotor(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    range: { start: '2026-10-18', end: '2026-11-16', valid: true },
    options: { account: ['rev'], provider: ['claude'], model: ['Opus 5', 'Sonnet 5'], kind: ['pushback', 'review'], device: ['local'], repo: ['dono/outro', 'dono/repo'] },
    totals: somaDoMotor({ attempts: 5, ok: 4, erro: 1, inputTokens: 6000, outputTokens: 2000, cacheReadTokens: 400000, cacheCreationTokens: 12000, costUsd: 12.5, subscription: 5 }),
    byKind: [
      { name: 'review', ...somaDoMotor({ attempts: 4, inputTokens: 5000, outputTokens: 1800, cacheReadTokens: 390000, cacheCreationTokens: 11000, costUsd: 10 }) },
      { name: 'pushback', ...somaDoMotor({ attempts: 1, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 10000, cacheCreationTokens: 1000, costUsd: 2.5 }) },
      { name: 'chat', ...somaDoMotor() },
      { name: 'tool', ...somaDoMotor() },
      { name: 'outro', ...somaDoMotor() },
    ],
    completed: { reviews: 3, prs: 2 },
    retries: 1,
    unidentified: 0,
    since: Date.UTC(2026, 9, 1, 12),
    sinceDay: '2026-10-01',
    series: [
      { name: '2026-11-14', ...somaDoMotor({ attempts: 1, inputTokens: 1000, outputTokens: 300, cacheReadTokens: 50000, cacheCreationTokens: 2000, costUsd: 2 }) },
      { name: '2026-11-15', ...somaDoMotor({ attempts: 3, inputTokens: 4000, outputTokens: 1500, cacheReadTokens: 300000, cacheCreationTokens: 9000, costUsd: 9.1 }) },
      { name: '2026-11-16', ...somaDoMotor({ attempts: 1, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 50000, cacheCreationTokens: 1000, costUsd: 1.4 }) },
    ],
    models: [
      { name: 'Opus 5', attempts: 1, inputTokens: 1000, outputTokens: 200 },
      { name: 'Sonnet 5', attempts: 4, inputTokens: 5000, outputTokens: 1800 },
    ],
    history: { total: 2, page: 0, pages: 1, rows: [operacaoDoMotor(12), operacaoDoMotor(7, { kind: 'pushback', model: 'Opus 5', status: 'erro', costUsd: 0, costSource: 'desconhecido' })] },
    incomplete: false,
    ...extra,
  };
}

// Uma linha de teto, como linhaDeOrcamento (lib/engine/usage.js) a monta.
export function tetoDoMotor(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p1', label: 'Assinatura do time', kind: 'assinatura', budgetDaily: 50, budgetTotal: null, budgetSince: null,
    budgetByWeekday: {}, budgetDates: {}, capHoje: 50, capOrigem: 'base', today: 12.5, sinceCutoff: 300,
    blocked: false, reason: null, parcialmenteEstimado: false, tipicoReview: 4.1, sugestaoDiaria: 70,
    ...extra,
  };
}

// Uma sessão recente, como sessaoParaTela (lib/engine/snapshot-usage.js) a deixa passar.
export function sessaoDoMotor(n: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `a-${n}`, at: Date.UTC(2026, 10, 16, 12, 0) - n * 60_000, day: '2026-11-16', kind: 'review', ref: `dono/repo#${n}`, account: 'rev', profileId: 'p1',
    model: 'Sonnet 5', farol: '3.0.0-dev', inputTokens: 100 + n, outputTokens: 50, cacheReadTokens: 1000, cacheCreationTokens: 10,
    costUsd: 0.5, costSource: 'medido', status: 'ok', provider: 'claude', billingKind: 'dir',
    ...extra,
  };
}

// A chave `usage` do snapshot, como o motor a manda (usageSummary).
export function consumoDoMotor(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const parte = (sessions: number, costUsd: number) => ({ sessions, costUsd });
  return {
    totals: { sessions: 42, inputTokens: 1, outputTokens: 1, cacheReadTokens: 1, cacheCreationTokens: 1, costUsd: 900 },
    series: [], stackedSeries: {}, matrixSeries: [],
    budgets: [tetoDoMotor()],
    recentSessions: [sessaoDoMotor(1), sessaoDoMotor(2)],
    falhasPorSessao: {},
    auditoria: { total: parte(42, 900), util: parte(39, 810), perdido: parte(3, 90), medido: parte(41, 880), estimado: parte(1, 20), desconhecido: parte(0, 0) },
    sessionsSince: Date.UTC(2026, 9, 1, 12),
    retentionDays: 120,
    ...extra,
  };
}
