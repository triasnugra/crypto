# Salinan kode Mesin 1 (untuk uji kesetiaan replay)

Sumber: `triasnugra/crypto` (diunduh 20 Okt 2026). Jangan diedit selain yang tercatat di bawah.

| Berkas | sha1 (CRLF dinormalkan) | Perubahan |
|---|---|---|
| engine.mjs | a6aa2848cf79ffa1a7a1218935ecb9cd99b9310b | tidak ada |
| validate.mjs | 28bd69ebf8f724b8d832741b6f10747fab58a92a | satu baris: `async function at` diekspor (`export`). Semua logika tidak berubah. |

Fungsi `at(sym, pair, ts)` merekonstruksi mesin pada waktu `ts` dari candle Binance dan
merakit ulang candle yang sedang berjalan dari candle 15 menit sampai `ts` (tidak ada look-ahead).

Versi mesin untuk kohort = sha1 `engine.mjs` saja (validate.mjs hanya mengatur tab Uji).
