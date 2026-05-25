# PROMPT.md — 自用选股器 项目重构 Prompt

> 此文档用于指导 Claude Code / Codex 等工具对本项目进行重构。请将此内容作为系统提示或初始 Prompt 的一部分。

---

## 项目概述

重构一个名为 **"自用选股器"** 的股票行情看板 Web 应用。该应用的核心功能是从新浪财经 API 获取实时股票/ETF/港股/指数数据，展示行情、K线图表和虚拟持仓盈亏。

**目标**：将当前的原生 JS 多文件（无模块化、无构建工具）项目重构为现代前端工程化项目。

---

## 功能需求

### 1. 股票搜索
- 输入框实时搜索（300ms 防抖）
- 支持按股票代码或名称搜索
- 搜索范围：A股、港股、ETF、指数
- 搜索结果可一键添加自选或持仓

### 2. 实时行情
- 3 秒自动刷新
- 顶部导航栏展示4个核心指数（上证指数、科创50、恒生指数、恒生科技指数）
- 自选股列表展示价格、涨跌幅
- 右侧排行版：涨幅榜、跌幅榜、换手率

### 3. K线图表
- 周期切换：分时、日K、周K、月K
- ECharts 蜡烛图 + 成交量柱状图
- 均线：MA5/MA10/MA20/MA60 可切换显示
- **最高最低值标注**：纯文字标注（红色"高 3250.60" / 绿色"低 3180.15"），无水滴背景
- **dataZoom 动态更新**：缩放/平移 K 线时，自动重算可见范围内的最高最低值并更新标注

### 4. 虚拟持仓
- 手动录入持仓股票的成本价和数量
- 实时计算盈亏金额和盈亏比例
- 盈亏比例开关（toggle）
- 持仓汇总：总市值、总成本、总盈亏

### 5. 盈亏曲线
- 可选起始日期（快捷按钮：近1月/近3月/近6月/近1年 + 自定义日期）
- 合并盈亏曲线 + 水平虚线标注最高/最低值
- 持仓 < 4 只时，展示每只持仓的独立盈亏曲线（不同颜色虚线），每条也有水平虚线标注
- tooltip 显示个股盈亏明细

---

## 数据源

### 新浪财经 API（非官方）

所有数据来自新浪财经，需要 Node.js 代理服务解决跨域和 GBK 编码问题。

#### 1. 实时行情

```
URL: https://hq.sinajs.cn/list={codes}
编码: GBK
返回: var hq_str_sh600519="贵州茅台,1700.00,1698.00,...";
```

**A 股字段（0 起始）**：
| 索引 | 字段 |
|------|------|
| 0 | 名称 |
| 1 | 今开 |
| 2 | 昨收 |
| 3 | 当前价 |
| 4 | 最高 |
| 5 | 最低 |
| 8 | 成交量(手) |
| 9 | 成交额(元) |
| 30 | 日期 |
| 31 | 时间 |

**港股字段（0 起始）**：
| 索引 | 字段 |
|------|------|
| 0 | 名称 |
| 1 | 今开 |
| 2 | 昨收 |
| 3 | 最高 |
| 4 | 最低 |
| 5 | 当前价 |
| 6 | 涨跌额 |
| 7 | 涨跌幅 |
| 10 | 成交量 |
| 11 | 成交额 |
| 17 | 日期 |
| 18 | 时间 |

⚠️ **港股和 A 股字段布局不同！** A 股 `f[3]`=当前价，港股 `f[5]`=当前价。

#### 2. 搜索建议

```
URL: https://suggest3.sinajs.cn/suggest/type=&key={keyword}&name=suggestdata
编码: GBK
返回: suggestdata="显示名,type,纯代码,完整代码,名称;..."
```

允许的类型代码：
- `1` = A 股
- `11` = 指数
- `22/25` = 基金
- `31` = 港股
- `203/204` = 场内 ETF

完整代码格式：`sh600519` / `sz159740` / `hk00001` / `of159740`

⚠️ **ETF 前缀**：搜索返回 `of` 前缀（如 `of159740`），但行情接口只接受 `sz`/`sh` 前缀。需要自动转换 `of` → `sz`。

#### 3. K 线数据

```
URL: https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData
参数: symbol={code}&scale={scale}&ma=no&datalen={datalen}
编码: GBK（返回 JSON）
```

⚠️ **接口路径是 `CN_MarketData`，不是 `CN_MarketDataService`！**

scale 映射：
| type | scale | datalen |
|------|-------|---------|
| minute | 5 | 78 |
| daily | 240 | 200 |
| weekly | 1200 | 200 |
| monthly | 5760 | 200 |

⚠️ **字段映射**：API 返回 `day/open/high/low/close/volume`，**不是** `d/o/h/l/c/v`。

