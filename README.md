# 自用选股器 (Stock Picker)

> 一个轻量级的实时股票行情看板，类似雪球/同花顺/东方财富的精简版，专注于行情数据与虚拟持仓管理。

## 功能特性

- 🔍 **全量搜索** — 输入股票代码或名称，实时搜索 A股/港股/ETF/指数
- 📊 **实时行情** — 3秒自动刷新，展示价格、涨跌幅、成交量等核心数据
- 📈 **K线图表** — 支持分时/日K/周K/月K，自动标注可见范围最高最低值
- 💼 **虚拟持仓** — 手动录入成本价和数量，实时计算盈亏金额与比例
- 📉 **盈亏曲线** — 可选起始日期，展示历史盈亏走势（持仓<4只时展示个股独立曲线）
- 🌐 **多市场支持** — 沪A、深A、港股、ETF、主要指数

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | 原生 HTML5 + CSS3 + JavaScript（无框架） |
| 图表 | ECharts 5.4.3 |
| 后端 | Node.js + Express（CORS 代理） |
| 数据源 | 新浪财经 API |
| 编码 | iconv-lite（GBK → UTF-8） |

## 项目结构

```
stock-dashboard/
├── public/                    # 前端静态文件
│   ├── index.html             # 页面入口
│   ├── css/
│   │   └── styles.css         # 全部样式
│   └── js/
│       ├── utils.js           # 工具函数（fmt/signStr 等）
│       ├── sim-service.js     # 模拟数据服务（降级备用）
│       ├── api-service.js     # API 数据服务
│       ├── portfolio.js       # 持仓管理
│       ├── chart-service.js   # K线图表渲染
│       └── app.js             # 主应用逻辑
├── server.js                  # Express 代理服务器
├── package.json
├── README.md
├── PROMPT.md                  # AI 重构用 Prompt
└── .gitignore
```

## 快速开始

### 前置要求

- Node.js >= 16
- npm >= 7

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/<your-username>/stock-picker.git
cd stock-picker

# 安装依赖
npm install

# 启动服务
npm start

# 浏览器访问
# http://localhost:3001
```

### 环境变量（可选）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3001 | 服务端口号 |

## API 说明

服务端代理新浪财经 API，解决跨域和 GBK 编码问题。

### GET /api/quote

获取实时行情报价。

```
GET /api/quote?codes=sh600519,sz000001,hkHSI
```

返回 JSON 数组，每只股票包含：
- `code` — 代码（如 sh600519）
- `name` — 名称
- `price` — 当前价（字符串，保留原始精度）
- `open` / `prevClose` / `high` / `low` — 开盘/昨收/最高/最低
- `change` / `changePct` — 涨跌额/涨跌幅
- `volume` / `amount` — 成交量/成交额

### GET /api/search

搜索股票/ETF/指数。

```
GET /api/search?keyword=茅台
```

返回匹配结果数组（最多12条），包含 `code`、`name`、`type`。

支持的搜索类型：
- A股（type=1）、指数（type=11）、ETF（type=203/204）、港股（type=31）

### GET /api/kline

获取K线数据。

```
GET /api/kline?code=sh600519&type=daily&datalen=200
```

参数：
- `code` — 股票代码（必填）
- `type` — 周期：minute/daily/weekly/monthly
- `datalen` — 数据条数，最大800

返回 JSON 数组，每条包含 `date`、`open`、`close`、`high`、`low`、`volume`。

## 关键设计决策

### 价格精度

新浪 API 返回的 ETF 价格可能是 3-4 位小数（如 `0.607`），为了完整保留精度：

1. **服务端**：`price`/`open`/`prevClose`/`high`/`low` 保留为**字符串**，不做 `parseFloat`
2. **前端 `fmt()` 函数**：采用自适应精度，保留原始有效小数位（最少2位，最多4位）
3. **绝对不能用固定2位小数**，否则 ETF 价格 `0.607` 会变成 `0.61`

### GBK 编码

新浪财经 API 返回 GBK 编码数据，服务端使用 `iconv-lite` 解码：

```javascript
const buf = await res.buffer();
const text = iconv.decode(buf, 'gbk');
```

### 港股字段差异

A 股和港股的行情字段布局不同：
- A 股：`f[3]` = 当前价，`f[4]` = 最高，`f[5]` = 最低
- 港股：`f[5]` = 当前价，`f[3]` = 最高，`f[4]` = 最低

服务端根据 `code.startsWith('hk')` 判断并分别解析。

### ETF 代码前缀

新浪搜索返回 ETF 时可能使用 `of` 前缀（如 `of159740`），但行情接口只接受 `sz`/`sh` 前缀。服务端自动将 `of` 前缀转换为 `sz`。

### K线数据源

K线接口路径为 `CN_MarketData.getKLineData`（不是 `CN_MarketDataService`）。字段映射：API 返回 `day/open/high/low/close/volume`，不是 `d/o/h/l/c/v`。

## 部署指南

### 本地开发

```bash
npm install && npm start
```

### 静态网站托管（Vercel / Netlify / Cloudflare Pages）

前端可以单独部署到静态托管平台，但需要注意：

1. **API 代理**：静态托管无法运行 Node.js 代理服务，需要将 API 路由部署为 Serverless Functions
2. **Vercel 示例**：将 `server.js` 中的路由迁移到 `api/` 目录下的 serverless functions
3. **Netlify 示例**：使用 `netlify/functions/` 目录 + `netlify.toml` 配置

### Docker 部署

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3001
CMD ["node", "server.js"]
```

## 已知限制

1. 新浪财经 API 非官方接口，可能随时变更或限流
2. 港股数据更新频率和字段完整度不如 A 股
3. 持仓数据存储在 localStorage，换设备/清缓存会丢失
4. 盈亏曲线取最近 600 条日线，起始日期超出范围则无数据

## 许可证

MIT License
