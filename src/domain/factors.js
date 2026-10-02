/**
 * 六层多因子漏斗 —— 各层因子实现。
 *
 * 与 Dart 版 (lib/domain/screener/factors.dart) 1:1 对应，
 * 并保留已修复的止损 clamp 边界 bug（上下界颠倒会导致运行时抛错）。
 */

import * as I from './indicators.js';
import { ChipDistribution } from './chip.js';
import { pos52w, clamp } from '../data/api.js';

/* ================================================================== */
/* ① 长期趋势因子 Trend Filter                                          */
/* ================================================================== */

export function trendFactor(stock, bars, q, cfg) {
  const m = {};
  const notes = [];

  if (bars.length < cfg.minBars) {
    return verdict(false, 0, m, [`K线仅 ${bars.length} 根，不足 ${cfg.minBars} 根（上市过短）`]);
  }

  const cls = I.closes(bars);
  const ma20 = I.lastSma(cls, 20);
  const ma60 = I.lastSma(cls, 60);
  const ma120 = I.lastSma(cls, 120);
  const ma250 = I.lastSma(cls, 250);
  const close = bars[bars.length - 1].close;

  m.MA20 = ma20; m.MA60 = ma60; m.MA120 = ma120; m.MA250 = ma250; m.close = close;

  let pass = true;
  let score = 60;

  // --- MA 多头排列 ---
  if (cfg.requireMaBullishStack) {
    const stack = ma20 != null && ma60 != null && ma120 != null && ma250 != null &&
      ma20 > ma60 && ma60 > ma120 && ma120 > ma250;
    m.maStack = stack ? 1 : 0;
    if (stack) { notes.push('MA 多头排列（20>60>120>250）'); score += 12; }
    else { notes.push('MA 未形成多头排列'); pass = false; }
  }

  // --- 200MA 上行 ---
  const ma200Series = I.sma(cls, 200).filter((v) => v != null);
  let slope = null;
  if (ma200Series.length >= 20) {
    slope = I.regressionSlope(ma200Series.slice(-20));
  }
  m.ma200Slope = slope;
  if (slope != null) {
    if (slope > cfg.ma200SlopeMin) {
      notes.push(`200MA 上行（斜率 ${slope.toFixed(3)}%/日）`);
      score += 10;
    } else {
      notes.push(`200MA 走平/下行（斜率 ${slope.toFixed(3)}%）`);
      pass = false;
    }
  }

  // --- 52 周高低位过滤 ---
  const pos = pos52w(q);
  m.pos52w = pos * 100;
  m.high52w = q.high52w;
  m.low52w = q.low52w;
  if (pos >= cfg.pos52wMin && pos <= cfg.pos52wMax) {
    notes.push(`52周分位 ${(pos * 100).toFixed(1)}%（区间合适）`);
    score += clamp(pos * 12, 0, 12);
  } else {
    notes.push(
      pos < cfg.pos52wMin
        ? `52周分位偏低 ${(pos * 100).toFixed(1)}%（低位，排除）`
        : `52周分位过高 ${(pos * 100).toFixed(1)}%（追高风险）`
    );
    pass = false;
  }

  // --- 站上 200MA ---
  if (cfg.aboveMa200Required) {
    const above = ma250 != null && close > ma250;
    m.aboveMa200 = above ? 1 : 0;
    const dist = ma250 == null ? 0 : (close / ma250 - 1) * 100;
    m.distMa200 = dist;
    if (above) { notes.push(`站上 200MA（+${dist.toFixed(1)}%）`); score += 8; }
    else { notes.push(`跌破 200MA（${dist.toFixed(1)}%）`); pass = false; }
  }

  return verdict(pass, clamp(score, 0, 100), m, notes);
}

/* ================================================================== */
/* ② 基本面爆发因子                                                     */
/* ================================================================== */

