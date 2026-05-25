'use strict';

/* ------------------------------------------------------------------ */
/*  CHART SERVICE (with markPoint for high/low)                        */
/* ------------------------------------------------------------------ */
class ChartService {
  constructor(domId) {
    this.dom = document.getElementById(domId);
    this.chart = echarts.init(this.dom, null, { renderer: 'canvas' });
    this.code = null; this.period = 'minute';
    this.maVisible = { 5: true, 10: true, 20: true, 60: true };
    /** @type {Array|null} stored kline data for dataZoom recalculations */
    this._currentData = null;
    window.addEventListener('resize', () => this.chart.resize());
  }

  render(code, period, data) {
    this.code = code; this.period = period;
    if (!data || data.length === 0) {
      this.chart.setOption({ graphic: [{ type: 'text', left: 'center', top: 'middle',
        style: { text: '暂无数据', fill: '#999', font: '14px sans-serif' } }] }, true);
      return;
    }

    const dates = data.map(d => d.date);
    const ohlc  = data.map(d => [d.open, d.close, d.low, d.high]);
    const volumes = data.map(d => d.volume);
    const isRise  = data.map(d => d.close >= d.open);

    // ---- Find high/low points for markPoint ----
    let highIdx = 0, lowIdx = 0;
    data.forEach((d, i) => {
      if (d.high > data[highIdx].high) highIdx = i;
      if (d.low  < data[lowIdx].low)  lowIdx  = i;
    });

    const maColors = { 5: '#e67e22', 10: '#3498db', 20: '#9b59b6', 60: '#1abc9c' };

    const maSeries = [5, 10, 20, 60].map(n => ({
      name: `MA${n}`, type: 'line',
      data: this._calcMA(data.map(d => d.close), n),
      smooth: true, symbol: 'none',
      lineStyle: { color: maColors[n], width: 1, opacity: this.maVisible[n] ? 1 : 0 },
      itemStyle: { color: maColors[n], opacity: this.maVisible[n] ? 1 : 0 },
      xAxisIndex: 0, yAxisIndex: 0,
    }));

    const option = {
      backgroundColor: '#fff',
      animation: false,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', lineStyle: { color: '#ccc' }, crossStyle: { color: '#ccc' } },
        backgroundColor: '#fff', borderColor: '#e8e8e8',
        textStyle: { color: '#1a1a1a', fontSize: 12, fontFamily: 'Consolas,monospace' },
        formatter: (params) => this._tooltipFormatter(params, data),
      },
      legend: {
        data: ['MA5','MA10','MA20','MA60'],
        textStyle: { color: '#999', fontSize: 11 },
        top: 4, right: 16, icon: 'rect', itemWidth: 16, itemHeight: 3,
      },
      grid: [
        { top: 40, left: 60, right: 16, bottom: '35%' },
        { top: '68%', left: 60, right: 16, bottom: 30 },
      ],
      xAxis: [
        { type: 'category', data: dates, gridIndex: 0,
          axisLine: { lineStyle: { color: '#e8e8e8' } },
          axisLabel: { color: '#999', fontSize: 10 },
          splitLine: { lineStyle: { color: '#f5f5f5' } },
          axisTick: { show: false } },
        { type: 'category', data: dates, gridIndex: 1,
          axisLine: { lineStyle: { color: '#e8e8e8' } },
          axisLabel: { show: false },
          splitLine: { lineStyle: { color: '#f5f5f5' } },
          axisTick: { show: false } },
      ],
      yAxis: [
        { type: 'value', gridIndex: 0, scale: true,
          splitLine: { lineStyle: { color: '#f5f5f5' } },
          axisLabel: { color: '#999', fontSize: 10, fontFamily: 'Consolas,monospace' },
          axisLine: { show: false }, axisTick: { show: false } },
        { type: 'value', gridIndex: 1, scale: true,
          splitLine: { lineStyle: { color: '#f5f5f5' } },
          axisLabel: { color: '#999', fontSize: 9 },
          axisLine: { show: false }, axisTick: { show: false } },
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1],
          start: Math.max(0, 100 - Math.round(100 * 60 / Math.max(dates.length, 1))), end: 100 },
        { type: 'slider', xAxisIndex: [0, 1], bottom: 2, height: 20,
          start: Math.max(0, 100 - Math.round(100 * 60 / Math.max(dates.length, 1))), end: 100,
          backgroundColor: '#fafafa', fillerColor: 'rgba(52,152,219,.1)',
          borderColor: '#e8e8e8', textStyle: { color: '#999', fontSize: 9 },
          handleStyle: { color: '#3498db' } },
      ],
      series: [
        {
          name: 'K线', type: 'candlestick', data: ohlc, xAxisIndex: 0, yAxisIndex: 0,
          itemStyle: { color: '#e74c3c', color0: '#2ecc71', borderColor: '#e74c3c', borderColor0: '#2ecc71' },
          markPoint: {
            symbol: 'none',
            animation: false,
            label: { show: true, fontSize: 11, fontFamily: 'Consolas,monospace', fontWeight: 'bold' },
            data: this._buildHighLowMarkData(data, dates, highIdx, lowIdx),
          },
        },
        ...maSeries,
        {
          name: '成交量', type: 'bar',
          data: volumes.map((v, i) => ({
            value: v, itemStyle: { color: isRise[i] ? 'rgba(231,76,60,.6)' : 'rgba(46,204,113,.6)' },
          })),
          xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: 8,
        },
      ],
    };
    this._currentData = data;
    this.chart.setOption(option, true);

    // Listen for dataZoom to dynamically update high/low marks
    this.chart.off('datazoom');
    this.chart.on('datazoom', () => {
      this._updateHighLowMark();
    });
  }

  /**
   * Build markPoint data array for high/low labels.
   * @param {Array} data  kline data array
   * @param {Array} dates date labels
   * @param {number} highIdx
   * @param {number} lowIdx
   * @returns {Array}
   */
  _buildHighLowMarkData(data, dates, highIdx, lowIdx) {
    return [
      {
        name: '最高',
        coord: [dates[highIdx], data[highIdx].high],
        value: data[highIdx].high,
        label: {
          formatter: (p) => '高 ' + window.fmt(p.value),
          color: '#e74c3c',
          fontSize: 11,
          fontFamily: 'Consolas,monospace',
          fontWeight: 'bold',
          position: 'top',
        },
      },
      {
        name: '最低',
        coord: [dates[lowIdx], data[lowIdx].low],
        value: data[lowIdx].low,
        label: {
          formatter: (p) => '低 ' + window.fmt(p.value),
          color: '#2ecc71',
          fontSize: 11,
          fontFamily: 'Consolas,monospace',
          fontWeight: 'bold',
          position: 'bottom',
        },
      },
    ];
  }

  /**
   * Recalculate high/low marks based on current visible dataZoom range.
   */
  _updateHighLowMark() {
    const data = this._currentData;
    if (!data || data.length === 0) return;

    const option = this.chart.getOption();
    const dzArr = option && option.dataZoom;
    if (!dzArr || dzArr.length === 0) return;

    // Get start/end percentages from dataZoom
    const dz = dzArr[0];
    const startPct = dz.start != null ? dz.start : 0;
    const endPct   = dz.end   != null ? dz.end   : 100;

    const len = data.length;
    const startIdx = Math.floor(len * startPct / 100);
    const endIdx   = Math.min(len - 1, Math.ceil(len * endPct / 100));

    if (startIdx >= endIdx) return;

    // Find high/low in visible range
    let highIdx = startIdx, lowIdx = startIdx;
    for (let i = startIdx; i <= endIdx; i++) {
      if (data[i].high > data[highIdx].high) highIdx = i;
      if (data[i].low  < data[lowIdx].low)   lowIdx  = i;
    }

    const dates = data.map(d => d.date);
    const markData = this._buildHighLowMarkData(data, dates, highIdx, lowIdx);

    // Only update the markPoint on the candlestick series (series index 0)
    this.chart.setOption({
      series: [{
        markPoint: {
          symbol: 'none',
          animation: false,
          label: { show: true, fontSize: 11, fontFamily: 'Consolas,monospace', fontWeight: 'bold' },
          data: markData,
        },
      }],
    });
  }

  toggleMA(maNum) { this.maVisible[maNum] = !this.maVisible[maNum]; }

  _calcMA(closes, n) {
    return closes.map((_, i) => {
      if (i < n - 1) return null;
      return parseFloat((closes.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n).toFixed(2));
    });
  }

  _tooltipFormatter(params, data) {
    const idx = params[0]?.dataIndex; if (idx === undefined) return '';
    const d = data[idx]; if (!d) return '';
    const chg = d.close - d.open; const pct = (chg / (d.open || 1) * 100).toFixed(2);
    const clr = chg >= 0 ? '#e74c3c' : '#2ecc71';
    const lines = [
      `<b style="color:#1a1a1a">${d.date}</b>`,
      `<span style="color:#999">开</span> <b style="color:${clr}">${d.open}</b>`,
      `<span style="color:#999">收</span> <b style="color:${clr}">${d.close}</b>`,
      `<span style="color:#999">高</span> <b style="color:#e74c3c">${d.high}</b>`,
      `<span style="color:#999">低</span> <b style="color:#2ecc71">${d.low}</b>`,
      `<span style="color:#999">涨跌</span> <b style="color:${clr}">${window.signStr(chg)} (${window.signStr(parseFloat(pct))}%)</b>`,
      `<span style="color:#999">量</span> <b>${window.fmtAmount(d.volume * d.close)}</b>`,
    ];
    params.forEach(p => {
      if (p.seriesName && p.seriesName.startsWith('MA') && p.value !== null) {
        const mc = {MA5:'#e67e22',MA10:'#3498db',MA20:'#9b59b6',MA60:'#1abc9c'}[p.seriesName]||'#666';
        lines.push(`<span style="color:${mc}">${p.seriesName}: ${p.value}</span>`);
      }
    });
    return lines.join('<br>');
  }
}

