import { toWib, MIN } from '../util/time.js';

export const STATUSES = ['PENDING', 'TP', 'SL', 'CANCELLED', 'EXPIRED', 'INVALID', 'AMBIGUOUS', 'UNVERIFIABLE'];
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const ev = (s) => s.evaluation || { result: 'PENDING' };
const isResolved = (s) => ev(s).result === 'TP' || ev(s).result === 'SL';
const ZERO_COSTS = { feePctPerSide: 0, slipPct: 0 };

/** Unit independensi: hari analisis (UTC). Satu mesin menerbitkan banyak setup sekaligus pada satu batch/hari,
 *  dan setup itu bergerak bersama pasar, sehingga 20 setup di hari yang sama bukan 20 observasi independen. */
/** Minggu kalender ISO (UTC) dari waktu analisis. Unit independensi resmi sesuai protokol Mesin 2. */
export function isoWeekKey(iso) {
  const d = new Date(iso); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear(), w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
export const dayKey = (s) => isoWeekKey(s.analysisTimeUtc);
export const batchKey = (s) => `${s.engine}|${String(s.analysisTimeUtc).slice(0, 16)}`;

/** R bersih setelah biaya: fee dua sisi + slippage pada exit SL (stop = order market). Dalam satuan R. */
export function netR(s, costs = ZERO_COSTS) {
  const e = ev(s), gross = e.rMultiple;
  if (!Number.isFinite(gross)) return null;
  const fill = e.entryFill, risk = Math.abs(fill - s.stopLoss);
  if (!Number.isFinite(fill) || !(risk > 0)) return gross;
  // Protokol Mesin 2 (forward-lib.mjs costPct): 2 x fee per sisi + slip, pada SEMUA trade terisi.
  const pct = 2 * (costs.feePctPerSide ?? 0) + (costs.slipPct ?? 0);
  return gross - (pct / 100) * fill / risk;
}

export function wilson(w, n, z = 1.96) {
  if (!n) return null;
  const p = w / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

export function maxDrawdownR(rs) {
  let cum = 0, peak = 0, dd = 0;
  for (const r of rs) { cum += r; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); }
  return dd;
}

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const quant = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];

/** Bootstrap berkluster: yang diacak adalah HARI (beserta seluruh trade di hari itu), bukan trade. */
function clusterBootstrap(groups, iterations, seed) {
  const rand = rng(seed), D = groups.length, exp = [], net = [], win = [];
  for (let i = 0; i < iterations; i++) {
    let n = 0, sr = 0, sn = 0, w = 0;
    for (let d = 0; d < D; d++) { const g = groups[Math.floor(rand() * D)]; n += g.length; for (const x of g) { sr += x.r; sn += x.rn; if (x.r > 0) w++; } }
    exp.push(sr / n); net.push(sn / n); win.push(w / n);
  }
  const ci = (a) => { a.sort((x, y) => x - y); return [quant(a, 0.025), quant(a, 0.975)]; };
  return { expectancyCI: ci(exp), netExpectancyCI: ci(net), winRateCI: ci(win) };
}
const groupByDay = (list, costs) => { // dikelompokkan per minggu ISO (lihat dayKey)
  const m = new Map();
  for (const s of list) { const k = dayKey(s); (m.get(k) || m.set(k, []).get(k)).push({ r: ev(s).rMultiple, rn: netR(s, costs) }); }
  return m;
};

/**
 * Statistik satu kelompok. Hanya TP/SL yang dihitung menang/kalah.
 * opts: { costs, minDaysForCI=5, minIndependentDays=20, iterations=2000, seed=7, noCI }
 */
