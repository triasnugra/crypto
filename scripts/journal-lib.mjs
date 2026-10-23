// Hash rantai dan verifikasi journal Mesin Crypto. Dipakai generator, verifikator, dan cek situs.
import crypto from 'node:crypto';

// Hanya field ini yang dicakup hash (tidak berubah setelah entri dibuat).
// lastSeen, seen, rev bersifat mutable dan sengaja di luar hash.
export const IMMUTABLE = ['aset', 'arah', 't', 'tf', 'kind', 'harga_awal', 'mode', 'entry', 'sl', 'tp', 'tps', 'engine', 'seq', 'prev'];

export function entryHash(e) {
  const o = {};
  for (const k of IMMUTABLE) o[k] = e[k] === undefined ? null : e[k];
  return crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 20);
}

export function verifyJournal(j) {
  if (!Array.isArray(j)) return { ok: false, n: 0, errors: ['JOURNAL_NOT_ARRAY'] };
  const errors = [], ids = new Set();
  let prev = null;
  j.forEach((e, i) => {
    const w = `#${i + 1} ${e?.id ?? '?'}`;
    if (e.seq !== i + 1) errors.push(`${w}: seq ${e.seq}, seharusnya ${i + 1}`);
    if ((e.prev ?? null) !== prev) errors.push(`${w}: prev tidak cocok dengan hash entri sebelumnya`);
    if (e.h !== entryHash(e)) errors.push(`${w}: hash isi tidak cocok (isi entri berubah)`);
    if (ids.has(e.id)) errors.push(`${w}: id ganda`);
    ids.add(e.id);
    if (e.arah !== 'LONG' && e.arah !== 'SHORT') errors.push(`${w}: arah tidak valid`);
    else if (![e.entry, e.sl, e.tp, e.t, e.due].every(Number.isFinite)) errors.push(`${w}: angka tidak valid`);
    else {
      const L = e.arah === 'LONG';
      if (L ? !(e.sl < e.entry) : !(e.sl > e.entry)) errors.push(`${w}: SL di sisi yang salah`);
      if (L ? !(e.tp > e.entry) : !(e.tp < e.entry)) errors.push(`${w}: TP di sisi yang salah`);
      if (!(e.due > e.t)) errors.push(`${w}: due <= t`);
    }
    prev = e.h;
  });
  return { ok: errors.length === 0, n: j.length, errors };
}
