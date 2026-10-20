import { toWib } from './util/time.js';
import { summarize, groupBy, periodStats, markClusters, compareEngines, pairSetups, equityCurve, netR } from './statistics/stats.js';

const lifecycleOf = (s) => {
  const r = s.evaluation?.result ?? 'PENDING';
  return r === 'PENDING' ? (s.evaluation?.entryTimeUtc ? 'ACTIVE' : 'WAITING') : r;
};

const view = (s, cl, costs) => ({
  id: s.setupId, engine: s.engine, analysisWib: s.analysisTimeWib, analysisUtc: s.analysisTimeUtc, ticker: s.ticker,
  direction: s.direction, entryType: s.entryType, entry: s.entryPrice, entryRange: s.entryRange, tp: s.takeProfit,
  sl: s.stopLoss, rr: s.riskReward, riskPct: s.riskPercent, reason: s.entryReason, timeframe: s.timeframe,
  originalStatus: s.originalStatus, latestOriginalStatus: s.latestOriginalStatus,
  result: s.evaluation?.result ?? 'PENDING', lifecycle: lifecycleOf(s),
  resultWib: toWib(s.evaluation?.resultTimeUtc), resultTimeSource: s.evaluation?.resultTimeSource ?? null,
  entryWib: toWib(s.evaluation?.entryTimeUtc), r: s.evaluation?.rMultiple ?? null, rNet: netR(s, costs), notes: s.evaluation?.notes ?? [],
  reasonCode: s.evaluation?.reasonCode ?? null, warnings: s.warnings ?? [], clusterId: cl?.clusterId, isPrimary: cl?.isPrimary ?? true,
  analysisTimeSource: s.analysisTimeSource, cohort: s.cohort ?? null, engineVersion: s.engineVersion ?? null,
  priceAtAnalysis: s.priceAtAnalysis ?? null, sourceResult: s.sourceResult ?? null, sourceR: s.sourceR ?? null,
  priceDataError: s.evaluation?.priceDataError ?? null,
});

export function buildDashboard({ setups, diagnostics, cfg, nowIso }) {
  const costs = cfg.costs ?? { feePctPerSide: 0, slipPct: 0 };
  const clusters = markClusters(setups, cfg.cluster);
  const rows = setups.map((s) => view(s, clusters.get(s.setupId), costs)).sort((a, b) => (a.analysisUtc < b.analysisUtc ? 1 : -1));
  const isPrimaryCluster = (s) => clusters.get(s.setupId).isPrimary;
  const clean = (s) => s.cohort === 'primary';

  // Koin yang dicakup kedua mesin (sudah pernah menerbitkan setup yang dapat diverifikasi di keduanya).
  const tickersOf = (e) => new Set(setups.filter((s) => s.engine === e && s.cohort !== 'unverifiable' && s.ticker).map((s) => s.ticker));
  const tA = tickersOf('crypto'), tB = tickersOf('tn');
  const commonUniverse = [...tA].filter((t) => tB.has(t)).sort();
  const inCommon = new Set(commonUniverse);

  // Lingkup: primary = kohort bersih + koin bersama + independen; cohort = kohort bersih, semua koin; all = semua (eksploratori).
  const SCOPES = {
    primary: (s) => clean(s) && isPrimaryCluster(s) && inCommon.has(s.ticker),
    cohort: (s) => clean(s) && isPrimaryCluster(s),
    all: () => true,
  };
  const sopts = { costs, minDaysForCI: cfg.minDaysForCI, minIndependentDays: cfg.minIndependentDays, iterations: cfg.ciIterations ?? 2000 };
  const by = (e, scope) => setups.filter((s) => s.engine === e && SCOPES[scope](s));

  const engines = {};
  for (const scope of Object.keys(SCOPES)) {
    engines[scope] = {};
    for (const e of ['crypto', 'tn']) {
      const l = by(e, scope);
      engines[scope][e] = { summary: summarize(l, sopts), equity: equityCurve(l, costs),
        byTicker: groupBy(l, (s) => s.ticker, sopts), byDirection: groupBy(l, (s) => s.direction, sopts),
        byTimeframe: groupBy(l, (s) => s.timeframe, sopts), byReason: groupBy(l, (s) => s.entryReason, sopts),
        byVersion: groupBy(l, (s) => s.engineVersion ?? 'tidak diketahui', sopts),
        daily: periodStats(l, 'daily'), weekly: periodStats(l, 'weekly'), monthly: periodStats(l, 'monthly') };
    }
  }
  const copts = { minSample: cfg.minSamplePerEngine, minIndependentDays: cfg.minIndependentDays, iterations: cfg.bootstrapIterations, costs };
  // Gerbang protokol (sebelum ini angka kinerja tidak ditampilkan): >= minSamplePerEngine trade DAN >= minIndependentDays minggu, per mesin.
  const gateFor = (scope) => Object.fromEntries(['crypto', 'tn'].map((e) => {
    const sm = engines[scope][e].summary;
    return [e, { trades: sm.resolved, weeks: sm.nDays, needTrades: cfg.minSamplePerEngine, needWeeks: cfg.minIndependentDays, met: sm.resolved >= cfg.minSamplePerEngine && sm.nDays >= cfg.minIndependentDays }];
  }));
  for (const scope of Object.keys(SCOPES)) engines[scope].gate = { ...gateFor(scope), met: ['crypto', 'tn'].every((e) => gateFor(scope)[e].met) };
  const comparison = Object.fromEntries(Object.keys(SCOPES).map((sc) => [sc, compareEngines(by('crypto', sc), by('tn', sc), copts)]));
  const pairs = pairSetups(setups.filter((s) => s.engine === 'crypto'), setups.filter((s) => s.engine === 'tn'), cfg.pairWindowMinutes);
  const lastRun = diagnostics.runs.at(-1) ?? null;
  const quality = {
    staleOnArrival: rows.filter((r) => r.reasonCode === 'STALE_ON_ARRIVAL'),
    invalid: rows.filter((r) => r.result === 'INVALID'), ambiguous: rows.filter((r) => r.result === 'AMBIGUOUS'),
    unverified: rows.filter((r) => r.priceDataError),
    withWarnings: rows.filter((r) => r.warnings.length), nearDuplicates: rows.filter((r) => !r.isPrimary),
    conflicts: pairs.filter((p) => p.relation === 'CONFLICT'),
    sourceDisagreements: rows.filter((r) => ['TP', 'SL'].includes(r.sourceResult) && ['TP', 'SL'].includes(r.result) && r.sourceResult !== r.result),
    unknownAnalysisTime: rows.filter((r) => r.result === 'UNVERIFIABLE' || r.analysisTimeSource === 'unknown_before_tracking'),
    exploratory: rows.filter((r) => r.cohort === 'exploratory'),
  };
  return { generatedAtUtc: nowIso, generatedAtWib: toWib(nowIso), counts: { setups: rows.length },
    engines, comparison, commonUniverse, pairs, setups: rows, quality, diagnostics: { lastRun, runs: diagnostics.runs.slice(-50) },
    protocol: { minSample: cfg.minSamplePerEngine, minIndependentDays: cfg.minIndependentDays, minDaysForCI: cfg.minDaysForCI, unit: 'minggu kalender ISO (UTC)' },
    methodology: { source: 'Binance Spot klines', costs,
      note: 'Hasil teoretis berbasis candle (bukan trading nyata). Fill saat harga menyentuh level. R bersih = R kotor dikurangi fee dua sisi dan slippage exit SL (asumsi, lihat costs).' } };
}

