import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import { extractCryptoCards } from '../src/parsers/crypto.js';
import { parseJournalEntry, verifyChain } from '../src/parsers/tn.js';
import { buildRecord } from '../src/normalize.js';
import { applyRevisionPolicy } from '../src/revision.js';
import { fetchEngineVersion } from '../src/scrapers/version.js';
import { evaluateSetup } from '../src/evaluator/evaluate.js';
import { summarize, netR, equityCurve, compareEngines } from '../src/statistics/stats.js';
import { makeProvider, series, T0, suiShort } from './helpers.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-p1-'));
process.env.DATA_DIR = path.join(tmp, 'data');
const { collect, evaluateAll, migrateLegacy } = await import('../src/index.js');
const store = await import('../src/storage/store.js');

const fx = (f) => new URL(`./fixtures/${f}`, import.meta.url);
const journal = JSON.parse(fs.readFileSync(fx('tn-journal-real.json'), 'utf8'));
const cryptoItems = extractCryptoCards(parseHTML(fs.readFileSync(fx('crypto-setups.html'), 'utf8')).document).items;
const ctx = { scanTimeMs: Date.parse('2026-10-17T06:00:00Z'), firstRun: false, sourceUrl: 'u' };

/* ---------- jurnal Mesin 2 nyata (97 entri) ---------- */
test('jurnal nyata: rantai hash utuh (82 entri fwd, seq 1..82, prev->h tersambung)', () => {
  const c = verifyChain(journal);
  assert.equal(journal.length, 97);
  assert.equal(c.n, 82); assert.equal(c.ok, true); assert.equal(c.brokenFromSeq, null);
  assert.equal(c.contentVerified, false); // isi hash belum bisa diverifikasi mandiri
});

test('jurnal nyata: 97 entri hanya 7 batch pada 5 hari analisis', () => {
  const recs = journal.map((e) => buildRecord(parseJournalEntry(e, { chain: verifyChain(journal) }), ctx));
  assert.equal(new Set(recs.map((r) => r.analysisTimeUtc.slice(0, 16))).size, 7);
  assert.equal(new Set(recs.map((r) => r.analysisTimeUtc.slice(0, 10))).size, 5);
});

test('jurnal nyata: kohort utama = 82 entri berantai; 15 entri pra-protokol = eksploratori', () => {
  const chain = verifyChain(journal);
  const recs = journal.map((e) => buildRecord(parseJournalEntry(e, { chain }), ctx));
  assert.equal(recs.filter((r) => r.cohort === 'primary').length, 82);
  assert.equal(recs.filter((r) => r.cohort === 'exploratory').length, 15);
  assert.ok(recs.filter((r) => r.cohort === 'exploratory').every((r) => r.chainSeq === null && r.engineVersion === null));
  assert.ok(recs.filter((r) => r.cohort === 'primary').every((r) => r.engineVersion === '0537067ed55fc5be'));
});

test('jurnal nyata: R rencana selalu 2, SL minimal 3%, harga saat terbit terbaca', () => {
  const recs = journal.map((e) => buildRecord(parseJournalEntry(e, { chain: verifyChain(journal) }), ctx));
  assert.ok(recs.every((r) => r.riskReward >= 1.99 && r.riskReward <= 2.01), 'TP = 2R by construction');
  assert.ok(recs.every((r) => Math.abs(r.entryPrice - r.stopLoss) / r.entryPrice >= 0.0299));
  assert.ok(recs.every((r) => r.priceAtAnalysis > 0));
  assert.ok(recs.every((r) => !r.warnings.some((w) => w.startsWith('TIME_MISMATCH'))));
});

test('tanpa verifikasi rantai, entri fwd TIDAK menjadi kohort utama; rantai putus menurunkan entri sesudahnya', () => {
  const noChain = buildRecord(parseJournalEntry(journal.find((e) => e.fwd === 1), {}), ctx);
  assert.equal(noChain.cohort, 'exploratory'); assert.ok(noChain.warnings.includes('CHAIN_NOT_VERIFIED'));
  const tampered = structuredClone(journal);
  tampered.find((e) => e.seq === 40).prev = 'rusak';
  const chain = verifyChain(tampered);
  assert.equal(chain.ok, false); assert.equal(chain.brokenFromSeq, 40);
  const before = buildRecord(parseJournalEntry(tampered.find((e) => e.seq === 39), { chain }), ctx);
  const after = buildRecord(parseJournalEntry(tampered.find((e) => e.seq === 40), { chain }), ctx);
  assert.equal(before.cohort, 'primary'); assert.equal(after.cohort, 'exploratory');
});

