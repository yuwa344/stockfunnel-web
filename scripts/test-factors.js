/**
 * 因子引擎单元测试（Node 环境，无需浏览器）
 * 运行：node scripts/test-factors.js
 */

import { trendFactor, fundamentalFactor, rsFactor, vcpFactor, chipFactor, pivotFactor } from '../src/domain/factors.js';
import { ChipDistribution } from '../src/domain/chip.js';
import { DEFAULT_CONFIG } from '../src/domain/config.js';
import { pos52w, parseSnapshot, parseKLine } from '../src/data/api.js';

let pass = 0, fail = 0;
const cfg = DEFAULT_CONFIG;

function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

/* ---------------- 构造合成数据 ---------------- */

function synth({ count, start, dailyPct, noise = 0.01, seed = 42, turnover = null }) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const out = [];
  let p = start;
  for (let i = 0; i < count; i++) {
    const chg = dailyPct / 100 + (rnd() - 0.5) * noise;
    const o = p;
    p = p * (1 + chg);
    const c = p;
    const h = Math.max(o, c) * (1 + rnd() * 0.005);
    const l = Math.min(o, c) * (1 - rnd() * 0.005);
    out.push({
      date: `2025-01-${String((i % 28) + 1).padStart(2, '0')}`,
      open: o, high: h, low: l, close: c,
      volume: 1e6 + i * 1000, amount: 0, turnoverRate: turnover,
    });
  }
  return out;
}

function quote(over = {}) {
  return {
    symbol: 'sh600519', code: '600519', market: 'sh', name: '测试',
    price: 100, prevClose: 99, open: 99.5, high: 101, low: 99,
    volume: 1e7, amount: 1e8, changePct: 1, turnoverRate: 1.5, amplitude: 2,
    peTtm: 25, pb: 3, floatCap: 300e8, totalCap: 360e8,
    high52w: 120, low52w: 60, volRatio: 1.2, limitUp: 108, limitDown: 89,
    updateTime: '09-30 16:00',
    ...over,
  };
}

/* ================= 数据源解析 ================= */
console.log('\n[数据源解析]');

{
  // 真实腾讯响应（字段索引已核验）
  const raw = `v_sh600519="1~贵州茅台~600519~1258.62~1235.58~1239.53~38331~21633~16698~1258.62~14~1258.44~1~1258.16~1~1258.05~2~1258.00~41~1258.65~2~1258.66~3~1258.68~1~1258.69~2~1258.75~80~~20260930161458~23.04~1.86~1268.00~1236.05~1258.62/38331/4797246636~38331~479725~0.31~19.32~~1268.00~1236.05~2.59~15733.78~15733.78~6.26~1359.14~1112.02~1.36~-29~1251.53~17.67~19.11~~~0.06~479724.6636~453.1032~36~   A~GP-A~-6.71~0.38~4.13~32.41~27.30~1539.98~1151.01~-1.11~-3.15~5.87~1250081601~1250081601~-19.73~-9.97~1250081601~~~-9.58~0.16~~CNY~0~___D__F__N~1257.93~15~";`;
  const list = parseSnapshot(raw);
  ok(list.length === 1, '快照解析数量');
  const q = list[0];
  ok(q.name === '贵州茅台', '中文名称 GBK 解码', `got=${q.name}`);
  ok(q.price === 1258.62, '现价');
  ok(q.turnoverRate === 0.31, '换手率');
  ok(q.amplitude === 2.59, '振幅');
  ok(q.peTtm === 19.32, '市盈率');
  ok(q.high52w === 1539.98, '52周最高（索引67）', `got=${q.high52w}`);
  ok(q.low52w === 1151.01, '52周最低（索引68）', `got=${q.low52w}`);
  ok(q.volume === 38331 * 100, '成交量 手→股');
  ok(q.amount === 479725 * 10000, '成交额 万→元');
  ok(Math.abs(q.pos52w_placeholder ?? pos52w(q) - (1258.62 - 1151.01) / (1539.98 - 1151.01)) < 0.01, '52周分位');
}

