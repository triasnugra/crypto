// Tes dasar: menangkap bug "engine.mjs tidak ada di root" sebelum terbit, dan menjaga invarian rencana trade.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { candles } from './synth.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha1 = (f) => crypto.createHash('sha1').update(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).digest('hex');

test('semua import dan fetch relatif menunjuk file yang ada', () => {
  const files = [
    ...fs.readdirSync(root).filter((f) => f.endsWith('.mjs')).map((f) => path.join(root, f)),
    ...(fs.existsSync(path.join(root, 'scripts')) ? fs.readdirSync(path.join(root, 'scripts')).filter((f) => f.endsWith('.mjs')).map((f) => path.join(root, 'scripts', f)) : []),
    path.join(root, 'index.html'),
  ];
  const missing = [];
  for (const file of files) {
    let text = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.html')) text = (text.match(/<script type="module">([\s\S]*?)<\/script>/) || [, ''])[1];
    const re = /(?:from\s*|import\s*\(?\s*|fetch\(\s*)['"](\.{1,2}\/[^'"?]+)['"]/g;
    for (const m of text.matchAll(re)) {
      const target = path.resolve(path.dirname(file), m[1]);
      if (!fs.existsSync(target)) missing.push(`${path.relative(root, file)} -> ${m[1]}`);
    }
  }
  assert.deepEqual(missing, [], 'File tidak ditemukan (halaman akan kosong): ' + missing.join('; '));
});

test('engine.mjs di root dapat diimpor dan mengekspor API yang dipakai halaman', async () => {
  const m = await import('../engine.mjs');
  for (const k of ['bj', 'kl', 'NOT', 'fmt', 'analyze', 'alertList']) assert.ok(k in m, `ekspor ${k} hilang`);
});

test('engine.mjs di root sama dengan salinan vendor (bila ada)', (t) => {
  const v = path.join(root, 'vendor/mesin1/engine.mjs');
  if (!fs.existsSync(v)) return t.skip('tanpa vendor');
  if (sha1(v) !== sha1(path.join(root, 'engine.mjs'))) t.diagnostic('engine.mjs berbeda dari vendor: itu versi mesin baru (PROTOCOL 7). Catat perubahannya.');
});

test('invarian rencana pada 300 pasar acak: sisi SL/TP benar, risiko >= 1%, tanpa NaN', async () => {
  const { analyze } = await import('../engine.mjs');
  const END = Date.UTC(2026, 9, 24, 12);
  let setups = 0;
  for (let i = 0; i < 300; i++) {
    const d = candles(i + 1, 500, 864e5, END, [0.0002, 0.5, 30, 2500, 80000][i % 5], 0.03);
    const f = candles(i + 7001, 300, 144e5, END, d.at(-1).c, 0.013);
    const r = analyze('X', d, f, { qv: 1e9, btcBias: 0 });
    for (const p of r.setups) {
      setups++;
      const L = p.side === 1;
      assert.ok([p.entry, p.sl, p.risk, p.slp, p.rr].every(Number.isFinite), `NaN pada seed ${i}`);
      assert.ok(L ? p.sl < p.entry : p.sl > p.entry, `SL sisi salah seed ${i}`);
      assert.ok(p.tg.length > 0 && p.tg.every((x) => (L ? x.v > p.entry : x.v < p.entry)), `TP sisi salah seed ${i}`);
      assert.ok(p.slp >= 0.99, `risiko < 1% seed ${i}: ${p.slp}`);
    }
  }
  assert.ok(setups > 50, 'tes tidak menghasilkan cukup setup untuk bermakna');
});
