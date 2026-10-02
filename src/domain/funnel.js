/**
 * 六层漏斗编排引擎。
 *
 * 流程：
 *  0. 加载全市场（代码段枚举 + 批量快照校验）
 *  1. 批量拉 K 线
 *  2. ① 趋势 → ② 基本面 → ③ RS 截面排名 → ④ VCP → ⑤ 筹码 → ⑥ 枢轴突破
 *
 * 性能策略：昂贵的筹码模型只在第 5 层对存活者计算；
 * 换手率数据（需代理）不可用时自动降级并明确标注。
 */

import * as API from '../data/api.js';
import { generateCandidates, resolveLive, universeIndex } from '../data/universe.js';
import { ChipDistribution } from './chip.js';
import {
  trendFactor, fundamentalFactor, rsFactor, vcpFactor, chipFactor, pivotFactor, computeRs,
} from './factors.js';
import { STAGES } from './config.js';

/** 全市场缓存（避免重复枚举） */
let universeCache = null;

export async function loadUniverse({ onProgress, force = false, signal } = {}) {
  if (universeCache && !force) {
    onProgress?.({ message: '全市场已缓存', done: 1, total: 1 });
    return universeCache;
  }
  onProgress?.({ message: '枚举 A 股代码段…', done: 0, total: 1 });
  const candidates = generateCandidates();
  const live = await resolveLive(candidates, {
    concurrency: 10,
    signal,
    onProgress: (done, total) => {
      onProgress?.({ message: `校验标的 ${done}/${total}`, done, total });
    },
  });
  universeCache = live;
  universeIndex.set(live);
  return live;
}

export function getUniverse() { return universeCache; }

/**
 * 执行漏斗。
 * @param {object} cfg ScreenerConfig
 * @param {function} onProgress 进度回调
 * @param {AbortSignal} signal
 */