export function summarize(list, opts = {}) {
  const costs = opts.costs ?? ZERO_COSTS, minDaysForCI = opts.minDaysForCI ?? 5, minDays = opts.minIndependentDays ?? 20;
  const counts = Object.fromEntries(STATUSES.map((k) => [k, 0]));
  list.forEach((s) => { counts[ev(s).result] = (counts[ev(s).result] || 0) + 1; });
  const resolved = list.filter(isResolved).sort((a, b) => Date.parse(ev(a).resultTimeUtc) - Date.parse(ev(b).resultTimeUtc));
  const n = resolved.length;
  const rs = resolved.map((s) => ev(s).rMultiple), rn = resolved.map((s) => netR(s, costs));
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const wins = rs.filter((r) => r > 0), losses = rs.filter((r) => r < 0);
  const nWins = rn.filter((r) => r > 0), nLoss = rn.filter((r) => r < 0);
  const triggered = list.filter((s) => ev(s).entryTimeUtc);
  const published = list.length - counts.UNVERIFIABLE;
  const active = list.filter((s) => ev(s).result === 'PENDING' && ev(s).entryTimeUtc).length;
  const stale = list.filter((s) => ev(s).result === 'EXPIRED' && ev(s).reasonCode === 'STALE_ON_ARRIVAL').length;
  const plannedRR = mean(resolved.map((s) => s.riskReward).filter(Number.isFinite));
  const days = groupByDay(resolved, costs), nDays = days.size; // nDays = jumlah MINGGU independen
  const nBatches = new Set(resolved.map(batchKey)).size;
  const top = [...days].sort((a, b) => b[1].length - a[1].length)[0];
  const dominance = top ? { day: top[0], trades: top[1].length, share: top[1].length / n } : null;
  const sd = n > 1 ? Math.sqrt(sum(rn.map((r) => (r - sum(rn) / n) ** 2)) / (n - 1)) : null;

  const warnings = [];
  if (n > 0 && nDays < minDays) warnings.push('LOW_EFFECTIVE_SAMPLE');
  if (n > 0 && nDays < minDaysForCI) warnings.push('CI_NOT_COMPUTABLE');
  if (dominance && n >= 5 && dominance.share > 0.5) warnings.push('DAY_DOMINANCE');

  let clusterCI = null;
  if (!opts.noCI && nDays >= minDaysForCI) clusterCI = clusterBootstrap([...days.values()], opts.iterations ?? 2000, opts.seed ?? 7);

  return {
    published, unverifiable: counts.UNVERIFIABLE, triggered: triggered.length, counts,
    lifecycle: { waiting: counts.PENDING - active, active }, staleOnArrival: stale, staleRate: published ? stale / published : null,
    resolved: n, winRate: n ? counts.TP / n : null, winRateCI95: wilson(counts.TP, n), // CI naif: mengasumsikan trade independen
    expectancyR: n ? sum(rs) / n : null, expectancyNetR: n ? sum(rn) / n : null,
    totalR: n ? sum(rs) : 0, totalNetR: n ? sum(rn) : 0,
    avgR: n ? sum(rs) / n : null,
    profitFactor: losses.length ? sum(wins) / Math.abs(sum(losses)) : null,
    profitFactorNet: nLoss.length ? sum(nWins) / Math.abs(sum(nLoss)) : null,
    avgWinR: wins.length ? mean(wins) : null, avgLossR: losses.length ? mean(losses) : null,
    plannedRR, breakEvenWinRate: plannedRR ? 1 / (1 + plannedRR) : null,
    maxDrawdownR: maxDrawdownR(rs), maxDrawdownNetR: maxDrawdownR(rn),
    sqn: nDays >= minDays && n >= 150 && sd ? Math.sqrt(n) * (sum(rn) / n) / sd : null,
    nDays, nBatches, dominance, clusterCI, warnings,
    avgMinutesToEntry: mean(triggered.map((s) => (Date.parse(ev(s).entryTimeUtc) - Date.parse(s.analysisTimeUtc)) / MIN)),
    avgMinutesToResult: mean(resolved.map((s) => (Date.parse(ev(s).resultTimeUtc) - Date.parse(s.analysisTimeUtc)) / MIN)),
  };
}