/* ---------- versi mesin ---------- */
test('versi mesin: deterministik, abaikan CRLF, null bila satu berkas gagal', async () => {
  const mk = (map) => async (u) => { const k = u.split('?')[0]; return map[k] ? { ok: true, text: async () => map[k] } : { ok: false, status: 404 }; };
  const f1 = mk({ 'https://x/e.mjs': 'a\nb', 'https://x/v.mjs': 'c' });
  const a = await fetchEngineVersion(['https://x/e.mjs', 'https://x/v.mjs'], f1);
  const b = await fetchEngineVersion(['https://x/e.mjs', 'https://x/v.mjs'], mk({ 'https://x/e.mjs': 'a\r\nb', 'https://x/v.mjs': 'c' }));
  assert.equal(a.id.length, 16); assert.equal(a.id, b.id);
  const c = await fetchEngineVersion(['https://x/e.mjs', 'https://x/v.mjs'], mk({ 'https://x/e.mjs': 'a\nb!', 'https://x/v.mjs': 'c' }));
  assert.notEqual(a.id, c.id);
  const bad = await fetchEngineVersion(['https://x/e.mjs', 'https://x/missing.mjs'], f1);
  assert.equal(bad.id, null);
});

/* ---------- aturan revisi ---------- */
const head = (over = {}) => ({ setupId: 'h1', engine: 'crypto', symbol: 'XAUTUSDT', ticker: 'XAUT', direction: 'LONG', entryType: 'limit',
  entryPrice: 4155, takeProfit: [4304.8], stopLoss: 4068.8, analysisTimeUtc: '2026-10-16T13:54:00.000Z', cohort: 'primary',
  evaluation: { result: 'PENDING' }, ...over });
const rec = (over = {}) => ({ ...head(), setupId: 'new', takeProfit: [4297.2], stopLoss: 4068.5, evaluation: undefined, ...over });
const NOW = Date.parse('2026-10-17T00:00:00Z'), POL = { entryTolerance: 0.01, cooldownHours: 24 };

test('revisi: level bergeser = revisi (bukan setup baru); level yang dievaluasi tetap level pertama', () => {
  const r = applyRevisionPolicy([head()], [rec()], POL, NOW);
  assert.equal(r.merged, 1);
  assert.equal(r.records[0].setupId, 'h1');
  assert.deepEqual(Object.keys(r.events[0].changes).sort(), ['sl', 'tp']);
  assert.deepEqual(r.events[0].changes.tp, [4304.8, 4297.2]);
});

test('revisi: sudah dicatat tidak dicatat lagi; hanya perubahan baru yang dicatat', () => {
  const r1 = applyRevisionPolicy([head()], [rec()], POL, NOW);
  const r2 = applyRevisionPolicy([head()], [rec()], POL, NOW, r1.lastLevels);
  assert.equal(r2.events.length, 0);
  const r3 = applyRevisionPolicy([head()], [rec({ takeProfit: [4292.7] })], POL, NOW, r2.lastLevels);
  assert.deepEqual(Object.keys(r3.events[0].changes), ['tp']);
});

test('revisi: entry jauh, arah beda, atau koin lain = setup baru', () => {
  assert.equal(applyRevisionPolicy([head()], [rec({ entryPrice: 4300 })], POL, NOW).merged, 0);
  assert.equal(applyRevisionPolicy([head()], [rec({ direction: 'SHORT' })], POL, NOW).merged, 0);
  assert.equal(applyRevisionPolicy([head()], [rec({ symbol: 'BTCUSDT' })], POL, NOW).merged, 0);
});

test('revisi: induk selesai bergabung selama cooldown, lalu menjadi peluang baru', () => {
  const done = head({ evaluation: { result: 'SL', resultTimeUtc: '2026-10-16T20:00:00.000Z' } });
  assert.equal(applyRevisionPolicy([done], [rec()], POL, Date.parse('2026-10-17T06:00:00Z')).merged, 1); // 10 jam setelah selesai
  assert.equal(applyRevisionPolicy([done], [rec()], POL, Date.parse('2026-10-18T00:00:00Z')).merged, 0); // 28 jam
});

