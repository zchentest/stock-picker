'use strict';

const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const path    = require('path');
const iconv   = require('iconv-lite');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── 公共请求头，绕过新浪防盗链 ──────────────────────────────────────────────
const SINA_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://finance.sina.com.cn',
};

// ── 中间件 ──────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// 静态文件托管（访问 http://localhost:3001 直接打开 public/index.html）
app.use(express.static(path.join(__dirname, 'public')));

// ── 工具函数 ────────────────────────────────────────────────────────────────

/**
 * 带超时的 fetch，返回 Buffer（保留原始字节供 iconv 转码）
 */
async function fetchBuffer(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const buf = await res.buffer();
    clearTimeout(timer);
    return { buf, status: res.status };
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

/**
 * 将 Buffer 从 GBK 解码为 UTF-8 字符串
 */
function gbkToUtf8(buf) {
  return iconv.decode(buf, 'gbk');
}

// ── /api/quote ───────────────────────────────────────────────────────────────
/**
 * GET /api/quote?codes=sh600519,sz000001,hkHSI
 * 代理新浪实时行情，返回解析后的 JSON 数组。
 *
 * 新浪返回 GBK 编码，每行一只股票：
 *   var hq_str_sh600519="贵州茅台,1700.00,1698.00,1710.00,1720.00,1690.00,...,2024-05-24,15:00:00,1";
 *
 * A股字段（逗号分隔引号内内容，0起始）：
 *   0:名称 1:今开 2:昨收 3:当前价 4:最高 5:最低
 *   8:成交量(手) 9:成交额(元) 30:日期 31:时间
 *
 * 港股字段：
 *   0:名称 1:今开  2:昨收 3:最高 4:最低 5:当前价 6:涨跌额 7:涨跌幅
 *   10:成交量 11:成交额 17:日期 18:时间
 */
app.get('/api/quote', async (req, res) => {
  const { codes } = req.query;
  if (!codes) return res.json({ error: '缺少 codes 参数', data: [] });

  const url = `https://hq.sinajs.cn/list=${codes}`;
  try {
    const { buf } = await fetchBuffer(url, { headers: SINA_HEADERS });
    const text = gbkToUtf8(buf);

    const result = [];
    for (const line of text.split('\n')) {
      const match = line.match(/var hq_str_([^=]+)="([^"]*)"/);
      if (!match) continue;

      const code = match[1].trim();
      const raw  = match[2].trim();
      if (!raw) continue;

      const f = raw.split(',');

      // 判断是否港股（代码以 hk 开头）
      const isHK = code.startsWith('hk');

      let name, open, prevClose, price, high, low, volume, amount, date, time;

      if (isHK) {
        // 港股字段布局
        if (f.length < 19) continue;
        name      = f[0];
        open      = f[1];
        prevClose = f[2];
        high      = f[3];
        low       = f[4];
        price     = f[5];
        volume    = parseInt(f[10], 10) || 0;
        amount    = parseFloat(f[11]) || 0;
        date      = f[17] || '';
        time      = f[18] || '';
      } else {
        // A股 / 指数 / ETF 字段布局
        if (f.length < 32) continue;
        name      = f[0];
        open      = f[1];
        prevClose = f[2];
        price     = f[3];
        high      = f[4];
        low       = f[5];
        volume    = parseInt(f[8], 10) || 0;
        amount    = parseFloat(f[9]) || 0;
        date      = f[30] || '';
        time      = f[31] || '';
      }

      if (!Number(price)) continue; // 停牌或无效

      const pPrice     = Number(price);
      const pPrevClose = Number(prevClose);
      const change    = parseFloat((pPrice - pPrevClose).toFixed(4));
      const changePct = pPrevClose !== 0
        ? parseFloat(((change / pPrevClose) * 100).toFixed(2))
        : 0;

      result.push({ code, name, price, open, prevClose, high, low,
        change, changePct, volume, amount, date, time });
    }

    return res.json(result);
  } catch (err) {
    console.error('[/api/quote]', err.message);
    return res.json({ error: `行情获取失败: ${err.message}`, data: [] });
  }
});

// ── /api/search ──────────────────────────────────────────────────────────────
/**
 * GET /api/search?keyword=贵州茅台
 * 代理新浪搜索建议接口，返回解析后的 JSON 数组。
 *
 * 新浪返回格式（每条分号分隔，字段逗号分隔）：
 *   显示名,type,纯代码,完整代码(含前缀),显示名2,...
 *
 * type 含义：
 *   1  = A股（沪深主板/中小板/创业板/科创板）
 *   11 = A股指数
 *   22/25 = 基金
 *   31 = 港股
 *   41 = 美股
 *   203 = 场内ETF（深圳）
 *   204 = 场内ETF（上海）
 *
 * 完整代码（字段index=3）格式：sh600519 / sz159740 / hk00001 / of159740
 * 对于ETF，新浪搜索返回 sz/sh 前缀，行情接口也用 sz/sh 前缀
 */