{
  const raw = '{"code":0,"data":{"sh600519":{"qfqday":[["2026-09-29","1244.60","1235.58","1245.87","1230.88","26366"],["2026-09-30","1239.53","1258.62","1268.00","1236.05","38331"]]}}}';
  const bars = parseKLine(raw, { tencent: 'sh600519' });
  ok(bars.length === 2, 'K线解析');
  ok(bars[0].open === 1244.60 && bars[0].close === 1235.58, 'K线开收字段顺序');
  ok(bars[1].high === 1268.00 && bars[1].low === 1236.05, 'K线高低字段');
  ok(bars[1].volume === 38331 * 100, 'K线量 手→股');
  ok(bars[0].date < bars[1].date, 'K线按日期升序');
}

/* ================= ① 趋势 ================= */
console.log('\n[① 长期趋势因子]');

{
  const bars = synth({ count: 300, start: 20, dailyPct: 0.15 });
  const last = bars[bars.length - 1].close;
  // 52 周区间需覆盖当前价，否则分位会被算成 0
  const q = quote({ price: last, high52w: last * 1.05, low52w: last * 0.5 });
  const v = trendFactor({}, bars, q, cfg);
  ok(v.passed, '强势上涨股通过', v.notes.join(' | '));
  ok(v.score > 60, '得分 > 60', `got=${v.score}`);
  ok(v.metrics.MA20 > v.metrics.MA60, 'MA20 > MA60');
  ok(v.metrics.MA60 > v.metrics.MA250, 'MA60 > MA250');
  ok(v.metrics.pos52w > 90, '52周分位处于高位区', `got=${v.metrics.pos52w?.toFixed(1)}`);
}

{
  const bars = synth({ count: 100, start: 20, dailyPct: 0.1 });
  const v = trendFactor({}, bars, quote(), cfg);
  ok(!v.passed, 'K线不足被拒');
  ok(v.notes[0].includes('上市过短'), '给出上市过短原因');
}

{
  const bars = synth({ count: 300, start: 100, dailyPct: -0.1 });
  const q = quote({ price: bars[bars.length - 1].close, high52w: 150, low52w: bars[bars.length - 1].close * 0.95 });
  const v = trendFactor({}, bars, q, cfg);
  ok(!v.passed, '下跌趋势被拒');
}

{
  const bars = synth({ count: 300, start: 20, dailyPct: 0.15 });
  const q = quote({ price: bars[bars.length - 1].close, high52w: 1000, low52w: 19 });
  const v = trendFactor({}, bars, q, cfg);
  ok(!v.passed, '52周分位过低被拒');
  ok(v.notes.some((n) => n.includes('52周分位')), '给出52周分位说明');
}

/* ================= ② 基本面 ================= */
console.log('\n[② 基本面因子]');

{
  const v = fundamentalFactor({}, synth({ count: 300, start: 20, dailyPct: 0.15 }), quote({ peTtm: 0 }), cfg);
  ok(!v.passed, 'PE 缺失被拒');
}
{
  const v = fundamentalFactor({}, synth({ count: 300, start: 20, dailyPct: 0.15 }), quote({ peTtm: 200 }), cfg);
  ok(!v.passed, 'PE 过高被拒');
}
{
  // 前期慢涨 + 近期加速（满足加速确认）
  const bars = [];
  let p = 20;
  for (let i = 0; i < 300; i++) {
    const pct = i < 240 ? 0.05 : 0.35;
    const o = p; p = p * (1 + pct / 100);
    bars.push({ date: `2025-01-01`, open: o, high: Math.max(o, p) * 1.002, low: Math.min(o, p) * 0.998, close: p, volume: 5e6, amount: 0, turnoverRate: 1 });
  }
  const q = quote({ price: p, high52w: p * 1.02, low52w: p * 0.6 });
  const v = fundamentalFactor({}, bars, q, cfg);
  ok(v.passed, '优质股通过', v.notes.join(' | '));
}

