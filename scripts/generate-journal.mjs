// Generator journal.json Mesin Crypto. Menjalankan engine.mjs yang SAMA dengan halaman (tanpa browser),
// lalu mencatat setup terbaik tiap koin dengan level presisi penuh, waktu analisis, dan versi mesin.
// Aturan pencatatan: docs/JOURNAL.md. Append-only dan berantai hash: entri lama tidak diubah isinya.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { bj, kl, NOT, analyze } from '../engine.mjs';
import { entryHash, verifyJournal } from './journal-lib.mjs';

export const CFG = {
  topN: 40,                // sama dengan halaman: 40 koin USDT teratas menurut volume 24 jam
  conc: 4,
  entryTtlHours: 72,       // sama dengan config/settings.json benchmark
  mergeTolerance: 0.01,    // PROTOCOL 3: entry dalam 1% = setup yang sama
  gapHours: 24,            // PROTOCOL 3: absen > 24 jam = peluang baru
  maxRevisions: 20,
  maxFailFraction: 0.25,   // lebih dari ini koin gagal = scan dianggap gagal (jangan terbitkan setengah data)
  scanLogKeep: 200,
};
const H = 36e5;
const r10 = (x) => Number(Number(x).toPrecision(10));
const r2 = (x) => Math.round(x * 100) / 100;
const iso = (ms) => new Date(ms).toISOString();
const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

export function engineSha1(file = fileURLToPath(new URL('../engine.mjs', import.meta.url))) {
  return crypto.createHash('sha1').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
}

export async function withRetry(fn, { tries = 3, base = 1000, sleep = sleepReal } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (i === tries - 1) break;
      await sleep(/HTTP (418|429)/.test(String(e?.message)) ? 30000 * (i + 1) : base * 2 ** i); // 418/429 = dibatasi Binance
    }
  }
  throw last;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

/** Induk = entri terbuka (belum due) dengan koin+arah sama, entry dalam toleransi, terlihat terakhir <= 24 jam lalu. */
export function findParent(journal, c, t, cfg = CFG) {
  for (let i = journal.length - 1; i >= 0; i--) {
    const e = journal[i];
    if (e.aset !== c.aset || e.arah !== c.arah) continue;
    if (t >= e.due) continue;
    if (t - e.lastSeen > cfg.gapHours * H) continue;
    if (Math.abs(c.entry / e.entry - 1) > cfg.mergeTolerance) continue;
    return e;
  }
  return null;
}

function newEntry(journal, r, p, { t, engine, btcBias, qv }, cfg) {
  const seq = journal.length + 1, prev = journal.at(-1)?.h ?? null;
  const aset = r.s, arah = p.side === 1 ? 'LONG' : 'SHORT';
  const tps = p.tg.map((x) => ({ v: r10(x.v), l: x.l }));
  const e = {
    id: `${iso(t).slice(0, 10)}|${aset}|${arah}|${p.tf}|#${seq}`,
    waktu: `${iso(t).slice(0, 10)} ${iso(t).slice(11, 16)} UTC`,
    t, due: t + cfg.entryTtlHours * H,
    aset, arah, tf: p.tf, kind: p.kind, tipe: p.type,
    entry: r10(p.entry), sl: r10(p.sl), tp: tps[0].v, tps,
    harga_awal: r10(r.px),
    // 'pasar' = harga sudah melewati level, jadi entry = harga saat analisis (kartu halaman tetap menulis "Entry limit")
    mode: p.entry === r.px ? 'pasar' : 'limit',
    alasan: p.why,
    rr: r2(p.rr), rr1: r2(Math.abs(p.tg[0].v - p.entry) / p.risk), slp: r2(p.slp), skor: p.sc, jarak: r2(p.dist),
    konfirmasi: p.cf[0], konfirmasi_teks: p.cf[1],
    status_kartu: p.cf[0] === 'ok' && p.dist <= 1.5 ? 'Aktif' : p.dist <= 6 ? 'Menunggu retest' : 'Jauh',
    peringatan: p.w, bias_harian: r.bias, btc_bias: btcBias, qv: Math.round(qv), n_setup: r.setups.length,
    batal_jika: { tp1_tercapai_sebelum_entry: true, close_melewati_sl_tf: p.tf },
    engine: engine.slice(0, 16), seq, prev, lastSeen: t, seen: 1,
  };
  e.h = entryHash(e);
  return e;
}

const writeAtomic = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', text);
  fs.renameSync(file + '.tmp', file);
};
const readJson = (file, dflt) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : dflt);

