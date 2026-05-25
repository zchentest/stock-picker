'use strict';

/* ------------------------------------------------------------------ */
/*  SECTORS constant (shared with SimDataService)                      */
/* ------------------------------------------------------------------ */
const SECTORS = [
  { name: '人工智能', delta: 0 }, { name: '新能源车', delta: 0 },
  { name: '光伏储能', delta: 0 }, { name: '医药生物', delta: 0 },
  { name: '银行金融', delta: 0 }, { name: '半导体',   delta: 0 },
  { name: '消费白酒', delta: 0 }, { name: '军工航天', delta: 0 },
];
window.SECTORS = SECTORS;

/* ------------------------------------------------------------------ */
/*  SIM DATA SERVICE                                                    */
/* ------------------------------------------------------------------ */
class SimDataService {
  constructor() {
    this._stocks = new Map();
    this._indices = new Map();
    this._initSectors();
  }

  ensureStock(code, name, basePrice) {
    if (this._stocks.has(code)) return;
    const base = basePrice || this._guessBase(code);
    const rng = window.makeRng(window.daySeed() + window.codeHash(code));
    const open = parseFloat((base * (1 + (rng() - 0.5) * 0.06)).toFixed(2));
    const prevClose = base;
    const ticks = this._buildTicks(open, base, rng);
    const lastPrice = ticks.length > 0 ? ticks[ticks.length - 1].price : open;
    const volM = 50;
    const filled = ticks.length / 240;
    this._stocks.set(code, {
      code, name, base, open, prevClose, price: lastPrice,
      high: Math.max(...ticks.map(t => t.price), open),
      low:  Math.min(...ticks.map(t => t.price), open),
      volume: Math.round(volM * 1e4 * (filled + (rng() - 0.5) * 0.1)),
      amount: 0, volM, ticks, rng,
      pe: parseFloat((10 + rng() * 40).toFixed(1)),
      pb: parseFloat((1 + rng() * 9).toFixed(2)),
    });
    const st = this._stocks.get(code);
    st.amount = st.volume * st.price;
    st.turnover = parseFloat((st.volume / (st.volM * 1e4 * 5)).toFixed(4));
  }

  ensureIndex(code, name, base) {
    if (this._indices.has(code)) return;
    const rng = window.makeRng(window.daySeed() + 5000 + window.codeHash(code));
    const open = parseFloat((base * (1 + (rng() - 0.5) * 0.04)).toFixed(2));
    const ticks = this._buildTicks(open, base, rng, 0.002);
    const price = ticks.length > 0 ? ticks[ticks.length - 1].price : open;
    this._indices.set(code, {
      code, name, base, open, prevClose: base,
      price: parseFloat(price.toFixed(2)), ticks, rng,
      miniTicks: (ticks.length >= 60 ? ticks.slice(-60) : ticks).map(t => t.price),
    });
  }

  _buildTicks(open, base, rng, vol = 0.004) {
    const tradeMins = this._tradingMinutes();
    const ticks = []; let price = open;
    tradeMins.forEach(t => {
      price = price * (1 + (rng() - 0.5) * vol);
      price = Math.max(price, base * 0.7); price = Math.min(price, base * 1.3);
      ticks.push({ t, price: parseFloat(price.toFixed(2)) });
    });
    return ticks;
  }

  _tradingMinutes() {
    const now = new Date(); const h = now.getHours(), m = now.getMinutes(); const mins = [];
    for (let t = 9*60+30; t <= 11*60+30; t++) { const th=Math.floor(t/60),tm=t%60; if (h>th||(h===th&&m>=tm)) mins.push(t); }
    for (let t = 13*60; t <= 15*60; t++) { const th=Math.floor(t/60),tm=t%60; if (h>th||(h===th&&m>=tm)) mins.push(t); }
    return mins;
  }

  _guessBase(code) {
    const num = parseInt(code.slice(2));
    if (num===600519) return 1720; if (num===601318) return 47;
    if (code.startsWith('sh6')) return 30+(num%100);
    if (code.startsWith('sz0')) return 15+(num%50);
    if (code.startsWith('sz3')) return 50+(num%200);
    return 20+(num%80);
  }

