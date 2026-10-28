// Perbarui data/macro-calendar.json dari sumber resmi: jadwal FOMC (federalreserve.gov) dan jadwal rilis CPI (bls.gov).
// Jalankan: node scripts/update-macro.mjs
// Tanpa jaringan (atau bila situs memblokir): simpan halaman/ICS-nya lalu pakai --fomc-file=... --cpi-file=...
// Tidak bisa fetch sama sekali? Isi "overrides" di config/macro.json secara manual, itu selalu menang.
//
// Pengaman: tahun yang hasil parse-nya tidak valid TIDAK menimpa data lama, dan jumlah entri yang lebih sedikit
// dari data lama tidak menimpa. Kalau semua sumber gagal, berkas tidak disentuh dan exit code = 1.
import fs from 'node:fs';
import path from 'node:path';
import { etOffsetHours } from '../macro-calendar.mjs';

const FOMC_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
const BLS_ICS = 'https://www.bls.gov/schedule/news_release/bls.ics';
const BLS_HTML = 'https://www.bls.gov/schedule/news_release/cpi.htm';
const OUT = process.env.MACRO_OUT || 'data/macro-calendar.json';
const UA = process.env.MACRO_UA || 'macro-calendar-updater (GitHub Actions; contact via repository issues)';
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');
const mnum = (s) => MON[String(s).slice(0, 3).toLowerCase()];
const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const wd = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();

// ---------- FOMC ----------
// Mengembalikan { "2026": ["2026-01-28", ...] }. Tanggal keputusan = hari terakhir pertemuan.
export function parseFomc(html) {
  const t = text(html), heads = [...t.matchAll(/(\d{4}) FOMC Meetings/g)], out = {};
  heads.forEach((h, i) => {
    const year = +h[1], seg = t.slice(h.index + h[0].length, i + 1 < heads.length ? heads[i + 1].index : undefined), list = [];
    for (const m of seg.matchAll(/\b([A-Z][a-z]{2,8})(?:\/([A-Z][a-z]{2,8}))?\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\*?/g)) {
      const m1 = mnum(m[1]), m2 = m[2] ? mnum(m[2]) : m1, d1 = +m[3], d2 = +m[4];
      if (!m1 || !m2) continue;
      const cross = m[2] || d2 < d1, month = cross ? (m2 === m1 ? (m1 % 12) + 1 : m2) : m1, yy = cross && month < m1 ? year + 1 : year;
      const iso = `${yy}-${pad(month)}-${pad(d2)}`;
      if (wd(iso) >= 1 && wd(iso) <= 5 && yy === year && !list.includes(iso)) list.push(iso);
    }
    if (list.length >= 6 && list.length <= 9) out[year] = list.sort();   // wajar: 8 pertemuan terjadwal per tahun
  });
  return out;
}

// ---------- CPI ----------
const toEt = (y, mo, d, h, mi, utc) => {
  if (!utc) return { date: `${y}-${pad(mo)}-${pad(d)}`, hhmm: `${pad(h)}:${pad(mi)}` };
  const o = etOffsetHours(y, mo, d), t = new Date(Date.UTC(y, mo - 1, d, h - o, mi));
  return { date: t.toISOString().slice(0, 10), hhmm: pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()) };
};
// Mengembalikan { "2026": ["2026-01-13 08:30", ...] }, jam = waktu New York.
export function parseCpiIcs(ics) {
  const out = {};
  for (const ev of ics.replace(/\r?\n[ \t]/g, '').split('BEGIN:VEVENT').slice(1)) {
    const sum = (ev.match(/SUMMARY[^:]*:(.*)/) || [])[1] || '';
    if (!/consumer price index/i.test(sum) || /producer|import|export|employment/i.test(sum)) continue;
    const d = ev.match(/DTSTART([^:]*):(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{0,2})?(Z?)/);
    if (!d) continue;
    const e = toEt(+d[2], +d[3], +d[4], +(d[5] ?? 8), +(d[6] ?? 30), d[7] === 'Z');
    (out[e.date.slice(0, 4)] ||= []).push(`${e.date} ${e.hhmm}`);
  }
  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])].sort();
  return out;
}
export function parseCpiHtml(html) {
  const t = text(html), out = {};
  for (const m of t.matchAll(/\b([A-Z][a-z]{2})[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP])M/g)) {
    const mo = mnum(m[1]); if (!mo) continue;
    let h = +m[4] % 12 + (m[6] === 'P' ? 12 : 0);
    const date = `${m[3]}-${pad(mo)}-${pad(+m[2])}`;
    if (wd(date) < 1 || wd(date) > 5) continue;
    (out[m[3]] ||= []).push(`${date} ${pad(h)}:${m[5]}`);
  }
  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])].sort();
  return out;
}

