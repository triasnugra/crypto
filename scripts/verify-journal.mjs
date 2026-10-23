// node scripts/verify-journal.mjs [data/journal.json]
import fs from 'node:fs';
import { verifyJournal } from './journal-lib.mjs';

const file = process.argv[2] || 'data/journal.json';
if (!fs.existsSync(file)) { console.log(`Belum ada ${file}: tidak ada yang diverifikasi.`); process.exit(0); }
const v = verifyJournal(JSON.parse(fs.readFileSync(file, 'utf8')));
console.log(v.ok ? `OK: ${v.n} entri, rantai hash utuh.` : `GAGAL (${v.errors.length} masalah):\n` + v.errors.slice(0, 20).join('\n'));
process.exit(v.ok ? 0 : 1);