  _initSectors() {
    const rng = window.makeRng(window.daySeed() + 9999);
    SECTORS.forEach(s => { s.delta = parseFloat(((rng() - 0.48) * 4).toFixed(2)); });
  }

  tick() {
    this._stocks.forEach(st => {
      const delta = (st.rng() - 0.49) * 0.006;
      let p = st.price * (1 + delta);
      p = Math.max(p, st.prevClose * 0.90); p = Math.min(p, st.prevClose * 1.10);
      st.price = parseFloat(p.toFixed(2));
      if (st.price > st.high) st.high = st.price; if (st.price < st.low) st.low = st.price;
      const volInc = Math.round(st.volM * 1e4 * 0.001 * (st.rng() + 0.5));
      st.volume += volInc; st.amount = st.volume * st.price;
      st.turnover = parseFloat((st.volume / (st.volM * 1e4 * 5)).toFixed(4));
    });
    this._indices.forEach(idx => {
      const delta = (idx.rng() - 0.49) * 0.003;
      idx.price = parseFloat((idx.price * (1 + delta)).toFixed(2));
      idx.miniTicks.push(idx.price); if (idx.miniTicks.length > 60) idx.miniTicks.shift();
    });
    SECTORS.forEach(s => {
      s.delta = parseFloat((s.delta + (Math.random() - 0.5) * 0.1).toFixed(2));
      s.delta = Math.max(-9.9, Math.min(9.9, s.delta));
    });
  }

  getStock(code) { return this._stocks.get(code); }
  getIndex(code) { return this._indices.get(code); }

  getKlineData(code, period) {
    const st = this._stocks.get(code); if (!st) return [];
    if (period === 'minute') return this._buildIntradayKline(st);
    return this._buildHistoryKline(st, period);
  }

  _buildIntradayKline(st) {
    if (!st.ticks || st.ticks.length === 0) return [];
    const bars = []; const barSize = 5;
    let barStart = null, o=0, h=0, l=0, c=0;
    st.ticks.forEach(tick => {
      const barMin = Math.floor(tick.t / barSize) * barSize;
      if (barStart === null) { barStart = barMin; o=h=l=c=tick.price; }
      if (barMin !== barStart) {
        bars.push({ date: this._minToLabel(barStart), open:o, close:c, low:l, high:h,
          volume: Math.round(st.volume/Math.max(1,st.ticks.length)*barSize) });
        barStart = barMin; o=h=l=c=tick.price;
      } else { if (tick.price>h)h=tick.price; if (tick.price<l)l=tick.price; c=tick.price; }
    });
    if (barStart !== null) bars.push({ date: this._minToLabel(barStart), open:o, close:c, low:l, high:h,
      volume: Math.round(st.volume/Math.max(1,st.ticks.length)*barSize) });
    return bars;
  }

  _minToLabel(t) { return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`; }

  _buildHistoryKline(st, period) {
    const rng = window.makeRng(window.daySeed() + window.codeHash(st.code));
    const count = period==='daily'?200:period==='weekly'?80:40;
    const vol = period==='daily'?0.025:period==='weekly'?0.04:0.07;
    const data = []; let price = st.prevClose;
    for (let i = count; i >= 0; i--) {
      const date = this._offsetDate(i, period);
      const o=price, h=o*(1+rng()*vol), l=o*(1-rng()*vol), c=l+rng()*(h-l);
      const v = Math.round(st.volM*1e4*(period==='daily'?1:period==='weekly'?5:20)*(0.5+rng()));
      data.push({ date, open:parseFloat(o.toFixed(2)), close:parseFloat(c.toFixed(2)),
        low:parseFloat(l.toFixed(2)), high:parseFloat(h.toFixed(2)), volume:v });
      price = c;
    }
    if (data.length > 0) { data[data.length-1].close = st.price; data[data.length-1].date = this._offsetDate(0, period); }
    return data;
  }

  _offsetDate(daysBack, period) {
    const d = new Date(); const mult = period==='weekly'?7:period==='monthly'?30:1;
    d.setDate(d.getDate() - daysBack * mult);
    if (period==='weekly') return `${d.getFullYear()}-W${String(Math.ceil(d.getDate()/7)).padStart(2,'0')}`;
    if (period==='monthly') return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
}

window.SimDataService = SimDataService;