---

## ⚠️ 关键陷阱（踩过的坑）

### 1. 价格精度（修了 3 次的 Bug）

ETF 价格可能是 3-4 位小数（如 `0.607`），如果用 `parseFloat()` + `toFixed(2)` 会截断为 `0.61`。

**正确做法**：
- 服务端：`price`/`open`/`prevClose`/`high`/`low` **保留为字符串**，不做 `parseFloat`
- 前端 `fmt(n, d)` 函数：当 `d` 未指定时，自适应精度（最少 2 位，最多 4 位，保留原始有效小数位）
- **绝对不能用固定 2 位小数！**

```javascript
function fmt(n, d) {
  if (isNaN(n) || n === null || n === undefined) return '--';
  const num = Number(n);
  if (d !== undefined) {
    return num.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  // 自适应精度
  const s = String(n);
  const dotIdx = s.indexOf('.');
  let decimals = 2;
  if (dotIdx >= 0) {
    decimals = s.length - dotIdx - 1;
    if (decimals < 2) decimals = 2;
    if (decimals > 4) decimals = 4;
  }
  return num.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
```

### 2. GBK 编码

新浪 API 返回 GBK 编码，直接用 `response.text()` 会乱码。必须用 `iconv-lite` 解码：

```javascript
const buf = await res.buffer();
const text = iconv.decode(buf, 'gbk');
```

### 3. 港股字段差异

A 股 `f[3]`=当前价，港股 `f[5]`=当前价。港股的最高最低在 `f[3]`/`f[4]`，不是 `f[4]`/`f[5]`。

### 4. K 线接口路径

正确：`CN_MarketData.getKLineData`
错误：~~`CN_MarketDataService.getKLineData`~~

### 5. K 线字段名

正确：`day/open/high/low/close/volume`
错误：~~`d/o/h/l/c/v`~~

### 6. ETF 代码前缀

`of159740` 无法查行情，必须转换为 `sz159740`。

### 7. ECharts 实例重用

盈亏曲线的 ECharts 实例在第二次查询时可能已失效。必须在每次查询前 `dispose()` 旧实例，重新 `init()`。

### 8. K 线最高最低值标注

- 不要用 `symbol: 'pin'`（水滴状），用户觉得丑
- 用 `symbol: 'none'`，只显示纯文字标注
- 必须监听 `dataZoom` 事件，动态更新可见范围内的极值

---

## 代理服务端

### 路由

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/quote?codes=sh600519,sz000001` | GET | 批量获取实时行情 |
| `/api/search?keyword=茅台` | GET | 搜索股票/ETF/指数 |
| `/api/kline?code=sh600519&type=daily&datalen=200` | GET | 获取K线数据 |

### 请求头

新浪有防盗链，代理请求需带：

```javascript
const SINA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 ...',
  Referer: 'https://finance.sina.com.cn',
};
```

---

## UI 设计规范

- **风格**：雪球（Xueqiu）白色极简风格，**不是**暗色主题
- **配色**：
  - 背景：`#f5f5f5`（主区）/ `#ffffff`（卡片）
  - 涨：`#e74c3c`（红）
  - 跌：`#2ecc71`（绿）
  - 主色：`#3498db`（蓝）
- **布局**：三栏式（左侧自选/持仓、中间K线、右侧排行）+ 底部指数卡片
- **字体**：`-apple-system, PingFang SC, Microsoft YaHei`（正文）/ `Consolas, Monaco`（数字）

---

## 重构建议

1. **前端框架**：建议使用 React/Vue + Vite + TypeScript
2. **状态管理**：Zustand / Pinia，替代当前的全局变量
3. **样式**：Tailwind CSS 或 CSS Modules，替代当前的 CSS 变量
4. **图表**：继续使用 ECharts，但封装为 React/Vue 组件
5. **API 层**：用 Axios/Fetch 封装，替代当前的 raw fetch
6. **部署**：
   - 前端部署到 Vercel/Netlify/Cloudflare Pages
   - API 代理部署为 Serverless Functions
   - 或整体 Docker 部署
7. **数据持久化**：持仓数据可考虑迁移到 IndexedDB 或后端存储

---

## 测试用例参考

重构后应确保以下场景正常工作：

1. 搜索 `159740` 能找到对应的 ETF（恒生科技指数ETF）
2. 搜索 `恒生科技` 能找到指数和 ETF
3. 搜索 `00001` 能找到港股（长和），名称正确显示（非乱码）
4. ETF 价格 `0.607` 显示为 3 位小数，不会截断为 `0.61`
5. K 线数据能正常加载，字段不为全零
6. 缩放 K 线后最高最低值自动更新
7. 盈亏曲线二次查询不报错
8. 港股行情字段正确解析
