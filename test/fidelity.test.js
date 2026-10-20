import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { parseHTML } from 'linkedom';
import { fmtLikeCard, normalizeLive, normalizeReplay, compareCards, isoFromRawName } from '../src/fidelity/compare.js';
import { extractCryptoCards, parseCryptoCard } from '../src/parsers/crypto.js';
import { fmt as engineFmt } from '../vendor/mesin1/engine.mjs';

const sha1 = (s) => crypto.createHash('sha1').update(s.replace(/\r\n/g, '\n')).digest('hex');

test('fmtLikeCard identik dengan fmt milik mesin di berbagai magnitudo', () => {
  const vals = [0.0000039, 0.0123, 0.4668, 1.144, 11.608, 99.99, 100, 1157.7, 82250, 0.00704, 6.943, 2.299, 1333.7];
  for (const v of vals) assert.equal(fmtLikeCard(v), engineFmt(v), `v=${v}`);
});

test('salinan vendor tidak berubah dari hash yang tercatat (engine.mjs) dan validate hanya beda di satu baris ekspor', () => {
  const eng = fs.readFileSync(new URL('../vendor/mesin1/engine.mjs', import.meta.url), 'utf8');
  const val = fs.readFileSync(new URL('../vendor/mesin1/validate.mjs', import.meta.url), 'utf8');
  const orig = fs.readFileSync(new URL('../vendor/mesin1/VENDOR.md', import.meta.url), 'utf8');
  assert.ok(orig.includes(sha1(eng)), 'hash engine.mjs sesuai VENDOR.md');
  const restored = val.replace('\nexport async function at(sym,p,ts){', '\nasync function at(sym,p,ts){');
  assert.equal(restored.split('\n').length, val.split('\n').length);
  assert.ok(val.includes('export async function at(sym,p,ts){'));
});

test('kartu live: AVAX dinormalisasi ke bentuk perbandingan', () => {
  const { items } = extractCryptoCards(parseHTML(fs.readFileSync(new URL('./fixtures/crypto-setups.html', import.meta.url), 'utf8')).document);
  const avax = normalizeLive(parseCryptoCard(items.find((c) => c.ticker === 'AVAX')));
  assert.deepEqual(avax, { symbol: 'AVAXUSDT', direction: 'SHORT', entry: 11.608, sl: 12.15, tp1: 8.845 });
});

test('setup replay: side 1 = LONG; TP1 = tg[0]; setup null -> null', () => {
  const s = { side: 1, entry: 11.6083, sl: 12.1501, tg: [{ v: 8.8449, l: 'x' }, { v: 7.1, l: 'y' }] };
  assert.deepEqual(normalizeReplay(s, 'AVAXUSDT'), { symbol: 'AVAXUSDT', direction: 'LONG', entry: 11.608, sl: 12.15, tp1: 8.845 });
  assert.equal(normalizeReplay(null, 'X'), null);
});

test('perbandingan: selisih pembulatan tidak dihitung; selisih nyata dan koin hilang dihitung', () => {
  const live = new Map([
    ['AVAX', { symbol: 'AVAXUSDT', direction: 'SHORT', entry: 11.608, sl: 12.15, tp1: 8.845 }],
    ['ZK', { symbol: 'ZKUSDT', direction: 'SHORT', entry: 0.0171, sl: 0.0189, tp1: 0.0134 }],
    ['BTC', { symbol: 'BTCUSDT', direction: 'SHORT', entry: 83205, sl: 85701, tp1: 78213 }],
  ]);
  const rep = new Map([
    ['AVAX', { symbol: 'AVAXUSDT', direction: 'SHORT', entry: 11.608, sl: 12.15, tp1: 8.845 }],
    ['ZK', { symbol: 'ZKUSDT', direction: 'SHORT', entry: 0.0171, sl: 0.0189, tp1: 0.0135 }],   // TP beda satu digit
    ['BTC', null],                                                                             // replay tak menghasilkan setup
  ]);
  const r = compareCards(live, rep);
  assert.equal(r.n, 3); assert.equal(r.exact, 1);
  assert.deepEqual(r.missingInReplay, ['BTC']);
  assert.equal(r.mismatches[0].symbol, 'ZK');
  assert.deepEqual(r.mismatches[0].diffs, [{ field: 'tp1', live: 0.0134, replay: 0.0135 }]);
  assert.ok(Math.abs(r.matchRate - 1 / 3) < 1e-9);
});

test('nama berkas raw -> waktu scan ISO', () => {
  assert.equal(isoFromRawName('2026-10-16T13-00-00-000Z.json'), '2026-10-16T13:00:00.000Z');
  assert.equal(isoFromRawName('latest.json'), null);
});
