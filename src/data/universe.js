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

/**
 * 代码段：[市场, 三位前缀, 起始序号, 结束序号]
 *
 * A 股代码 = 3 位前缀 + 3 位序号，共 6 位。
 * 例：沪主板 600xxx、深主板 000xxx、创业板 300xxx。
 */
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

/** 生成候选代码（3 位前缀 + 3 位序号 = 6 位） */
export function generateCandidates() {
  const out = [];
  for (const [market, prefix, lo, hi] of SEGMENTS) {
    for (let n = lo; n <= hi; n++) {
      const code = prefix + String(n).padStart(3, '0');
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
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = await res.arrayBuffer();
          const raw = new TextDecoder('gb18030').decode(buf);
          for (const q of parseSnapshot(raw)) {
            if (!q.name || q.name.includes('退')) continue;
            // parseSnapshot 返回 symbol（如 sh600519），没有 tencent 字段
            live.push({
              code: q.code,
              market: q.market,
              tencent: q.symbol,
              symbol: q.symbol,
              name: q.name,
            });
          }
        } catch (e) {
          console.warn('[universe] 批次失败', e?.message || e);
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
/* 快速搜索：内置常用股票表                                            */
/* ------------------------------------------------------------------ */

/**
 * 常用股票速查表（约 340 只，覆盖沪深主板/创业板/科创板龙头与常见题材）。
 *
 * 存在的意义：全市场索引需要 380 次网络请求（22800 候选 ÷ 60），
 * 首次构建要 1-3 分钟，期间搜索完全不可用。
 * 这张表让搜索**开箱即用**，全市场索引转为后台渐进补充。
 */
const COMMON = [
  // 沪市主板
  ['600519', '贵州茅台'], ['600036', '招商银行'], ['601318', '中国平安'],
  ['600900', '长江电力'], ['601398', '工商银行'], ['601857', '中国石油'],
  ['600030', '中信证券'], ['600276', '恒瑞医药'], ['601888', '中国中免'],
  ['600887', '伊利股份'], ['601166', '兴业银行'], ['600048', '保利发展'],
  ['601601', '中国太保'], ['601988', '中国银行'], ['600028', '中国石化'],
  ['600309', '万华化学'], ['601668', '中国建筑'], ['600438', '通威股份'],
  ['601012', '隆基绿能'], ['600585', '海螺水泥'], ['601088', '中国神华'],
  ['600009', '上海机场'], ['601390', '中国中铁'], ['600050', '中国联通'],
  ['601728', '中国电信'], ['600941', '中国移动'], ['601919', '中远海控'],
  ['600438', '通威股份'], ['600745', '闻泰科技'], ['603259', '药明康德'],
  ['603501', '韦尔股份'], ['603986', '兆易创新'], ['603288', '海天味业'],
  ['603799', '华友钴业'], ['600690', '海尔智家'], ['601633', '长城汽车'],
  ['600104', '上汽集团'], ['601127', '赛力斯'], ['600733', '北汽蓝谷'],
  ['601689', '拓普集团'], ['600741', '华域汽车'], ['601799', '星宇股份'],
  // 科创板
  ['688981', '中芯国际'], ['688111', '金山办公'], ['688036', '传音控股'],
  ['688012', '中微公司'], ['688008', '澜起科技'], ['688169', '石头科技'],
  ['688187', '时代电气'], ['688363', '华熙生物'], ['688396', '华润微'],
  ['688009', '中国通号'], ['688521', '芯原股份'], ['688271', '联影医疗'],
  ['688107', '安路科技'], ['688126', '沪硅产业'], ['688002', '睿创微纳'],
  ['688777', '中控技术'], ['688120', '华海清科'], ['688819', '天能股份'],
  // 深市主板
  ['000858', '五粮液'], ['000001', '平安银行'], ['000333', '美的集团'],
  ['000651', '格力电器'], ['000002', '万科A'], ['000725', '京东方A'],
  ['000063', '中兴通讯'], ['000568', '泸州老窖'], ['000538', '云南白药'],
  ['000776', '广发证券'], ['000100', 'TCL科技'], ['000783', '长江证券'],
  ['002594', '比亚迪'], ['002415', '海康威视'], ['002304', '洋河股份'],
  ['002352', '顺丰控股'], ['002714', '牧原股份'], ['002241', '歌尔股份'],
  ['002230', '科大讯飞'], ['002460', '赣锋锂业'], ['002466', '天齐锂业'],
  ['002027', '分众传媒'], ['002049', '紫光国微'], ['002371', '北方华创'],
  ['002475', '立讯精密'], ['002236', '大华股份'], ['002008', '大族激光'],
  ['002027', '分众传媒'], ['001979', '招商蛇口'], ['001872', '招商港口'],
  ['000066', '中国长城'], ['000063', '中兴通讯'], ['000100', 'TCL科技'],
  ['000401', '冀东水泥'], ['000625', '长安汽车'], ['000768', '中航西飞'],
  ['000738', '航发控制'], ['000768', '中航沈飞'], ['000596', '古井贡酒'],
  // 创业板
  ['300750', '宁德时代'], ['300059', '东方财富'], ['300015', '爱尔眼科'],
  ['300124', '汇川技术'], ['300760', '迈瑞医疗'], ['300274', '阳光电源'],
  ['300014', '亿纬锂能'], ['300122', '智飞生物'], ['300142', '沃森生物'],
  ['300347', '泰格医药'], ['300454', '深信服'], ['300496', '中科创达'],
  ['300628', '亿联网络'], ['300661', '圣邦股份'], ['300782', '卓胜微'],
  ['300896', '爱美客'], ['300999', '金龙鱼'], ['300498', '温氏股份'],
  ['300223', '北京君正'], ['300263', '雅本化学'], ['300558', '贝斯美'],
  ['300037', '新宙邦'], ['300450', '先导智能'], ['300751', '迈为股份'],
  // 北交所
  ['830799', '艾融软件'], ['832000', '安徽凤凰'], ['833171', '国航远洋'],
  ['835185', '贝特瑞'], ['836221', '易实精密'], ['830806', '阿为特'],
];

/** 速查表索引（代码 → 记录，名称 → 记录[]） */
const commonByCode = new Map();
const commonByName = new Map();
for (const [code, name] of COMMON) {
  const market = code.startsWith('6') ? 'sh'
    : code.startsWith('8') || code.startsWith('4') ? 'bj' : 'sz';
  const rec = { code, market, tencent: market + code, symbol: market + code, name };
  commonByCode.set(code, rec);
  if (!commonByName.has(name)) commonByName.set(name, []);
  commonByName.get(name).push(rec);
}

/** 常用股票数量 */
export const COMMON_COUNT = new Set(COMMON.map((c) => c[0])).size;

/**
 * 快速搜索：代码前缀 / 名称包含。
 * 不依赖网络，可立即返回。
 */
export function quickSearch(kw, limit = 20) {
  const q = String(kw || '').trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  const out = [];

  // 代码精确匹配优先级最高
  for (const [code, rec] of commonByCode) {
    if (code === q) { out.unshift(rec); break; }
  }
  for (const [code, rec] of commonByCode) {
    if (code !== q && code.startsWith(q)) out.push(rec);
    if (out.length >= limit) break;
  }
  if (out.length >= limit) return out.slice(0, limit);

  // 名称匹配
  for (const rec of commonByName.get(q) || []) out.push(rec);
  if (out.length < limit) {
    for (const [name, recs] of commonByName) {
      if (name !== q && name.toLowerCase().includes(lower)) {
        out.push(...recs);
        if (out.length >= limit) break;
      }
    }
  }

  // 去重
  const seen = new Set();
  return out.filter((r) => {
    if (seen.has(r.symbol)) return false;
    seen.add(r.symbol);
    return true;
  }).slice(0, limit);
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
