// Cek situs yang SUDAH terbit: file inti harus bisa diunduh, journal utuh dan segar.
// Menangkap kasus seperti engine.mjs 404 yang membuat halaman kosong tanpa ada yang tahu.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { verifyJournal } from './journal-lib.mjs';

export async function checkLive({ base = 'https://triasnugra.github.io/crypto/', fetchImpl = globalThis.fetch, now = Date.now(), maxAgeHours = 14 } = {}) {
  const out = [];
  const add = (ok, msg) => out.push({ ok, msg });
  const get = (p) => fetchImpl(`${base}${p}?_=${now}`, { cache: 'no-store' });

  for (const f of ['index.html', 'engine.mjs', 'validate.mjs', 'eliz-dataset.json']) {
    try {
      const r = await get(f);
      if (!r.ok) { add(false, `${f}: HTTP ${r.status}`); continue; }
      if (f === 'engine.mjs' && !/export function analyze/.test(await r.text())) { add(false, 'engine.mjs: isi tidak seperti mesin (tanpa analyze)'); continue; }
      add(true, `${f}: OK`);
    } catch (e) { add(false, `${f}: ${String(e?.message ?? e).slice(0, 80)}`); }
  }
  try {
    const r = await get('data/journal.json');
    if (!r.ok) add(false, `data/journal.json: HTTP ${r.status}`);
    else { const v = verifyJournal(await r.json()); add(v.ok, v.ok ? `journal: ${v.n} entri, rantai utuh` : `journal rusak: ${v.errors[0]}`); }
  } catch (e) { add(false, `journal: ${String(e?.message ?? e).slice(0, 80)}`); }
  try {
    const r = await get('data/scan-log.json');
    if (!r.ok) add(false, `data/scan-log.json: HTTP ${r.status}`);
    else {
      const last = (await r.json()).at(-1);
      const age = last ? (now - last.t) / 36e5 : Infinity;
      add(!!last && last.status !== 'FAILED' && age <= maxAgeHours, last ? `scan terakhir ${last.status}, ${age.toFixed(1)} jam lalu${last.error ? ' (' + last.error + ')' : ''}` : 'scan-log kosong');
    }
  } catch (e) { add(false, `scan-log: ${String(e?.message ?? e).slice(0, 80)}`); }
  return { ok: out.every((x) => x.ok), results: out };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await checkLive({ base: process.env.LIVE_BASE || undefined });
  for (const x of r.results) console.log(`${x.ok ? 'OK   ' : 'GAGAL'} ${x.msg}`);
  process.exit(r.ok ? 0 : 1);
}
