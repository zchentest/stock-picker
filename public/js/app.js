'use strict';

/* =====================================================================
 *  自用选股-盈亏查看工具 v6.0 — 雪球风格 + K线标注 + 虚拟持仓 + 分组对比 + 港股指数
 * ===================================================================== */

/* ------------------------------------------------------------------ */
/*  CONSTANTS                                                           */
/* ------------------------------------------------------------------ */
const INDEX_CODES = [
  { code: 'sh000001', name: '上证指数', base: 3128.5 },
  { code: 'hkHSI',   name: '恒生指数', base: 20000 },
  { code: 'hkHSTECH',name: '恒生科技', base: 4500 },
  { code: 'sh513050',name: '中概互联网', base: 1.0 },
  { code: 'sz159262',name: '港股通科技', base: 0.8 },
];
window.INDEX_CODES = INDEX_CODES;

const DEFAULT_WATCHLIST = ['sh600519','sh601318','sz000001','sz002594','sz300750'];
window.DEFAULT_WATCHLIST = DEFAULT_WATCHLIST;

/* ------------------------------------------------------------------ */
/*  MODAL HELPER                                                       */
/* ------------------------------------------------------------------ */
function showModal(title, fields, actions) {
  return new Promise((resolve) => {
    const container = document.getElementById('modalContainer');
    const fieldHtml = fields.map(f => {
      if (f.type === 'select') {
        const opts = (f.options || []).map(o =>
          `<option value="${o.value}"${o.value === f.value ? ' selected' : ''}>${o.label}</option>`
        ).join('');
        return `<div class="modal-field">
          <label>${f.label}</label>
          <select id="modal-${f.key}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:14px;font-family:var(--font-mono);outline:none">${opts}</select>
        </div>`;
      }
      return `
      <div class="modal-field">
        <label>${f.label}</label>
        <input type="${f.type||'text'}" id="modal-${f.key}" value="${f.value ?? ''}"
               placeholder="${f.placeholder||''}" step="${f.step||'any'}" />
      </div>`;
    }).join('');
    const actionHtml = actions.map(a => `
      <button class="modal-btn${a.primary?' modal-btn-primary':''}${a.danger?' modal-btn-danger':''}"
              data-action="${a.key}">${a.label}</button>`).join('');
    container.innerHTML = `
      <div class="modal-overlay" id="modalOverlay">
        <div class="modal-box">
          <div class="modal-title">${title}</div>
          ${fieldHtml}
          <div class="modal-actions">${actionHtml}</div>
        </div>
      </div>`;

    const overlay = document.getElementById('modalOverlay');
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { container.innerHTML = ''; resolve(null); }
    });

    overlay.querySelectorAll('.modal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const values = {};
        fields.forEach(f => {
          const el = document.getElementById(`modal-${f.key}`);
          values[f.key] = el ? el.value : '';
        });
        container.innerHTML = '';
        resolve({ action, values });
      });
    });

    // Focus first input
    const firstInput = overlay.querySelector('input, select');
    if (firstInput) firstInput.focus();
  });
}
window.showModal = showModal;

/* ------------------------------------------------------------------ */
/*  APP CONTROLLER                                                      */
/* ------------------------------------------------------------------ */
class App {
  constructor() {
    this._watchCodes = this._loadWatchlist();
    this._quoteCache = new Map();
    this._indexCache = new Map();
    this._indexMiniTicks = new Map();
    this._nameCache = new Map();  // code → name 缓存，API 不可用时降级使用
    INDEX_CODES.forEach(idx => this._indexMiniTicks.set(idx.code, []));

    this._sim = new window.SimDataService();
    this._api = new window.ApiDataService(this._sim);
    this._chart = new window.ChartService('klineChart');
    this._miniSvc = new window.MiniChartService();
    this._portfolio = new window.PortfolioManager();

    this._activeCode = this._watchCodes[0] || null;
    this._activePeriod = 'minute';
    this._activeRank = 'rise';
    this._activeSidebarTab = 'watchlist';
    this._apiStatus = 'loading';

    // 盈亏曲线分组勾选状态：groupId → boolean
    this._pnlGroupChecked = {};

    INDEX_CODES.forEach(idx => this._sim.ensureIndex(idx.code, idx.name, idx.base));

    this._bindEvents();
    this._bootRender();
    this._startRefresh();
  }

