// Jejak keputusan evaluator untuk audit manual: candle 1 menit setelah analisis, dengan tanda sentuhan entry/TP/SL.
// Murni: tidak memanggil jaringan. Dipakai oleh scripts/audit-setup.mjs.
export function traceCandles(setup, candles1m) {
  const long = setup.direction === 'LONG';
  const tp = setup.takeProfit?.[0], sl = setup.stopLoss;
  const lo = setup.entryRange ? Math.min(...setup.entryRange) : setup.entryPrice;
  const hi = setup.entryRange ? Math.max(...setup.entryRange) : setup.entryPrice;
  const a = Date.parse(setup.analysisTimeUtc);
  return candles1m.filter((c) => c.t >= a).map((c) => {
    const touchEntry = long ? c.l <= hi : c.h >= lo;
    const touchTP = long ? c.h >= tp : c.l <= tp;
    const touchSL = long ? c.l <= sl : c.h >= sl;
    const flags = [touchEntry && 'ENTRY', touchTP && 'TP', touchSL && 'SL'].filter(Boolean).join(' ');
    return { t: new Date(c.t).toISOString(), o: c.o, h: c.h, l: c.l, c: c.c, touches: flags || '-' };
  });
}
