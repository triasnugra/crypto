// Kalender makro AS (FOMC dan CPI) untuk Mesin 1 dan Mesin 2. Modul murni: tanpa dependensi, jalan di browser dan Node.
// Berkas ini SAMA di kedua repo. Sengaja TIDAK mengubah engine.mjs / core.mjs (hash versi mesin tetap).
//
// Sumber tanggal, urutan prioritas per event:
//   1. override   : config/macro.json > overrides (isian manual Anda; selalu menang)
//   2. resmi      : data/macro-calendar.json (dihasilkan scripts/update-macro.mjs dari federalreserve.gov dan bls.gov)
//   3. seed       : FOMC 2026 bawaan (daftar yang sudah ada di kode lama)
//   4. perkiraan  : dihitung aturan di bawah untuk tahun berapa pun. BELUM TERVERIFIKASI.
// Event bersumber 'perkiraan' hanya tampil sebagai info biru dan TIDAK PERNAH dipakai untuk tag/hold.

export const DEFAULTS = {
  events: ['FOMC', 'CPI'],
  mode: 'alert',              // alert = banner saja | tag = banner + tandai sinyal | hold = banner + tahan sinyal baru
  gateScope: 'window',        // window = hanya di jendela rilis | day = sejak 00:00 UTC hari rilis sampai akhir jendela
  window: { FOMC: { preMin: 120, postMin: 240 }, CPI: { preMin: 60, postMin: 180 } },
  overrides: [],              // [{type:'CPI', date:'2027-01-13', time:'08:30'}]  time = jam New York (ET), opsional
  tzLabel: { name: 'WIB', offsetMin: 420 },
};