export async function scan(opts = {}) {
  const cfg = { ...CFG, ...(opts.cfg || {}) };
  const dir = opts.dir ?? 'data', now = opts.now ?? Date.now, sleep = opts.sleep ?? sleepReal, dry = !!opts.dry;
  const retry = (fn) => withRetry(fn, { sleep });
  const jf = path.join(dir, 'journal.json'), lf = path.join(dir, 'scan-log.json');
  const t0 = now();
  const sum = { t: t0, iso: iso(t0), engine: null, status: 'FAILED', coins: 0, analyzed: 0, failed: [], setups: 0, added: 0, merged: 0, revised: 0, error: null, durationMs: 0 };
  let journal = null;
  try {
    sum.engine = engineSha1();
    journal = readJson(jf, []);
    const v = verifyJournal(journal);
    if (!v.ok) throw new Error('JOURNAL_CORRUPT: ' + v.errors.slice(0, 3).join(' | '));

    const tk = await retry(() => bj('ticker/24hr'));
    const qvOf = new Map(tk.map((x) => [x.symbol, +x.quoteVolume]));
    const top = tk.filter((x) => x.symbol.endsWith('USDT') && !NOT.test(x.symbol.slice(0, -4)))
      .sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, cfg.topN);
    const getCoin = async (s) => {
      const [d, h] = await Promise.all([retry(() => kl(s + 'USDT', '1d', 500)), retry(() => kl(s + 'USDT', '4h', 300))]);
      return { d, h, t: now() };   // t = saat data koin ini diterima (waktu analisis)
    };

    const bg = await getCoin('BTC');                       // BTC wajib; gagal = scan gagal
    const btc = analyze('BTC', bg.d, bg.h, { qv: 1e9 });
    const rest = top.map((x) => x.symbol.slice(0, -4)).filter((s) => s !== 'BTC');
    const res = await pool(rest, cfg.conc, async (s) => {
      try { const g = await getCoin(s); return { r: analyze(s, g.d, g.h, { btcBias: btc.bias, qv: qvOf.get(s + 'USDT') }), t: g.t, qv: qvOf.get(s + 'USDT') }; }
      catch (e) { return { s, error: String(e?.message ?? e).slice(0, 120) }; }
    });
    sum.coins = rest.length + 1;
    sum.failed = res.filter((x) => x.error).map((x) => x.s);
    sum.analyzed = sum.coins - sum.failed.length;
    if (sum.failed.length > cfg.maxFailFraction * rest.length) throw new Error(`TOO_MANY_COIN_ERRORS: ${sum.failed.length}/${rest.length}`);

    const items = [{ r: btc, t: bg.t, qv: qvOf.get('BTCUSDT') ?? 1e9 }, ...res.filter((x) => !x.error)];
    const ctx = { engine: sum.engine, btcBias: btc.bias };
    for (const it of items) {
      const p = it.r.best;
      if (!p) continue;
      sum.setups++;
      const cand = { aset: it.r.s, arah: p.side === 1 ? 'LONG' : 'SHORT', entry: r10(p.entry), sl: r10(p.sl), tp: r10(p.tg[0].v) };
      const parent = findParent(journal, cand, it.t, cfg);
      if (!parent) { journal.push(newEntry(journal, it.r, p, { ...ctx, t: it.t, qv: it.qv }, cfg)); sum.added++; continue; }
      parent.lastSeen = it.t; parent.seen = (parent.seen || 1) + 1; sum.merged++;
      const last = parent.rev?.at(-1) ?? parent;       // level awal tetap beku; perubahan hanya dicatat sebagai revisi
      if (last.entry !== cand.entry || last.sl !== cand.sl || last.tp !== cand.tp) {
        parent.rev = [...(parent.rev || []), { t: it.t, entry: cand.entry, sl: cand.sl, tp: cand.tp }].slice(-cfg.maxRevisions);
        sum.revised++;
      }
    }
    sum.status = sum.setups ? 'OK' : 'OK_NO_SETUPS';
    if (!dry) writeAtomic(jf, '[\n' + journal.map((e) => ' ' + JSON.stringify(e)).join(',\n') + '\n]\n');
  } catch (e) {
    sum.status = 'FAILED';
    sum.error = String(e?.message ?? e).slice(0, 300);
  }
  sum.durationMs = now() - t0;
  if (!dry) {
    let log = [];
    try { log = readJson(lf, []); } catch { log = []; }
    writeAtomic(lf, JSON.stringify([...log, sum].slice(-cfg.scanLogKeep), null, 1) + '\n');
  }
  return sum;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const s = await scan({ dir: process.env.DATA_DIR || 'data', dry: process.argv.includes('--dry') });
  console.log(JSON.stringify({ ...s, failed: s.failed.length ? s.failed : undefined }));
  process.exit(s.status === 'FAILED' ? 1 : 0);
}
