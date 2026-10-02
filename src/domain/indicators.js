/**
 * 技术指标库。纯函数、无状态，本地计算。
 * 与 Dart 版 (lib/domain/indicators.dart) 1:1 对应。
 */

export function sma(src, period) {
  const out = new Array(src.length).fill(null);
  if (period <= 0 || !src.length) return out;
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i];
    if (i >= period) sum -= src[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function lastSma(src, period) {
  if (src.length < period) return null;
  let s = 0;
  for (let i = src.length - period; i < src.length; i++) s += src[i];
  return s / period;
}

export function ema(src, period) {
  const out = new Array(src.length).fill(null);
  if (period <= 0 || !src.length) return out;
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < src.length; i++) {
    if (i === period - 1) {
      let s = 0;
      for (let j = 0; j < period; j++) s += src[j];
      prev = s / period;
      out[i] = prev;
    } else if (i >= period) {
      prev = src[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/** 真实波幅序列 */
export function trueRange(bars) {
  return bars.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = bars[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
}

export function atr(bars, period) {
  if (bars.length < period + 1) return null;
  const tr = trueRange(bars);
  let s = 0;
  for (let i = tr.length - period; i < tr.length; i++) s += tr[i];
  return s / period;
}

/**
 * 相对强度 RS = 当前价 / N日前价 - 1。
 * 马克·米勒体系核心：比绝对涨跌幅更可靠。
 */
export function rs(bars, lookback = 250) {
  if (bars.length < lookback + 1) return null;
  const now = bars[bars.length - 1].close;
  const past = bars[bars.length - 1 - lookback].close;
  if (past <= 0) return null;
  return now / past - 1;
}

export function rsMulti(bars, periods) {
  const out = {};
  for (const p of periods) out[p] = rs(bars, p);
  return out;
}

/** 年化波动率（对数收益标准差 × √244） */
export function annualizedVol(bars, period = 60) {
  if (bars.length < period + 1) return null;
  const rets = [];
  for (let i = bars.length - period; i < bars.length; i++) {
    const c0 = bars[i - 1].close;
    const c1 = bars[i].close;
    if (c0 > 0 && c1 > 0) rets.push(Math.log(c1 / c0));
  }
  if (rets.length < 10) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  let s = 0;
  for (const r of rets) s += (r - mean) ** 2;
  const sd = Math.sqrt(s / (rets.length - 1));
  return sd * Math.sqrt(244) * 100;
}

/** 线性回归斜率（归一化为日变化率 %） */
export function regressionSlope(src) {
  if (src.length < 5) return null;
  const n = src.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += i; sy += src[i]; sxx += i * i; sxy += i * src[i];
  }
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-9) return null;
  const slope = (n * sxy - sx * sy) / den;
  const meanY = sy / n;
  return meanY === 0 ? null : (slope / meanY) * 100;
}

/** RSI */
export function rsi(bars, period = 14) {
  if (bars.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    const d = bars[i].close - bars[i - 1].close;
    if (d >= 0) gain += d; else loss -= d;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

export function rollingStd(src, period) {
  if (src.length < period || period < 2) return null;
  const w = src.slice(src.length - period);
  const mean = w.reduce((a, b) => a + b, 0) / period;
  let s = 0;
  for (const v of w) s += (v - mean) ** 2;
  return Math.sqrt(s / (period - 1));
}

export function mean(src) {
  return src.length ? src.reduce((a, b) => a + b, 0) / src.length : 0;
}

export function median(src) {
  if (!src.length) return 0;
  const s = [...src].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** 百分位排名（0~1，1 = 最大） */
export function percentileRank(value, all) {
  if (!all.length) return 0;
  let below = 0;
  for (const v of all) if (v < value) below++;
  return below / all.length;
}

export function closes(bars) { return bars.map((c) => c.close); }
export function highs(bars) { return bars.map((c) => c.high); }
export function lows(bars) { return bars.map((c) => c.low); }
export function volumes(bars) { return bars.map((c) => c.volume); }
