'use strict';

/* ------------------------------------------------------------------ */
/*  PORTFOLIO MANAGER                                                   */
/* ------------------------------------------------------------------ */
class PortfolioManager {
  constructor() {
    this._items = this._load();
    this._showPct = localStorage.getItem('showProfitPct') !== 'false';
  }

  _load() {
    try { const raw = localStorage.getItem('portfolio'); if (raw) return JSON.parse(raw); } catch(_){}
    return [];
  }

  _save() { localStorage.setItem('portfolio', JSON.stringify(this._items)); }

  get showPct() { return this._showPct; }
  set showPct(v) { this._showPct = v; localStorage.setItem('showProfitPct', String(v)); }

  getAll() { return [...this._items]; }

  add(code, name, costPrice, quantity) {
    const existing = this._items.find(i => i.code === code);
    if (existing) {
      existing.name = name || existing.name;
      existing.costPrice = costPrice;
      existing.quantity = quantity;
    } else {
      this._items.push({ code, name, costPrice, quantity });
    }
    this._save();
  }

  update(code, costPrice, quantity) {
    const item = this._items.find(i => i.code === code);
    if (item) { item.costPrice = costPrice; item.quantity = quantity; this._save(); }
  }

  remove(code) {
    this._items = this._items.filter(i => i.code !== code); this._save();
  }

  getByCode(code) { return this._items.find(i => i.code === code); }

  /**
   * 计算持仓盈亏。
   * @param {Map<string,object>} quoteCache - code → quote
   */
  computePnL(quoteCache) {
    let totalMarketValue = 0, totalCost = 0;
    const details = this._items.map(item => {
      const q = quoteCache.get(item.code);
      // 优先用实时行情价格，其次用昨收价，最后用成本价（API不可用时至少不显示离谱的负数）
      let price = q ? Number(q.price) : 0;
      if (!price && q && Number(q.prevClose)) price = Number(q.prevClose);
      if (!price) price = item.costPrice;  // 最后降级用成本价
      const marketValue = price * item.quantity;
      const costValue = item.costPrice * item.quantity;
      const pnl = marketValue - costValue;
      const pnlPct = costValue !== 0 ? ((pnl / costValue) * 100) : 0;
      totalMarketValue += marketValue;
      totalCost += costValue;
      return { ...item, price, marketValue, costValue, pnl, pnlPct };
    });
    const totalPnl = totalMarketValue - totalCost;
    const totalPnlPct = totalCost !== 0 ? ((totalPnl / totalCost) * 100) : 0;
    return { details, totalMarketValue, totalCost, totalPnl, totalPnlPct };
  }
}

window.PortfolioManager = PortfolioManager;