// ---------- gabung ----------
// Tahun lama tidak ditimpa bila hasil baru lebih sedikit. Mengembalikan daftar perubahan untuk log.
export function mergeCalendar(old, fresh) {
  const cal = JSON.parse(JSON.stringify(old || {})), log = [];
  for (const type of ['FOMC', 'CPI']) for (const [y, list] of Object.entries(fresh[type] || {})) {
    const cur = cal[type]?.[y] || [];
    if (list.length < cur.length) { log.push(`${type} ${y}: dilewati (${list.length} < ${cur.length} entri lama)`); continue; }
    if (JSON.stringify(list) === JSON.stringify(cur)) continue;
    (cal[type] ||= {})[y] = list; log.push(`${type} ${y}: ${cur.length} -> ${list.length} entri`);
  }
  return { cal, log };
}

async function get(url, file) {
  if (file) return fs.readFileSync(file, 'utf8');
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
  return r.text();
}
const arg = (n) => (process.argv.find((a) => a.startsWith('--' + n + '=')) || '').split('=').slice(1).join('=') || null;

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const fresh = { FOMC: {}, CPI: {} }, errs = [], used = [];
  try { fresh.FOMC = parseFomc(await get(FOMC_URL, arg('fomc-file'))); used.push('federalreserve.gov'); } catch (e) { errs.push('FOMC: ' + e.message); }
  const cf = arg('cpi-file');
  try {
    const raw = await get(cf ? null : BLS_ICS, cf);
    fresh.CPI = /BEGIN:VCALENDAR/.test(raw) ? parseCpiIcs(raw) : parseCpiHtml(raw);
    if (!Object.keys(fresh.CPI).length) throw new Error('ICS/HTML terbaca tapi tidak ada jadwal CPI');
    used.push('bls.gov');
  } catch (e) {
    errs.push('CPI (ics/berkas): ' + e.message);
    try { fresh.CPI = parseCpiHtml(await get(BLS_HTML, null)); if (Object.keys(fresh.CPI).length) used.push('bls.gov (html)'); else throw new Error('tidak ada jadwal CPI di halaman'); } catch (e2) { errs.push('CPI (html): ' + e2.message); }
  }
  const nothing = !Object.keys(fresh.FOMC).length && !Object.keys(fresh.CPI).length;
  errs.forEach((e) => console.error('GAGAL', e));
  if (nothing) { console.error('Tidak ada data baru. Berkas tidak diubah. Pakai --fomc-file/--cpi-file atau isi overrides di config/macro.json.'); process.exit(1); }
  const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const { cal, log } = mergeCalendar(old.calendar, fresh);
  log.forEach((l) => console.log(l));
  if (!log.some((l) => !l.includes('dilewati')) && old.calendar) { console.log('Tidak ada perubahan.'); process.exit(0); }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), sumber: used, catatan: 'Dihasilkan scripts/update-macro.mjs. Jam rilis default: FOMC 14:00 ET, CPI 08:30 ET.', calendar: cal }, null, 1) + '\n');
  console.log('Ditulis', OUT);
}