/* ================= ③ RS ================= */
console.log('\n[③ RS 相对强度因子]');

{
  const v = rsFactor({}, synth({ count: 300, start: 20, dailyPct: 0.25 }), cfg);
  ok(v.passed, '强势股多周期为正', v.notes.join(' | '));
  ok(v.metrics.rs63 > 0 && v.metrics.rs126 > 0 && v.metrics.rs252 > 0, '三周期 RS 均为正');
}
{
  const v = rsFactor({}, synth({ count: 300, start: 100, dailyPct: -0.2 }), cfg);
  ok(!v.passed, '弱势股被拒');
}
{
  const v = rsFactor({}, synth({ count: 100, start: 20, dailyPct: 0.1 }), cfg);
  ok(!v.passed, '数据不足被拒');
  ok(v.notes.some((n) => n.includes('不足')), '给出数据不足说明');
  ok(!v.notes.some((n) => n.includes('NaN')), '无 NaN 输出');
}

/* ================= ④ VCP ================= */
console.log('\n[④ VCP 波动收缩]');

{
  const v = vcpFactor({}, synth({ count: 30, start: 20, dailyPct: 0.1 }), cfg);
  ok(!v.passed, 'K线不足被拒');
}
{
  // 构造三次逐级收窄
  const bars = [];
  let p = 20;
  const mk = (close, vol) => {
    const o = p; p = close;
    bars.push({
      date: `2025-01-${String(bars.length % 28 + 1).padStart(2, '0')}`,
      open: o, high: Math.max(o, close) * 1.004, low: Math.min(o, close) * 0.996,
      close, volume: vol, amount: 0, turnoverRate: vol / 1e6,
    });
  };
  for (let i = 0; i < 60; i++) mk(p * 1.006, 2e6);
  for (let i = 0; i < 10; i++) mk(p * 1.005, 1.6e6);
  let pk = p; for (let i = 0; i < 8; i++) mk(pk * (1 - 0.01 * (i + 1)), 1.2e6);
  for (let i = 0; i < 10; i++) mk(p * 1.005, 1.0e6);
  pk = p; for (let i = 0; i < 6; i++) mk(pk * (1 - 0.008 * (i + 1)), 7e5);
  for (let i = 0; i < 10; i++) mk(p * 1.005, 5e5);
  pk = p; for (let i = 0; i < 4; i++) mk(pk * (1 - 0.007 * (i + 1)), 3e5);
  mk(p * 0.998, 4e5);
  mk(p * 1.01, 9e5);

  const v = vcpFactor({}, bars, cfg);
  ok(v.metrics.depthCount >= 1, '识别到收缩波段', `count=${v.metrics.depthCount}`);
  ok(v.notes.length > 0, '给出判定说明');
  ok(!v.notes.some((n) => n.includes('NaN') || n.includes('undefined')), '无 NaN/undefined');
}

/* ================= ⑤ 筹码 ================= */
console.log('\n[⑤ 筹码峰集中度]');

{
  const bars = synth({ count: 250, start: 10, dailyPct: 0.4, turnover: 3 });
  const q = quote({ price: bars[bars.length - 1].close });
  const v = chipFactor({}, bars, q, cfg);
  ok(v.metrics.profitRatio > 85, '单边上涨获利比例 > 85%', `got=${v.metrics.profitRatio?.toFixed(1)}`);
}
{
  const bars = synth({ count: 250, start: 100, dailyPct: -0.3, turnover: 1 });
  const q = quote({ price: bars[bars.length - 1].close, high52w: 150, low52w: 10 });
  const v = chipFactor({}, bars, q, cfg);
  ok(!v.passed, '下跌股被拒');
}
{
  const bars = synth({ count: 250, start: 50, dailyPct: 0, noise: 0, turnover: 1 });
  const chip = ChipDistribution.build(bars, { lookback: 250, binCount: 120 });
  const sum = chip.weights.reduce((a, b) => a + b, 0);
  ok(Math.abs(sum - 1) < 0.01, '权重归一化', `sum=${sum.toFixed(4)}`);
  const c90 = chip.concentration90();
  ok(c90 >= 0 && c90 < 1, '集中度在合理区间', `c90=${c90.toFixed(4)}`);
  ok(chip.avgCost() > 0, '平均成本为正');
}
{
  const chip = ChipDistribution.build(synth({ count: 10, start: 10, dailyPct: 0.1 }), {});
  ok(chip.isEmpty, '数据不足返回空');
}

