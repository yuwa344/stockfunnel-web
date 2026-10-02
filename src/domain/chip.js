/**
 * 筹码分布模型。
 *
 * ## 为什么需要自建
 * 交易所与免费行情源均不公开「筹码峰」数据（同花顺/通达信属付费终端专有）。
 * 本模型按业界通用的**换手率衰减法**从 OHLCV + turnoverRate 数值反推分布。
 *
 * ## 算法
 * 1. 以价格区间为桶（默认 120 档，横跨近 lookback 日价格范围）
 * 2. 每日成交量按**三角形分布**注入价格桶
 *    （日内真实路径不可知，三角核假设开/高/低/收各占约 1/4，均价附近密度最高）
 * 3. 旧筹码按 a = turnoverRate × decayFactor 线性衰减，
 *    衰减掉的份额由当日新筹码补足
 * 4. 逐日迭代收敛
 *
 * ## 稳定性处理
 * - 换手率极低时按比例抑制衰减（minTurnover），避免噪声被放大
 * - 衰减系数 a 截断到 [0,1]，保证数值稳定
 * - a == 0（无换手）时不注入新筹码，避免虚假集中
 */

export class ChipDistribution {
  constructor(priceBuckets, weights) {
    this.priceBuckets = priceBuckets;
    this.weights = weights;
  }

  get isEmpty() { return !this.weights.length; }

  get totalWeight() { return this.weights.reduce((a, b) => a + b, 0); }

  static build(bars, { lookback = 250, binCount = 120, decayFactor = 1.0, minTurnover = 0.15 } = {}) {
    if (bars.length < 20) return new ChipDistribution([], []);

    const start = Math.max(0, bars.length - lookback);
    const win = bars.slice(start);
    if (win.length < 20) return new ChipDistribution([], []);

    let lo = Infinity, hi = -Infinity;
    for (const c of win) {
      if (c.low < lo) lo = c.low;
      if (c.high > hi) hi = c.high;
    }
    if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return new ChipDistribution([], []);

    const pad = (hi - lo) * 0.02;
    lo -= pad; hi += pad;

    const step = (hi - lo) / binCount;
    const buckets = Array.from({ length: binCount }, (_, i) => lo + step * (i + 0.5));
    const dist = new Array(binCount).fill(0);

    for (const c of win) {
      let tr = c.turnoverRate ?? 0;
      if (!Number.isFinite(tr) || tr < 0) tr = 0;
      let a = (tr / 100) * decayFactor;
      if (tr < minTurnover) a *= 0.5;
      a = Math.min(1, Math.max(0, a));
      if (a <= 0) continue;
      const keep = 1 - a;
      const day = triangular(c, buckets, step);
      for (let i = 0; i < binCount; i++) {
        dist[i] = dist[i] * keep + day[i] * a;
      }
    }

    const sum = dist.reduce((a, b) => a + b, 0);
    if (sum > 0) for (let i = 0; i < binCount; i++) dist[i] /= sum;
    return new ChipDistribution(buckets, dist);
  }

  /** 90% 筹码集中度（跨度 ÷ 中间价），越小越集中 */
  concentration90() { return this.concentrationP(0.9); }
  concentration70() { return this.concentrationP(0.7); }

  concentrationP(p) {
    if (this.isEmpty) return 1;
    const total = this.totalWeight;
    if (total <= 0) return 1;
    const loTarget = (1 - p) / 2;
    const hiTarget = 1 - loTarget;
    let acc = 0;
    let lo = this.priceBuckets[0];
    let hi = this.priceBuckets[this.priceBuckets.length - 1];
    let loFound = false;
    for (let i = 0; i < this.weights.length; i++) {
      acc += this.weights[i];
      if (!loFound && acc >= loTarget) { lo = this.priceBuckets[i]; loFound = true; }
      if (acc >= hiTarget) { hi = this.priceBuckets[i]; break; }
    }
    const span = hi - lo;
    if (span <= 0) return 0;
    const ref = (hi + lo) / 2;
    return ref === 0 ? 1 : Math.min(10, Math.max(0, span / ref));
  }