// Jam rilis resmi (waktu New York): FOMC pernyataan 14:00 ET, CPI 08:30 ET.
const ET_TIME = { FOMC: '14:00', CPI: '08:30' };
const LABEL = { FOMC: 'FOMC (keputusan suku bunga The Fed)', CPI: 'CPI AS (inflasi)' };
const SEED = { FOMC: { 2026: ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09'] } };
const TRUSTED = new Set(['override', 'resmi', 'seed']);

export function mergeConfig(c = {}) {
  return {
    ...DEFAULTS, ...c,
    window: { FOMC: { ...DEFAULTS.window.FOMC, ...(c.window?.FOMC || {}) }, CPI: { ...DEFAULTS.window.CPI, ...(c.window?.CPI || {}) } },
    tzLabel: { ...DEFAULTS.tzLabel, ...(c.tzLabel || {}) },
    overrides: Array.isArray(c.overrides) ? c.overrides : [],
  };
}

// ---------- tanggal ----------
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;                       // m 1..12
const dow = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();         // 0 = Minggu
const nthSunday = (y, m, n) => 1 + ((7 - dow(y, m, 1)) % 7) + 7 * (n - 1);

// Offset New York terhadap UTC (jam): DST AS = Minggu ke-2 Maret sampai Minggu ke-1 November.
export function etOffsetHours(y, m, d) {
  const s = nthSunday(y, 3, 2), e = nthSunday(y, 11, 1);
  const k = m * 100 + d;
  return k >= 300 + s && k < 1100 + e ? 4 : 5;
}

// 'YYYY-MM-DD' + 'HH:MM' (jam New York) -> epoch ms UTC.
export function etToUtcMs(date, hhmm) {
  const [y, m, d] = date.split('-').map(Number), [h, mi] = hhmm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h + etOffsetHours(y, m, d), mi);
}

// ---------- perkiraan (tahun berapa pun) ----------
// FOMC: Rabu terdekat ke tanggal acuan. Pada 2026 cocok 8 dari 8 dengan jadwal resmi. Di tahun lain bisa meleset satu minggu
// (The Fed kadang menggeser pertemuan), karena itu hasilnya hanya "perkiraan".
const FOMC_REF = [[1, 29], [3, 18], [4, 30], [6, 17], [7, 30], [9, 17], [10, 29], [12, 10]];
export function nearestWeekday(y, m, d, wd) {
  let best = null;
  for (let k = -3; k <= 3; k++) {
    const t = new Date(Date.UTC(y, m - 1, d + k));
    if (t.getUTCDay() === wd) best = t;
  }
  return best.toISOString().slice(0, 10);
}
export const estimateFomc = (y) => FOMC_REF.map(([m, d]) => nearestWeekday(y, m, d, 3));

// CPI: BLS umumnya merilis hari kerja antara tanggal 10 dan 15, paling sering Selasa sampai Kamis. Tebakan: hari
// Selasa-Kamis terdekat ke tanggal 12. Selisihnya bisa sampai beberapa hari.
export function estimateCpi(y) {
  const out = [];
  for (let m = 1; m <= 12; m++) {
    let pick = null;
    for (let k = 0; k <= 4 && !pick; k++) for (const s of k ? [-k, k] : [0]) {
      const t = new Date(Date.UTC(y, m - 1, 12 + s)), w = t.getUTCDay();
      if (w >= 2 && w <= 4) { pick = t.toISOString().slice(0, 10); break; }
    }
    out.push(pick);
  }
  return out;
}

// ---------- kalender ----------
// official = isi data/macro-calendar.json: { FOMC: { "2027": ["2027-01-27", ...] }, CPI: { "2027": ["2027-01-13 08:30", ...] } }
function parseEntry(type, s) {
  const [date, time] = String(s).trim().split(/\s+/);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const hhmm = /^\d{1,2}:\d{2}$/.test(time || '') ? time : ET_TIME[type];
  return { type, date, hhmm };
}

export function eventsForYear(year, official = {}, cfg = DEFAULTS) {
  const out = [];
  for (const type of cfg.events) {
    const ov = cfg.overrides.filter((o) => o.type === type && String(o.date).startsWith(String(year))).map((o) => ({ type, date: o.date, hhmm: o.time || ET_TIME[type], src: 'override' }));
    const off = (official?.[type]?.[year] || []).map((s) => parseEntry(type, s)).filter(Boolean).map((e) => ({ ...e, src: 'resmi' }));
    const seed = (SEED[type]?.[year] || []).map((s) => ({ type, date: s, hhmm: ET_TIME[type], src: 'seed' }));
    const est = (type === 'FOMC' ? estimateFomc(year) : estimateCpi(year)).map((s) => ({ type, date: s, hhmm: ET_TIME[type], src: 'perkiraan' }));
    // Resmi atau seed menggantikan seluruh perkiraan tahun itu bila lengkap. FOMC lengkap = 8 pertemuan, CPI lengkap = 12 rilis.
    const need = type === 'FOMC' ? 8 : 12;
    const base = off.length >= need ? off : seed.length >= need ? seed : mergeByMonth(type, [...off, ...seed], est);
    // Override menggantikan entri bulan yang sama.
    const months = new Set(ov.map((e) => e.date.slice(0, 7)));
    out.push(...base.filter((e) => !months.has(e.date.slice(0, 7))), ...ov);
  }
  return out.map((e) => ({ ...e, t: etToUtcMs(e.date, e.hhmm), label: LABEL[e.type], trusted: TRUSTED.has(e.src) })).sort((a, b) => a.t - b.t);
}

// Tahun belum lengkap: pakai entri terverifikasi apa adanya, lalu isi celahnya dengan perkiraan.
// Perkiraan dibuang bila ada entri terverifikasi di bulan yang sama (CPI) atau dalam 21 hari (FOMC), supaya tidak dobel.
function mergeByMonth(type, known, est) {
  const ms = (e) => Date.parse(e.date + 'T00:00:00Z');
  const clash = (e) => known.some((k) => type === 'CPI' ? k.date.slice(0, 7) === e.date.slice(0, 7) : Math.abs(ms(k) - ms(e)) < 21 * 864e5);
  return [...known, ...est.filter((e) => !clash(e))];
}

// Semua event di sekitar `now` (tahun lalu, ini, depan, supaya aman di pergantian tahun).
export function eventsAround(now, official = {}, cfg = DEFAULTS) {
  const y = new Date(now).getUTCFullYear();
  return [y - 1, y, y + 1].flatMap((yy) => eventsForYear(yy, official, cfg));
}

const hm = (ms, off = 0) => { const d = new Date(ms + off * 6e4); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };

// ---------- status, banner, gerbang ----------
export function macroStatus(now = Date.now(), official = {}, rawCfg = {}) {
  const cfg = mergeConfig(rawCfg), tz = cfg.tzLabel, W = cfg.window;
  const evs = eventsAround(now, official, cfg), today = new Date(now).toISOString().slice(0, 10), tmrw = new Date(now + 864e5).toISOString().slice(0, 10);
  const alerts = [], active = [];
  for (const e of evs) {
    const w = W[e.type], t0 = e.t - w.preMin * 6e4, t1 = e.t + w.postMin * 6e4, day = new Date(e.t).toISOString().slice(0, 10);
    const dayStart = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
    const g0 = cfg.gateScope === 'day' ? Math.min(t0, dayStart) : t0;
    const inWin = now >= t0 && now <= t1, inGate = now >= g0 && now <= t1;
    const time = `${hm(e.t)} UTC (${hm(e.t, tz.offsetMin)} ${tz.name})`;
    const est = e.src === 'perkiraan', note = est ? 'PERKIRAAN, belum terverifikasi. Cek federalreserve.gov / bls.gov.' : e.src === 'seed' ? 'Verifikasi di federalreserve.gov' : 'Sumber: ' + e.src;
    if (inWin) alerts.push([est ? 'b' : 'r', `${e.label}: JENDELA RILIS AKTIF (${time}). Volatilitas tinggi, spread melebar, wick palsu sering terjadi.`, note]);
    else if (day === today || day === tmrw) alerts.push([est ? 'b' : 'y', `${e.label} ${day === today ? 'hari ini' : 'besok'}, rilis ${e.date} ${time}${est ? ' (perkiraan)' : ''}. Berita memicu noise: tunggu pemicu yang jelas dan pakai SL ketat.`, note]);
    if (inGate && e.trusted) active.push({ type: e.type, date: e.date, t: e.t, src: e.src, inWindow: inWin });
  }
  const gate = { mode: cfg.mode, scope: cfg.gateScope, active: active.length > 0, events: active,
    tag: active.length ? active.map((a) => `${a.type} ${a.date}`).join('+') : null,
    hold: cfg.mode === 'hold' && active.length > 0 };
  return { alerts, gate, events: evs };
}

// Bentuk yang sama dengan alertList() lama: [[warna, teks, keterangan], ...]
export const macroAlerts = (now, official, cfg) => macroStatus(now, official, cfg).alerts;

// Pengganti banner FOMC lama di alertList(): buang entri berawalan 'FOMC' lalu tambahkan banner makro.
export const mergeAlerts = (oldList, now, official, cfg) => [...oldList.filter((a) => !String(a[1]).startsWith('FOMC')), ...macroAlerts(now, official, cfg)];

// ---------- pemuat ----------
// Node: loadMacroNode(import.meta.url-relatif root). Browser: loadMacroWeb().
export async function loadMacroWeb(base = './') {
  const get = async (p) => { try { const r = await fetch(base + p, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; } };
  const [official, cfg] = await Promise.all([get('data/macro-calendar.json'), get('config/macro.json')]);
  return { official: official?.calendar || official || {}, cfg: mergeConfig(cfg || {}) };
}
export async function loadMacroNode(root) {
  const fs = await import('node:fs'), path = await import('node:path');
  const rd = (p) => { try { return JSON.parse(fs.readFileSync(path.join(root, p), 'utf8')); } catch { return null; } };
  const official = rd('data/macro-calendar.json');
  return { official: official?.calendar || official || {}, cfg: mergeConfig(rd('config/macro.json') || {}) };
}