test('revisi: setup tidak-terverifikasi tidak menyerap kemunculan berikutnya', () => {
  const unv = head({ cohort: 'unverifiable', evaluation: { result: 'UNVERIFIABLE' } });
  const r = applyRevisionPolicy([unv], [rec()], POL, NOW);
  assert.equal(r.merged, 0); assert.equal(r.records[0].setupId, 'new');
});

/* ---------- evaluator: kelas baru ---------- */
test('STALE_ON_ARRIVAL: harga saat terbit sudah melewati TP -> EXPIRED dengan kode khusus', async () => {
  const NOWMS = T0 + 48 * 3600e3;
  const r = await evaluateSetup(suiShort(), makeProvider(series(T0, 600, [[0, 1.0], [600, 1.0]], 0)), { now: NOWMS });
  assert.equal(r.result, 'EXPIRED'); assert.equal(r.reasonCode, 'STALE_ON_ARRIVAL');
  assert.equal(r.priceAtAnalysis, 1.0); assert.match(r.notes[0], /sudah melewati TP/);
});
test('TP tercapai SETELAH terbit (bukan di awal) tetap TP_REACHED_BEFORE_ENTRY', async () => {
  const r = await evaluateSetup(suiShort(), makeProvider(series(T0, 600, [[0, 1.10], [60, 1.02], [600, 1.0]], 0)), { now: T0 + 48 * 3600e3 });
  assert.equal(r.reasonCode, 'TP_REACHED_BEFORE_ENTRY');
});
test('evaluator: waktu analisis tidak diketahui = UNVERIFIABLE', async () => {
  const r = await evaluateSetup({ ...suiShort(), analysisTimeSource: 'unknown_before_tracking' }, makeProvider([]), { now: T0 });
  assert.equal(r.result, 'UNVERIFIABLE');
});

/* ---------- statistik baru ---------- */
const trade = (id, result, day, extra = {}) => ({ setupId: id, engine: 'crypto', ticker: 'X', stopLoss: 97, riskReward: 2,
  analysisTimeUtc: new Date(Date.UTC(2026, 9, 1 + day, 6)).toISOString(),
  evaluation: { result, rMultiple: result === 'TP' ? 2 : -1, entryFill: 100, entryTimeUtc: 'e', resultTimeUtc: new Date(Date.UTC(2026, 9, 1 + day, 12)).toISOString() }, ...extra });

test('R bersih mengikuti protokol Mesin 2: 2 x fee + slip pada SEMUA trade terisi, dalam satuan R', () => {
  const costs = { feePctPerSide: 0.05, slipPct: 0.05 };  // total 0,15% dari entry; risiko 3% -> 0,05R per trade
  assert.ok(Math.abs(netR(trade('a', 'TP', 0), costs) - (2 - 0.15 / 3)) < 1e-9);
  assert.ok(Math.abs(netR(trade('b', 'SL', 0), costs) - (-1 - 0.15 / 3)) < 1e-9);
});

test('metrik: profit factor, rata-rata menang/kalah, win rate impas dari R rencana', () => {
  const l = [trade('1', 'TP', 0), trade('2', 'TP', 1), trade('3', 'SL', 2), trade('4', 'SL', 3), trade('5', 'SL', 4)];
  const s = summarize(l, { noCI: true });
  assert.equal(s.profitFactor, 4 / 3); assert.equal(s.avgWinR, 2); assert.equal(s.avgLossR, -1);
  assert.ok(Math.abs(s.breakEvenWinRate - 1 / 3) < 1e-12);
});

test('satu hari mendominasi: 20 trade di 1 hari = 1 observasi independen, CI tidak dihitung, ada peringatan', () => {
  const l = Array.from({ length: 20 }, (_, i) => trade('a' + i, 'SL', 0));
  const s = summarize(l);
  assert.equal(s.resolved, 20); assert.equal(s.nDays, 1); // satu minggu
  assert.equal(s.clusterCI, null);
  for (const w of ['LOW_EFFECTIVE_SAMPLE', 'CI_NOT_COMPUTABLE', 'DAY_DOMINANCE']) assert.ok(s.warnings.includes(w), w);
  assert.equal(s.dominance.share, 1);
});

test('CI berkluster lebih lebar dari CI naif ketika hasil berkorelasi dalam satu hari', () => {
  // 10 hari; tiap hari 6 trade dengan hasil yang sama (semua TP atau semua SL)
  const l = [];
  for (let d = 0; d < 10; d++) for (let k = 0; k < 6; k++) l.push(trade(`d${d}k${k}`, d % 2 === 0 ? 'TP' : 'SL', 7 * d));
  const s = summarize(l, { iterations: 1500 });
  assert.equal(s.nDays, 10); // 10 minggu independen
  const wNaive = s.winRateCI95[1] - s.winRateCI95[0], wCluster = s.clusterCI.winRateCI[1] - s.clusterCI.winRateCI[0];
  assert.ok(wCluster > wNaive, `klaster ${wCluster.toFixed(3)} > naif ${wNaive.toFixed(3)}`);
});

