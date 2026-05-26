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
    try {
      const raw = localStorage.getItem('portfolio'); if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          // 兼容旧数据：没有 id 字段的自动补上
          arr.forEach(item => {
            if (!item.id) item.id = 'h_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
          });
          return arr;
        }
      }
    } catch(_){}
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
  /**
   * 添加持仓。同一只股票可以在不同分组中重复添加。
   * @returns {string} 新持仓的 ID
   */
  add(code, name, costPrice, quantity, group) {
    const id = 'h_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    this._items.push({ id, code, name, costPrice, quantity, group: group || 'default' });
    this._save();
    return id;
  }

  /**
   * 更新指定 ID 的持仓
   */
  updateById(id, costPrice, quantity) {
    const item = this._items.find(i => i.id === id);
    if (item) { item.costPrice = costPrice; item.quantity = quantity; this._save(); }
  }

  /**
   * 更新指定持仓的分组
   */
  updateGroupOf(id, groupId) {
    const item = this._items.find(i => i.id === id);
    if (item) { item.group = groupId; this._save(); }
  }

  /**
   * 删除指定 ID 的持仓
   */
  removeById(id) {
    this._items = this._items.filter(i => i.id !== id); this._save();
  }

  /**
   * 按 ID 获取持仓
   */
  getById(id) { return this._items.find(i => i.id === id); }

  /**
   * 按 code 获取所有持仓（可能多条，因为在不同分组）
   */
  getAllByCode(code) { return this._items.filter(i => i.code === code); }

  /**
   * 检查某只股票是否已在指定分组中持仓
   */
  isInGroup(code, groupId) { return this._items.some(i => i.code === code && (i.group || 'default') === groupId); }

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
