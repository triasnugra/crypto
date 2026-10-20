import test from 'node:test';
import assert from 'node:assert/strict';
import { traceCandles } from '../src/evaluator/trace.js';
const T = Date.parse('2026-10-19T10:12:00Z');
const setup = { direction: 'LONG', entryPrice: 0.459, takeProfit: [0.539], stopLoss: 0.442, analysisTimeUtc: new Date(T).toISOString() };
test('jejak: TP tersentuh sebelum entry terlihat sebagai TP tanpa ENTRY (kasus EXPIRED)', () => {
  const c = [
    { t: T - 60e3, o: 0.5, h: 0.5, l: 0.45, c: 0.46 },      // sebelum analisis: tidak ditampilkan
    { t: T, o: 0.50, h: 0.54, l: 0.50, c: 0.53 },           // naik tanpa menyentuh 0.459
    { t: T + 60e3, o: 0.53, h: 0.55, l: 0.52, c: 0.54 },
  ];
  const r = traceCandles(setup, c);
  assert.equal(r.length, 2);
  assert.equal(r[0].touches, 'TP');
  assert.equal(r[1].touches, 'TP');
});
test('jejak: candle yang menyentuh entry dan SL sekaligus ditandai keduanya', () => {
  const r = traceCandles(setup, [{ t: T, o: 0.46, h: 0.46, l: 0.44, c: 0.45 }]);
  assert.equal(r[0].touches, 'ENTRY SL');
});
