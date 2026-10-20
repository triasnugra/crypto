/*
 * Perbandingan kartu LIVE (halaman Mesin 1 yang terlihat saat scan) dengan kartu REPLAY (mesin yang sama
 * dijalankan ulang pada waktu scan yang sama). Angka halaman diformat dengan fungsi `fmt` (engine.mjs), jadi
 * angka replay diformat dengan cara yang sama sebelum dibandingkan: selisih pembulatan tidak dihitung sebagai ketidaksesuaian.
 */

/** Salinan persis dari `fmt` di engine.mjs. Jika engine.mjs berubah, salin ulang dan uji ulang. */
export const fmtLikeCard = (v) => (v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toPrecision(3));
const cardNum = (v) => (v == null || !Number.isFinite(v) ? null : Number(fmtLikeCard(v)));

/** Kartu live (hasil parseCryptoCard) -> bentuk perbandingan. */
export function normalizeLive(parsed) {
  return {
    symbol: parsed.ticker ? `${parsed.ticker}USDT` : null,
    direction: parsed.direction ? parsed.direction.toUpperCase() : null,
    entry: cardNum(parsed.entryPrice),
    sl: cardNum(parsed.stopLoss),
    tp1: cardNum(parsed.takeProfit?.[0]),
  };
}

/** Setup replay (hasil analyze → setups[0]) -> bentuk perbandingan. side 1 = LONG (validate.mjs: p.side==1). */
export function normalizeReplay(setup, pair) {
  if (!setup) return null;
  return {
    symbol: pair,
    direction: setup.side === 1 ? 'LONG' : 'SHORT',
    entry: cardNum(setup.entry),
    sl: cardNum(setup.sl),
    tp1: cardNum(setup.tg?.[0]?.v),
  };
}

const FIELDS = ['direction', 'entry', 'sl', 'tp1'];

/**
 * @param liveById  Map symbol -> kartu live (hanya koin yang tampil di scan itu)
 * @param replayById Map symbol -> kartu replay | null (null = replay tidak menghasilkan setup)
 */
export function compareCards(liveById, replayById) {
  const out = { n: liveById.size, exact: 0, mismatches: [], missingInReplay: [] };
  for (const [sym, live] of liveById) {
    const rep = replayById.get(sym);
    if (!rep) { out.missingInReplay.push(sym); continue; }
    const diffs = FIELDS.filter((f) => live[f] !== rep[f]).map((f) => ({ field: f, live: live[f], replay: rep[f] }));
    if (diffs.length === 0) out.exact++;
    else out.mismatches.push({ symbol: sym, diffs });
  }
  out.matchRate = out.n ? out.exact / out.n : null;
  return out;
}

/** Nama berkas raw dari collect(): 2026-10-16T13-00-00-000Z.json -> ISO. null bila tidak cocok. */
export function isoFromRawName(name) {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json$/);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : null;
}