window.ChartService = ChartService;

/* ------------------------------------------------------------------ */
/*  MINI CHART SERVICE                                                 */
/* ------------------------------------------------------------------ */
class MiniChartService {
  constructor() { this._charts = new Map(); }

  render(domId, ticks, isRise) {
    const dom = document.getElementById(domId);
    if (!dom || !ticks || ticks.length === 0) return;
    let chart = this._charts.get(domId);
    if (!chart) { chart = echarts.init(dom, null, { renderer: 'svg' }); this._charts.set(domId, chart); }
    const color = isRise ? '#e74c3c' : '#2ecc71';
    chart.setOption({
      animation: false,
      grid: { top: 2, left: 0, right: 0, bottom: 2 },
      xAxis: { type: 'category', show: false, data: ticks.map((_, i) => i) },
      yAxis: { type: 'value', show: false, scale: true },
      series: [{
        type: 'line', data: ticks, smooth: true, symbol: 'none',
        lineStyle: { color, width: 1.5 },
        areaStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: isRise ? 'rgba(231,76,60,0.2)' : 'rgba(46,204,113,0.2)' },
              { offset: 1, color: isRise ? 'rgba(231,76,60,0)' : 'rgba(46,204,113,0)' },
            ] }
        },
      }],
      tooltip: { show: false },
    }, true);
  }
}

window.MiniChartService = MiniChartService;