  _loadWatchlist() {
    try { const raw = localStorage.getItem('watchlist');
      if (raw) { const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length > 0) {
          return arr.map(item => {
            if (typeof item === 'string') return item;
            if (item && item.code) {
              if (item.name) this._nameCache.set(item.code, item.name);
              return item.code;
            }
            return null;
          }).filter(Boolean);
        }
      }
    } catch(_){}
    return [...DEFAULT_WATCHLIST];
  }
  _saveWatchlist() {
    const data = this._watchCodes.map(code => {
      const q = this._quoteCache.get(code);
      const name = (q && q.name && q.name !== code) ? q.name : (this._nameCache.get(code) || '');
      return name ? { code, name } : code;
    });
    localStorage.setItem('watchlist', JSON.stringify(data));
  }

  async _bootRender() {
    this._renderWatchlist();
    this._renderNavbarIndices(null);
    this._renderIndexStrip(null);
    this._renderStockHeader(null);
    this._renderRankList();
    this._renderSectors();
    this._renderPortfolio();
    this._renderNews();
    await this._refreshAll();
  }

  /* ---- Data refresh ---- */
  async _refreshAll() {
    await Promise.all([this._refreshWatchlist(), this._refreshIndices()]);
    this._renderPortfolio();
  }

  async _refreshWatchlist() {
    if (this._watchCodes.length === 0) {
      this._renderWatchlist(); this._renderStockHeader(null);
      this._renderRankList(); return;
    }
    const quotes = await this._api.fetchQuotes(this._watchCodes);
    if (quotes.length > 0) {
      this._setApiStatus('ok');
      quotes.forEach(q => {
        this._quoteCache.set(q.code, q);
        if (q.name && q.name !== q.code) this._nameCache.set(q.code, q.name);
        this._sim.ensureStock(q.code, q.name, q.price);
        const simSt = this._sim.getStock(q.code);
        if (simSt) {
          simSt.price = q.price; simSt.open = q.open; simSt.prevClose = q.prevClose;
          simSt.high = q.high; simSt.low = q.low; simSt.name = q.name;
          simSt.volume = q.volume; simSt.amount = q.amount;
        }
      });
      this._watchCodes.forEach(code => {
        if (!this._quoteCache.has(code)) {
          const fallbackName = this._nameCache.get(code) || code;
          this._sim.ensureStock(code, fallbackName, undefined);
        }
      });
    } else {
      this._setApiStatus('error');
      this._sim.tick();
      this._watchCodes.forEach(code => {
        if (this._quoteCache.has(code)) {
          // 已有缓存，保留真实名称和价格
        } else {
          const fallbackName = this._nameCache.get(code) || code;
          this._sim.ensureStock(code, fallbackName, undefined);
          const simSt = this._sim.getStock(code);
          if (simSt) this._quoteCache.set(code, this._simToQuote(simSt));
        }
      });
    }
    this._renderWatchlist();
    if (this._activeCode && this._quoteCache.has(this._activeCode)) this._renderStockHeader(this._activeCode);
    this._renderRankList();
  }

  async _refreshIndices() {
    const codes = INDEX_CODES.map(i => i.code);
    const quotes = await this._api.fetchQuotes(codes);
    if (quotes.length > 0) {
      quotes.forEach(q => {
        this._indexCache.set(q.code, q);
        const ticks = this._indexMiniTicks.get(q.code) || [];
        ticks.push(q.price); if (ticks.length > 60) ticks.shift();
        this._indexMiniTicks.set(q.code, ticks);
      });
    } else {
      this._sim.tick();
      INDEX_CODES.forEach(idx => {
        const simIdx = this._sim.getIndex(idx.code); if (!simIdx) return;
        this._indexCache.set(idx.code, this._simToQuote(simIdx));
        this._indexMiniTicks.set(idx.code, [...simIdx.miniTicks]);
      });
    }
    this._renderNavbarIndices(this._indexCache);
    this._renderIndexStrip(this._indexCache);
  }

  _simToQuote(simSt) {
    const price = simSt.price || 0; const prevClose = simSt.prevClose || price;
    const change = parseFloat((price - prevClose).toFixed(4));
    const changePct = prevClose !== 0 ? parseFloat(((change / prevClose) * 100).toFixed(2)) : 0;
    return { code: simSt.code, name: simSt.name, price, open: simSt.open || price, prevClose,
      high: simSt.high || price, low: simSt.low || price, change, changePct,
      volume: simSt.volume || 0, amount: simSt.amount || 0, date: '', time: '(模拟)' };
  }

  _setApiStatus(status) {
    this._apiStatus = status;
    const badge = document.getElementById('apiBadge'); if (!badge) return;
    badge.className = `api-badge ${status}`;
    badge.textContent = status === 'ok' ? '● 实时行情' : status === 'error' ? '● 行情异常' : '● 连接中';
  }

  async _loadAndRenderKline(code, period) {
    const loading = document.getElementById('chartLoading');
    if (loading) loading.classList.add('show');
    try {
      const data = await this._api.fetchKline(code, period);
      this._chart.render(code, period, data);
    } catch (e) {
      this._chart.render(code, period, this._sim.getKlineData(code, period));
    } finally {
      if (loading) loading.classList.remove('show');
    }
  }

  _startRefresh() {
    setInterval(() => this._refreshAll(), 60000);
    setInterval(() => this._updateClock(), 1000);
    this._updateClock();
  }

  /* ---- Watchlist management ---- */
  addToWatchlist(code, name) {
    if (this._watchCodes.includes(code)) { this._toast(`${name || code} 已在自选股中`); return; }
    this._watchCodes.push(code); this._saveWatchlist();
    this._sim.ensureStock(code, name || code, undefined);
    if (!this._activeCode) this._activeCode = code;
    this._toast(`✓ 已添加 ${name || code}`);
    this._refreshWatchlist();
  }

  removeFromWatchlist(code) {
    const idx = this._watchCodes.indexOf(code); if (idx < 0) return;
    const q = this._quoteCache.get(code); const name = q ? q.name : code;
    this._watchCodes.splice(idx, 1); this._quoteCache.delete(code); this._saveWatchlist();
    if (this._activeCode === code) {
      this._activeCode = this._watchCodes[0] || null;
      if (this._activeCode) this._loadAndRenderKline(this._activeCode, this._activePeriod);
    }
    this._toast(`已移除 ${name}`);
    this._renderWatchlist(); this._renderStockHeader(this._activeCode); this._renderRankList();
  }

  /* ---- Render: Watchlist ---- */
  _renderWatchlist() {
    const el = document.getElementById('watchlist');
    if (this._watchCodes.length === 0) {
      el.innerHTML = `<div class="watchlist-empty">还没有自选股<br>在顶部搜索框添加</div>`;
      return;
    }
    el.innerHTML = this._watchCodes.map(code => {
      const q = this._quoteCache.get(code);
      const displayName = q ? q.name : (this._nameCache.get(code) || code.slice(2));
      if (!q) return `
        <div class="watchlist-item ${code===this._activeCode?'active':''}" data-code="${code}">
          <div class="wl-row1"><span class="wl-name">${displayName}</span><span class="wl-price flat">--</span></div>
          <div class="wl-row2"><span class="wl-code">${code.slice(2)}</span><span class="wl-pct flat">加载中</span></div>
          <span class="wl-del" title="移除自选">×</span>
        </div>`;
      const cls = window.colorClass(q.changePct);
      return `
        <div class="watchlist-item ${code===this._activeCode?'active':''}" data-code="${code}">
          <div class="wl-row1"><span class="wl-name">${q.name}</span><span class="wl-price ${cls}">${window.fmt(q.price)}</span></div>
          <div class="wl-row2"><span class="wl-code">${code.slice(2)}</span><span class="wl-pct ${cls}">${window.signStr(q.changePct)}%</span></div>
          <span class="wl-del" title="移除自选">×</span>
        </div>`;
    }).join('');
    this._bindWatchlistClicks();
  }

  _bindWatchlistClicks() {
    document.querySelectorAll('.watchlist-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('wl-del')) return;
        this._activeCode = item.dataset.code;
        this._renderWatchlist(); this._renderStockHeader(this._activeCode);
        // 点击自选股时立即刷新该股票行情
        this._api.fetchQuotes([this._activeCode]).then(quotes => {
          if (quotes.length > 0) {
            quotes.forEach(q => {
              this._quoteCache.set(q.code, q);
              this._sim.ensureStock(q.code, q.name, q.price);
              const simSt = this._sim.getStock(q.code);
              if (simSt) {
                simSt.price = q.price; simSt.open = q.open; simSt.prevClose = q.prevClose;
                simSt.high = q.high; simSt.low = q.low; simSt.name = q.name;
                simSt.volume = q.volume; simSt.amount = q.amount;
              }
            });
            this._renderWatchlist();
            this._renderStockHeader(this._activeCode);
            this._renderPortfolio();
          }
        });
        this._api.clearKlineCache(this._activeCode);
        this._loadAndRenderKline(this._activeCode, this._activePeriod);
      });
      const delBtn = item.querySelector('.wl-del');
      if (delBtn) delBtn.addEventListener('click', (e) => {
        e.stopPropagation(); this.removeFromWatchlist(item.dataset.code);
      });
    });
    if (this._activeCode && !this._chart.code) this._loadAndRenderKline(this._activeCode, this._activePeriod);
  }

  /* ---- Render: Portfolio (with groups) ---- */
  _renderPortfolio() {
    const allItems = this._portfolio.getAll();
    const groups = this._portfolio.getGroups();

    const toggle = document.getElementById('pctToggle');
    if (toggle) { if (this._portfolio.showPct) toggle.classList.add('on'); else toggle.classList.remove('on'); }

    const list = document.getElementById('portfolioList');
    if (allItems.length === 0) {
      list.innerHTML = `<div class="portfolio-empty">暂无持仓<br>在搜索结果中添加持仓</div>`;
      document.getElementById('portfolioSummary').innerHTML = '';
      return;
    }

    // 按分组渲染
    let html = '';
    groups.forEach(g => {
      const groupItems = this._portfolio.getByGroup(g.id);
      if (groupItems.length === 0) return;
      const pnl = this._portfolio.computePnL(this._quoteCache, g.id);
      const pnlCls = window.colorClass(pnl.totalPnl);

      html += `<div class="pf-group-header" data-group="${g.id}">
        <span class="pf-group-dot" style="background:${g.color}"></span>
        <span class="pf-group-name">${g.name}</span>
        <span class="pf-group-summary ${pnlCls}">${window.signStr(pnl.totalPnl)} (${window.signStr(pnl.totalPnlPct)}%)</span>
        <span class="pf-group-edit" title="编辑分组">✎</span>
      </div>`;

      groupItems.forEach(d => {
        const q = this._quoteCache.get(d.code);
        let price = q ? Number(q.price) : 0;
        if (!price && q && Number(q.prevClose)) price = Number(q.prevClose);
        if (!price) price = d.costPrice;
        const marketValue = price * d.quantity;
        const costValue = d.costPrice * d.quantity;
        const itemPnl = marketValue - costValue;
        const itemPnlPct = costValue !== 0 ? ((itemPnl / costValue) * 100) : 0;
        const itemPnlCls = window.colorClass(itemPnl);
        const pctStr = this._portfolio.showPct ? ` <span class="pf-pnl-pct ${itemPnlCls}">(${window.signStr(itemPnlPct)}%)</span>` : '';
        html += `
          <div class="portfolio-item" data-code="${d.code}">
            <div class="pf-row1">
              <span><span class="pf-name">${d.name}</span><span class="pf-qty">${d.quantity}股</span></span>
              <span class="pf-cost">成本 ${window.fmt(d.costPrice)}</span>
            </div>
            <div class="pf-row2">
              <span class="pf-price ${itemPnlCls}">${window.fmt(price)}</span>
              <span class="pf-pnl ${itemPnlCls}">${window.signStr(itemPnl)}${pctStr}</span>
            </div>
            <span class="pf-del" title="删除持仓">×</span>
          </div>`;
      });
    });
    list.innerHTML = html;

    // Bind click events
    list.querySelectorAll('.portfolio-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('pf-del')) return;
        this._editPortfolioItem(item.dataset.code);
      });
      const delBtn = item.querySelector('.pf-del');
      if (delBtn) delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._portfolio.remove(item.dataset.code);
        this._toast('已删除持仓');
        this._renderPortfolio();
      });
    });

    // 分组编辑按钮
    list.querySelectorAll('.pf-group-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const groupId = btn.closest('.pf-group-header').dataset.group;
        this._editGroup(groupId);
      });
    });

    // Summary — 所有持仓合计
    const total = this._portfolio.computePnL(this._quoteCache);
    const totalPnlCls = window.colorClass(total.totalPnl);
    const sumEl = document.getElementById('portfolioSummary');
    sumEl.innerHTML = `
      <div class="pf-sum-row"><span class="pf-sum-label">总市值</span><span class="pf-sum-value">${window.fmtAmount(total.totalMarketValue)}</span></div>
      <div class="pf-sum-row"><span class="pf-sum-label">总成本</span><span class="pf-sum-value">${window.fmtAmount(total.totalCost)}</span></div>
      <div class="pf-sum-row"><span class="pf-sum-label">总盈亏</span><span class="pf-sum-value ${totalPnlCls}">${window.signStr(total.totalPnl)} (${window.signStr(total.totalPnlPct)}%)</span></div>`;
  }

  /* ---- 分组管理 ---- */
  async _editGroup(groupId) {
    const g = this._portfolio.getGroupById(groupId);
    if (!g) return;

    const result = await showModal(`编辑分组 — ${g.name}`, [
      { key: 'name', label: '分组名称', type: 'text', value: g.name },
      { key: 'color', label: '颜色（如 #e74c3c）', type: 'text', value: g.color },
    ], [
      { key: 'delete', label: '删除分组', danger: groupId !== 'default' },
      { key: 'cancel', label: '取消' },
      { key: 'confirm', label: '保存', primary: true },
    ]);

    if (!result) return;
    if (result.action === 'delete' && groupId !== 'default') {
      this._portfolio.removeGroup(groupId);
      this._toast('分组已删除，持仓移至默认分组');
      this._renderPortfolio();
      return;
    }
    if (result.action === 'confirm') {
      this._portfolio.updateGroup(groupId, result.values.name, result.values.color);
      this._toast('分组已更新');
      this._renderPortfolio();
    }
  }

  async _addPortfolioFromSearch(code, name) {
    // Ensure in watchlist first
    if (!this._watchCodes.includes(code)) this.addToWatchlist(code, name);

    const groups = this._portfolio.getGroups();
    const groupOptions = groups.map(g => ({ value: g.id, label: g.name }));
    groupOptions.push({ value: '_new', label: '+ 新建分组' });

    const result = await showModal(`添加持仓 — ${name}`, [
      { key: 'costPrice', label: '成本价', type: 'number', placeholder: '0.00', step: '0.001' },
      { key: 'quantity',  label: '持仓数量', type: 'number', placeholder: '100', step: '1' },
      { key: 'group', label: '分组', type: 'select', value: 'default', options: groupOptions },
    ], [
      { key: 'cancel', label: '取消' },
      { key: 'confirm', label: '确认添加', primary: true },
    ]);
    if (!result || result.action !== 'confirm') return;

    const costPrice = parseFloat(result.values.costPrice);
    const quantity = parseInt(result.values.quantity, 10);
    if (isNaN(costPrice) || costPrice <= 0 || isNaN(quantity) || quantity <= 0) {
      this._toast('请输入有效的成本价和数量'); return;
    }

    let groupId = result.values.group;
    if (groupId === '_new') {
      const newGroupName = prompt('请输入新分组名称：');
      if (!newGroupName) groupId = 'default';
      else groupId = this._portfolio.addGroup(newGroupName);
    }

    this._portfolio.add(code, name, costPrice, quantity, groupId);
    this._toast(`✓ 已添加 ${name} 持仓`);
    this._renderPortfolio();
  }

  async _editPortfolioItem(code) {
    const item = this._portfolio.getByCode(code);
    if (!item) return;

    const groups = this._portfolio.getGroups();
    const groupOptions = groups.map(g => ({ value: g.id, label: g.name }));
    groupOptions.push({ value: '_new', label: '+ 新建分组' });

    const result = await showModal(`编辑持仓 — ${item.name}`, [
      { key: 'costPrice', label: '成本价', type: 'number', value: item.costPrice, step: '0.001' },
      { key: 'quantity',  label: '持仓数量', type: 'number', value: item.quantity, step: '1' },
      { key: 'group', label: '分组', type: 'select', value: item.group || 'default', options: groupOptions },
    ], [
      { key: 'delete', label: '删除持仓', danger: true },
      { key: 'cancel', label: '取消' },
      { key: 'confirm', label: '保存', primary: true },
    ]);
    if (!result) return;
    if (result.action === 'delete') {
      this._portfolio.remove(code); this._toast('已删除持仓'); this._renderPortfolio(); return;
    }
    if (result.action === 'confirm') {
      const costPrice = parseFloat(result.values.costPrice);
      const quantity = parseInt(result.values.quantity, 10);
      if (isNaN(costPrice) || costPrice <= 0 || isNaN(quantity) || quantity <= 0) {
        this._toast('请输入有效的成本价和数量'); return;
      }

      let groupId = result.values.group;
      if (groupId === '_new') {
        const newGroupName = prompt('请输入新分组名称：');
        if (!newGroupName) groupId = 'default';
        else groupId = this._portfolio.addGroup(newGroupName);
      }

      this._portfolio.update(code, costPrice, quantity);
      this._portfolio.updateGroupOf(code, groupId);
      this._toast('持仓已更新'); this._renderPortfolio();
    }
  }

  /* ---- Render: Stock Header ---- */
  _renderStockHeader(code) {
    const el = document.getElementById('stockHeader');
    if (!code || !this._quoteCache.has(code)) {
      el.innerHTML = `<div class="stock-header-top"><div class="sh-name-block"><span class="sh-name" style="color:var(--text-muted)">请选择或添加自选股</span></div></div>`;
      return;
    }
    const q = this._quoteCache.get(code);
    const cls = window.colorClass(q.changePct);
    const metas = [
      { label: '今开', value: window.fmt(q.open) },
      { label: '昨收', value: window.fmt(q.prevClose) },
      { label: '最高', value: `<span class="rise">${window.fmt(q.high)}</span>` },
      { label: '最低', value: `<span class="fall">${window.fmt(q.low)}</span>` },
      { label: '成交量', value: window.fmt(q.volume, 0) + '手' },
      { label: '成交额', value: window.fmtAmount(q.amount) },
      { label: '日期', value: q.date || '--' },
      { label: '时间', value: q.time || '--' },
    ];
    el.innerHTML = `
      <div class="stock-header-top">
        <div class="sh-name-block"><span class="sh-name">${q.name}</span><span class="sh-code">${q.code.toUpperCase()}</span></div>
        <div class="sh-price-block">
          <span class="sh-price ${cls}">${window.fmt(q.price)}</span>
          <span class="sh-change ${cls}">${window.signStr(q.change)} (${window.signStr(q.changePct)}%)</span>
        </div>
      </div>
      <div class="sh-meta">${metas.map(m => `<div class="meta-item"><span class="meta-label">${m.label}</span><span class="meta-value">${m.value}</span></div>`).join('')}</div>`;
  }

  /* ---- Render: Rank List ---- */
  _renderRankList() {
    const label = { rise: '涨跌幅', fall: '涨跌幅', turn: '换手率' }[this._activeRank];
    document.getElementById('rankColLabel').textContent = label;
    const all = this._watchCodes.map(code => this._quoteCache.get(code)).filter(Boolean);
    if (all.length < 2) {
      document.getElementById('rankList').innerHTML = `<div class="rank-empty">请添加更多自选股<br>以查看排行榜</div>`;
      return;
    }
    let sorted;
    if (this._activeRank === 'rise') sorted = [...all].sort((a,b) => b.changePct - a.changePct);
    else if (this._activeRank === 'fall') sorted = [...all].sort((a,b) => a.changePct - b.changePct);
    else sorted = [...all].sort((a,b) => (b.amount||0) - (a.amount||0));
    sorted = sorted.slice(0, 10);
    document.getElementById('rankList').innerHTML = sorted.map((q, i) => {
      const val = this._activeRank === 'turn' ? window.fmtAmount(q.amount) : window.signStr(q.changePct) + '%';
      const cls = this._activeRank === 'turn' ? 'flat' : window.colorClass(q.changePct);
      return `
        <div class="rank-item" data-code="${q.code}">
          <span class="rank-num ${i<3?'top3':''}">${i+1}</span>
          <div class="rank-info"><span class="rank-name">${q.name}</span><span class="rank-code">${q.code.slice(2)}</span></div>
          <span class="rank-pct ${cls}">${val}</span>
        </div>`;
    }).join('');
    document.getElementById('rankList').querySelectorAll('.rank-item').forEach(item => {
      item.addEventListener('click', () => {
        const code = item.dataset.code;
        if (this._watchCodes.includes(code)) {
          this._activeCode = code; this._renderWatchlist(); this._renderStockHeader(code);
          this._api.clearKlineCache(code); this._loadAndRenderKline(code, this._activePeriod);
          this._toast(`切换到 ${this._quoteCache.get(code)?.name || code}`);
        }
      });
    });
  }

  /* ---- Render: Sectors ---- */
  _renderSectors() {
    document.getElementById('sectorGrid').innerHTML = window.SECTORS.map(s => {
      const cls = window.colorClass(s.delta); const barW = Math.min(100, Math.abs(s.delta)/10*100);
      const barColor = s.delta >= 0 ? 'var(--rise)' : 'var(--fall)';
      return `<div class="sector-cell"><span class="sector-name">${s.name}</span><span class="sector-pct ${cls}">${window.signStr(s.delta)}%</span><div class="sector-bar" style="width:${barW}%;background:${barColor}"></div></div>`;
    }).join('');
  }

  /* ---- Render: Index News ---- */
  async _renderNews() {
    const el = document.getElementById('newsList');
    if (!el) return;
    el.innerHTML = '<div class="news-loading">加载中…</div>';

    // 从各指数关键词获取最新新闻
    const keywords = ['恒生指数', '恒生科技指数', '中概互联网ETF', '港股通科技ETF'];
    const allNews = [];
    const seenTitles = new Set();

    const results = await Promise.all(
      keywords.map(kw => this._api.fetchNews(kw).catch(() => []))
    );

    results.forEach(items => {
      items.forEach(item => {
        if (!item.title || seenTitles.has(item.title)) return;
        seenTitles.add(item.title);
        allNews.push(item);
      });
    });

    if (allNews.length === 0) {
      el.innerHTML = '<div class="news-empty">暂无相关公告</div>';
      return;
    }

    // 最多显示 10 条
    const display = allNews.slice(0, 10);
    el.innerHTML = display.map(n => {
      const title = n.title.length > 30 ? n.title.slice(0, 30) + '…' : n.title;
      const dateStr = n.date ? `<span class="news-date">${n.date}</span>` : '';
      const sourceStr = n.source ? `<span class="news-source">${n.source}</span>` : '';
      return `<a class="news-item" href="${n.link}" target="_blank" rel="noopener noreferrer">
        <span class="news-title">${title}</span>
        <span class="news-meta">${sourceStr}${dateStr}</span>
      </a>`;
    }).join('');
  }

  /* ---- Render: Index Strip & Navbar ---- */
  _renderNavbarIndices(cacheMap) {
    document.getElementById('navbarIndices').innerHTML = INDEX_CODES.map(idx => {
      const q = cacheMap && cacheMap.get(idx.code);
      if (!q) return `<div class="nav-index"><div class="nav-index-row1"><span class="nav-index-name">${idx.name}</span><span class="nav-index-price flat">--</span></div><div class="nav-index-row2 flat">--</div></div>`;
      const cls = window.colorClass(q.changePct);
      return `<div class="nav-index"><div class="nav-index-row1"><span class="nav-index-name">${idx.name}</span><span class="nav-index-price ${cls}">${window.fmt(q.price)}</span></div><div class="nav-index-row2 ${cls}">${window.signStr(q.change)} (${window.signStr(q.changePct)}%)</div></div>`;
    }).join('');
  }

  _renderIndexStrip(cacheMap) {
    document.getElementById('indexStrip').innerHTML = INDEX_CODES.map(idx => {
      const q = cacheMap && cacheMap.get(idx.code);
      const price = q ? q.price : null;
      const cls = q ? window.colorClass(q.changePct) : 'flat';
      const changeText = q ? `${window.signStr(q.change)} / ${window.signStr(q.changePct)}%` : '--';
      return `<div class="index-card"><div class="idx-top"><span class="idx-name">${idx.name}</span><span class="idx-price ${cls}">${price!==null?window.fmt(price):'--'}</span></div><div class="idx-change ${cls}">${changeText}</div><div class="idx-mini" id="mini-${idx.code}"></div></div>`;
    }).join('');
    INDEX_CODES.forEach(idx => {
      const ticks = this._indexMiniTicks.get(idx.code) || [];
      const q = cacheMap && cacheMap.get(idx.code);
      this._miniSvc.render(`mini-${idx.code}`, ticks, q ? q.changePct >= 0 : true);
    });
  }

  _updateClock() {
    const pad = n => String(n).padStart(2,'0');
    const now = new Date();
    document.getElementById('timeDisplay').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  /* ---- Event binding ---- */
  _bindEvents() {
    // Period buttons
    document.querySelectorAll('.period-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._activePeriod = btn.dataset.period;
        if (this._activeCode) {
          this._api.clearKlineCache(this._activeCode);
          this._loadAndRenderKline(this._activeCode, this._activePeriod);
        }
      });
    });

    // MA toggle
    document.querySelectorAll('.ma-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('off');
        this._chart.toggleMA(parseInt(btn.dataset.ma));
        if (this._activeCode) this._loadAndRenderKline(this._activeCode, this._activePeriod);
      });
    });

    // Rank tabs
    document.querySelectorAll('.rank-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.rank-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._activeRank = tab.dataset.rank;
        this._renderRankList();
      });
    });

    // Sidebar tabs
    document.querySelectorAll('.sidebar-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._activeSidebarTab = tab.dataset.tab;
        document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
        document.getElementById(tab.dataset.tab === 'watchlist' ? 'panelWatchlist' : 'panelPortfolio').classList.add('active');
      });
    });

    // Portfolio toggle
    document.getElementById('pctToggle').addEventListener('click', () => {
      this._portfolio.showPct = !this._portfolio.showPct;
      this._renderPortfolio();
    });

    // 分组管理按钮
    document.getElementById('addGroupBtn').addEventListener('click', () => this._createGroup());

    // Search
    let _searchTimer = null;
    const searchInput = document.getElementById('searchInput');
    const searchDropdown = document.getElementById('searchDropdown');

    searchInput.addEventListener('input', () => {
      clearTimeout(_searchTimer);
      const q = searchInput.value.trim();
      if (!q) { searchDropdown.classList.remove('show'); return; }
      _searchTimer = setTimeout(() => this._doSearch(q), 300);
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-box')) searchDropdown.classList.remove('show');
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { searchDropdown.classList.remove('show'); searchInput.blur(); }
    });

    // 盈亏曲线按钮
    document.getElementById('pfCurveBtn').addEventListener('click', () => this._showPnlCurveModal());
    document.getElementById('pnlCurveClose').addEventListener('click', () => {
      document.getElementById('pnlCurveModal').style.display = 'none';
    });
    document.getElementById('pnlCurveModal').addEventListener('click', (e) => {
      if (e.target.id === 'pnlCurveModal') e.target.style.display = 'none';
    });
    document.getElementById('pnlCurveGo').addEventListener('click', () => this._loadPnlCurve());

    // 快捷日期按钮
    function setQuickDate(months, btn) {
      const d = new Date(); d.setMonth(d.getMonth() - months);
      document.getElementById('pnlStartDate').value = d.toISOString().slice(0,10);
      document.querySelectorAll('.pnl-quick-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
    document.querySelectorAll('.pnl-quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const months = parseInt(btn.dataset.months);
        setQuickDate(months, btn);
      });
    });

    // 手动修改日期时取消快捷按钮选中
    document.getElementById('pnlStartDate').addEventListener('change', () => {
      document.querySelectorAll('.pnl-quick-btn').forEach(b => b.classList.remove('active'));
    });

    // 默认起始日期：3个月前
    const threeMonthsAgo = new Date(); threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    document.getElementById('pnlStartDate').value = threeMonthsAgo.toISOString().slice(0,10);
  }

  /* ---- 分组创建 ---- */
  async _createGroup() {
    const result = await showModal('新建分组', [
      { key: 'name', label: '分组名称', type: 'text', placeholder: '如：换仓后' },
      { key: 'color', label: '颜色（如 #e74c3c）', type: 'text', placeholder: '#3498db' },
    ], [
      { key: 'cancel', label: '取消' },
      { key: 'confirm', label: '创建', primary: true },
    ]);
    if (!result || result.action !== 'confirm') return;
    const name = result.values.name.trim();
    if (!name) { this._toast('请输入分组名称'); return; }
    const color = result.values.color.trim() || undefined;
    this._portfolio.addGroup(name, color);
    this._toast(`✓ 分组「${name}」已创建`);
    this._renderPortfolio();
  }

  async _doSearch(keyword) {
    const searchDropdown = document.getElementById('searchDropdown');
    searchDropdown.innerHTML = `<div class="search-result-item" style="color:var(--text-muted);cursor:default">搜索中…</div>`;
    searchDropdown.classList.add('show');

    const results = await this._api.searchStocks(keyword);
    if (!results || results.length === 0) {
      searchDropdown.innerHTML = `<div class="search-result-item" style="color:var(--text-muted);cursor:default">未找到结果</div>`;
      return;
    }

    searchDropdown.innerHTML = results.map(r => {
      const inList = this._watchCodes.includes(r.code);
      const inPortfolio = !!this._portfolio.getByCode(r.code);
      return `
        <div class="search-result-item" data-code="${r.code}" data-name="${r.name}">
          <div class="search-result-left">
            <span class="search-result-name">${r.name}</span>
            <span class="search-result-code">${r.code.slice(2)} · ${r.code.startsWith('sh')?'沪':r.code.startsWith('hk')?'港':'深'}</span>
          </div>
          <div style="display:flex;gap:4px">
            <button class="search-add-btn${inList?' added':''}" data-code="${r.code}" data-name="${r.name}">
              ${inList?'已添加':'+ 自选'}</button>
            <button class="search-portfolio-btn${inPortfolio?' added':''}" data-code="${r.code}" data-name="${r.name}"
                    ${inPortfolio?'style="border-color:var(--border);color:var(--text-muted);cursor:default"':''}>
              ${inPortfolio?'已持仓':'+ 持仓'}</button>
          </div>
        </div>`;
    }).join('');

    // Click row → preview or add
    searchDropdown.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.search-add-btn') || e.target.closest('.search-portfolio-btn')) return;
        const code = item.dataset.code, name = item.dataset.name;
        if (this._watchCodes.includes(code)) {
          this._activeCode = code; this._renderWatchlist(); this._renderStockHeader(code);
          this._loadAndRenderKline(code, this._activePeriod);
        } else {
          this.addToWatchlist(code, name);
        }
        searchDropdown.classList.remove('show');
        searchInput.value = '';
      });
    });

    // + 自选 button
    searchDropdown.querySelectorAll('.search-add-btn').forEach(btn => {
      if (btn.classList.contains('added')) return;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.addToWatchlist(btn.dataset.code, btn.dataset.name);
        btn.textContent = '已添加'; btn.classList.add('added');
      });
    });

    // + 持仓 button
    searchDropdown.querySelectorAll('.search-portfolio-btn').forEach(btn => {
      if (btn.classList.contains('added')) return;
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        searchDropdown.classList.remove('show');
        searchInput.value = '';
        await this._addPortfolioFromSearch(btn.dataset.code, btn.dataset.name);
      });
    });
  }

  _toast(msg, duration = 2500) {
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
    document.getElementById('toaster').appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  /* ---- 盈亏曲线 ---- */
  _showPnlCurveModal() {
    const items = this._portfolio.getAll();
    if (items.length === 0) { this._toast('请先添加持仓'); return; }

    // 渲染分组勾选区
    this._renderPnlGroupCheckboxes();
    document.getElementById('pnlCurveModal').style.display = 'flex';
  }

  _renderPnlGroupCheckboxes() {
    const container = document.getElementById('pnlGroupChecks');
    const groups = this._portfolio.getGroups();
    const items = this._portfolio.getAll();

    // 只显示有持仓的分组
    const activeGroups = groups.filter(g =>
      items.some(it => (it.group || 'default') === g.id)
    );

    // 初始化勾选状态：默认全部勾选
    activeGroups.forEach(g => {
      if (this._pnlGroupChecked[g.id] === undefined) this._pnlGroupChecked[g.id] = true;
    });

    container.innerHTML = activeGroups.map(g => {
      const checked = this._pnlGroupChecked[g.id] !== false;
      return `<label class="pnl-group-check">
        <input type="checkbox" data-group="${g.id}" ${checked ? 'checked' : ''} />
        <span class="pnl-group-dot" style="background:${g.color}"></span>
        ${g.name}
      </label>`;
    }).join('');

    // 对比模式开关（至少有2个分组时显示）
    const compareSwitch = document.getElementById('pnlCompareSwitch');
    if (compareSwitch) {
      compareSwitch.style.display = activeGroups.length >= 2 ? 'flex' : 'none';
    }

    // 虚拟对比线开关（至少有2个分组时显示）
    const virtualSwitch = document.getElementById('pnlVirtualSwitch');
    if (virtualSwitch) {
      virtualSwitch.style.display = activeGroups.length >= 2 ? 'flex' : 'none';
    }

    // 绑定 checkbox 事件
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        this._pnlGroupChecked[cb.dataset.group] = cb.checked;
      });
    });
  }

  async _loadPnlCurve() {
    const startDate = document.getElementById('pnlStartDate').value;
    if (!startDate) { this._toast('请选择起始日期'); return; }

    const items = this._portfolio.getAll();
    if (items.length === 0) { this._toast('请先添加持仓'); return; }

    const groups = this._portfolio.getGroups();
    const checkedGroupIds = groups
      .filter(g => this._pnlGroupChecked[g.id] !== false)
      .map(g => g.id);

    if (checkedGroupIds.length === 0) {
      this._toast('请至少勾选一个分组'); return;
    }

    const chartEl = document.getElementById('pnlCurveChart');
    if (this._pnlChart) {
      this._pnlChart.dispose();
      this._pnlChart = null;
    }
    chartEl.innerHTML = '<div style="text-align:center;padding:60px;color:#999">加载中…</div>';

    const compareMode = document.getElementById('pnlCompareSwitch')?.querySelector('input')?.checked;
    const showVirtual = document.getElementById('pnlVirtualSwitch')?.querySelector('input')?.checked;

    try {
      // 取每只持仓股票的日线K线
      const allKlines = {};
      await Promise.all(items.map(async (item) => {
        try {
          const data = await this._api.fetchKline(item.code, 'daily', 600);
          if (Array.isArray(data) && data.length > 0) {
            allKlines[item.code] = data.filter(d => d.date >= startDate);
          }
        } catch (_) { /* 单只获取失败不影响整体 */ }
      }));

      // 合并所有日期
      const dateSet = new Set();
      Object.values(allKlines).forEach(klines => klines.forEach(k => dateSet.add(k.date)));
      const dates = [...dateSet].sort();

      if (dates.length === 0) {
        chartEl.innerHTML = '<div style="text-align:center;padding:60px;color:#999">无数据</div>';
        return;
      }

      // 构建每日收盘价映射
      const closeMap = {};
      dates.forEach(d => { closeMap[d] = {}; });
      Object.entries(allKlines).forEach(([code, klines]) => {
        klines.forEach(k => { if (closeMap[k.date]) closeMap[k.date][code] = Number(k.close); });
      });

      // 前向填充
      const codeList = items.map(it => it.code);
      const lastClose = {};
      dates.forEach(d => {
        codeList.forEach(code => {
          if (closeMap[d][code] !== undefined) {
            lastClose[code] = closeMap[d][code];
          } else {
            closeMap[d][code] = lastClose[code] || 0;
          }
        });
      });

      // ---- 构建各分组的盈亏曲线 ----
      const COLORS = ['#3498db', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#2ecc71', '#34495e'];
      const seriesList = [];
      const legendData = [];

      if (!compareMode) {
        // ===== 普通模式：合并所有勾选分组的持仓，画一条总盈亏线 =====
        const activeItems = items.filter(it => checkedGroupIds.includes(it.group || 'default'));
        let totalCost = 0;
        activeItems.forEach(it => { totalCost += it.costPrice * it.quantity; });

        const marketValues = [];
        const costValues = [];
        dates.forEach(d => {
          let mv = 0;
          activeItems.forEach(it => {
            mv += (closeMap[d][it.code] || 0) * it.quantity;
          });
          marketValues.push(parseFloat(mv.toFixed(2)));
          costValues.push(parseFloat(totalCost.toFixed(2)));
        });

        const pnlValues = marketValues.map((mv, i) => parseFloat((mv - costValues[i]).toFixed(2)));
        const pnlMax = Math.max(...pnlValues);
        const pnlMin = Math.min(...pnlValues);

        legendData.push('总市值', '总成本', '盈亏金额');
        seriesList.push({
          name: '总市值', type: 'line', data: marketValues,
          lineStyle: { color: '#3498db', width: 2 }, itemStyle: { color: '#3498db' }, symbol: 'none',
          areaStyle: { color: 'rgba(52,152,219,0.08)' },
        });
        seriesList.push({
          name: '总成本', type: 'line', data: costValues,
          lineStyle: { color: '#999', width: 1, type: 'dashed' }, itemStyle: { color: '#999' }, symbol: 'none',
        });
        seriesList.push({
          name: '盈亏金额', type: 'line', data: pnlValues,
          lineStyle: { width: 2 }, itemStyle: { color: '#e74c3c' }, symbol: 'none',
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(231,76,60,0.15)' },
              { offset: 1, color: 'rgba(46,204,113,0.15)' },
            ]),
          },
          visualMap: false,
          pieces: [{ min: 0, color: '#e74c3c' }, { max: 0, color: '#2ecc71' }],
          markLine: {
            silent: true, symbol: 'none',
            lineStyle: { type: 'dashed', width: 1 },
            label: { fontSize: 10, fontFamily: 'Consolas,monospace', formatter: (p) => p.name + ' ' + window.fmt(p.value) },
            data: [
              { name: '最高', yAxis: pnlMax, lineStyle: { color: '#e74c3c' }, label: { color: '#e74c3c' } },
              { name: '最低', yAxis: pnlMin, lineStyle: { color: '#2ecc71' }, label: { color: '#2ecc71' } },
            ],
          },
        });

        // 个股独立曲线（持仓 < 4 时展示）
        if (activeItems.length < 4) {
          activeItems.forEach((item, idx) => {
            const values = dates.map(d => {
              const close = closeMap[d][item.code] || 0;
              return parseFloat(((close - item.costPrice) * item.quantity).toFixed(2));
            });
            const maxVal = Math.max(...values);
            const minVal = Math.min(...values);
            const color = COLORS[idx % COLORS.length];
            legendData.push(item.name);
            seriesList.push({
              name: item.name, type: 'line', data: values,
              lineStyle: { color, width: 1.5, type: 'dashed' }, itemStyle: { color }, symbol: 'none',
              markLine: {
                silent: true, symbol: 'none',
                lineStyle: { type: 'dashed', width: 1 },
                label: { fontSize: 9, fontFamily: 'Consolas,monospace', formatter: (p) => p.name + ' ' + window.fmt(p.value) },
                data: [
                  { name: '高', yAxis: maxVal, lineStyle: { color }, label: { color } },
                  { name: '低', yAxis: minVal, lineStyle: { color, opacity: 0.6 }, label: { color, opacity: 0.7 } },
                ],
              },
            });
          });
        }

      } else {
        // ===== 对比模式：每个分组独立画盈亏曲线 =====
        const groupSeriesData = [];  // { group, pnlValues, marketValues, costValues }

        checkedGroupIds.forEach((groupId, idx) => {
          const group = groups.find(g => g.id === groupId);
          const groupItems = items.filter(it => (it.group || 'default') === groupId);
          if (groupItems.length === 0) return;

          let totalCost = 0;
          groupItems.forEach(it => { totalCost += it.costPrice * it.quantity; });

          const marketValues = [];
          const costValues = [];
          dates.forEach(d => {
            let mv = 0;
            groupItems.forEach(it => {
              mv += (closeMap[d][it.code] || 0) * it.quantity;
            });
            marketValues.push(parseFloat(mv.toFixed(2)));
            costValues.push(parseFloat(totalCost.toFixed(2)));
          });

          const pnlValues = marketValues.map((mv, i) => parseFloat((mv - costValues[i]).toFixed(2)));
          const pnlMax = Math.max(...pnlValues);
          const pnlMin = Math.min(...pnlValues);
          const color = group ? group.color : COLORS[idx % COLORS.length];
          const seriesName = group ? group.name : `分组${idx + 1}`;

          groupSeriesData.push({ group: groupId, pnlValues, marketValues, costValues, items: groupItems });

          legendData.push(seriesName);
          seriesList.push({
            name: seriesName, type: 'line', data: pnlValues,
            lineStyle: { color, width: 2.5 }, itemStyle: { color }, symbol: 'none',
            markLine: {
              silent: true, symbol: 'none',
              lineStyle: { type: 'dashed', width: 1 },
              label: { fontSize: 9, fontFamily: 'Consolas,monospace', formatter: (p) => p.name + ' ' + window.fmt(p.value) },
              data: [
                { name: seriesName + '高', yAxis: pnlMax, lineStyle: { color }, label: { color } },
                { name: seriesName + '低', yAxis: pnlMin, lineStyle: { color, opacity: 0.5 }, label: { color, opacity: 0.6 } },
              ],
            },
          });

          // 个股独立曲线（每组持仓 < 4 时）
          if (groupItems.length < 4) {
            groupItems.forEach((item, iidx) => {
              const values = dates.map(d => {
                const close = closeMap[d][item.code] || 0;
                return parseFloat(((close - item.costPrice) * item.quantity).toFixed(2));
              });
              const maxVal = Math.max(...values);
              const minVal = Math.min(...values);
              const itemColor = COLORS[(idx * 3 + iidx) % COLORS.length];
              legendData.push(item.name);
              seriesList.push({
                name: item.name, type: 'line', data: values,
                lineStyle: { color: itemColor, width: 1, type: 'dashed' }, itemStyle: { color: itemColor }, symbol: 'none',
                markLine: {
                  silent: true, symbol: 'none',
                  lineStyle: { type: 'dashed', width: 1 },
                  label: { fontSize: 8, fontFamily: 'Consolas,monospace', formatter: (p) => window.fmt(p.value) },
                  data: [
                    { name: '高', yAxis: maxVal, lineStyle: { color: itemColor, opacity: 0.5 }, label: { color: itemColor } },
                    { name: '低', yAxis: minVal, lineStyle: { color: itemColor, opacity: 0.3 }, label: { color: itemColor, opacity: 0.5 } },
                  ],
                },
              });
            });
          }
        });

        // ===== 虚拟对比线："假设没换" =====
        // 逻辑：用分组A（如"原始持仓"）的成本和数量 × 分组B（如"换仓后"）的股票走势
        // 即：如果一直拿着旧基金，盈亏会怎样
        if (showVirtual && checkedGroupIds.length >= 2) {
          const groupA = checkedGroupIds[0]; // 原始分组
          const groupB = checkedGroupIds[1]; // 换仓后分组
          const itemsA = items.filter(it => (it.group || 'default') === groupA);
          const itemsB = items.filter(it => (it.group || 'default') === groupB);
          const groupAInfo = groups.find(g => g.id === groupA);
          const groupBInfo = groups.find(g => g.id === groupB);

          // 虚拟线1：用B的收益率 × A的本金（即"如果A的本金买了B会怎样"）
          if (itemsA.length > 0 && itemsB.length > 0) {
            const costA = itemsA.reduce((sum, it) => sum + it.costPrice * it.quantity, 0);
            const bTotalCost = itemsB.reduce((s, it) => s + it.costPrice * it.quantity, 0);
            const groupAName = groupAInfo ? groupAInfo.name : '原始持仓';
            const groupBName = groupBInfo ? groupBInfo.name : '换仓后';

            const virtualPnl = dates.map(d => {
              let bMarketValue = 0;
              itemsB.forEach(it => {
                bMarketValue += (closeMap[d][it.code] || 0) * it.quantity;
              });
              // B 的收益率 × A 的本金 = 假设A的本金买了B的盈亏
              const bReturn = bTotalCost > 0 ? (bMarketValue - bTotalCost) / bTotalCost : 0;
              return parseFloat((costA * bReturn).toFixed(2));
            });

            const vMax = Math.max(...virtualPnl);
            const vMin = Math.min(...virtualPnl);
            const vName = `假设${groupAName}买${groupBName}`;

            legendData.push(vName);
            seriesList.push({
              name: vName, type: 'line', data: virtualPnl,
              lineStyle: { color: '#95a5a6', width: 2, type: 'dotted' },
              itemStyle: { color: '#95a5a6' }, symbol: 'none',
              markLine: {
                silent: true, symbol: 'none',
                lineStyle: { type: 'dotted', width: 1 },
                label: { fontSize: 9, fontFamily: 'Consolas,monospace', formatter: (p) => p.name + ' ' + window.fmt(p.value) },
                data: [
                  { name: '高', yAxis: vMax, lineStyle: { color: '#95a5a6' }, label: { color: '#95a5a6' } },
                  { name: '低', yAxis: vMin, lineStyle: { color: '#95a5a6', opacity: 0.5 }, label: { color: '#95a5a6', opacity: 0.6 } },
                ],
              },
            });
          }

          // 虚拟线2：A的成本 × A的走势（即"如果不换继续持有A"）
          if (itemsA.length > 0) {
            const costA = itemsA.reduce((sum, it) => sum + it.costPrice * it.quantity, 0);
            const holdPnl = dates.map(d => {
              let mvA = 0;
              itemsA.forEach(it => {
                mvA += (closeMap[d][it.code] || 0) * it.quantity;
              });
              return parseFloat((mvA - costA).toFixed(2));
            });
            const hMax = Math.max(...holdPnl);
            const hMin = Math.min(...holdPnl);
            const groupAName = groupAInfo ? groupAInfo.name : '原始持仓';

            legendData.push(`${groupAName}继续持有`);
            seriesList.push({
              name: `${groupAName}继续持有`, type: 'line', data: holdPnl,
              lineStyle: { color: '#bdc3c7', width: 1.5, type: [4, 4] },
              itemStyle: { color: '#bdc3c7' }, symbol: 'none',
              markLine: {
                silent: true, symbol: 'none',
                lineStyle: { type: 'dotted', width: 1 },
                label: { fontSize: 9, fontFamily: 'Consolas,monospace', formatter: (p) => window.fmt(p.value) },
                data: [
                  { name: '高', yAxis: hMax, lineStyle: { color: '#bdc3c7' }, label: { color: '#bdc3c7' } },
                  { name: '低', yAxis: hMin, lineStyle: { color: '#bdc3c7', opacity: 0.5 }, label: { color: '#bdc3c7', opacity: 0.6 } },
                ],
              },
            });
          }
        }
      }

      // 用 ECharts 渲染
      chartEl.innerHTML = '';
      this._pnlChart = echarts.init(chartEl);

      this._pnlChart.setOption({
        backgroundColor: '#fff',
        tooltip: {
          trigger: 'axis',
          formatter: function(params) {
            const date = params[0].axisValue;
            let s = `<b>${date}</b><br>`;
            params.forEach(p => {
              const clr = p.value >= 0 ? '#e74c3c' : '#2ecc71';
              s += `<span style="color:${p.color}">●</span> ${p.seriesName}: <span style="color:${clr}">${window.signStr(p.value)}</span><br>`;
            });
            return s;
          }
        },
        legend: { data: legendData, top: 0, textStyle: { fontSize: 11 }, type: 'scroll' },
        grid: { left: 60, right: 30, top: 40, bottom: 30 },
        xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 10 } },
        yAxis: [
          { type: 'value', name: '盈亏金额', axisLabel: { fontSize: 10, formatter: v => v >= 1e8 ? (v/1e8).toFixed(1)+'亿' : v >= 1e4 ? (v/1e4).toFixed(0)+'万' : v } },
        ],
        series: seriesList,
        dataZoom: [{ type: 'inside' }],
      }, true);

    } catch (err) {
      chartEl.innerHTML = `<div style="text-align:center;padding:60px;color:#e74c3c">加载失败: ${err.message}</div>`;
    }
  }
}

window.App = App;

/* ------------------------------------------------------------------ */
/*  BOOT                                                                */
/* ------------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => { window._app = new App(); });
