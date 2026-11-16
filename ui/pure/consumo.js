// A aba Consumo: séries, matriz por modelo e sessões. Extraído do ui/pure.js na Fase 1a da reorganização; o conteúdo
// não mudou.
//
// Saiu do app.js na onda 5, segundo passo. O bloco inteiro já era puro: não lia nenhuma
// global, só montava string a partir do resumo de uso que o engine manda. O que prendia
// ele no app.js era a forma, não o conteúdo: cada função terminava atribuindo em
// `el.innerHTML`, então parecia render de DOM. Separado o build da atribuição, o app.js
// fica só com `el.innerHTML = xHtml(...)`.
//
// Fica de fora, de propósito, o drawUsageTimeline: ele mede `el.clientWidth` e ata
// listener de mouse, ou seja, precisa do elemento de verdade. O que dá pra fazer por ele
// é o usageTooltipHtml, que ele chama e que veio junto.
//
// usageMatrixHtml devolve { html, caption } porque a versão antiga escrevia em DOIS
// lugares (a matriz e a legenda ao lado); um objeto pequeno é o jeito de manter os dois
// sem devolver o elemento.
//
// fmtMoney, que morava fisicamente dentro deste bloco, ficou em comum.js: os checks do
// Sistema também o usam, e deixá-lo aqui faria o Sistema depender do Consumo por
// acidente de posição.
import { esc, fmtCompact, fmtMoney, fmtTok, fmtWhenDay, usageDayKeysBack } from './comum.js';
import { sessionRefCell } from './mencoes.js';

export function usageMetricVal(b, m) {
  b = b || {};
  if (m === 'custo') return b.costUsd || 0;
  if (m === 'input') return b.inputTokens || 0;
  if (m === 'output') return b.outputTokens || 0;
  if (m === 'cache') return (b.cacheReadTokens || 0) + (b.cacheCreationTokens || 0);
  return (b.inputTokens || 0) + (b.outputTokens || 0); // total
}

// path SVG de uma sparkline (linha + area fechada), normalizado pro maior valor
// da serie. w/h em unidades do viewBox (a UI usa 100x26, igual ao mock).
export function sparklinePath(vals, w = 100, h = 26) {
  const n = (vals || []).length;
  if (!n) return { line: '', area: '' };
  const mx = Math.max(1e-9, ...vals);
  const dx = n > 1 ? w / (n - 1) : 0;
  const pts = vals.map((v, i) => `${(i * dx).toFixed(1)},${(h - (h - 2) * (v / mx)).toFixed(1)}`);
  return { line: 'M' + pts.join('L'), area: `M0,${h}L${pts.join('L')}L${w},${h}Z` };
}

// chip de variacao percentual (cur vs prev). Sem base valida (prev ausente ou
// zero) nao da pra comparar, entao nao mostra nada, em vez de "Infinity%".
export function usageDelta(cur, prev) {
  if (!prev || prev <= 0) return '';
  const pc = Math.round(((cur - prev) / prev) * 100);
  return (pc >= 0 ? '↑ ' : '↓ ') + Math.abs(pc) + '%';
}

// camadas de area empilhada + grade, pra linha do tempo do Consumo. `series` e um
// array por dia, cada item um array de valores (1 por camada, MESMA ordem de
// `names`), ja na metrica escolhida (usageMetricVal ja aplicado por quem chama).
export function usageStackLayers(series, names, colors, W, H) {
  const padL = 46, padR = 14, padT = 12, padB = 22;
  const cw = W - padL - padR, ch = H - padT - padB, n = series.length;
  // serie vazia: retorna resultado vazio sem tentar calcular paths com undefined
  if (n === 0) {
    return { layers: [], xs: [], grid: [], padL, padT, padB, cw, ch, W, H, peakIndex: 0, dayTotals: [], maxV: 1e-9 };
  }
  const dayTotals = series.map(vals => vals.reduce((a, b) => a + b, 0));
  const maxV = Math.max(1e-9, ...dayTotals) * 1.06;
  const yOf = v => padT + ch * (1 - v / maxV);
  const xs = (n > 1 ? series.map((_, i) => padL + i * (cw / (n - 1))) : [padL + cw / 2]);
  const r1 = v => Math.round(v * 10) / 10;
  const cum = series.map(() => 0);
  const layers = names.map((name, li) => {
    const base = cum.slice();
    for (let i = 0; i < n; i++) cum[i] += (series[i][li] || 0);
    let d = 'M' + r1(xs[0]) + ',' + r1(yOf(cum[0]));
    for (let i = 1; i < n; i++) d += 'L' + r1(xs[i]) + ',' + r1(yOf(cum[i]));
    for (let i = n - 1; i >= 0; i--) d += 'L' + r1(xs[i]) + ',' + r1(yOf(base[i]));
    return { name, color: colors[li % colors.length], d: d + 'Z' };
  });
  const grid = [maxV, maxV / 2, 0].map(v => ({ y: r1(yOf(v)), value: v }));
  let peakIndex = 0;
  for (let i = 1; i < n; i++) if (dayTotals[i] > dayTotals[peakIndex]) peakIndex = i;
  return { layers, xs: xs.map(r1), grid, padL, padT, padB, cw, ch, W, H, peakIndex, dayTotals, maxV };
}

