'use strict';

/* ------------------------------------------------------------------ */
/*  PORTFOLIO MANAGER — 支持分组                                        */
/* ------------------------------------------------------------------ */
class PortfolioManager {
  constructor() {
    this._items = this._load();
    this._groups = this._loadGroups();
    this._showPct = localStorage.getItem('showProfitPct') !== 'false';
  }

  _load() {
    try { const raw = localStorage.getItem('portfolio'); if (raw) return JSON.parse(raw); } catch(_){}
    return [];
  }

  _save() { localStorage.setItem('portfolio', JSON.stringify(this._items)); }

  _loadGroups() {
    try { const raw = localStorage.getItem('portfolioGroups'); if (raw) return JSON.parse(raw); } catch(_){}
    return [{ id: 'default', name: '默认分组', color: '#3498db' }];
  }

  _saveGroups() { localStorage.setItem('portfolioGroups', JSON.stringify(this._groups)); }

  get showPct() { return this._showPct; }
  set showPct(v) { this._showPct = v; localStorage.setItem('showProfitPct', String(v)); }

  getAll() { return [...this._items]; }
  getGroups() { return [...this._groups]; }

  /* ---- 分组管理 ---- */
  addGroup(name, color) {
    const id = 'g_' + Date.now();
    this._groups.push({ id, name, color: color || this._autoColor(this._groups.length) });
    this._saveGroups();
    return id;
  }

  updateGroup(id, name, color) {
    const g = this._groups.find(g => g.id === id);
    if (g) { g.name = name || g.name; g.color = color || g.color; this._saveGroups(); }
  }

  removeGroup(id) {
    if (id === 'default') return; // 不能删默认分组
    this._groups = this._groups.filter(g => g.id !== id);
    // 把该分组的持仓移回默认
    this._items.forEach(item => { if (item.group === id) item.group = 'default'; });
    this._save(); this._saveGroups();
  }

  getGroupById(id) { return this._groups.find(g => g.id === id); }

  _autoColor(idx) {
    const colors = ['#3498db', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#2ecc71', '#34495e'];
    return colors[idx % colors.length];
  }

  /* ---- 持仓管理 ---- */
  add(code, name, costPrice, quantity, group) {
    const existing = this._items.find(i => i.code === code);
    if (existing) {
      existing.name = name || existing.name;
      existing.costPrice = costPrice;
      existing.quantity = quantity;
      if (group) existing.group = group;
    } else {
      this._items.push({ code, name, costPrice, quantity, group: group || 'default' });
    }
    this._save();
  }

  update(code, costPrice, quantity) {
    const item = this._items.find(i => i.code === code);
    if (item) { item.costPrice = costPrice; item.quantity = quantity; this._save(); }
  }

  updateGroupOf(code, groupId) {
    const item = this._items.find(i => i.code === code);
    if (item) { item.group = groupId; this._save(); }
  }

  remove(code) {
    this._items = this._items.filter(i => i.code !== code); this._save();
  }

  getByCode(code) { return this._items.find(i => i.code === code); }

  /**
   * 获取指定分组的持仓
   */
  getByGroup(groupId) { return this._items.filter(i => (i.group || 'default') === groupId); }

  /**
   * 计算持仓盈亏。
   * @param {Map<string,object>} quoteCache - code → quote
   * @param {string} [groupId] - 只计算某个分组，不传则计算全部
   */
  computePnL(quoteCache, groupId) {
    const items = groupId ? this.getByGroup(groupId) : this._items;
    let totalMarketValue = 0, totalCost = 0;
    const details = items.map(item => {
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
