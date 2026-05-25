'use strict';

/* ------------------------------------------------------------------ */
/*  UTILITY FUNCTIONS (attached to window for cross-file access)       */
/* ------------------------------------------------------------------ */

/**
 * Simple LCG PRNG with seed.
 * @param {number} seed
 * @returns {Function} rng function returning [0, 1)
 */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0xFFFFFFFF; };
}

/**
 * Format a number with adaptive decimal precision (2-4 places).
 * This is the "修过3次的bug" function — do NOT change precision logic.
 * @param {number} n - value to format
 * @param {number} [d] - optional fixed decimal places
 * @returns {string}
 */
function fmt(n, d) {
  if (isNaN(n) || n === null || n === undefined) return '--';
  const num = Number(n);
  if (d !== undefined) {
    return num.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  // 自适应精度：保留原始有效小数位（至少2位，最多4位）
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

/**
 * Format large amounts with 万/亿 suffix.
 * @param {number} n
 * @returns {string}
 */
function fmtAmount(n) {
  if (!n) return '--';
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(0) + '万';
  return n.toFixed(0);
}

/**
 * Return CSS class name for rise/fall/flat.
 * @param {number} v
 * @returns {string}
 */
function colorClass(v) { return v > 0 ? 'rise' : v < 0 ? 'fall' : 'flat'; }

/**
 * Format a number with sign prefix and adaptive decimal precision.
 * @param {number} v
 * @param {number} [d] - optional fixed decimal places
 * @returns {string}
 */
function signStr(v, d) {
  const n = parseFloat(v);
  if (isNaN(n)) return '--';
  if (d === undefined) {
    const s = String(v);
    const dotIdx = s.indexOf('.');
    d = 2;
    if (dotIdx >= 0) {
      d = s.length - dotIdx - 1;
      if (d < 2) d = 2;
      if (d > 4) d = 4;
    }
  }
  return (n >= 0 ? '+' : '') + n.toFixed(d);
}

/**
 * Return a deterministic seed based on today's date.
 * @returns {number}
 */
function daySeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/**
 * Simple string hash for stock codes.
 * @param {string} code
 * @returns {number}
 */
function codeHash(code) {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return h;
}

// Attach to window for cross-file access
window.makeRng    = makeRng;
window.fmt        = fmt;
window.fmtAmount  = fmtAmount;
window.colorClass = colorClass;
window.signStr    = signStr;
window.daySeed    = daySeed;
window.codeHash   = codeHash;
