// Audit satu setup: menampilkan evaluasi dan jejak candle 1 menit (Binance) agar bisa dicek manual di TradingView.
// Pemakaian: node scripts/audit-setup.mjs <setupId> [--hours=72]   (butuh akses Binance: jalankan di GitHub Actions)
import fs from 'node:fs';
import path from 'node:path';
import { createBinanceProvider } from '../src/price-data/binance.js';
import { evaluateSetup } from '../src/evaluator/evaluate.js';
import { traceCandles } from '../src/evaluator/trace.js';

const id = process.argv[2];
if (!id) { console.error('pakai: node scripts/audit-setup.mjs <setupId>'); process.exit(2); }
const hours = Number((process.argv.find((a) => a.startsWith('--hours=')) || '--hours=72').split('=')[1]);
const dir = path.join(process.env.DATA_DIR || 'data', 'setups');
const all = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
const s = all.find((x) => x.setupId === id);
if (!s) { console.error('setupId tidak ditemukan:', id); process.exit(1); }

const settings = JSON.parse(fs.readFileSync(new URL('../config/settings.json', import.meta.url), 'utf8'));
const provider = createBinanceProvider({ bases: settings.binanceBaseUrls });
const a = Date.parse(s.analysisTimeUtc);
const end = Math.min(Date.now(), a + hours * 3600e3);
const candles = await provider.getCandles(s.symbol, '1m', Math.floor(a / 60e3) * 60e3, end);
const ev = await evaluateSetup(s, provider, { now: Date.now(), cfg: settings });

console.log(JSON.stringify({ setupId: s.setupId, symbol: s.symbol, direction: s.direction, analysisUtc: s.analysisTimeUtc,
  entry: s.entryPrice ?? s.entryRange, tp1: s.takeProfit?.[0], sl: s.stopLoss, hasil: ev.result, alasan: ev.reasonCode,
  entryTerpicu: ev.entryTimeUtc, hasilUtc: ev.resultTimeUtc, interval: ev.interval, candleDipakai: ev.candlesUsed }, null, 2));
console.log('\nJejak candle 1m (ENTRY/TP/SL = level tersentuh di menit itu):');
for (const r of traceCandles(s, candles).filter((r) => r.touches !== '-').slice(0, 40)) console.log(JSON.stringify(r));
console.log('(hanya menit yang menyentuh level yang ditampilkan; untuk seluruh candle cek di TradingView BINANCE:' + s.symbol + ', timeframe 1m)');
