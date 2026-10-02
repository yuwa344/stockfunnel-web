/**
 * 全市场标的枚举与本地搜索。
 *
 * ## 背景
 * 免费接口中唯一稳定的全市场列表接口（proxy.finance.qq.com getRank）在实测中
 * 参数校验失败不可用，东财全系域名在本网络不可达，`smartbox.gtimg.cn` 无 CORS 头。
 *
 * 因此采用**确定性代码段枚举 + 批量快照校验**：
 * A 股代码段由交易所固定（600/601/603/605/688/000/001/002/003/300/301/43x/8xx），
 * 枚举后用腾讯批量快照（60 只/请求）校验存在性。
 * 校验通过后快照本身就带名称，本地搜索表由此构建 —— 无需 smartbox。
 */

import { fetchSnapshots, parseSnapshot, API } from './api.js';

/** 代码段：[市场, 前缀, 起始号, 结束号] */
const SEGMENTS = [
  ['sh', '600', 0, 999], ['sh', '601', 0, 999], ['sh', '603', 0, 999],
  ['sh', '605', 0, 99], ['sh', '688', 0, 999], ['sh', '689', 0, 99],
  ['sz', '000', 0, 999], ['sz', '001', 0, 999], ['sz', '002', 0, 999],
  ['sz', '003', 0, 99],
  ['sz', '300', 0, 999], ['sz', '301', 0, 999],
  ['bj', '430', 0, 999], ['bj', '830', 0, 999], ['bj', '831', 0, 99],
  ['bj', '832', 0, 99], ['bj', '833', 0, 999], ['bj', '834', 0, 999],
  ['bj', '835', 0, 999], ['bj', '836', 0, 999], ['bj', '837', 0, 999],
  ['bj', '838', 0, 999], ['bj', '839', 0, 999], ['bj', '870', 0, 999],
  ['bj', '871', 0, 99], ['bj', '872', 0, 999], ['bj', '873', 0, 999],
  ['bj', '874', 0, 99], ['bj', '875', 0, 99], ['bj', '876', 0, 99],
  ['bj', '877', 0, 99], ['bj', '878', 0, 99], ['bj', '879', 0, 99],
  ['bj', '880', 0, 99], ['bj', '881', 0, 99], ['bj', '882', 0, 99],
  ['bj', '883', 0, 99], ['bj', '884', 0, 99], ['bj', '885', 0, 99],
];

/** 生成候选代码（约 2.4 万个探测位） */
export function generateCandidates() {
  const out = [];
  for (const [market, prefix, lo, hi] of SEGMENTS) {
    for (let n = lo; n <= hi; n++) {
      const code = prefix + String(n).padStart(4, '0');
      out.push({ code, market, tencent: market + code, symbol: market + code, name: '' });
    }
  }
  return out;
}

/**
 * 校验有效标的（带名称）。
 * 腾讯对不存在代码返回空 body，对退市代码返回名称但价格为 0 —— 两者都会被过滤。
 */
export async function resolveLive(candidates, { concurrency = 10, onProgress, signal } = {}) {
  const CHUNK = 60;
  const live = [];
  let done = 0;

  const chunks = [];
  for (let i = 0; i < candidates.length; i += CHUNK) {
    chunks.push(candidates.slice(i, i + CHUNK));
  }

  for (let g = 0; g < chunks.length; g += concurrency) {
    if (signal?.aborted) break;
    const group = chunks.slice(g, g + concurrency);
    await Promise.all(
      group.map(async (chunk) => {
        try {
          const codes = chunk.map((s) => s.tencent).join(',');
          const res = await fetch(API.SNAPSHOT + codes, { cache: 'no-store' });
          const buf = await res.arrayBuffer();
          const raw = new TextDecoder('gb18030').decode(buf);
          for (const q of parseSnapshot(raw)) {
            if (q.name.includes('退')) continue;
            live.push({ code: q.code, market: q.market, tencent: q.tencent, symbol: q.symbol, name: q.name });
          }
        } catch (e) {
          console.warn('[universe] 批次失败', e);
        } finally {
          done += chunk.length;
          onProgress?.(done, candidates.length);
        }
      })
    );
  }
  return live;
}

/* ------------------------------------------------------------------ */
/* 本地搜索                                                            */
/* ------------------------------------------------------------------ */

/** 从已加载的全市场表构建搜索索引 */
export class UniverseIndex {
  constructor() {
    this.list = [];
    this.bySymbol = new Map();
    this.loaded = false;
  }

  set(list) {
    this.list = list;
    this.bySymbol = new Map(list.map((s) => [s.symbol, s]));
    this.loaded = true;
  }

  get size() { return this.list.length; }

  /**
   * 本地搜索：代码前缀 / 名称包含 / 拼音首字母（若有名则简码）。
   * 无 smartbox（CORS 限制）时的完全替代方案。
   */
  search(kw, limit = 20) {
    const q = kw.trim().toLowerCase();
    if (!q || !this.loaded) return [];

    const scored = [];
    for (const s of this.list) {
      let score = -1;
      if (s.code === q) score = 100;
      else if (s.code.startsWith(q)) score = 90;
      else if (s.symbol === q) score = 95;
      else if (s.name.toLowerCase().includes(q)) score = 70;
      if (score > 0) scored.push({ s, score });
      if (scored.length > 400) break;
    }
    scored.sort((a, b) => b.score - a.score || a.s.code.localeCompare(b.s.code));
    return scored.slice(0, limit).map((x) => x.s);
  }

  get(symbol) { return this.bySymbol.get(symbol); }
}

export const universeIndex = new UniverseIndex();