/* ================= ⑥ 枢轴突破 ================= */
console.log('\n[⑥ 枢轴点放量突破]');

{
  // 横盘 100 天后放量突破
  const bars = [];
  for (let i = 0; i < 100; i++) {
    const base = 20 + (i % 5) * 0.1;
    bars.push({
      date: `2025-01-${String(i % 28 + 1).padStart(2, '0')}`,
      open: base, high: base * 1.01, low: base * 0.99, close: base,
      volume: 1e6, amount: 0, turnoverRate: 1,
    });
  }
  bars.push({ date: '2025-06-01', open: 20.5, high: 21.4, low: 20.4, close: 21.2, volume: 3e6, amount: 0, turnoverRate: 5 });
  const v = pivotFactor({}, bars, quote({ price: 21.2 }), cfg);
  ok(v.passed, '放量突破通过', v.notes.join(' | '));
  ok(v.metrics.volumeRatio >= 1.5, '量比 >= 1.5', `got=${v.metrics.volumeRatio?.toFixed(2)}`);

  // 关键：止损必须落在 5%~8%
  const stop = v.metrics.stopLoss;
  const stopPct = (21.2 - stop) / 21.2 * 100;
  ok(stopPct >= 4.99 && stopPct <= 8.01, `止损在 5%~8% 区间`, `got=${stopPct.toFixed(2)}%`);
  ok(v.metrics.target > 21.2, '目标价高于买入价');
}

{
  const bars = synth({ count: 100, start: 20, dailyPct: -0.05, turnover: 1 });
  const v = pivotFactor({}, bars, quote({ price: bars[bars.length - 1].close }), cfg);
  ok(!v.passed, '未突破不产生信号');
  ok(v.notes.some((n) => n.includes('未突破')), '给出未突破说明');
}

/* ================= 止损 clamp 边界（回归测试） ================= */
console.log('\n[止损边界回归 · 曾修复的 Bug]');

{
  // 场景：形态低点远高于 8% 止损价（茅台真实数据形态）
  // 旧代码 clamp(stop5, stop8) 参数颠倒会抛 RangeError
  const bars = [];
  for (let i = 0; i < 100; i++) {
    const base = 1000;
    bars.push({ date: `2025-01-01`, open: base, high: base * 1.002, low: base * 0.998, close: base, volume: 1e6, amount: 0 });
  }
  bars.push({ date: '2025-06-01', open: 1001, high: 1020, low: 1000, close: 1015, volume: 5e6, amount: 0 });
  let threw = null;
  try {
    const v = pivotFactor({}, bars, quote({ price: 1015 }), cfg);
    const stopPct = (1015 - v.metrics.stopLoss) / 1015 * 100;
    ok(stopPct >= 4.99 && stopPct <= 8.01, '高价股止损仍在区间内', `got=${stopPct.toFixed(2)}%`);
  } catch (e) {
    threw = e;
  }
  ok(!threw, '不抛异常（旧版 clamp 上下界颠倒会崩）', threw ? threw.message : '');
}

/* ================= 结果 ================= */
console.log(`\n${'='.repeat(46)}`);
console.log(`通过 ${pass} · 失败 ${fail} · 共 ${pass + fail}`);
console.log('='.repeat(46));
process.exit(fail > 0 ? 1 : 0);