// indice do dia mais proximo de um X de mouse (coordenadas do MESMO viewBox usado
// em usageStackLayers), limitado as bordas da serie.
export function usageHoverIndex(mouseX, geo) {
  const n = geo.xs.length;
  if (n <= 1) return 0;
  const step = geo.cw / (n - 1);
  const idx = Math.round((mouseX - geo.padL) / step);
  return Math.max(0, Math.min(n - 1, idx));
}

// matriz Tipo x Modelo pro periodo pedido (dias, as chaves de usageDayKeysBack).
// matrixSeries vem inteiro do backend (usage.js), com granularidade diaria, quem
// soma o periodo escolhido e esta funcao, do mesmo jeito que o resto da tela soma
// series no cliente. Celula sem dado no periodo vem zerada, nao ausente.
export function usageMatrixRows(matrixSeries, kindNames, modelNames, days, metric) {
  const daySet = new Set(days);
  const vals = kindNames.map(() => modelNames.map(() => 0));
  for (const entry of matrixSeries) {
    if (!daySet.has(entry.day)) continue;
    kindNames.forEach((k, i) => {
      const row = entry.cells[k] || {};
      modelNames.forEach((m, j) => { vals[i][j] += usageMetricVal(row[m], metric); });
    });
  }
  const rowTotals = vals.map(row => row.reduce((a, b) => a + b, 0));
  const colTotals = modelNames.map((_, j) => vals.reduce((a, row) => a + row[j], 0));
  const grand = rowTotals.reduce((a, b) => a + b, 0);
  const cellMax = Math.max(1e-9, ...vals.flat());
  const rows = kindNames.map((k, i) => ({
    kind: k,
    cells: modelNames.map((m, j) => ({ model: m, value: vals[i][j], intensity: vals[i][j] / cellMax })),
    total: rowTotals[i],
  }));
  return { rows, colTotals, grand };
}

// _resto e a fatia reconciliada de um dia sem detalhamento (registro anterior aos
// buckets cruzados da v2.38.0, ou sessao gravada por versao antiga no meio do dia):
// o engine garante que soma(camadas) == serie do dia, e essa camada e a diferenca.
export const USAGE_KIND_LABEL = { review: 'Revisão', pushback: 'Contestação', tool: 'Ferramentas', chat: 'Chat', outro: 'Outro', _resto: 'Sem detalhamento' };

// Desfecho da sessão. Status desconhecido (registro de uma versão futura, arquivo
// editado à mão) cai em 'ok' na leitura, que é o comportamento que sempre valeu.
export const USAGE_ST_LABEL = {
  ok: 'ok', erro: 'erro', cancelada: 'cancelada', parcial: 'parcial', descartada: 'descartada', interrompida: 'interrompida',
};

// o carimbo de versao por sessao (campo `farol`) nasceu na v2.42.0: sessao sem
// o campo e, por definicao, anterior a essa versao. Constante FIXA, nunca
// acompanha a versao atual do app.
export const FAROL_STAMP_SINCE = '2.42.0';

export const FAROL_PRE_STAMP_LABEL = `< ${FAROL_STAMP_SINCE}`;