/* ---------- pemecahan keluaran dashboard ---------- */
const QUALITY_CAP = 500;
const topGroups = (obj, n) => Object.fromEntries(Object.entries(obj).sort((a, b) => b[1].resolved - a[1].resolved).slice(0, n));

/**
 * Memecah hasil buildDashboard menjadi file kecil yang dimuat sesuai kebutuhan:
 *  summary  : statistik, indeks bulan, diagnostik (selalu dimuat, kecil)
 *  live     : semua setup PENDING dari SEMUA bulan
 *  quality  : daftar masalah kualitas (dibatasi QUALITY_CAP terbaru per daftar, total tetap dicatat)
 *  months   : { 'YYYY-MM': baris setup bulan itu }
 */
export function splitDashboard(full) {
  const months = {};
  for (const r of full.setups) {
    const m = /^\d{4}-\d{2}/.test(r.analysisUtc ?? '') ? r.analysisUtc.slice(0, 7) : 'unknown';
    (months[m] ||= []).push(r);
  }
  const index = Object.entries(months).map(([month, rows]) => ({
    month, setups: rows.length,
    pending: rows.filter((r) => r.result === 'PENDING').length,
    resolved: rows.filter((r) => r.result === 'TP' || r.result === 'SL').length,
    file: `setups-${month}.json`,
  })).sort((a, b) => (a.month < b.month ? 1 : -1));

  const engines = {};
  for (const [scope, byEngine] of Object.entries(full.engines)) {
    engines[scope] = {};
    engines[scope].gate = byEngine.gate;
    for (const [e, v] of Object.entries(byEngine)) {
      if (e === 'gate') continue;
      engines[scope][e] = { ...v, byReason: topGroups(v.byReason, 50), daily: v.daily.slice(-90), weekly: v.weekly.slice(-60) };
    }
  }

  const q = full.quality, totals = {}, quality = {};
  for (const [k, arr] of Object.entries(q)) { totals[k] = arr.length; quality[k] = arr.slice(0, QUALITY_CAP); }
  quality.totals = totals;
  quality.cap = QUALITY_CAP;
  const qualityCounts = { ...totals, unknownAnalysisTimeCrypto: q.unknownAnalysisTime.filter((r) => r.engine === 'crypto').length };

  const live = { generatedAtUtc: full.generatedAtUtc, setups: full.setups.filter((r) => r.result === 'PENDING') };
  const summary = {
    generatedAtUtc: full.generatedAtUtc, generatedAtWib: full.generatedAtWib,
    counts: { setups: full.setups.length, pending: live.setups.length, months: index.length },
    months: index, engines, comparison: full.comparison, commonUniverse: full.commonUniverse, protocol: full.protocol,
    pairs: full.pairs.slice(0, 200), pairsTotal: full.pairs.length,
    qualityCounts, diagnostics: full.diagnostics, methodology: full.methodology,
  };
  return { summary, live, quality, months };
}