test('UNVERIFIABLE tidak masuk "setup terbit"; lifecycle WAITING/ACTIVE dan stale dihitung', () => {
  const mkp = (id, ev) => ({ setupId: id, engine: 'crypto', analysisTimeUtc: '2026-10-01T00:00:00.000Z', evaluation: ev });
  const s = summarize([mkp('u', { result: 'UNVERIFIABLE' }), mkp('w', { result: 'PENDING' }), mkp('a', { result: 'PENDING', entryTimeUtc: 'x' }),
    mkp('s', { result: 'EXPIRED', reasonCode: 'STALE_ON_ARRIVAL' }), mkp('e', { result: 'EXPIRED', reasonCode: 'ENTRY_TTL' })], { noCI: true });
  assert.equal(s.published, 4); assert.equal(s.unverifiable, 1);
  assert.deepEqual(s.lifecycle, { waiting: 1, active: 1 });
  assert.equal(s.staleOnArrival, 1); assert.equal(s.staleRate, 0.25);
});

test('kurva ekuitas kumulatif per waktu hasil, kotor dan bersih', () => {
  const pts = equityCurve([trade('a', 'TP', 0), trade('b', 'SL', 1)], { feePctPerSide: 0.05, slipPct: 0 });
  assert.equal(pts.length, 2); assert.equal(pts[0].gross, 2); assert.equal(pts[1].gross, 1); assert.ok(pts[1].net < pts[1].gross);
});

/* ---------- pipeline: revisi, versi mesin, migrasi ---------- */
const settings = { cancelPatterns: ['batal'], rawRetentionPerEngine: 5, revision: { entryTolerance: 0.01, cooldownHours: 24 }, cluster: { windowHours: 24, entryTolerance: 0.01 },
  entryTtlHours: 72, maxHoldDays: 30, sanityMaxDeviation: 0.5, binanceBaseUrls: [] };
const sources = { crypto: { url: 'x', trackPresence: true, revisionPolicy: true }, tn: { url: 'y', cumulativeSource: true } };
const shiftSL = (items, f) => items.map((c) => { const k = structuredClone(c); const r = k.rows.find((x) => /^SL/.test(x.label)); r.value = String(+r.value * f); return k; });
const crypto = (items, version = 'v1') => async () => ({ status: 'OK', items: items.map((c) => structuredClone(c)), diagnostics: { errors: [], warnings: [], meta: { summaryCount: items.length }, engineVersion: version } });
const only = (engine, fn) => async (e) => (e === engine ? fn(e) : { status: 'OK_NO_SETUPS', items: [], diagnostics: { errors: [], warnings: [] } });
const types = (m) => store.readEvents(m).map((e) => e.type);

test('pipeline Mesin 1: revisi bergabung ke induk, versi mesin tercatat, tidak ada setup baru tiap scan', async () => {
  const meta = store.loadMeta(), h = 3600e3, t0 = Date.parse('2026-10-16T13:00:00Z');
  const run = (i, items, v) => collect({ engines: ['crypto'], sources, settings, meta, now: t0 + i * h, scrapeEngine: only('crypto', crypto(items, v)) });
  const prov = { getCandles: async () => [] };

  const r1 = await run(0, cryptoItems);                       // putaran pertama: 30 setup, waktu tidak diketahui
  assert.equal(r1.crypto.added, 30);
  await evaluateAll({ provider: prov, settings, now: t0 + 0.5 * h });
  assert.ok(store.loadSetups().every((s) => s.evaluation.result === 'UNVERIFIABLE'));

  const r2 = await run(3, shiftSL(cryptoItems, 1.001));       // setup tak-terverifikasi tidak menyerap: muncul 30 setup yang BISA diberi waktu
  assert.equal(r2.crypto.added, 30); assert.equal(r2.crypto.merged, 0);
  await evaluateAll({ provider: prov, settings, now: t0 + 3.5 * h });

  const r3 = await run(6, shiftSL(cryptoItems, 1.003));       // SL bergeser lagi: bergabung ke induk, bukan setup baru
  assert.equal(r3.crypto.added, 0); assert.equal(r3.crypto.merged, 30);
  assert.equal(store.loadSetups().length, 60);
  assert.equal(types('2026-10').filter((t) => t === 'SETUP_REVISION').length, 30);

  const before = types('2026-10').filter((t) => t === 'SETUP_REVISION').length;
  await run(9, shiftSL(cryptoItems, 1.003));                  // sama dengan scan sebelumnya: tidak ada revisi baru
  assert.equal(types('2026-10').filter((t) => t === 'SETUP_REVISION').length, before);

  assert.equal(store.loadSetups().filter((s) => s.cohort === 'primary').length, 30);
  assert.equal(store.loadSetups().filter((s) => s.cohort === 'unverifiable').length, 30);
  assert.ok(store.loadSetups().filter((s) => s.cohort === 'primary').every((s) => s.engineVersion === 'v1'));
  assert.equal(types('2026-10').filter((t) => t === 'ENGINE_VERSION_CHANGE').length, 1);
  await run(12, cryptoItems, 'v2');                           // mesin diubah: dicatat sebagai kejadian
  assert.equal(types('2026-10').filter((t) => t === 'ENGINE_VERSION_CHANGE').length, 2);
  assert.equal(store.loadMeta().engineVersions.crypto.id, 'v2');
});