// linha pronta pra tabela de Sessoes recentes: rotulo de tipo, referencia (com
// fallback sem travessao), tokens somados, custo com 2 casas e o estado (ok/erro).
/* Como a coluna de custo se apresenta, conforme a ORIGEM do número.

   Custo estimado ganha til na frente: sessão que morreu no meio tem token medido e um
   custo que não existe em lugar nenhum do stream, então o valor entra na conta (o
   dinheiro foi gasto de verdade) sem se passar por medição. `sem-base` é o caso em que
   nem estimar deu, e aí a coluna diz isso em vez de mostrar um zero que mente para
   baixo. Registro antigo não tem o campo e é lido como medido, que é o que ele era. */
function custoDaSessao(s) {
  const valor = (s.costUsd || 0).toFixed(2);
  if (s.costSource === 'sem-base' || s.costSource === 'desconhecido') {
    return {
      costLabel: 'não medido',
      costTitle: 'a sessão morreu antes de reportar o custo e ainda não há sessão concluída deste tipo e modelo pra estimar a taxa',
    };
  }
  if (s.costSource === 'estimado') {
    return {
      costLabel: `~${valor}`,
      costTitle: 'custo estimado pela taxa que as sessões concluídas mediram; a sessão morreu antes de reportar o valor',
    };
  }
  return { costLabel: valor, costTitle: '' };
}

export function usageSessionRow(s, agora = Date.now()) {
  return {
    whenLabel: fmtWhenDay(s.at, agora),
    kindLabel: USAGE_KIND_LABEL[s.kind] || s.kind,
    ref: s.ref || '(sem referência)',
    model: s.model || '',
    // versao do Farol que gravou a sessao. Sessao antiga (antes desta feature)
    // nao tem o campo: mostra o rotulo de pre-carimbo (regra de EXIBICAO, o
    // registro em usage-sessions.json continua intocado, sem retro-carimbo).
    farol: s.farol || FAROL_PRE_STAMP_LABEL,
    tokLabel: fmtTok((s.inputTokens || 0) + (s.outputTokens || 0)),
    ...custoDaSessao(s),
    // 'cancelada' existe desde a v2.40.0 (sessão morta pelo usuário DEPOIS do result:
    // gastou, mas não concluiu); antes caía como 'ok', indistinguível de concluída.
    // 'parcial' e 'descartada' entraram em 31/08/2026 e fecham a auditoria: a primeira
    // é a sessão que morreu no meio, a segunda é a que terminou e teve o RESULTADO
    // jogado fora (commit novo durante a análise), que até então contava como 'ok'.
    stLabel: USAGE_ST_LABEL[s.status] || 'ok',
    stClass: USAGE_ST_LABEL[s.status] ? s.status : 'ok',
  };
}

export function fmtUsageMetric(v, metric) { return metric === 'custo' ? fmtMoney(v) : fmtCompact(v); }

// cor por camada: fixa pro tipo (bate com o mock), ciclica pras outras dimensoes
// (modelo/conta), que tem quantidade variavel de nomes. _resto (a fatia
// reconciliada sem detalhamento) e SEMPRE apagado, em qualquer dimensao: e
// registro antigo, nao pode parecer uma serie de verdade.
export const USAGE_KIND_COLOR = { review: 'var(--accent)', chat: 'var(--ok)', tool: '#b394f0', pushback: 'var(--danger)', outro: 'var(--faint)', _resto: 'var(--faint)' };

export const USAGE_PALETTE = ['var(--accent)', 'var(--info)', 'var(--ok)', '#b394f0', 'var(--danger)', 'var(--faint)'];

export function usageColorsFor(dim, names) {
  if (dim === 'kind') return names.map(n => USAGE_KIND_COLOR[n] || 'var(--faint)');
  return names.map((n, i) => n === '_resto' ? 'var(--faint)' : USAGE_PALETTE[i % USAGE_PALETTE.length]);
}