export async function runFunnel(cfg, onProgress, signal) {
  const t0 = Date.now();
  const stages = [];

  try {
    // ---------- Stage 0 ----------
    const universe = await loadUniverse({ onProgress, signal });
    if (signal?.aborted) return { stages, startedAt: t0, finishedAt: Date.now(), universeSize: 0, signals: [], error: '已取消' };

    onProgress?.({ message: '拉取实时快照…', done: 0, total: universe.length });
    const quoteMap = await API.fetchSnapshots(universe, {
      concurrency: 8,
      onProgress: (d, t) => onProgress?.({ message: `快照 ${d}/${t}`, done: d, total: t }),
    });
    if (signal?.aborted) return cancelled(t0);

    // 剔除异常标的
    const valid = [];
    for (const s of universe) {
      const q = quoteMap.get(s.symbol);
      if (!q) continue;
      if (q.price <= 0 || q.price < 0.5) continue; // 停牌 / 仙股
      valid.push(s);
    }
    const universeSize = valid.length;

    // ---------- 加载 K 线 ----------
    onProgress?.({ message: `加载历史K线（${valid.length} 只）…`, done: 0, total: valid.length });
    const klineMap = await API.fetchKLines(valid, {
      count: 320,
      concurrency: cfg.klineConcurrency,
      onProgress: (d, t) => onProgress?.({ message: `加载K线 ${d}/${t}`, done: d, total: t }),
    });
    if (signal?.aborted) return cancelled(t0);

    // ==================== ① 趋势 ====================
    onProgress?.({ message: '① 长期趋势筛选…', done: 0, total: valid.length });
    let trendPass = [];
    const trendReject = {};
    for (const s of valid) {
      if (signal?.aborted) return cancelled(t0);
      const bars = klineMap.get(s.symbol);
      const q = quoteMap.get(s.symbol);
      if (!bars?.length || !q) continue;
      const v = trendFactor(s, bars, q, cfg);
      if (v.passed) trendPass.push(wrap(s, 'trend', v));
      else bump(trendReject, v.notes);
    }
    if (trendPass.length > cfg.maxTrendCandidates) {
      trendPass.sort((a, b) => b.score - a.score);
      trendPass = trendPass.slice(0, cfg.maxTrendCandidates);
    }
    stages.push({
      key: 'trend', passed: trendPass, inputCount: valid.length,
      rejectedStats: trendReject, scoreBy: scoreMap(trendPass),
    });
    onProgress?.({ message: `① 长期趋势：${trendPass.length} 只通过`, done: trendPass.length, total: valid.length });
    if (!trendPass.length) return done(t0, stages, universeSize);

    // ==================== ② 基本面 ====================
    const fundPass = [];
    const fundReject = {};
    for (const fr of trendPass) {
      if (signal?.aborted) return cancelled(t0);
      const s = fr.stock;
      const v = fundamentalFactor(s, klineMap.get(s.symbol), quoteMap.get(s.symbol), cfg);
      if (v.passed) fundPass.push(wrap(s, 'fundamental', v));
      else bump(fundReject, v.notes);
    }
    stages.push({
      key: 'fundamental', passed: fundPass, inputCount: trendPass.length,
      rejectedStats: fundReject, scoreBy: scoreMap(fundPass),
    });
    onProgress?.({ message: `② 基本面：${fundPass.length} 只通过`, done: fundPass.length, total: trendPass.length });
    if (!fundPass.length) return done(t0, stages, universeSize);

    // ==================== ③ RS 截面排名 ====================
    const rsStage = applyRsFilter(cfg, fundPass, klineMap);
    stages.push(rsStage);
    onProgress?.({ message: `③ 相对强度：${rsStage.passed.length} 只通过`, done: rsStage.passed.length, total: fundPass.length });
    if (!rsStage.passed.length) return done(t0, stages, universeSize);

    // ==================== ④ VCP ====================
    const vcpPass = [];
    const vcpReject = {};
    for (const fr of rsStage.passed) {
      if (signal?.aborted) return cancelled(t0);
      const s = fr.stock;
      const v = vcpFactor(s, klineMap.get(s.symbol), cfg);
      if (v.passed) vcpPass.push(wrap(s, 'vcp', v));
      else bump(vcpReject, v.notes);
    }
    stages.push({
      key: 'vcp', passed: vcpPass, inputCount: rsStage.passed.length,
      rejectedStats: vcpReject, scoreBy: scoreMap(vcpPass),
    });
    onProgress?.({ message: `④ VCP 收缩：${vcpPass.length} 只通过`, done: vcpPass.length, total: rsStage.passed.length });
    if (!vcpPass.length) return done(t0, stages, universeSize);

    // ---------- 加载换手率（筹码峰必需）----------
    const vcpStocks = vcpPass.map((f) => f.stock);
    let turnoverMap = new Map();
    const needProxy = !localStorage.getItem('sf_proxy');
    if (needProxy) {
      onProgress?.({
        message: '⚠ 未配置换手率代理，筹码层将降级估算',
        done: 0, total: 1,
      });
    } else {
      onProgress?.({ message: '加载换手率数据…', done: 0, total: vcpStocks.length });
      turnoverMap = await API.fetchTurnovers(vcpStocks, {
        concurrency: 5,
        onProgress: (d, t) => onProgress?.({ message: `换手率 ${d}/${t}`, done: d, total: t }),
      });
    }

    // ==================== ⑤ 筹码峰 ====================
    const chipPass = [];
    const chipReject = {};
    const chipCache = new Map();
    for (const fr of vcpPass) {
      if (signal?.aborted) return cancelled(t0);
      const s = fr.stock;
      const bars0 = klineMap.get(s.symbol);
      const turn = turnoverMap.get(s.symbol);
      const bars = turn ? attachTurnover(bars0, turn) : bars0;
      const chip = ChipDistribution.build(bars, { lookback: cfg.chipLookback, binCount: cfg.chipBins });
      chipCache.set(s.symbol, chip);
      const v = chipFactor(s, bars, quoteMap.get(s.symbol), cfg, chip);
      if (v.passed) chipPass.push(wrap(s, 'chip', v));
      else bump(chipReject, v.notes);
    }
    stages.push({
      key: 'chip', passed: chipPass, inputCount: vcpPass.length,
      rejectedStats: chipReject, scoreBy: scoreMap(chipPass),
    });
    onProgress?.({ message: `⑤ 筹码集中：${chipPass.length} 只通过`, done: chipPass.length, total: vcpPass.length });
    if (!chipPass.length) return done(t0, stages, universeSize);

    // ==================== ⑥ 枢轴放量突破 ====================
    const pivotPass = [];
    const pivotReject = {};
    const signals = [];
    for (const fr of chipPass) {
      if (signal?.aborted) return cancelled(t0);
      const s = fr.stock;
      const v = pivotFactor(s, klineMap.get(s.symbol), quoteMap.get(s.symbol), cfg, chipCache.get(s.symbol));
      if (v.passed) {
        const price = v.metrics.close ?? quoteMap.get(s.symbol).price;
        const sig = {
          code: s.code, name: s.name, symbol: s.symbol,
          price,
          stopLoss: v.metrics.stopLoss ?? price * 0.94,
          target: v.metrics.target ?? price * 1.1,
          volumeRatio: v.metrics.volumeRatio ?? 1,
          reason: v.notes.join('；'),
          triggeredAt: new Date(),
          get rr() { const r = this.price - this.stopLoss; return r <= 0 ? 0 : (this.target - this.price) / r; },
          get stopPct() { return (this.price - this.stopLoss) / this.price * 100; },
        };
        signals.push(sig);
        pivotPass.push({
          stock: s, stage: 'pivot', score: v.score,
          metrics: { ...v.metrics, signal: sig }, notes: v.notes,
        });
      } else {
        bump(pivotReject, v.notes);
      }
    }
    stages.push({
      key: 'pivot', passed: pivotPass, inputCount: chipPass.length,
      rejectedStats: pivotReject, scoreBy: scoreMap(pivotPass),
    });
    onProgress?.({ message: `⑥ 枢轴突破：${pivotPass.length} 只触发`, done: pivotPass.length, total: chipPass.length });

    return {
      stages, startedAt: t0, finishedAt: Date.now(),
      universeSize, signals, turnoverAvailable: turnoverMap.size > 0,
    };
  } catch (e) {
    console.error('[funnel]', e);
    return {
      stages, startedAt: t0, finishedAt: Date.now(), universeSize: 0,
      signals: [], error: e?.message || String(e),
    };
  }
}