/** Kurva ekuitas kumulatif (R) berdasarkan waktu hasil. Dipangkas ke maxPoints titik untuk dashboard. */
export function equityCurve(list, costs = ZERO_COSTS, maxPoints = 400) {
  const rows = list.filter(isResolved).sort((a, b) => Date.parse(ev(a).resultTimeUtc) - Date.parse(ev(b).resultTimeUtc));
  let g = 0, n = 0;
  const pts = rows.map((s) => { g += ev(s).rMultiple; n += netR(s, costs); return { t: ev(s).resultTimeUtc, gross: +g.toFixed(3), net: +n.toFixed(3) }; });
  if (pts.length <= maxPoints) return pts;
  const step = pts.length / maxPoints;
  return Array.from({ length: maxPoints }, (_, i) => pts[Math.min(pts.length - 1, Math.floor(i * step))]).concat(pts.at(-1));
}

export function groupBy(list, keyFn, opts = {}) {
  const g = new Map();
  for (const s of list) { const k = keyFn(s) ?? '(tidak tersedia)'; (g.get(k) || g.set(k, []).get(k)).push(s); }
  return Object.fromEntries([...g].sort().map(([k, v]) => [k, summarize(v, { ...opts, noCI: true })]));
}

function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = d.getUTCFullYear(), w = Math.ceil(((d - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
/** Periode berdasarkan tanggal HASIL dalam WIB. */
export function periodStats(list, kind) {
  const resolved = list.filter((s) => ['TP', 'SL'].includes(ev(s).result));
  const key = (s) => { const d = toWib(ev(s).resultTimeUtc).slice(0, 10);
    return kind === 'weekly' ? isoWeek(d) : kind === 'monthly' ? d.slice(0, 7) : d; };
  const g = new Map();
  for (const s of resolved) (g.get(key(s)) || g.set(key(s), []).get(key(s))).push(s);
  return [...g].sort(([a], [b]) => (a < b ? -1 : 1)).map(([period, l]) => {
    const m = summarize(l); return { period, resolved: m.resolved, tp: m.counts.TP, sl: m.counts.SL, totalR: m.totalR };
  });
}

/** Klaster near-duplicate: engine+simbol+arah sama, waktu dekat, entry berdekatan. Primary = yang pertama. */
export function markClusters(list, { windowHours = 24, entryTolerance = 0.01 } = {}) {
  const out = new Map(), open = [];
  const sorted = [...list].sort((a, b) => Date.parse(a.analysisTimeUtc) - Date.parse(b.analysisTimeUtc));
  for (const s of sorted) {
    const t = Date.parse(s.analysisTimeUtc);
    const head = open.find((h) => h.engine === s.engine && h.symbol === s.symbol && h.direction === s.direction
      && t - Date.parse(h.analysisTimeUtc) <= windowHours * 3600_000
      && h.entryPrice && s.entryPrice && Math.abs(s.entryPrice - h.entryPrice) / h.entryPrice <= entryTolerance);
    if (head) out.set(s.setupId, { clusterId: head.setupId, isPrimary: false });
    else { open.push(s); out.set(s.setupId, { clusterId: s.setupId, isPrimary: true }); }
  }
  return out;
}


/**
 * Bandingkan expectancy NET (R) dua mesin dengan bootstrap berkluster per hari.
 * Tidak menyatakan "lebih baik" kecuali: tiap mesin >= minSample trade DAN >= minIndependentDays minggu independen,
 * dan CI95 selisih tidak mencakup 0. Kriteria ditetapkan di muka (docs/PROTOCOL.md).
 */
export function compareEngines(listA, listB, { minSample = 150, minIndependentDays = 20, iterations = 5000, seed = 42, costs = ZERO_COSTS } = {}) {
  const A = listA.filter(isResolved), B = listB.filter(isResolved);
  const gA = groupByDay(A, costs), gB = groupByDay(B, costs);
  const mA = A.length ? mean(A.map((s) => netR(s, costs))) : null, mB = B.length ? mean(B.map((s) => netR(s, costs))) : null;
  const res = { nA: A.length, nB: B.length, weeksA: gA.size, weeksB: gB.size, minSample, minIndependentDays,
    metric: 'expectancyNetR', expectancyA: mA, expectancyB: mB, diff: null, ci95: null, verdict: 'INSUFFICIENT_SAMPLE', reasons: [],
    caveat: 'Selisih diuji dengan bootstrap per hari. Hasil teoretis berbasis candle; bukan bukti kausal dan bukan trading nyata.' };
  if (!A.length || !B.length) { res.reasons.push('salah satu mesin belum punya trade selesai'); return res; }
  res.diff = mA - mB;
  if (A.length < minSample) res.reasons.push(`Mesin 1: ${A.length} trade < ${minSample}`);
  if (B.length < minSample) res.reasons.push(`Mesin 2: ${B.length} trade < ${minSample}`);
  if (gA.size < minIndependentDays) res.reasons.push(`Mesin 1: ${gA.size} minggu independen < ${minIndependentDays}`);
  if (gB.size < minIndependentDays) res.reasons.push(`Mesin 2: ${gB.size} minggu independen < ${minIndependentDays}`);
  if (res.reasons.length) return res;
  const rand = rng(seed), ga = [...gA.values()], gb = [...gB.values()], diffs = [];
  const boot = (g) => { let n = 0, s = 0; for (let d = 0; d < g.length; d++) { const x = g[Math.floor(rand() * g.length)]; n += x.length; for (const t of x) s += t.rn; } return s / n; };
  for (let i = 0; i < iterations; i++) diffs.push(boot(ga) - boot(gb));
  diffs.sort((x, y) => x - y);
  res.ci95 = [diffs[Math.floor(0.025 * iterations)], diffs[Math.floor(0.975 * iterations)]];
  res.verdict = res.ci95[0] > 0 ? 'CRYPTO_BETTER' : res.ci95[1] < 0 ? 'TN_BETTER' : 'NO_SIGNIFICANT_DIFFERENCE';
  return res;
}

/** Pasangan setup lintas mesin: simbol sama + waktu berdekatan. Arah berbeda = CONFLICT, bukan setup yang sama. */
export function pairSetups(a, b, windowMinutes = 120) {
  const used = new Set(), pairs = [];
  const cand = [];
  for (const x of a) for (const y of b) {
    if (x.symbol && x.symbol === y.symbol) {
      const dt = Math.abs(Date.parse(x.analysisTimeUtc) - Date.parse(y.analysisTimeUtc)) / MIN;
      if (dt <= windowMinutes) cand.push({ x, y, dt });
    }
  }
  cand.sort((p, q) => p.dt - q.dt);
  for (const { x, y, dt } of cand) {
    if (used.has(x.setupId) || used.has(y.setupId)) continue;
    used.add(x.setupId); used.add(y.setupId);
    const pct = (u, v) => (u != null && v != null && v !== 0 ? (u - v) / v : null);
    pairs.push({ symbol: x.symbol, minutesApart: dt, sameDirection: x.direction === y.direction,
      relation: x.direction === y.direction ? 'COMPARABLE' : 'CONFLICT',
      crypto: { id: x.setupId, direction: x.direction, entry: x.entryPrice, tp: x.takeProfit?.[0] ?? null, sl: x.stopLoss, result: ev(x).result, r: ev(x).rMultiple ?? null },
      tn: { id: y.setupId, direction: y.direction, entry: y.entryPrice, tp: y.takeProfit?.[0] ?? null, sl: y.stopLoss, result: ev(y).result, r: ev(y).rMultiple ?? null },
      entryDiffPct: pct(x.entryPrice, y.entryPrice), tpDiffPct: pct(x.takeProfit?.[0], y.takeProfit?.[0]), slDiffPct: pct(x.stopLoss, y.stopLoss) });
  }
  return pairs;
}
