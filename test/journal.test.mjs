import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan } from '../scripts/generate-journal.mjs';
import { verifyJournal, entryHash } from '../scripts/journal-lib.mjs';
import { checkLive } from '../scripts/check-live.mjs';
import { installMarket, SYMS } from './synth.mjs';

const T = Date.UTC(2026, 9, 24, 12, 12);
const noSleep = async () => {};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jr-'));
const read = (d, f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
const run = (dir, now, extra = {}) => scan({ dir, now: () => now, sleep: noSleep, ...extra });

test('scan pertama: mencatat setup, rantai utuh, level presisi penuh, stablecoin tidak ikut', async () => {
  const restore = installMarket(), dir = tmp();
  try {
    const s = await run(dir, T);
    assert.equal(s.status, 'OK', s.error);
    assert.equal(s.coins, SYMS.length);               // USDCUSDT dikecualikan
    assert.ok(s.added >= 1, 'data sintetis harus menghasilkan setup');
    const j = read(dir, 'journal.json');
    assert.equal(j.length, s.added);
    assert.ok(verifyJournal(j).ok);
    for (const e of j) {
      assert.equal(e.engine.length, 16);
      assert.ok(e.due > e.t && e.tps.length >= 1 && e.tp === e.tps[0].v);
      assert.match(e.waktu, /^\d{4}-\d\d-\d\d \d\d:\d\d UTC$/);
      assert.ok(['pasar', 'limit'].includes(e.mode));
    }
    assert.ok(!fs.existsSync(path.join(dir, 'journal.json.tmp')));
    assert.equal(read(dir, 'scan-log.json').at(-1).status, 'OK');
  } finally { restore(); }
});

test('scan ulang 1 jam kemudian: bergabung ke induk, tidak menggandakan, hash tetap valid', async () => {
  const restore = installMarket(), dir = tmp();
  try {
    const a = await run(dir, T), before = read(dir, 'journal.json');
    const b = await run(dir, T + 36e5);
    assert.equal(b.added, 0);
    assert.equal(b.merged, a.added);
    const after = read(dir, 'journal.json');
    assert.equal(after.length, before.length);
    assert.ok(after.every((e) => e.seen === 2 && e.lastSeen === T + 36e5));
    assert.deepEqual(after.map((e) => [e.entry, e.sl, e.tp, e.h]), before.map((e) => [e.entry, e.sl, e.tp, e.h]));
    assert.ok(verifyJournal(after).ok);
  } finally { restore(); }
});

test('setelah induk kedaluwarsa (72 jam) kemunculan sama dihitung peluang baru, rantai tersambung', async () => {
  const restore = installMarket(), dir = tmp();
  try {
    const a = await run(dir, T);
    const c = await run(dir, T + 80 * 36e5);
    assert.equal(c.added, a.added);
    const j = read(dir, 'journal.json');
    assert.equal(j.length, a.added * 2);
    assert.ok(verifyJournal(j).ok);
    assert.equal(j[a.added].prev, j[a.added - 1].h);
  } finally { restore(); }
});

test('BTC gagal: scan GAGAL, journal tidak berubah, scan-log mencatat penyebab', async () => {
  const dir = tmp();
  let restore = installMarket();
  try { await run(dir, T); } finally { restore(); }
  const bytes = fs.readFileSync(path.join(dir, 'journal.json'), 'utf8');
  restore = installMarket({ failSyms: new Set(['BTCUSDT']) });
  try {
    const s = await run(dir, T + 36e5);
    assert.equal(s.status, 'FAILED');
    assert.equal(fs.readFileSync(path.join(dir, 'journal.json'), 'utf8'), bytes);
    assert.equal(read(dir, 'scan-log.json').at(-1).status, 'FAILED');
  } finally { restore(); }
});

test('terlalu banyak koin gagal: scan GAGAL (tidak menerbitkan data setengah)', async () => {
  const restore = installMarket({ failSyms: new Set(['ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT']) }), dir = tmp();
  try {
    const s = await run(dir, T);
    assert.equal(s.status, 'FAILED');
    assert.match(s.error, /TOO_MANY_COIN_ERRORS/);
    assert.ok(!fs.existsSync(path.join(dir, 'journal.json')));
  } finally { restore(); }
});

test('journal yang diubah manual ditolak, dan verifikator menunjuk entrinya', async () => {
  const restore = installMarket(), dir = tmp();
  try {
    await run(dir, T);
    const j = read(dir, 'journal.json');
    j[0].entry = j[0].entry * 1.01;                    // tamper
    fs.writeFileSync(path.join(dir, 'journal.json'), JSON.stringify(j));
    const v = verifyJournal(j);
    assert.ok(!v.ok && /hash isi/.test(v.errors[0]));
    const s = await run(dir, T + 36e5);
    assert.equal(s.status, 'FAILED');
    assert.match(s.error, /JOURNAL_CORRUPT/);
  } finally { restore(); }
});

test('entryHash tidak terpengaruh field mutable', () => {
  const e = { aset: 'X', arah: 'LONG', t: 1, tf: '4H', kind: 'dev', harga_awal: 1, mode: 'limit', entry: 1, sl: 0.9, tp: 1.2, tps: [{ v: 1.2, l: 'TP1' }], engine: 'a', seq: 1, prev: null };
  assert.equal(entryHash(e), entryHash({ ...e, lastSeen: 99, seen: 7, rev: [1] }));
  assert.notEqual(entryHash(e), entryHash({ ...e, sl: 0.89 }));
});

test('check-live: lolos bila semua ada dan segar, gagal bila engine.mjs 404', async () => {
  const restore = installMarket(), dir = tmp();
  try { await run(dir, T); } finally { restore(); }
  const files = {
    'index.html': '<html/>', 'engine.mjs': 'export function analyze(){}', 'validate.mjs': 'x', 'eliz-dataset.json': '{}',
    'data/journal.json': fs.readFileSync(path.join(dir, 'journal.json'), 'utf8'), 'data/scan-log.json': fs.readFileSync(path.join(dir, 'scan-log.json'), 'utf8'),
  };
  const mk = (missing) => async (url) => {
    const p = new URL(url).pathname.replace('/crypto/', '');
    return p in files && p !== missing ? { ok: true, status: 200, text: async () => files[p], json: async () => JSON.parse(files[p]) } : { ok: false, status: 404 };
  };
  assert.ok((await checkLive({ base: 'https://x.test/crypto/', fetchImpl: mk(null), now: T + 36e5 })).ok);
  const bad = await checkLive({ base: 'https://x.test/crypto/', fetchImpl: mk('engine.mjs'), now: T + 36e5 });
  assert.ok(!bad.ok && bad.results.some((r) => /engine\.mjs: HTTP 404/.test(r.msg)));
  assert.ok(!(await checkLive({ base: 'https://x.test/crypto/', fetchImpl: mk(null), now: T + 20 * 36e5 })).ok, 'scan basi harus gagal');
});