app.get('/api/search', async (req, res) => {
  const { keyword } = req.query;
  if (!keyword) return res.json({ error: '缺少 keyword 参数', data: [] });

  const url = `https://suggest3.sinajs.cn/suggest/type=&key=${encodeURIComponent(keyword)}&name=suggestdata`;

  try {
    const { buf } = await fetchBuffer(url, { headers: SINA_HEADERS });
    const text = gbkToUtf8(buf);

    const match = text.match(/suggestdata="([^"]*)"/);
    if (!match || !match[1]) return res.json([]);

    const entries = match[1].split(';').filter(Boolean);
    const seen    = new Set();
    const result  = [];

    // 允许的 type 集合：A股/指数/ETF/港股
    const ALLOWED_TYPES = new Set(['1', '11', '22', '25', '31', '41', '203', '204']);

    for (const entry of entries) {
      const parts = entry.split(',');
      if (parts.length < 4) continue;

      const displayName  = parts[0];  // 搜索显示名
      const type         = parts[1];  // 类型代码
      const pureCode     = parts[2];  // 纯数字代码（如 600519）
      const fullCode     = parts[3];  // 含前缀代码（如 sh600519）

      if (!ALLOWED_TYPES.has(type)) continue;
      if (!fullCode || !displayName) continue;

      // 去除 of 前缀的基金代码（of前缀无法查行情）；ETF用 sz/sh 前缀
      // 港股代码前缀 hk 保留
      let tradeCode = fullCode;
      if (fullCode.startsWith('of')) {
        // 如果有同名 sz/sh 版本会在后续出现，跳过 of 版
        // 但如果只有 of 版，则尝试用 sz 前缀
        tradeCode = 'sz' + pureCode;
      }

      // 去重（同一 tradeCode 只取第一条）
      if (seen.has(tradeCode)) continue;
      seen.add(tradeCode);

      // 名称优先取 parts[4]（更规范的名称字段），其次 parts[0]
      const name = (parts[4] && parts[4].trim()) ? parts[4].trim() : displayName.trim();

      result.push({ code: tradeCode, name, type });
      if (result.length >= 12) break;
    }

    return res.json(result);
  } catch (err) {
    console.error('[/api/search]', err.message);
    return res.json({ error: `搜索失败: ${err.message}`, data: [] });
  }
});

// ── /api/kline ───────────────────────────────────────────────────────────────
/**
 * GET /api/kline?code=sh600519&type=daily
 * 代理新浪 K 线数据，返回解析后的 JSON 数组。
 *
 * type → scale 映射：
 *   minute → 5  (5分钟，datalen=78)
 *   daily  → 240
 *   weekly → 1200
 *   monthly→ 5760
 *
 * 新浪返回 JSON 数组（GBK）：
 *   [{"d":"2024-01-01","o":"1700.00","c":"1720.00","h":"1730.00","l":"1690.00","v":"12345"},...]
 *
 * 港股 K 线使用不同的接口：
 *   https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketDataService.getKLineData
 *   ?symbol=hkHSI&scale=240&datalen=200
 *   港股代码直接传 hkHSI / hk00001 等
 */
const KLINE_SCALE_MAP = {
  minute:  { scale: 5,    datalen: 78 },
  daily:   { scale: 240,  datalen: 200 },
  day:     { scale: 240,  datalen: 200 },
  weekly:  { scale: 1200, datalen: 200 },
  week:    { scale: 1200, datalen: 200 },
  monthly: { scale: 5760, datalen: 200 },
  month:   { scale: 5760, datalen: 200 },
};

app.get('/api/kline', async (req, res) => {
  const { code, type = 'daily', datalen: datalenParam } = req.query;
  if (!code) return res.json({ error: '缺少 code 参数', data: [] });

  const scaleInfo = KLINE_SCALE_MAP[type] || KLINE_SCALE_MAP.daily;
  const { scale } = scaleInfo;
  const datalen = datalenParam ? Math.min(parseInt(datalenParam, 10), 800) : scaleInfo.datalen;

  const url =
    `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/` +
    `CN_MarketData.getKLineData?symbol=${code}&scale=${scale}&ma=no&datalen=${datalen}`;

  try {
    const { buf } = await fetchBuffer(url, { headers: SINA_HEADERS });
    const text = gbkToUtf8(buf);

    let raw;
    try {
      raw = JSON.parse(text);
    } catch (_) {
      return res.json({ error: 'K线数据解析失败', data: [] });
    }

    if (!Array.isArray(raw)) {
      return res.json({ error: 'K线数据格式异常', data: [] });
    }

    const result = raw.map((item) => ({
      date:   item.day  || item.d || '',
      open:   item.open  !== undefined ? item.open  : (item.o || '0'),
      close:  item.close !== undefined ? item.close : (item.c || '0'),
      high:   item.high  !== undefined ? item.high  : (item.h || '0'),
      low:    item.low   !== undefined ? item.low   : (item.l || '0'),
      volume: parseInt(item.volume || item.v, 10) || 0,
    }));

    return res.json(result);
  } catch (err) {
    console.error('[/api/kline]', err.message);
    return res.json({ error: `K线数据获取失败: ${err.message}`, data: [] });
  }
});

// ── 启动服务 ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Stock Dashboard Server listening on port ${PORT}`);
  console.log(`   前端页面: http://localhost:${PORT}`);
  console.log(`   行情 API: http://localhost:${PORT}/api/quote?codes=sh600519`);
  console.log(`   搜索 API: http://localhost:${PORT}/api/search?keyword=茅台`);
  console.log(`   K线 API:  http://localhost:${PORT}/api/kline?code=sh600519&type=daily\n`);
});
