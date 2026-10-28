// Mode makro pada generator journal: alert (default) tidak mengubah apa pun, tag menandai entri baru, hold menahan entri baru.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan } from '../scripts/generate-journal.mjs';
import { verifyJournal } from '../scripts/journal-lib.mjs';
import { mergeConfig } from '../macro-calendar.mjs';
import { installMarket } from './synth.mjs';

const IN_WINDOW = Date.UTC(2026, 9, 28, 17, 30);   // FOMC 28 Okt 2026 14:00 ET = 18:00 UTC, di dalam jendela
const OUTSIDE = Date.UTC(2026, 9, 24, 12, 12);
const noSleep = async () => {};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mj-'));
const read = (d) => JSON.parse(fs.readFileSync(path.join(d, 'journal.json'), 'utf8'));
const run = (dir, now, mode, extra = {}) => scan({ dir, now: () => now, sleep: noSleep, macro: { official: {}, cfg: mergeConfig({ mode, ...extra }) } });

test('mode alert (default): jurnal tidak berubah walau di jendela rilis', async () => {
  const restore = installMarket(), dir = tmp();
  try {
    const s = await run(dir, IN_WINDOW, 'alert');
    assert.equal(s.status, 'OK', s.error);
    assert.ok(s.added >= 1);
    assert.equal(s.held, 0);
    assert.ok(read(dir).every((e) => e.macro === undefined), 'mode alert tidak boleh menambah label');
  } finally { restore(); }
});

test('mode tag: entri baru di jendela rilis diberi label, rantai hash tetap valid', async () => {
  const restore = installMarket(), dir = tmp();
  try {
    const s = await run(dir, IN_WINDOW, 'tag');
    assert.equal(s.status, 'OK', s.error);
    const j = read(dir);
    assert.ok(j.length >= 1 && j.every((e) => e.macro === 'FOMC 2026-10-28'));
    assert.equal(verifyJournal(j).ok, true);
  } finally { restore(); }
});

test('mode hold: tidak ada entri baru di jendela rilis, normal di luar jendela', async () => {
  const restore = installMarket(), d1 = tmp(), d2 = tmp();
  try {
    const a = await run(d1, IN_WINDOW, 'hold');
    assert.equal(a.status, 'OK', a.error);
    assert.equal(a.added, 0);
    assert.ok(a.held >= 1, 'setup yang ditahan harus tercatat di scan-log');
    const b = await run(d2, OUTSIDE, 'hold');
    assert.ok(b.added >= 1 && b.held === 0);
    assert.ok(read(d2).every((e) => e.macro === undefined));
  } finally { restore(); }
});

test('kalender rusak/hilang tidak menggagalkan scan', async () => {
  const restore = installMarket(), dir = tmp();
  try {
    const s = await scan({ dir, now: () => OUTSIDE, sleep: noSleep, macro: { official: null, cfg: null } });
    assert.equal(s.status, 'OK', s.error);
  } finally { restore(); }
});