/* ------------------------------------------------------------------ */

/** ③ RS 横向截面筛选：取前 rsTopPercent */
function applyRsFilter(cfg, input, klineMap) {
  const allRs = [];
  const rsValue = new Map();
  const stockBy = new Map();

  for (const fr of input) {
    const s = fr.stock;
    const bars = klineMap.get(s.symbol);
    if (!bars) continue;
    const v = rsFactor(s, bars, cfg);
    if (!v.passed) continue;
    const rsMap = computeRs(bars, cfg.rsPeriods);
    const valid = Object.values(rsMap).filter((x) => x != null);
    if (!valid.length) continue;
    const combined = valid.reduce((a, b) => a + b, 0) / valid.length;
    rsValue.set(s.symbol, combined);
    stockBy.set(s.symbol, s);
    allRs.push(combined);
  }

  const cutoff = Math.max(1, Math.ceil(allRs.length * cfg.rsTopPercent));
  const sorted = [...allRs].sort((a, b) => b - a);
  const threshold = sorted.length ? sorted[cutoff - 1] : Infinity;

  const passed = [];
  const rejected = {};
  for (const [sym, val] of rsValue) {
    if (val < threshold) {
      bumpKey(rejected, `RS 未进入前 ${(cfg.rsTopPercent * 100).toFixed(0)}%`);
      continue;
    }
    const s = stockBy.get(sym);
    const bars = klineMap.get(sym);
    const v = rsFactor(s, bars, cfg);
    const rank = allRs.filter((r) => r <= val).length / allRs.length;
    passed.push({
      stock: s, stage: 'rs', score: rank * 100,
      metrics: { ...v.metrics, rsRank: rank * 100 },
      notes: [...v.notes, `截面排名 ${(rank * 100).toFixed(0)}%`],
    });
  }
  passed.sort((a, b) => b.score - a.score);

  return {
    key: 'rs', passed, inputCount: input.length,
    rejectedStats: rejected, scoreBy: scoreMap(passed),
  };
}

/** 把换手率回填进 K 线（筹码模型的核心输入） */
function attachTurnover(bars, turnMap) {
  return bars.map((c) => {
    let tr = null;
    for (const [d, v] of turnMap) {
      if (d >= c.date) { tr = v; break; }
    }
    return { ...c, turnoverRate: tr };
  });
}

function wrap(stock, stage, v) {
  return { stock, stage, score: v.score, metrics: v.metrics, notes: v.notes };
}

function scoreMap(list) {
  const m = {};
  for (const f of list) m[f.stock.symbol] = f.score;
  return m;
}

/** 统计淘汰原因（只统计否定类说明） */
function bump(map, notes) {
  const bad = notes.filter((n) =>
    /未|不足|超出|不存在|无|跌|无法|超出阈值/.test(n)
  );
  const key = bad.length ? bad.join('; ') : (notes[0] || '其他');
  bumpKey(map, key);
}

function bumpKey(map, key) {
  const k = key.length > 70 ? key.slice(0, 70) + '…' : key || '其他';
  map[k] = (map[k] || 0) + 1;
}

function done(t0, stages, universeSize) {
  return { stages, startedAt: t0, finishedAt: Date.now(), universeSize, signals: [] };
}

function cancelled(t0) {
  return { stages, startedAt: t0, finishedAt: Date.now(), universeSize: 0, signals: [], error: '已取消' };
}