/**
 * 重要说明（诚实降级）：
 * 免费接口不提供分季度财务数据，因此无法直接计算真实季度 EPS 同比。
 * 本因子采用**可从行情反推的代理指标**：以价格动量作为盈利/营收景气的
 * 领先信号，配合估值交叉验证。UI 中已明确标注。
 */
export function fundamentalFactor(stock, bars, q, cfg) {
  const m = {};
  const notes = [];
  let pass = true;
  let score = 60;

  // --- 估值 ---
  const pe = q.peTtm;
  m.pe = pe;
  if (pe == null || pe <= 0) {
    notes.push('PE 缺失或为负（可能亏损），剔除');
    return verdict(false, 0, m, notes);
  }
  if (pe < cfg.peMin || pe > cfg.peMax) {
    notes.push(`PE ${pe.toFixed(1)} 超出合理区间`);
    pass = false;
  } else {
    notes.push(`PE ${pe.toFixed(1)} 合理`);
    score += clamp(((40 - pe) / 40) * 15, -5, 15);
  }

  if (q.pb != null) {
    m.pb = q.pb;
    if (q.pb > cfg.pbMax) { notes.push(`PB ${q.pb.toFixed(1)} 过高`); pass = false; }
  }

  // --- 流通市值 ---
  const capYi = q.floatCap / 1e8;
  m.floatCap = capYi;
  if (capYi < cfg.minFloatCapYi || capYi > cfg.maxFloatCapYi) {
    notes.push(`流通市值 ${capYi.toFixed(0)}亿 超出区间`);
    pass = false;
  } else {
    notes.push(`流通市值 ${capYi.toFixed(0)}亿`);
  }

  // --- 景气度代理 ---
  const mom60 = I.rs(bars, 60);
  const mom120 = I.rs(bars, 120);
  m.mom60 = (mom60 ?? 0) * 100;
  m.mom120 = (mom120 ?? 0) * 100;

  if (cfg.requireEpsGrowth) {
    if (mom60 == null) {
      notes.push('动量数据不足，无法判断增速');
      pass = false;
    } else if (mom60 * 100 < cfg.epsGrowthMin) {
      notes.push(`近60日涨幅 ${(mom60 * 100).toFixed(1)}% 未达增速阈值 ${cfg.epsGrowthMin}%`);
      pass = false;
    } else {
      notes.push(`景气度代理：60日涨幅 ${(mom60 * 100).toFixed(1)}%`);
      score += 10;
    }
  }

  if (cfg.revenueGrowthMin > 0 && mom120 != null) {
    if (mom120 * 100 < cfg.revenueGrowthMin) {
      notes.push(`中期动量 ${(mom120 * 100).toFixed(1)}% 不足营收增长阈值`);
      pass = false;
    }
  }

  // --- 加速确认 ---
  if (cfg.accelerationRequired && mom60 != null && mom120 != null) {
    const shortTerm = mom60 / 60;
    const midTerm = mom120 / 120;
    const accelerating = shortTerm > midTerm * 1.2;
    m.accelerating = accelerating ? 1 : 0;
    if (accelerating) { notes.push('增速加速确认（短期动能 > 中期）'); score += 8; }
    else { notes.push('未检测到增速加速'); pass = false; }
  }

  return verdict(pass, clamp(score, 0, 100), m, notes);
}

/* ================================================================== */
/* ③ 动量与相对强度因子 RS Factor                                        */
/* ================================================================== */

export function computeRs(bars, periods) {
  const out = {};
  for (const p of periods) out[p] = I.rs(bars, p);
  return out;
}

