/**
 * Canvas 图表组件。
 * 自绘以保证双端（移动/桌面）渲染完全一致，且零依赖。
 */

/* ------------------------------------------------------------------ */
/* K 线图                                                              */
/* ------------------------------------------------------------------ */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} o { bars, theme, selected, showMa, showVolume }
 */
export function drawKLine(canvas, o) {
  const { bars, theme, selected = null, showMa = true, showVolume = true } = o;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (!cssW || !cssH) return;

  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  if (!bars || !bars.length) {
    ctx.fillStyle = theme.axis;
    ctx.font = '12px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('暂无K线数据', cssW / 2, cssH / 2);
    return;
  }

  const RIGHT = 52;
  const volH = showVolume ? cssH * 0.22 : 0;
  const priceH = cssH - volH - (showVolume ? 6 : 0);
  const volTop = priceH + 6;
  const chartW = cssW - RIGHT;

  // 只画最近 100 根
  const total = bars.length;
  const start = Math.max(0, total - 100);
  const win = bars.slice(start);

  // 价格范围（含均线）
  let lo = Infinity, hi = -Infinity;
  for (const c of win) {
    if (c.low < lo) lo = c.low;
    if (c.high > hi) hi = c.high;
  }
  if (showMa) {
    const cls = win.map((c) => c.close);
    for (const p of [5, 10, 20, 60]) {
      const ma = sma(cls, p);
      for (const v of ma) {
        if (v == null || Number.isNaN(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  const pad = (hi - lo) * 0.06;
  lo -= pad; hi += pad;
  const range = Math.abs(hi - lo) < 1e-9 ? 1 : hi - lo;
  const yOf = (p) => priceH - ((p - lo) / range) * priceH;

  // 网格 + 价格轴
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 0.6;
  ctx.fillStyle = theme.axis;
  ctx.font = '9.5px -apple-system, sans-serif';
  ctx.textAlign = 'left';
  const LINES = 5;
  for (let i = 0; i <= LINES; i++) {
    const y = (priceH * i) / LINES;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(chartW, y);
    ctx.stroke();
    ctx.fillText(fmtPrice(hi - (hi - lo) * (i / LINES)), chartW + 6, y + 3);
  }

  // K 线
  const n = win.length;
  const slot = chartW / n;
  const bodyW = Math.max(1, Math.min(slot * 0.68, 14));
  let maxVol = 0;
  for (const c of win) if (c.volume > maxVol) maxVol = c.volume;
  if (maxVol <= 0) maxVol = 1;

  for (let i = 0; i < n; i++) {
    const c = win[i];
    const cx = slot * i + slot / 2;
    const isUp = c.close >= c.open;
    const col = isUp ? theme.up : theme.down;

    // 影线
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, yOf(c.high));
    ctx.lineTo(cx, yOf(c.low));
    ctx.stroke();

    // 实体
    const yO = yOf(c.open);
    const yC = yOf(c.close);
    const top = Math.min(yO, yC);
    const h = Math.max(1, Math.abs(yO - yC));
    ctx.fillStyle = col;
    ctx.fillRect(cx - bodyW / 2, top, bodyW, h);

    // 量柱
    if (showVolume) {
      const vh = (c.volume / maxVol) * (volH - 6);
      ctx.fillStyle = isUp ? theme.volUp : theme.volDown;
      ctx.fillRect(cx - bodyW / 2, volTop + volH - vh, bodyW, vh);
    }
  }

  // 均线
  if (showMa) {
    const cls = win.map((c) => c.close);
    drawMa(ctx, cls, slot, yOf, theme.ma5, 5);
    drawMa(ctx, cls, slot, yOf, theme.ma10, 10);
    drawMa(ctx, cls, slot, yOf, theme.ma20, 20);
    if (win.length >= 60) drawMa(ctx, cls, slot, yOf, theme.ma60, 60);

    // 图例
    let lx = 6;
    lx += legend(ctx, cls, 5, theme.ma5, lx, 4);
    lx += legend(ctx, cls, 10, theme.ma10, lx, 4);
    lx += legend(ctx, cls, 20, theme.ma20, lx, 4);
    if (cls.length >= 60) legend(ctx, cls, 60, theme.ma60, lx, 4);
  }

  // 十字光标
  if (selected != null && selected >= 0 && selected < n) {
    drawCrosshair(ctx, cssW, cssH, win, selected, slot, yOf, chartW, priceH, volTop, volH, showVolume, theme);
  }

  return { slot, n };
}

function drawMa(ctx, cls, slot, yOf, color, period) {
  if (cls.length < period) return;
  const ma = sma(cls, period);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < ma.length; i++) {
    const v = ma[i];
    if (v == null || Number.isNaN(v)) continue;
    const x = slot * i + slot / 2;
    const y = yOf(v);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  if (started) ctx.stroke();
}

function legend(ctx, cls, period, color, x, y) {
  const ma = sma(cls, period);
  const v = ma.length ? ma[ma.length - 1] : null;
  ctx.fillStyle = color;
  ctx.font = '9.5px -apple-system, sans-serif';
  ctx.textAlign = 'left';
  const label = `MA${period}`;
  ctx.fillText(label, x, y + 8);
  let w = ctx.measureText(label).width;
  if (v != null && !Number.isNaN(v)) {
    const vs = v.toFixed(2);
    ctx.fillText(vs, x + w + 3, y + 8);
    w += 3 + ctx.measureText(vs).width;
  }
  return w + 12;
}

function drawCrosshair(ctx, cssW, cssH, win, idx, slot, yOf, chartW, priceH, volTop, volH, showVolume, theme) {
  const x = slot * idx + slot / 2;
  const c = win[idx];
  const y = yOf(c.close);

  ctx.strokeStyle = theme.axis;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 0.8;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, showVolume ? volTop + volH : cssH);
  ctx.moveTo(0, y);
  ctx.lineTo(chartW, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // 右侧价格标签
  ctx.fillStyle = c.close >= c.open ? theme.up : theme.down;
  ctx.fillRect(chartW + 1, y - 8, 50, 16);
  ctx.fillStyle = '#fff';
  ctx.font = '9.5px -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(fmtPrice(c.close), chartW + 5, y + 3.5);

  // 底部信息条
  const info = `${c.date.slice(5)}  开${fmtPrice(c.open)}  高${fmtPrice(c.high)}  低${fmtPrice(c.low)}  收${fmtPrice(c.close)}  ${c.close >= c.open ? '+' : ''}${c.changePct?.toFixed(2) ?? '0.00'}%`;
  ctx.font = '9.5px -apple-system, sans-serif';
  const tw = ctx.measureText(info).width;
  ctx.fillStyle = theme.bg;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(4, cssH - 17, tw + 8, 13);
  ctx.globalAlpha = 1;
  ctx.fillStyle = c.close >= c.open ? theme.up : theme.down;
  ctx.fillText(info, 8, cssH - 7);
}

/* ------------------------------------------------------------------ */
/* 筹码峰图（横向）                                                     */
/* ------------------------------------------------------------------ */

export function drawChip(canvas, o) {
  const { chip, currentPrice, theme } = o;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (!cssW || !cssH) return;

  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  if (!chip || chip.isEmpty) return;

  const L = 34, B = 20, T = 8;
  const chartW = cssW - L;
  const chartH = cssH - B - T;

  let lo = chip.priceBuckets[0];
  let hi = chip.priceBuckets[chip.priceBuckets.length - 1];
  lo = Math.min(lo, currentPrice);
  hi = Math.max(hi, currentPrice);
  if (Math.abs(hi - lo) < 1e-9) hi = lo + 1;
  const range = hi - lo;
  lo -= range * 0.03; hi += range * 0.03;
  const r2 = hi - lo;
  const xOf = (p) => L + ((p - lo) / r2) * chartW;

  let maxW = 0;
  for (const w of chip.weights) if (w > maxW) maxW = w;
  if (maxW <= 0) maxW = 1;

  // 纵轴刻度
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 0.6;
  ctx.fillStyle = theme.axis;
  ctx.font = '8.5px -apple-system, sans-serif';
  ctx.textAlign = 'left';
  for (let i = 0; i <= 2; i++) {
    const y = T + (chartH * i) / 2;
    ctx.beginPath();
    ctx.moveTo(L, y);
    ctx.lineTo(L + chartW, y);
    ctx.stroke();
    ctx.fillText(`${(maxW * 100 * (1 - i / 2)).toFixed(1)}%`, 2, y + 3);
  }

  // 柱状
  const n = chip.weights.length;
  const barW = chartW / n;
  for (let i = 0; i < n; i++) {
    const price = chip.priceBuckets[i];
    const x = xOf(price);
    const h = (chip.weights[i] / maxW) * chartH;
    ctx.fillStyle = price <= currentPrice
      ? hexA(theme.up, 0.62)
      : hexA(theme.down, 0.62);
    ctx.fillRect(x - barW / 2, T + chartH - h, Math.max(barW, 1.2), h);
  }

  // 基线
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(L, T + chartH);
  ctx.lineTo(L + chartW, T + chartH);
  ctx.stroke();

  // 当前价线
  const curX = xOf(currentPrice);
  ctx.strokeStyle = theme.brand;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(curX, T);
  ctx.lineTo(curX, T + chartH);
  ctx.stroke();
  chipLabel(ctx, fmtPrice(currentPrice), curX, T, theme.brand, true);

  // 平均成本
  const avgCost = chip.avgCost();
  if (avgCost > 0 && avgCost >= lo && avgCost <= hi) {
    const ax = xOf(avgCost);
    ctx.strokeStyle = theme.warn;
    ctx.lineWidth = 1.1;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(ax, T);
    ctx.lineTo(ax, T + chartH);
    ctx.stroke();
    ctx.setLineDash([]);
    chipLabel(ctx, `均${fmtPrice(avgCost)}`, ax, T + 13, theme.warn, false);
  }

  // 阻力峰
  const res = chip.resistancePeak(currentPrice);
  if (res != null && res >= lo && res <= hi) {
    const rx = xOf(res);
    ctx.strokeStyle = theme.warn;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(rx, T);
    ctx.lineTo(rx, T + chartH);
    ctx.stroke();
    ctx.setLineDash([]);
    chipLabel(ctx, `阻${fmtPrice(res)}`, rx, T + 25, theme.warn, false);
  }

  // 横轴
  ctx.fillStyle = theme.axis;
  ctx.font = '8.5px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i <= 3; i++) {
    const p = lo + ((hi - lo) * i) / 3;
    ctx.fillText(fmtPrice(p), xOf(p), cssH - 7);
  }
}

function chipLabel(ctx, label, x, y, color, bold) {
  ctx.font = `${bold ? '700' : '600'} 9px -apple-system, sans-serif`;
  const w = ctx.measureText(label).width;
  ctx.fillStyle = color;
  roundRect(ctx, x - w / 2 - 3, y - 1, w + 6, 12, 3);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(label, x, y + 8);
}

/* ------------------------------------------------------------------ */
/* 迷你走势线                                                          */
/* ------------------------------------------------------------------ */

export function drawSpark(canvas, values, color) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (!cssW || !cssH || !values || values.length < 2) return;

  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  let lo = Infinity, hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = Math.abs(hi - lo) < 1e-9 ? 1 : hi - lo;

  ctx.beginPath();
  ctx.moveTo(0, cssH);
  for (let i = 0; i < values.length; i++) {
    const x = (cssW * i) / (values.length - 1);
    const y = cssH - ((values[i] - lo) / range) * cssH;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(cssW, cssH);
  ctx.closePath();
  ctx.fillStyle = hexA(color, 0.14);
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < values.length; i++) {
    const x = (cssW * i) / (values.length - 1);
    const y = cssH - ((values[i] - lo) / range) * cssH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.3;
  ctx.stroke();
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function sma(src, period) {
  const out = new Array(src.length).fill(null);
  if (src.length < period) return out;
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i];
    if (i >= period) sum -= src[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function fmtPrice(v) {
  if (!Number.isFinite(v)) return '--';
  if (Math.abs(v) >= 1000) return v.toFixed(2);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toFixed(3);
}
