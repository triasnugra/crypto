[PROTOCOL.md](https://github.com/user-attachments/files/33707531/PROTOCOL.md)
# Protokol benchmark (ditetapkan di muka)

Ditetapkan: **2026-10-18**, sebelum ada cukup data untuk menyimpulkan mesin mana pun.
Aturan di bawah tidak boleh diubah setelah melihat hasil kohort yang sedang berjalan. Perubahan dicatat di
bagian "Riwayat perubahan" lengkap dengan alasannya.

Semua hasil adalah **teoretis berbasis candle Binance** (bukan trading nyata) dan dihitung dengan aturan evaluasi
yang sama untuk kedua mesin.

## 1. Unit independensi: minggu kalender ISO (UTC)
Kedua mesin menerbitkan banyak setup sekaligus, dan setup itu bergerak bersama pasar. Contoh nyata (journal.json,
17 Okt 2026): **97 entri Mesin 2 hanya 7 batch pada 5 hari analisis**; 34 trade selesai hanya dari 4 hari.
Satu LONG-batch pada 14 Okt (20 setup) hampir seluruhnya terkena satu penurunan pasar.
`core.mjs` mengonfirmasi bahwa Mesin 2 memutuskan dari harga *open harian* (`scanInput`), yaitu satu keputusan per hari.
Unit yang dipakai adalah **minggu kalender ISO** (sama dengan protokol forward Mesin 2). Jumlah observasi independen = jumlah
minggu yang punya trade selesai, bukan jumlah trade. Semua interval kepercayaan dihitung dengan bootstrap yang mengacak minggu
(beserta seluruh trade di minggu itu).

## 2. Kohort
| Kohort | Isi | Dipakai untuk kesimpulan |
|---|---|---|
| `primary` | Mesin 2: entri berantai hash (`fwd=1`) yang tautannya terverifikasi pada scan ini. Mesin 1: setup yang pertama kali terlihat setelah pelacakan dimulai | Ya |
| `exploratory` | Mesin 2: entri pra-protokol (tanpa `h`, tidak tamper-evident) atau entri setelah rantai putus | Tidak (ditampilkan berlabel) |
| `unverifiable` | Mesin 1: setup yang sudah ada saat pelacakan dimulai (waktu analisis tidak diketahui) | Tidak (status `UNVERIFIABLE`, keluar dari "setup terbit") |

Catatan: yang diverifikasi mandiri hanya **tautan** rantai (`prev` = `h` entri sebelumnya, `seq` berurutan). Rumus hash isi
berada di skrip jurnal Mesin 2, bukan di `core.mjs`, sehingga isi entri belum bisa diverifikasi mandiri.

## 3. Definisi "satu setup" untuk Mesin 1 (bekukan pada kemunculan pertama)
Mesin 1 menghitung ulang SL/TP tiap scan (`engine.mjs`: SL ± 0,25 ATR; entry = min/max(level, harga)). Aturan:
- Kemunculan baru **bergabung** ke setup induk bila simbol, arah, tipe entry sama dan entry dalam toleransi **1%**,
  selama induk masih terbuka atau selesai kurang dari **24 jam** lalu.
- Level yang dievaluasi = level **pertama kali terlihat**. Perubahan level hanya dicatat sebagai kejadian `SETUP_REVISION`.
- Setelah cooldown, kemunculan yang sama dianggap peluang baru. Setup `unverifiable` tidak menyerap kemunculan.
- Setup yang hilang dari daftar dicatat `SETUP_DISAPPEARED`; **tidak** dianggap `CANCELLED` (tidak dapat dibedakan dari level bergeser).

## 4. Lingkup perbandingan utama
Kohort `primary` ∩ **koin yang dicakup kedua mesin** ∩ satu setup per klaster near-duplicate. Lingkup lain
("kohort bersih, semua koin" dan "semua data") ditampilkan sebagai pembanding berlabel.

## 5. Metrik
- **Utama:** expectancy **bersih** per trade (R). Biaya = protokol Mesin 2 (`forward-lib.mjs`, `costPct`):
  **fee 0,05% per sisi** (masuk dan keluar) + **slippage 0,05% pada setiap trade terisi** = 0,15% dari harga entry per trade.
  Dalam satuan R, biaya = 0,15% ÷ risiko (%). Contoh: risiko 3% → biaya 0,05R; risiko 15% → 0,01R.
  Trade yang tidak terisi tidak dikenai biaya.
- Sekunder: win rate dan win rate impas (dari R rencana), profit factor, rata-rata menang/kalah, drawdown (R),
  SQN (hanya bila ≥ 30 trade dan ≥ 30 hari), kurva ekuitas, rasio setup yang sudah melewati TP saat terbit.
- Breakdown (arah, koin, alasan entry, versi) bersifat **deskriptif / sumber hipotesis**. Tidak dipakai untuk menyimpulkan,
  dan tidak boleh dipilih setelah melihat mana yang tampak bagus.

## 6. Gerbang dan kriteria keputusan
**Gerbang tampilan:** angka kinerja (win rate, expectancy, total R, profit factor, drawdown, kurva ekuitas) **disembunyikan**
sampai tiap mesin memiliki **≥ 150 trade selesai** dan **≥ 20 minggu independen** pada lingkup utama. Tombol "intip" ada,
tetapi diberi label TIDAK SAH dan tidak boleh dipakai untuk keputusan.
1. **"Mesin A lebih baik dari B"** hanya dinyatakan bila, pada lingkup utama: tiap mesin ≥ **30 trade** dan ≥ **30 hari
   independen**, dan CI95 bootstrap-per-hari selisih expectancy bersih tidak mencakup 0.
2. **"Mesin memiliki edge"** hanya dinyatakan bila batas bawah CI95 expectancy bersih (bootstrap per hari) > 0 dengan
   ≥ 30 hari independen.
3. Di bawah ambang itu dashboard menulis "belum ada kesimpulan" beserta syarat yang belum terpenuhi.
4. Interval kepercayaan tidak dihitung bila hari independen < 5 (hasilnya akan menyesatkan).

## 7. Versi mesin
Setiap perubahan pada `engine.mjs` / `validate.mjs` (Mesin 1) atau `core.mjs` (Mesin 2) adalah **versi baru**, dicatat sebagai
kejadian `ENGINE_VERSION_CHANGE`, dan hasil dikelompokkan per versi. Kesimpulan tidak boleh menggabungkan versi berbeda.
Batasan: perubahan pada skrip inline halaman (nilai `ctx` seperti `legacy`, `tlb`, `closeStop`) dan ID `engine` di jurnal
(rumusnya tidak diketahui) belum terdeteksi/terverifikasi mandiri.

## 8. Larangan
- Menyetel mesin berdasarkan hasil kohort yang sedang berjalan tanpa membuat versi baru.
- Mengubah aturan evaluasi di tengah kohort tanpa mencatatnya di sini dan menjalankan ulang dengan jejak audit.
- Menghapus atau menimpa setup yang tidak menguntungkan.

## 8a. Uji kesetiaan replay (Mesin 1)
Replay Mesin 1 (`vendor/mesin1/`, sha1 `engine.mjs` tercatat di `VENDOR.md`) dijalankan ulang pada waktu scan yang tersimpan
(`data/raw/crypto`) dan dibandingkan kartunya. Angka replay diformat dengan `fmt` yang sama dengan halaman. Hasilnya
hanya laporan (`data/fidelity/`), tidak mengubah data setup. Belum diuji: koin pada universe (40 teratas menurut volume
24 jam) tidak bisa direkonstruksi persis; `qv` replay memakai volume hari sebelumnya, bukan volume 24 jam. Kedua hal
ini hanya memengaruhi teks peringatan volume, bukan level entry/SL/TP.

## 9. Keterbatasan yang diketahui
Mesin 1 hanya teramati pada saat scan (waktu terlihat bisa tertinggal sebesar jarak antar-scan; setup yang hidup lebih singkat
dari itu tidak tercatat). Fill dianggap terjadi saat harga menyentuh level. Hanya TP pertama yang dievaluasi.
Jurnal Mesin 2 memuat dua hasil alternatif (`bm`, `bi`) yang artinya belum dikonfirmasi pemilik mesin.

## Riwayat perubahan
- 2026-10-18: versi awal (unit hari, biaya 0,1% per sisi dan slippage hanya di SL, gerbang 30 trade dan 30 hari).
- 2026-10-20: diubah agar sesuai protokol Mesin 2 yang sudah disegel: unit minggu ISO, gerbang 150 trade dan 20 minggu,
  biaya 0,05% per sisi + slippage 0,05% pada semua trade terisi, dan angka kinerja disembunyikan sampai gerbang terpenuhi.
  Alasan: versi 18 Okt disusun sendiri dan bertentangan dengan protokol pemilik mesin. Tidak ada keputusan yang sudah diambil
  berdasarkan angka lama.