export function rsFactor(stock, bars, cfg) {
  const rsMap = computeRs(bars, cfg.rsPeriods);
  const m = {};
  const notes = [];
  let positive = 0, valid = 0;

  for (const p of cfg.rsPeriods) {
    const v = rsMap[p];
    m[`rs${p}`] = (v ?? 0) * 100;
    if (v != null) { valid++; if (v > 0) positive++; }
  }
  notes.push(
    'RS: ' + cfg.rsPeriods.map((p) => (rsMap[p] == null ? 'n/a' : `${(rsMap[p] * 100).toFixed(0)}%`)).join(' / ')
  );

  if (valid < cfg.rsPeriods.length) {
    return verdict(false, 0, m, [...notes, '部分周期数据不足（上市时间短）']);
  }

  const pass = positive >= cfg.rsMinPeriodsPositive;
  notes.push(pass
    ? `${positive}/${valid} 个周期为正，RS 健康`
    : `仅 ${positive}/${valid} 个周期为正，动量疲弱`);

  return verdict(pass, clamp((positive / valid) * 100, 0, 100), m, notes);
}

/* ================================================================== */
/* ④ VCP 波动收缩因子                                                   */
/* ================================================================== */

export function vcpFactor(stock, bars, cfg) {
  const m = {};
  const notes = [];

  if (bars.length < cfg.vcpLookback + 10) {
    return verdict(false, 0, m, [`K线不足 ${cfg.vcpLookback} 日`]);
  }

  const win = bars.slice(bars.length - cfg.vcpLookback);
  const peaks = findSwings(win, true);
  const troughs = findSwings(win, false);
  m.swingPeaks = peaks.length;
  m.swingTroughs = troughs.length;

  if (peaks.length < 2) {
    return verdict(false, 0, m, [`窗口内波峰不足 2 个（${peaks.length}），无收缩结构`]);
  }

  // 收缩深度：相邻波峰间的回撤
  const depths = [];
  const dryRatios = [];
  for (let i = 1; i < peaks.length; i++) {
    const p0 = peaks[i - 1], p1 = peaks[i];
    if (p1 <= p0) continue;
    let trough = Infinity;
    for (let j = p0; j <= p1; j++) if (win[j].low < trough) trough = win[j].low;
    const topRef = Math.max(win[p0].high, win[p1].high);
    if (topRef <= 0) continue;
    depths.push(((topRef - trough) / topRef) * 100);

    const volDuring = avgVolume(win, p0, p1);
    const volBefore = avgVolume(win, Math.max(0, p0 - 20), p0);
    if (volBefore > 0) dryRatios.push(volDuring / volBefore);
  }

  if (depths.length < cfg.vcpRequiredTroughs) {
    return verdict(false, 0, m, [
      ...notes,
      `有效收缩波段 ${depths.length} 个，不足 ${cfg.vcpRequiredTroughs} 个`,
    ]);
  }

  // 深度递减
  let shrinking = true;
  for (let i = 1; i < depths.length; i++) {
    if (depths[i] > depths[i - 1] * 1.05) { shrinking = false; break; }
  }
  m.lastDepth = depths[depths.length - 1];
  m.depthCount = depths.length;
  m.avgDepth = depths.reduce((a, b) => a + b, 0) / depths.length;

  const lastDry = dryRatios.length ? dryRatios[dryRatios.length - 1] : 1;
  m.lastDryRatio = lastDry * 100;
  m.minDryRatio = (dryRatios.length ? Math.min(...dryRatios) : 1) * 100;

  let pass = true;
  let score = 55;

  if (shrinking) {
    notes.push(`波动逐级收窄（深度：${depths.map((d) => d.toFixed(1)).join('→')}%）`);
    score += 18;
  } else {
    notes.push(`波动未逐级收窄（深度：${depths.map((d) => d.toFixed(1)).join('→')}%）`);
    pass = false;
  }

  if (lastDry < cfg.vcpVolumeDryRatio) {
    notes.push(`末端量能萎缩至前量 ${(lastDry * 100).toFixed(0)}%`);
    score += 15;
  } else {
    notes.push(`量能未充分萎缩（${(lastDry * 100).toFixed(0)}% > ${(cfg.vcpVolumeDryRatio * 100).toFixed(0)}%）`);
    pass = false;
  }

  if (depths.length >= cfg.vcpMaxContractions) score += 10;

  // 接近突破位
  let high = 0;
  for (const p of peaks) if (win[p].high > high) high = win[p].high;
  const close = win[win.length - 1].close;
  const distToHigh = high === 0 ? 0 : (close / high - 1) * 100;
  m.distToHigh = distToHigh;
  if (distToHigh > -cfg.vcpMinDepth * 100 * 0.35) {
    notes.push(`接近区间高点（距高点 ${distToHigh.toFixed(1)}%）`);
    score += 8;
  } else {
    notes.push(`距区间高点 ${distToHigh.toFixed(1)}%，尚未到位`);
  }

  return verdict(pass, clamp(score, 0, 100), m, notes);
}