export function usageTooltipHtml(day, vals, names, labels, colors, metric, idx, geo, W) {
  const total = vals.reduce((a, b) => a + b, 0);
  const leftPct = Math.min(82, Math.max(4, (geo.xs[idx] / W) * 100));
  const rows = names.map((n, i) => vals[i] > 0 ? `<div class="ut-row"><span class="dot" style="background:${colors[i]}"></span><span>${esc(labels[n] || n)}</span><b>${esc(fmtUsageMetric(vals[i], metric))}</b></div>` : '').join('');
  return `<div class="usage-tooltip" style="left:${leftPct}%"><div class="ut-head">${esc(day.slice(8, 10))}/${esc(day.slice(5, 7))} · ${esc(fmtUsageMetric(total, metric))}</div>${rows}</div>`;
}

export function usageKpisHtml(u, win) {
  const map = {}; for (const d of (u.series || [])) map[d.day] = d;
  const janela = usageDayKeysBack(win).map(day => map[day]);
  const anteriorKeys = usageDayKeysBack(win * 2).slice(0, win);
  const anterior = anteriorKeys.map(day => map[day]);
  const primeiroDia = (u.series && u.series[0] && u.series[0].day) || null;
  const comparavel = win * 2 <= ((u.retentionDays) || 120) && !!primeiroDia && primeiroDia <= anteriorKeys[0];
  const soma = (list, m) => list.reduce((a, d) => a + usageMetricVal(d, m), 0);
  const curCost = soma(janela, 'custo');
  const curTok = soma(janela, 'total');
  const curSess = janela.reduce((a, d) => a + ((d || {}).sessions || 0), 0);
  const curCache = soma(janela, 'cache');
  const antCost = comparavel ? soma(anterior, 'custo') : 0;
  const antTok = comparavel ? soma(anterior, 'total') : 0;
  const antSess = comparavel ? anterior.reduce((a, d) => a + ((d || {}).sessions || 0), 0) : 0;
  const hoje = map[usageDayKeysBack(1)[0]] || {};
  const ontemKey = usageDayKeysBack(2)[0];
  const ontem = map[ontemKey] || {};
  const spark14 = usageDayKeysBack(14).map(day => usageMetricVal(map[day], 'custo'));

  const card = (label, big, sub, delta, vals) => {
    const { line, area } = sparklinePath(vals, 100, 26);
    return `<div class="usage-kpi">
      <div class="usage-kpi-head"><span class="usage-kpi-label">${esc(label)}</span>${delta ? `<span class="usage-kpi-delta">${esc(delta)}</span>` : ''}</div>
      <b>${esc(big)}</b>
      <span class="usage-kpi-sub">${esc(sub)}</span>
      <svg viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true" class="usage-kpi-spark">
        <path d="${area}" fill="var(--accent-soft)"></path>
        <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="1.5" vector-effect="non-scaling-stroke"></path>
      </svg>
    </div>`;
  };

  // o sub do KPI de tokens declara o cache quando houver: "Tokens" (in+out) nao
  // inclui cache em nenhum painel, mas o CUSTO inclui o custo do cache, e sem a
  // linha os dois cartoes vizinhos nao se explicavam (achado da auditoria).
  const tokSub = `${fmtCompact(soma(janela, 'input'))} in · ${fmtCompact(soma(janela, 'output'))} out`
    + (curCache > 0 ? ` · ${fmtCompact(curCache)} cache` : '');
  return [
    card(`Custo estimado · ${win} dias`, fmtMoney(curCost), `~${fmtMoney(curCost / win)} por dia`, usageDelta(curCost, antCost), janela.map(d => usageMetricVal(d, 'custo'))),
    card(`Tokens · ${win} dias`, fmtCompact(curTok), tokSub, usageDelta(curTok, antTok), janela.map(d => usageMetricVal(d, 'total'))),
    card(`Sessões · ${win} dias`, String(curSess), `média de ${(curSess / win).toFixed(1)} por dia`, usageDelta(curSess, antSess), janela.map(d => (d || {}).sessions || 0)),
    card('Hoje', fmtMoney(usageMetricVal(hoje, 'custo')), `${fmtCompact(usageMetricVal(hoje, 'total'))} tokens · ${hoje.sessions || 0} sessões`, usageDelta(usageMetricVal(hoje, 'custo'), usageMetricVal(ontem, 'custo')), spark14),
  ].join('');
}