  /** 获利比例：成本低于当前价的筹码占比（%） */
  profitRatio(currentPrice) {
    if (this.isEmpty) return 0;
    let acc = 0;
    for (let i = 0; i < this.weights.length; i++) {
      if (this.priceBuckets[i] <= currentPrice) acc += this.weights[i];
    }
    return acc * 100;
  }

  /** 平均成本 */
  avgCost() {
    if (this.isEmpty) return 0;
    let s = 0, w = 0;
    for (let i = 0; i < this.weights.length; i++) {
      s += this.priceBuckets[i] * this.weights[i];
      w += this.weights[i];
    }
    return w === 0 ? 0 : s / w;
  }

  /** 上方阻力峰：现价之上筹码最密集价。无显著峰返回 null */
  resistancePeak(currentPrice) {
    if (this.isEmpty) return null;
    let bestIdx = -1, bestW = 0, vol = 0;
    for (let i = 0; i < this.weights.length; i++) {
      if (this.priceBuckets[i] <= currentPrice) continue;
      if (this.weights[i] > bestW) { bestW = this.weights[i]; bestIdx = i; }
      vol += this.weights[i];
    }
    if (bestIdx < 0 || vol <= 0) return null;
    if (bestW / vol < 0.18) return null; // 峰不够显著
    return this.priceBuckets[bestIdx];
  }

  /** 主峰分析：价格 / 权重 / 是否单峰 / 峰数 */
  peakAnalysis(currentPrice) {
    if (this.isEmpty) return { price: null, share: 0, isSingle: false, count: 0 };
    const peaks = [];
    for (let i = 1; i < this.weights.length - 1; i++) {
      if (this.priceBuckets[i] <= currentPrice) continue;
      if (this.weights[i] > this.weights[i - 1] && this.weights[i] >= this.weights[i + 1]) {
        peaks.push(i);
      }
    }
    if (!peaks.length) return { price: null, share: 0, isSingle: false, count: 0 };
    peaks.sort((a, b) => this.weights[b] - this.weights[a]);
    const top = peaks[0];
    let cluster = 0;
    for (let i = Math.max(0, top - 2); i <= Math.min(this.weights.length - 1, top + 2); i++) {
      cluster += this.weights[i];
    }
    let single = true;
    if (peaks.length > 1) {
      const second = this.weights[peaks[1]] * 3;
      if (second > cluster * 0.55) single = false;
    }
    return { price: this.priceBuckets[top], share: cluster, isSingle: single, count: peaks.length };
  }

  /** 抽样：[(价格, 占比%)]，价格升序 */
  sample(groups = 40) {
    if (this.isEmpty) return [];
    const g = Math.min(Math.max(1, groups), this.priceBuckets.length);
    const per = Math.ceil(this.priceBuckets.length / g);
    const out = [];
    for (let i = 0; i < this.priceBuckets.length; i += per) {
      const end = Math.min(i + per, this.priceBuckets.length);
      let w = 0, p = 0;
      for (let j = i; j < end; j++) { w += this.weights[j]; p = this.priceBuckets[j]; }
      out.push([p, w * 100]);
    }
    return out;
  }
}

/** 三角形分布注入：日内路径不可知，用三角核近似 */
function triangular(c, buckets, step) {
  const out = new Array(buckets.length).fill(0);
  const center = (c.open + c.close) / 2;
  const halfWidth = Math.max((c.high - c.low) / 2, step);
  for (let i = 0; i < buckets.length; i++) {
    const d = Math.abs(buckets[i] - center);
    if (d < halfWidth) {
      out[i] = 1 - d / halfWidth;
    } else {
      const tail = Math.max(0, 1 - d / (halfWidth * 2));
      out[i] = tail * tail;
    }
  }
  return out;
}