function findSwings(w, isHigh) {
  const span = Math.max(3, Math.floor(w.length / 12));
  const out = [];
  for (let i = span; i < w.length - span; i++) {
    const v = isHigh ? w[i].high : w[i].low;
    let extreme = true;
    for (let j = i - span; j <= i + span; j++) {
      if (j === i || j < 0 || j >= w.length) continue;
      const other = isHigh ? w[j].high : w[j].low;
      if (isHigh ? other > v : other < v) { extreme = false; break; }
    }
    if (extreme) out.push(i);
  }
  return out;
}

function avgVolume(w, from, to) {
  from = clamp(from, 0, w.length - 1);
  to = clamp(to, 0, w.length - 1);
  if (to <= from) return w[from].volume;
  let s = 0, c = 0;
  for (let i = from; i <= to; i++) { s += w[i].volume; c++; }
  return c ? s / c : 0;
}

/* ================================================================== */
/* ⑤ 筹码峰集中度因子                                                   */
/* ================================================================== */

export function chipFactor(stock, bars, q, cfg, prebuilt) {
  const m = {};
  const notes = [];

  const chip = prebuilt || ChipDistribution.build(bars, {
    lookback: cfg.chipLookback, binCount: cfg.chipBins,
  });
  if (chip.isEmpty) {
    return verdict(false, 0, m, ['筹码模型无法构建（数据不足）']);
  }

  const price = q.price > 0 ? q.price : bars[bars.length - 1].close;
  const c90 = chip.concentration90();
  const c70 = chip.concentration70();
  const profit = chip.profitRatio(price);
  const avgCost = chip.avgCost();
  const resistance = chip.resistancePeak(price);
  const peak = chip.peakAnalysis(price);

  m.concentration90 = c90 * 100;
  m.concentration70 = c70 * 100;
  m.profitRatio = profit;
  m.avgCost = avgCost;
  m.resistancePeak = resistance;
  m.peakCount = peak.count;
  m.peakShare = peak.share * 100;

  let pass = true;
  let score = 55;

  if (c90 < cfg.concentration90Max) {
    notes.push(`90%筹码集中度 ${(c90 * 100).toFixed(2)}% < ${(cfg.concentration90Max * 100).toFixed(0)}%`);
    score += 20;
  } else {
    notes.push(`筹码集中度 ${(c90 * 100).toFixed(2)}% 超出阈值`);
    pass = false;
  }

  if (profit > cfg.profitRatioMin) {
    notes.push(`获利比例 ${profit.toFixed(1)}% > ${cfg.profitRatioMin}%`);
    score += 15;
  } else {
    notes.push(`获利比例 ${profit.toFixed(1)}% 不足 ${cfg.profitRatioMin}%`);
    pass = false;
  }

  if (cfg.requireNoResistance) {
    if (resistance == null && peak.isSingle) {
      notes.push('上方无阻力峰（单峰密集结构）');
      score += 10;
    } else if (resistance != null) {
      notes.push(`上方存在阻力峰 ¥${resistance.toFixed(2)}`);
      pass = false;
    } else {
      notes.push(`上方存在多个密集峰（${peak.count} 个）`);
      pass = false;
    }
  }

  return verdict(pass, clamp(score, 0, 100), m, notes);
}

/* ================================================================== */
/* ⑥ 枢轴点放量突破因子                                                 */
/* ================================================================== */

