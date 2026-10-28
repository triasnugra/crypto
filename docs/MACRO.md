# Kalender makro: FOMC dan CPI (tahun berapa pun)

Menambah banner FOMC dan CPI AS di halaman, dengan jendela waktu rilis, dan opsi menandai atau menahan sinyal baru.
**`engine.mjs` / `core.mjs` / `trade-sim.mjs` tidak diubah**, jadi hash versi mesin (kohort Mesin 1, protokol forward Mesin 2) tetap sama.

## Yang berubah
| Berkas | Isi |
|---|---|
| `macro-calendar.mjs` (baru) | Modul kalender: perkiraan untuk tahun berapa pun, jendela rilis, banner, gerbang tag/hold. Sama di kedua repo. |
| `config/macro.json` (baru) | Pengaturan: `mode`, `gateScope`, jendela waktu per event, `overrides` manual. |
| `scripts/update-macro.mjs` (baru) | Mengambil jadwal resmi (federalreserve.gov, bls.gov) ke `data/macro-calendar.json`. |
| `.github/workflows/macro-calendar.yml` (baru) | Menjalankan updater tiap Senin dan manual. |
| `index.html` | Banner memakai modul ini. Banner FOMC lama dari `alertList()` diganti. |
| `scripts/generate-journal.mjs` (Mesin 1) / `scripts/jurnal.mjs` (Mesin 2) | Mode tag/hold. Mesin 2 juga memakai banner baru di teks alert. |
| tes | `test/macro*.test.mjs` (Mesin 1), `scripts/test-macro.mjs` (Mesin 2). |

## Dari mana tanggalnya (urutan prioritas)
1. **override**: isian manual di `config/macro.json` (selalu menang).
2. **resmi**: `data/macro-calendar.json` hasil updater.
3. **seed**: 8 tanggal FOMC 2026 dari kode lama.
4. **perkiraan**: dihitung otomatis untuk tahun berapa pun (2027, 2028, ... 2050).

**Perkiraan tidak sama dengan jadwal resmi.** FOMC: Rabu terdekat ke tanggal acuan; cocok 8 dari 8 pada 2026, tetapi The Fed kadang menggeser pertemuan satu minggu di tahun lain. CPI: hari Selasa-Kamis terdekat ke tanggal 12; bisa meleset beberapa hari. Karena itu event bersumber perkiraan hanya tampil sebagai **banner biru "(perkiraan)"**, tidak masuk teks alert yang disegel/prompt AI di Mesin 2, dan **tidak pernah** dipakai untuk tag atau hold.
Jadwal CPI 2026 belum ada di seed, jadi sampai updater berhasil jalan atau `overrides` diisi, CPI hanya muncul sebagai perkiraan.

## Mode (`config/macro.json`)
- `"mode": "alert"` (default): banner saja. Jurnal tidak berubah.
- `"mode": "tag"`: banner + entri jurnal baru di jendela rilis diberi field `macro` (mis. `"CPI 2026-11-10"`). Field ini di luar hash, jadi rantai hash tetap valid. Berguna untuk memisahkan statistik nanti.
- `"mode": "hold"`: banner + **tidak mencatat entri baru** di jendela rilis (Mesin 1: tercatat di `scan-log.json` sebagai `held`). Entri lama tetap dinilai.
- `"gateScope": "window"` (default): hanya di jendela rilis. `"day"`: sejak 00:00 UTC hari rilis sampai akhir jendela.
- `"window"`: menit sebelum/sesudah rilis per event. Default FOMC 120/240, CPI 60/180.

Jam rilis: FOMC pernyataan 14:00 ET, CPI 08:30 ET. Dikonversi ke UTC dengan aturan DST AS (tampil juga dalam WIB).

## Peringatan penting
- **Mesin 2 mencatat sinyal sekali sehari pada 01-05 UTC.** Rilis jatuh jam 12:30-19:00 UTC, jadi dengan `gateScope: "window"` mode tag/hold praktis tidak pernah aktif di Mesin 2. Pakai `"day"` bila ingin efek. Mesin 1 jalan tiap 4 jam, jadi `window` berfungsi.
- **Jangan aktifkan `hold` saat forward test Mesin 2 sedang berjalan.** Itu mengubah aturan sinyal mana yang dicatat, padahal protokol melarang mengubah aturan setelah dimulai. Kalau tetap mau, mulai protokol baru. `alert` dan `tag` aman.
- Di Mesin 2, teks alert baru ikut ke prompt agen AI (seperti FOMC sebelumnya). Perilaku agen di sekitar rilis bisa sedikit berbeda dari sebelum patch.

## Memperbarui
```
node scripts/update-macro.mjs                       # ambil dari situs resmi
node scripts/update-macro.mjs --fomc-file=fomc.html --cpi-file=bls.ics   # dari berkas yang Anda simpan
```
Tahun yang hasil parse-nya tidak valid, atau yang entrinya lebih sedikit dari data lama, tidak menimpa apa pun. Bila semua sumber gagal, exit code 1 dan berkas tidak disentuh.
Cadangan tanpa jaringan: tulis tanggal manual, mis. `"overrides": [{"type":"CPI","date":"2027-01-13","time":"08:30"}]` (jam New York).

## Tes
`node --test "test/*.test.mjs"` (Mesin 1) atau `node scripts/test-macro.mjs` (Mesin 2). Offline, tanpa jaringan.
