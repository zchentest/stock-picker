'use strict';

/* ------------------------------------------------------------------ */
/*  API_BASE constant                                                   */
/* ------------------------------------------------------------------ */
const API_BASE = '';   // 相对路径：本地和云部署通用，浏览器自动请求同域名
window.API_BASE = API_BASE;

/* ------------------------------------------------------------------ */
/*  API DATA SERVICE                                                    */
/* ------------------------------------------------------------------ */
class ApiDataService {
  constructor(sim) {
    this._sim = sim;
    this._klineCache = new Map();
    this._klineCacheMs = 30000;
  }

  async fetchQuotes(codes) {
    if (!codes || codes.length === 0) return [];
    try {
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(`${API_BASE}/api/quote?codes=${codes.join(',')}`, { signal: ctrl.signal });
      clearTimeout(timer);
      const json = await res.json();
      return Array.isArray(json) ? json : [];
    } catch (e) { console.warn('[fetchQuotes]', e.message); return []; }
  }

  async searchStocks(keyword) {
    if (!keyword) return [];
    try {
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${API_BASE}/api/search?keyword=${encodeURIComponent(keyword)}`, { signal: ctrl.signal });
      clearTimeout(timer);
      const json = await res.json();
      return Array.isArray(json) ? json : [];
    } catch (e) { console.warn('[searchStocks]', e.message); return []; }
  }

  async fetchKline(code, type, datalen) {
    const key = `${code}-${type}${datalen ? '-' + datalen : ''}`;
    const cached = this._klineCache.get(key);
    if (cached && Date.now() - cached.ts < this._klineCacheMs) return cached.data;
    try {
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 8000);
      let url = `${API_BASE}/api/kline?code=${code}&type=${type}`;
      if (datalen) url += `&datalen=${datalen}`;
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      const json = await res.json();
      if (Array.isArray(json) && json.length > 0) {
        this._klineCache.set(key, { data: json, ts: Date.now() }); return json;
      }
    } catch (e) { console.warn('[fetchKline]', e.message); }
    return this._sim.getKlineData(code, type);
  }

  clearKlineCache(code) {
    for (const key of this._klineCache.keys()) { if (key.startsWith(code + '-')) this._klineCache.delete(key); }
  }
}

window.ApiDataService = ApiDataService;