test('pipeline Mesin 2: kohort utama dari rantai terverifikasi; versi lama null; field baru diisi pada record lama', async () => {
  const meta = store.loadMeta();
  // simulasi record lama yang tersimpan sebelum Fase 1 (tanpa cohort/engineVersion/chainSeq/priceAtAnalysis)
  const entry = journal.find((e) => e.fwd === 1);
  const legacy = buildRecord(parseJournalEntry(entry, { chain: verifyChain(journal) }), ctx);
  for (const k of ['cohort', 'engineVersion', 'chainSeq', 'priceAtAnalysis']) delete legacy[k];
  store.saveSetups([...store.loadSetups(), { ...legacy, firstSeenUtc: 'x', evaluation: { result: 'PENDING' } }]);
  const tn = async () => ({ status: 'OK', items: journal, diagnostics: { errors: [], warnings: [], chain: verifyChain(journal), engineVersion: 'core:abc' } });
  const rep = await collect({ engines: ['tn'], sources, settings, meta, now: Date.parse('2026-10-17T07:00:00Z'), scrapeEngine: only('tn', tn) });
  assert.equal(rep.tn.chain.ok, true);
  const rec = store.loadSetups().find((s) => s.setupId === legacy.setupId);
  assert.equal(rec.cohort, 'primary'); assert.equal(rec.chainSeq, entry.seq); assert.equal(rec.engineVersion, entry.engine); assert.ok(rec.priceAtAnalysis > 0);
  assert.equal(store.loadMeta().engineVersions.tn.id, 'core:abc');
  const old = store.loadSetups().find((s) => s.engine === 'tn' && s.chainSeq === null);
  assert.ok(old, 'entri pra-protokol ada'); assert.equal(old.cohort, 'exploratory'); assert.equal(old.engineVersion, null);
});

test('migrasi: INVALID/ANALYSIS_TIME_UNKNOWN -> UNVERIFIABLE dengan jejak audit; Mesin 1 lama diberi kohort', () => {
  const legacy = [{ setupId: 'c1', engine: 'crypto', analysisTimeSource: 'unknown_before_tracking', rawData: { price: 12.3 },
    evaluation: { result: 'INVALID', reasonCode: 'ANALYSIS_TIME_UNKNOWN', notes: ['x'] } },
    { setupId: 'c2', engine: 'crypto', analysisTimeSource: 'first_seen', evaluation: { result: 'PENDING' } }];
  const ev = migrateLegacy(legacy, '2026-10-17T00:00:00.000Z');
  assert.equal(legacy[0].evaluation.result, 'UNVERIFIABLE');
  assert.deepEqual([ev[0].type, ev[0].from, ev[0].to], ['EVAL_CHANGE', 'INVALID', 'UNVERIFIABLE']);
  assert.equal(legacy[0].cohort, 'unverifiable'); assert.equal(legacy[1].cohort, 'primary');
  assert.equal(legacy[0].engineVersion, null); assert.equal(legacy[0].priceAtAnalysis, 12.3);
  assert.equal(migrateLegacy(legacy, '2026-10-17T01:00:00.000Z').length, 0); // idempoten
});
