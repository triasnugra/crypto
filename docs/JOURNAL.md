# Journal Mesin Crypto (`data/journal.json`)

Dihasilkan oleh `scripts/generate-journal.mjs` dari `engine.mjs` yang sama dengan halaman (tanpa browser, tanpa Playwright).
Terbit di `https://triasnugra.github.io/crypto/data/journal.json`. Status tiap scan ada di `data/scan-log.json`.

## Yang dicatat
Setup **terbaik per koin** (`best`, yang tampil sebagai kartu), dari 40 koin USDT teratas menurut volume 24 jam, parameter default `analyze`
(sama dengan halaman). Level **presisi penuh** (10 angka penting), bukan angka yang dibulatkan `fmt`.
Format dibuat kompatibel dengan journal TN: `aset, arah, entry, sl, tp (=TP1), waktu, t, due, alasan, h`. Tambahan: `tps` (semua target),
`tf, kind, tipe, rr, rr1, slp, mode, harga_awal, konfirmasi, status_kartu, peringatan, bias_harian, btc_bias, qv, engine`.

- `t` = saat data koin diterima (waktu analisis sebenarnya), UTC ms. `due` = `t` + 72 jam (TTL entry, sama dengan benchmark).
- `mode`: `limit` atau `pasar`. `pasar` berarti harga sudah melewati level, jadi entry = harga saat analisis (kartu halaman tetap menulis "Entry limit").
- `batal_jika`: aturan batal untuk evaluator: TP1 tercapai sebelum entry terisi, atau close di timeframe setup melewati SL.
- `engine` = 16 hex pertama sha1 `engine.mjs` (CRLF dinormalkan). Lengkapnya ada di `scan-log.json`. Beda hash = versi mesin baru (PROTOCOL 7).

## Aturan penggabungan (PROTOCOL 3)
Kemunculan baru bergabung ke entri induk bila koin dan arah sama, entry dalam 1% dari entry induk, induk belum melewati `due`, dan terakhir terlihat
kurang dari 24 jam lalu. Level induk **tidak pernah berubah**; perubahan dicatat di `rev` (maks 20). Selain itu menjadi entri baru.
`lastSeen`, `seen`, `rev` bersifat mutable dan tidak masuk hash.

## Integritas
Append-only, berantai hash. `h = sha256(JSON field IMMUTABLE)[0:20]`, daftar field dan urutannya ada di `scripts/journal-lib.mjs`
(`aset, arah, t, tf, kind, harga_awal, mode, entry, sl, tp, tps, engine, seq, prev`). `prev` = `h` entri sebelumnya (`null` untuk yang pertama).
`node scripts/verify-journal.mjs` memeriksa rantai, hash isi, sisi SL/TP, dan id ganda. Generator menolak menambah ke journal yang rusak.

## Scan gagal tidak menerbitkan data setengah
BTC gagal, atau lebih dari 25% koin gagal, atau journal rusak = status `FAILED`: `journal.json` tidak diubah, `scan-log.json` mencatat penyebabnya,
dan workflow berwarna merah. `OK_NO_SETUPS` berarti scan sehat tetapi memang tidak ada setup (berbeda dari gagal).
HTTP 418/429 dari Binance ditunggu (30 dtk, lalu 60 dtk) sebelum menyerah.

## Memasang ke monitor (terminal.zip)
Di `config/sources.json` ganti entri `crypto`:
```json
"crypto": {
  "label": "M7 Crypto", "type": "journal", "family": "Crypto (engine.mjs)",
  "url": "https://triasnugra.github.io/crypto/",
  "journalUrl": "https://triasnugra.github.io/crypto/data/journal.json",
  "fetchTimeoutMs": 30000, "retries": 3
}
```
Sudah diuji: `parseJournalEntry` + `buildRecord` monitor membaca entri ini dengan benar (waktu `source`, bukan `first_seen`).
Catatan: ID setup berubah (hash journal, bukan level kartu), jadi jalankan paralel dulu dengan nama mesin berbeda (mis. `crypto2`) sebelum
mengganti, supaya riwayat lama tidak bercampur. Pada monitor.zip (2 mesin) `index.js` masih memanggil scraper DOM untuk `crypto`;
pindahkan ke registri `engines.js` seperti di terminal.zip.

## Batasan
- Hanya setup terbaik per koin yang dicatat (seperti kartu). Setup lain per koin tidak tercatat.
- Waktu tercatat pada saat scan, setiap 4 jam; setup yang hidup lebih singkat tidak terlihat.
- Pages perlu membangun ulang setelah commit bot. Bila `journal.json` di situs tidak ikut ter-update, cek tab Actions > pages-build-deployment.
- Journal tumbuh sekitar puluhan KB per hari. Jangan dihapus (rantai hash); bila terlalu besar, mulai berkas baru per tahun dengan `prev` yang menyambung.