export function usageMatrixHtml(u, metric, win) {
  const days = usageDayKeysBack(win);
  // nomes PROPRIOS da matriz (matrixKindNames/matrixModelNames): incluem _resto
  // quando algum dia tem fatia sem detalhamento, independente da linha do tempo
  const kindNames = u.matrixKindNames || u.kindNames || [];
  const modelNames = u.matrixModelNames || u.modelNames || [];
  if (!modelNames.length) return { html: '<div class="usage-empty">Sem dados ainda.</div>', caption: '' };
  const m = usageMatrixRows(u.matrixSeries || [], kindNames, modelNames, days, metric);
  if (!m.grand) return { html: '<div class="usage-empty">Sem consumo nesta janela.</div>', caption: '' };
  const caption = metric === 'custo' ? 'custo estimado no período' : 'tokens no período';
  const kindLabel = k => USAGE_KIND_LABEL[k] || k;
  const modelLabelOf = mm => mm === '_resto' ? 'Sem detalhamento' : mm;
  // valor EXATO no title da celula (fmtTok/fmtMoney): as celulas compactadas
  // (43k) nao somam o proprio total a vista, e o title e onde confere sem ruido
  const exact = v => metric === 'custo' ? fmtMoney(v) : fmtTok(v);
  // modelo aposentado nunca some de u.modelNames (byModel, no backend, não tem poda:
  // é histórico permanente), então sem esse filtro a coluna dele ficava pra sempre na
  // matriz, zerada. A linha do tempo já faz o equivalente na legenda (totalPorNome[i]
  // > 0); aqui é a mesma ideia aplicada às colunas (achado da revisão final).
  const idxAtivos = modelNames.map((_, j) => j).filter(j => m.colTotals[j] > 0);
  const modelosAtivos = idxAtivos.map(j => modelNames[j]);
  const cols = `96px repeat(${modelosAtivos.length}, minmax(0,1fr)) 64px`;
  const head = `<div class="usage-matrix-row head" style="grid-template-columns:${cols}"><span></span>${modelosAtivos.map(mm => `<span class="usage-matrix-hcell">${esc(modelLabelOf(mm))}</span>`).join('')}<span class="usage-matrix-hcell">Total</span></div>`;
  const rows = m.rows.filter(r => r.total > 0).map(r => `<div class="usage-matrix-row" style="grid-template-columns:${cols}">
      <span class="usage-matrix-label"><span class="dot" style="background:${USAGE_KIND_COLOR[r.kind] || 'var(--faint)'};width:8px;height:8px;border-radius:2.5px;display:inline-block"></span>${esc(kindLabel(r.kind))}</span>
      ${idxAtivos.map(j => { const c = r.cells[j]; return `<span class="usage-matrix-cell" style="background:color-mix(in srgb, var(--accent) ${((0.04 + 0.24 * c.intensity) * 100).toFixed(0)}%, transparent)" title="${esc(kindLabel(r.kind))} × ${esc(modelLabelOf(c.model))}: ${esc(exact(c.value))}">${esc(fmtUsageMetric(c.value, metric))}</span>`; }).join('')}
      <span class="usage-matrix-total" title="${esc(exact(r.total))}">${esc(fmtUsageMetric(r.total, metric))}</span>
    </div>`).join('');
  const foot = `<div class="usage-matrix-row foot" style="grid-template-columns:${cols}"><span>Total</span>${idxAtivos.map(j => `<span class="usage-matrix-total" title="${esc(exact(m.colTotals[j]))}">${esc(fmtUsageMetric(m.colTotals[j], metric))}</span>`).join('')}<span class="usage-matrix-grand" title="${esc(exact(m.grand))}">${esc(fmtUsageMetric(m.grand, metric))}</span></div>`;
  return { html: `<div class="usage-matrix">${head}${rows}${foot}</div>`, caption };
}

