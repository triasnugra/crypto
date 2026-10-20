// Uji kesetiaan replay Mesin 1. LAPORAN SAJA: tidak mengubah data/setups.
// Untuk tiap snapshot scan Mesin 1 (data/raw/crypto/*.json, status OK), jalankan ulang mesin pada waktu scan itu
// (vendor/mesin1/validate.mjs → at()) dan bandingkan kartu replay dengan kartu live yang tersimpan.
import fs from 'node:fs';
import path from 'node:path';
import { parseCryptoCard } from '../src/parsers/crypto.js';
import { compareCards, normalizeLive, normalizeReplay, isoFromRawName } from '../src/fidelity/compare.js';

const RAW = path.join(process.env.DATA_DIR || 'data', 'raw', 'crypto');
const OUT = process.env.FIDELITY_OUT || path.join('data', 'fidelity');
const MAX_SNAPSHOTS = Number(process.env.FIDELITY_MAX || 20);
const CONC = 3;

const { at } = await import('../vendor/mesin1/validate.mjs');

async function replayAt(iso, symbols) {
  const ts = Date.parse(iso);
  const map = new Map();
  for (let i = 0; i < symbols.length; i += CONC) {
    await Promise.all(symbols.slice(i, i + CONC).map(async (sym) => {
      try {
        const { R } = await at(sym, `${sym}USDT`, ts);
        map.set(sym, normalizeReplay(R.v1?.best ?? null, `${sym}USDT`));
      } catch (e) {
        map.set(sym, { error: String(e.message).slice(0, 120) });
      }
    }));
  }
  return map;
}

async function main() {
  if (!fs.existsSync(RAW)) { console.log('Belum ada snapshot Mesin 1 di', RAW, '→ tidak ada yang diuji.'); return; }
  const files = fs.readdirSync(RAW).filter((f) => isoFromRawName(f)).sort().slice(-MAX_SNAPSHOTS);
  const report = { generatedAtUtc: new Date().toISOString(), engineFile: 'vendor/mesin1/engine.mjs', snapshots: [] };
  for (const f of files) {
    const snap = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
    if (snap.status !== 'OK' || !Array.isArray(snap.items) || !snap.items.length) continue;
    const iso = isoFromRawName(f);
    const live = new Map(snap.items.map((it) => { const n = normalizeLive(parseCryptoCard(it)); return [it.ticker, n]; }));
    const rep = await replayAt(iso, [...live.keys()]);
    const errors = [...rep.values()].filter((v) => v?.error).length;
    const cmp = compareCards(live, new Map([...rep].map(([k, v]) => [k, v?.error ? null : v])));
    report.snapshots.push({ scanUtc: iso, liveCards: cmp.n, exact: cmp.exact, matchRate: cmp.matchRate, replayErrors: errors,
      missingInReplay: cmp.missingInReplay, mismatches: cmp.mismatches.slice(0, 30) });
    console.log(`${iso}: ${cmp.exact}/${cmp.n} cocok, ${cmp.mismatches.length} beda, ${cmp.missingInReplay.length} tak-ada-di-replay, ${errors} error data`);
  }
  const rated = report.snapshots.filter((s) => s.matchRate != null);
  report.summary = { snapshots: rated.length, liveCards: rated.reduce((a, s) => a + s.liveCards, 0),
    exact: rated.reduce((a, s) => a + s.exact, 0) };
  report.summary.matchRate = report.summary.liveCards ? report.summary.exact / report.summary.liveCards : null;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `fidelity-${report.generatedAtUtc.slice(0, 10)}.json`), JSON.stringify(report, null, 2));
  console.log('ringkasan:', JSON.stringify(report.summary));
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