export function pivotFactor(stock, bars, q, cfg, chip) {
  const m = {};
  const notes = [];

  if (bars.length < cfg.breakoutLookback + 5) {
    return verdict(false, 0, m, [`K线不足 ${cfg.breakoutLookback} 日`]);
  }

  const n = bars.length;
  const today = bars[n - 1];
  const close = today.close;

  // 枢轴点：前 pivotWindow 日最高价
  let pivotHigh = -Infinity;
  for (let i = n - 1 - cfg.pivotWindow; i < n - 1; i++) {
    if (bars[i].high > pivotHigh) pivotHigh = bars[i].high;
  }
  m.pivotHigh = pivotHigh;

  // 筹码单峰上沿
  let chipTop = null;
  if (chip && !chip.isEmpty) {
    const p = chip.peakAnalysis(close);
    if (p.price != null) chipTop = p.price;
  }
  m.chipPeak = chipTop;

  const brokePivot = close > pivotHigh;
  const brokeChip = chipTop != null && close > chipTop;
  m.brokePivot = brokePivot ? 1 : 0;
  m.brokeChip = brokeChip ? 1 : 0;

  // 量能
  const vol50 = avgVol(bars, n - 1 - 50, n - 1);
  const vr = vol50 > 0 ? today.volume / vol50 : 0;
  m.volumeRatio = vr;
  m.todayVolume = today.volume;
  m.avgVol50 = vol50;
  m.close = close;

  let pass = true;
  let score = 50;

  if (brokePivot) {
    notes.push(`突破 ${cfg.pivotWindow} 日枢轴点 ¥${pivotHigh.toFixed(2)}`);
    score += 20;
  } else {
    notes.push(`未突破枢轴点（现价 ¥${close.toFixed(2)} < 枢轴 ¥${pivotHigh.toFixed(2)}）`);
    pass = false;
  }

  if (brokeChip) {
    notes.push(`突破筹码峰上沿 ¥${chipTop.toFixed(2)}`);
    score += 8;
  }

  if (vr >= cfg.breakoutVolumeRatio) {
    notes.push(`放量 ${vr.toFixed(2)}× ≥ ${cfg.breakoutVolumeRatio}×`);
    score += 20;
  } else {
    notes.push(`量能不足（${vr.toFixed(2)}× < ${cfg.breakoutVolumeRatio}×）`);
    pass = false;
  }

  m.isBullish = today.close >= today.open ? 1 : 0;
  if (today.close >= today.open) score += 5;
  else notes.push('当日为阴线，需谨慎');

  // --- 止损：严格落在 [minStop%, maxStop%] 区间 ---
  // 关键：clamp 的下界必须是更低价（8%），上界是更高价（5%）。写反会抛错。
  let recentLow = Infinity;
  for (let i = Math.max(0, n - 11); i < n; i++) if (bars[i].low < recentLow) recentLow = bars[i].low;

  const stopLowBound = close * (1 - cfg.maxStopLossPct / 100);   // 更低
  const stopHighBound = close * (1 - cfg.minStopLossPct / 100);  // 更高
  const structuralStop = recentLow > 0 ? recentLow * 0.995 : stopLowBound;
  const finalStop = clamp(structuralStop, stopLowBound, stopHighBound);

  const risk = close - finalStop;
  const target = close + risk * cfg.targetRR;
  m.stopLoss = finalStop;
  m.target = target;
  m.rr = risk <= 0 ? 0 : cfg.targetRR;
  m.recentLow = recentLow;

  return verdict(pass, clamp(score, 0, 100), m, notes);
}

function avgVol(bars, from, to) {
  from = Math.max(0, from);
  to = Math.min(bars.length - 1, to);
  if (to <= from) return bars[to]?.volume ?? 0;
  let s = 0, c = 0;
  for (let i = from; i <= to; i++) { s += bars[i].volume; c++; }
  return c ? s / c : 0;
}

/* ------------------------------------------------------------------ */

function verdict(passed, score, metrics, notes) {
  return { passed, score, metrics, notes };
}
