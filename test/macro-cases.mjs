// Kasus uji kalender makro. Dipakai bersama oleh test/macro.test.mjs (Mesin 1) dan scripts/test-macro.mjs (Mesin 2).
// Semua offline dan deterministik. Fixture HTML/ICS di bawah SINTETIS (bukan salinan halaman resmi).
const FOMC_HTML = (year, rows) => `<h4>${year} FOMC Meetings</h4>` + rows.map(([m, d]) => `<div class="row fomc-meeting"><div class="fomc-meeting__month"><strong>${m}</strong></div><div class="fomc-meeting__date">${d}</div></div>`).join('');
const ICS = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Consumer Price Index\r\nDTSTART;TZID=America/New_York:20270113T083000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Producer Price Index\r\nDTSTART:20270114T133000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Consumer Price Index\r\nDTSTART:20270210T133000Z\r\nEND:VEVENT\r\nEND:VCALENDAR`;
const SEED26 = ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09'];
const UTC = (...a) => Date.UTC(...a);

export function cases(M, U, t) {
  const { eq, ok } = t;
  // 1) perkiraan
  eq(M.estimateFomc(2026), SEED26, 'perkiraan FOMC 2026 identik dengan daftar lama (8/8)');
  for (const y of [2027, 2028, 2029, 2030, 2035, 2050]) {
    const f = M.estimateFomc(y), c = M.estimateCpi(y), w = (s) => new Date(s + 'T00:00:00Z').getUTCDay();
    ok(f.length === 8 && f.every((s) => s.startsWith(String(y)) && w(s) === 3), `FOMC ${y}: 8 tanggal, semua Rabu`);
    ok(c.length === 12 && c.every((s, i) => s.startsWith(y + '-' + String(i + 1).padStart(2, '0')) && w(s) >= 2 && w(s) <= 4), `CPI ${y}: 12 tanggal, satu per bulan, Selasa-Kamis`);
  }
  // 2) zona waktu / DST
  eq(M.etToUtcMs('2026-10-28', '14:00'), UTC(2026, 9, 28, 18), 'FOMC 28 Okt 2026 14:00 EDT = 18:00 UTC');
  eq(M.etToUtcMs('2027-01-27', '14:00'), UTC(2027, 0, 27, 19), 'FOMC Jan 2027 14:00 EST = 19:00 UTC');
  eq(M.etToUtcMs('2027-07-14', '08:30'), UTC(2027, 6, 14, 12, 30), 'CPI Jul 2027 08:30 EDT = 12:30 UTC');
  eq(M.etToUtcMs('2027-11-10', '08:30'), UTC(2027, 10, 10, 13, 30), 'CPI Nov 2027 08:30 EST = 13:30 UTC (setelah DST berakhir)');
  // 3) prioritas sumber
  const cfg0 = M.mergeConfig({});
  const y26 = M.eventsForYear(2026, {}, cfg0).filter((e) => e.type === 'FOMC');
  ok(y26.length === 8 && y26.every((e) => e.src === 'seed' && e.trusted), 'FOMC 2026 memakai seed terpercaya');
  const y27 = M.eventsForYear(2027, {}, cfg0).filter((e) => e.type === 'FOMC');
  ok(y27.length === 8 && y27.every((e) => e.src === 'perkiraan' && !e.trusted), 'FOMC 2027 tanpa data resmi = perkiraan tidak terpercaya');
  const off = { FOMC: { 2027: ['2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-22', '2027-10-27', '2027-12-08'] } };
  const o27 = M.eventsForYear(2027, off, cfg0).filter((e) => e.type === 'FOMC');
  ok(o27.length === 8 && o27.every((e) => e.src === 'resmi'), 'data resmi lengkap menggantikan seluruh perkiraan tahun itu');
  const part = { FOMC: { 2027: ['2027-01-27', '2027-03-17'] } };
  const p27 = M.eventsForYear(2027, part, cfg0).filter((e) => e.type === 'FOMC');
  ok(p27.filter((e) => e.src === 'resmi').length === 2 && new Set(p27.map((e) => e.date)).size === p27.length, 'data resmi parsial: dua resmi dipertahankan, tanpa tanggal dobel');
  ok(!p27.some((e) => e.src === 'perkiraan' && Math.abs(Date.parse(e.date) - Date.parse('2027-03-17')) < 21 * 864e5) && p27.length >= 6, 'perkiraan yang bentrok dengan tanggal resmi dibuang');
  const cOv = M.mergeConfig({ overrides: [{ type: 'CPI', date: '2027-01-13', time: '08:30' }] });
  const c27 = M.eventsForYear(2027, {}, cOv).filter((e) => e.type === 'CPI' && e.date.startsWith('2027-01'));
  ok(c27.length === 1 && c27[0].src === 'override' && c27[0].date === '2027-01-13' && c27[0].trusted, 'override manual menggantikan perkiraan di bulan yang sama dan dianggap terpercaya');
  // 4) status, banner, gerbang
  const at = (...a) => UTC(...a);
  const w1 = M.macroStatus(at(2026, 9, 28, 17, 30), {}, {});
  ok(w1.alerts.length === 1 && w1.alerts[0][0] === 'r' && /JENDELA RILIS AKTIF/.test(w1.alerts[0][1]) && /WIB/.test(w1.alerts[0][1]), 'FOMC 28 Okt 2026 jam 17:30 UTC: banner merah jendela aktif');
  ok(w1.gate.active && w1.gate.tag === 'FOMC 2026-10-28' && !w1.gate.hold, 'mode default (alert): gerbang aktif sebagai penanda tetapi hold=false');
  const h1 = M.macroStatus(at(2026, 9, 28, 17, 30), {}, { mode: 'hold' });
  ok(h1.gate.hold === true, 'mode hold: hold=true di dalam jendela');
  const pre = M.macroStatus(at(2026, 9, 28, 3), {}, {});
  ok(pre.alerts.length === 1 && pre.alerts[0][0] === 'y' && /hari ini/.test(pre.alerts[0][1]) && !pre.gate.active, 'FOMC hari ini tapi di luar jendela: banner kuning, gerbang (window) tidak aktif');
  const dayScope = M.macroStatus(at(2026, 9, 28, 3), {}, { mode: 'hold', gateScope: 'day' });
  ok(dayScope.gate.hold === true, 'gateScope=day: hold aktif sejak 00:00 UTC hari rilis');
  const tmr = M.macroStatus(at(2026, 9, 27, 12), {}, {});
  ok(tmr.alerts.length === 1 && /besok/.test(tmr.alerts[0][1]), 'sehari sebelum FOMC: banner "besok"');
  const after = M.macroStatus(at(2026, 9, 28, 22, 30), {}, {});
  ok(!after.gate.active, 'setelah jendela (post 240 menit) gerbang tertutup');
  const est = M.macroStatus(M.etToUtcMs('2027-03-17', '14:00'), {}, { mode: 'hold' });
  ok(est.alerts.length >= 1 && est.alerts.every((a) => a[0] === 'b') && !est.gate.active && !est.gate.hold, 'event perkiraan: hanya info biru, TIDAK PERNAH mengunci/menahan sinyal');
  const win = M.macroStatus(at(2026, 9, 28, 17, 30), {}, { window: { FOMC: { preMin: 10, postMin: 10 } } });
  ok(!win.gate.active, 'jendela bisa diatur lewat config (preMin/postMin)');
  // 5) pergantian tahun dan tahun jauh
  ok(M.macroStatus(UTC(2026, 11, 31, 23), {}, {}).events.some((e) => e.date.startsWith('2027')), 'pergantian tahun: event 2027 ikut terbaca di 31 Des 2026');
  ok(M.macroStatus(UTC(2041, 5, 1), {}, {}).events.length >= 40, 'tahun 2041 tetap menghasilkan kalender');
  ok(M.macroStatus(UTC(2026, 9, 28, 17, 30), {}, { events: ['CPI'] }).alerts.length === 0, 'events:["CPI"] mematikan FOMC');
  // 6) penggabungan banner lama
  const merged = M.mergeAlerts([['y', 'FOMC hari ini atau besok: lama', ''], ['y', 'Hari Senin: ...', '']], at(2026, 9, 28, 17, 30), {}, {});
  ok(merged.filter((a) => a[1].startsWith('FOMC')).length === 1 && merged.some((a) => a[1].startsWith('Hari Senin')), 'mergeAlerts membuang banner FOMC lama, banner lain tetap');
  // 7) parser sumber resmi (fixture sintetis)
  const fh = FOMC_HTML(2027, [['January', '26-27'], ['March', '16-17'], ['April', '27-28'], ['June', '15-16'], ['July', '27-28'], ['September', '21-22'], ['October', '26-27*'], ['December', '7-8']])
    + FOMC_HTML(2028, [['January', '25-26'], ['March', '14-15'], ['Apr/May', '30-1'], ['June', '13-14'], ['July', '25-26'], ['September', '19-20']]);
  const pf = U.parseFomc(fh);
  eq(pf[2027], ['2027-01-27', '2027-03-17', '2027-04-28', '2027-06-16', '2027-07-28', '2027-09-22', '2027-10-27', '2027-12-08'], 'parseFomc: ambil hari ke-2 pertemuan, abaikan tanda *');
  ok(pf[2028]?.includes('2028-05-01'), 'parseFomc: pertemuan lintas bulan (Apr/May 30-1) -> 1 Mei');
  eq(U.parseFomc('<h4>2027 FOMC Meetings</h4><p>halaman rusak</p>'), {}, 'parseFomc: halaman rusak = kosong, tidak menebak');
  const pc = U.parseCpiIcs(ICS);
  eq(pc['2027'], ['2027-01-13 08:30', '2027-02-10 08:30'], 'parseCpiIcs: TZID dan UTC (DST dihitung), PPI diabaikan');
  const ph = U.parseCpiHtml('<tr><td>Dec 2026</td><td>Jan. 13, 2027</td><td>08:30 AM</td></tr><tr><td>Jan 2027</td><td>Feb. 10, 2027</td><td>08:30 AM</td></tr>');
  eq(ph['2027'], ['2027-01-13 08:30', '2027-02-10 08:30'], 'parseCpiHtml: tabel jadwal BLS');
  // 8) penggabungan data: tidak boleh turun kualitas
  const m1 = U.mergeCalendar({ FOMC: { 2027: SEED26.map((s) => s.replace('2026', '2027')) } }, { FOMC: { 2027: ['2027-01-27'] }, CPI: { 2027: ['2027-01-13 08:30'] } });
  ok(m1.cal.FOMC['2027'].length === 8 && m1.cal.CPI['2027'].length === 1 && m1.log.some((l) => l.includes('dilewati')), 'mergeCalendar: hasil baru yang lebih sedikit tidak menimpa data lama');
  // 9) kalender hasil updater terbaca oleh modul
  const upd = M.eventsForYear(2027, { CPI: { 2027: ['2027-01-13 08:30', '2027-02-10 08:30'] } }, cfg0).filter((e) => e.type === 'CPI');
  ok(upd.filter((e) => e.src === 'resmi').length === 2 && upd.length === 12, 'CPI resmi parsial + perkiraan sisanya = 12 rilis, tanpa dobel bulan');
}