export function usageSessionsHtml(u) {
  const lista = u.recentSessions || [];
  // mensagem curta de proposito: a explicacao completa (o que gera consumo) ja
  // aparece na linha do tempo, logo acima nesta mesma aba; repetir a frase
  // inteira aqui so duplicava as mesmas 25 palavras duas vezes na tela.
  if (!lista.length) return '<div class="usage-empty">Nenhuma sessão ainda.</div>';
  const head = `<div class="usage-sessions-row head">
      <span class="usage-sessions-hcell">Quando</span><span class="usage-sessions-hcell">Tipo</span>
      <span class="usage-sessions-hcell">PR / sessão</span><span class="usage-sessions-hcell">Modelo</span>
      <span class="usage-sessions-hcell">Farol</span>
      <span class="usage-sessions-hcell right">Tokens</span><span class="usage-sessions-hcell right">~US$</span>
      <span class="usage-sessions-hcell right">Estado</span></div>`;
  const rows = lista.map(s => {
    const r = usageSessionRow(s);
    return `<div class="usage-sessions-row">
      <span class="usage-sessions-when">${esc(r.whenLabel)}</span>
      <span class="usage-sessions-kind"><span class="dot" style="background:${USAGE_KIND_COLOR[s.kind] || 'var(--faint)'};width:8px;height:8px;border-radius:2.5px;display:inline-block"></span>${esc(r.kindLabel)}</span>
      ${sessionRefCell(r.ref, 'usage-sessions-ref')}
      <span class="usage-sessions-model">${esc(r.model)}</span>
      <span class="usage-sessions-farol"${r.farol === FAROL_PRE_STAMP_LABEL ? ` title="sessão registrada antes da ${FAROL_STAMP_SINCE}, quando o carimbo de versão passou a existir"` : ''}>${esc(r.farol)}</span>
      <span class="usage-sessions-num">${esc(r.tokLabel)}</span>
      <span class="usage-sessions-num"${r.costTitle ? ` title="${esc(r.costTitle)}"` : ''}>${esc(r.costLabel)}</span>
      <span style="text-align:right"><span class="usage-sessions-st ${r.stClass}">${esc(r.stLabel)}</span></span>
    </div>`;
  }).join('');
  // cobertura declarada: o log individual nasceu na v2.38.0 (10/08/2026); sessoes
  // anteriores existem SO nos agregados (KPI/linha do tempo/matriz, camada "Sem
  // detalhamento"). Sem a data, a tabela parecia ser o historico inteiro.
  const desde = u.sessionsSince ? new Date(u.sessionsSince) : null;
  const p2 = n => String(n).padStart(2, '0');
  const desdeTxt = desde ? `Registro individual desde ${p2(desde.getDate())}/${p2(desde.getMonth() + 1)}/${desde.getFullYear()}; sessões anteriores aparecem só nos agregados. ` : '';
  return `<div class="usage-sessions">${head}${rows}</div>
    ${auditoriaLinhaHtml(u.auditoria)}
    <div class="usage-sessions-foot"><span>${esc(desdeTxt)}Registro permanente, sem botão de zerar.</span><span>Mostrando as ${lista.length} mais recentes</span></div>`;
}

/* Uma linha que responde a pergunta que a tabela sozinha nao responde: quanto do
   gasto virou resultado. Ela existe porque em 30/08/2026 o dia fechou com US$ 94,39
   e 87% do gasto de um tipo de sessao no lixo, e a aba mostrava sucesso em 100% das sessoes: pra
   enxergar o desperdicio foi preciso cruzar dois arquivos na mao.

   So aparece quando ha o que dizer (algum gasto perdido ou estimado): linha fixa
   dizendo "0% perdido" seria ruido em cima de quem esta com tudo certo. PURA. */
export function auditoriaLinhaHtml(a) {
  if (!a || !a.total || !a.total.sessions) return '';
  const perdido = (a.perdido && a.perdido.costUsd) || 0;
  const estimado = (a.estimado && a.estimado.costUsd) || 0;
  if (perdido <= 0 && estimado <= 0) return '';
  const total = (a.total && a.total.costUsd) || 0;
  const pct = total > 0 ? Math.round((perdido / total) * 100) : 0;
  const partes = [];
  if (perdido > 0) {
    partes.push(`<b>${fmtMoney(perdido)}</b> em ${a.perdido.sessions} sessão(ões) que não viraram resultado`
      + (total > 0 ? `, ${pct}% do gasto registrado` : ''));
  }
  if (estimado > 0) {
    partes.push(`<b>${fmtMoney(estimado)}</b> com custo estimado, não medido`);
  }
  return `<div class="usage-sessions-foot audit"><span>Auditoria do registro inteiro: ${partes.join('; ')}.</span></div>`;
}

