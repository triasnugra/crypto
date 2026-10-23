# Patch Mesin Crypto

## Cara pasang (tambahkan ke root repo `triasnugra/crypto`, timpa bila ada)
```
engine.mjs                      # <- PERBAIKAN UTAMA: file yang di-import index.html dan validate.mjs
package.json
scripts/{journal-lib,generate-journal,verify-journal,check-live}.mjs
test/{synth.mjs,smoke.test.mjs,journal.test.mjs}
docs/JOURNAL.md
.github/workflows/{journal,smoke}.yml
```
`engine.mjs` identik dengan `vendor/mesin1/engine.mjs` (sha1 a6aa2848cf79ffa1a7a1218935ecb9cd99b9310b), jadi versi mesin tidak berubah.

## Hapus / pindahkan ke repo benchmark (bukan milik repo mesin)
```
git rm scripts/replay-fidelity.mjs .github/workflows/fidelity.yml
```
Keduanya mengimpor `../src/...` yang tidak ada di repo ini dan workflow-nya memanggil `npm ci` tanpa lockfile, jadi pasti gagal.
Tes `smoke` akan merah selama `replay-fidelity.mjs` masih ada.

## Setelah push
1. Actions > "Tes dan cek situs" > Run workflow (job `live` memastikan `engine.mjs` sudah terbit dan journal ada).
2. Actions > "Journal Mesin Crypto" > Run workflow (scan pertama). Setelah itu jalan tiap 4 jam.
3. Pastikan Settings > Actions > Workflow permissions = Read and write.
