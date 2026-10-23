// Data pasar sintetis deterministik untuk tes (tanpa jaringan).
export const rng = (seed) => { let s = seed | 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

export function candles(seed, n, step, endT, p0 = 100, vol = 0.03) {
  const rnd = rng(seed), g = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const out = []; let p = p0; const t0 = endT - (n - 1) * step;
  for (let i = 0; i < n; i++) {
    const o = p, c = o * Math.exp(vol * g());
    out.push({ t: t0 + i * step, o, h: Math.max(o, c) * (1 + Math.abs(g()) * vol * 0.4), l: Math.min(o, c) * (1 - Math.abs(g()) * vol * 0.4), c, v: 1e6 * (0.5 + rnd()) });
    p = c;
  }
  return out;
}
export const toRows = (cs, step) => cs.map((q) => [q.t, String(q.o), String(q.h), String(q.l), String(q.c), String(q.v), q.t + step - 1]);

export const SYMS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'TAO'];
const END = Date.UTC(2026, 9, 24, 12);

/** Pasang fetch palsu bergaya Binance. opsi: failSyms (Set simbol USDT yang selalu HTTP 500). Kembalikan fungsi pemulih. */
export function installMarket({ failSyms = new Set() } = {}) {
  const orig = globalThis.fetch;
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  globalThis.fetch = async (url) => {
    const u = new URL(url), p = u.pathname.replace('/api/v3/', '');
    if (p === 'ticker/24hr') return ok([...SYMS.map((s, i) => ({ symbol: s + 'USDT', quoteVolume: String(1e9 / (i + 1)) })), { symbol: 'USDCUSDT', quoteVolume: '9e9' }]);
    if (p === 'klines') {
      const sym = u.searchParams.get('symbol');
      if (failSyms.has(sym)) return { ok: false, status: 500, json: async () => ({}) };
      const iv = u.searchParams.get('interval'), n = +u.searchParams.get('limit'), step = iv === '1d' ? 864e5 : 144e5;
      const i = SYMS.indexOf(sym.replace('USDT', ''));
      return ok(toRows(candles(1000 + i * 37 + (iv === '1d' ? 0 : 1), n, step, END, 100, iv === '1d' ? 0.03 : 0.013), step));
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return () => { globalThis.fetch = orig; };
}
