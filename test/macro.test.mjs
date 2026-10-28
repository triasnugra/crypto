import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../macro-calendar.mjs';
import * as U from '../scripts/update-macro.mjs';
import { cases } from './macro-cases.mjs';

test('kalender makro (FOMC + CPI): semua kasus', () => {
  const fails = [];
  cases(M, U, { eq: (a, b, n) => { try { assert.deepEqual(a, b); } catch { fails.push(n + ' => ' + JSON.stringify(a)); } }, ok: (c, n) => { if (!c) fails.push(n); } });
  assert.deepEqual(fails, [], 'Kasus gagal:\n' + fails.join('\n'));
});
