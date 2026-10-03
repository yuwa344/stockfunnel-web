/**
 * 数据访问层。
 *
 * ## 数据源与 CORS 实测结论（2026-09-30 验证）
 *
 * | 端点 | CORS | 用途 | 处理方式 |
 * |---|---|---|---|
 * | `qt.gtimg.cn` | ✅ `Access-Control-Allow-Origin: *` | 实时快照（全市场批量） | 直连 |
 * | `web.ifzq.gtimg.cn` | ✅ `*` | 日 K 线（前复权） | 直连 |
 * | `smartbox.gtimg.cn` | ❌ | 搜索 | 本地全市场表替代 |
 * | `q.stock.sohu.com` | ❌ | 历史换手率（筹码峰必需） | 可选代理 + 降级 |
 *
 * ## 编码坑点
 * 腾讯行情接口返回 **GBK** 字节流。浏览器原生 `TextDecoder('gbk')` 可直接解码，
 * 无需 Dart 侧的手写码表。生僻字用 `gb18030` 兜底（超集，兼容 GBK）。
 */

/**
 * 读取本地代理配置。
 * 用函数 + try 包裹而非模块顶层求值，避免在无 localStorage 的环境
 * （Node 测试、Service Worker、部分隐私模式）直接抛 ReferenceError。
 */
function getProxyBase() {
  try {
    return localStorage.getItem('sf_proxy') || '';
  } catch {
    return '';
  }
}

/** 走代理（若配置），否则直连。 */
function withProxy(url) {
  const base = getProxyBase();
  if (!base) return url;
  return base + encodeURIComponent(url);
}

/** 通用 fetch + 超时 + GBK 解码 */
async function fetchText(url, { timeout = 15000, gbk = false } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (gbk) {
      const buf = await res.arrayBuffer();
      try {
        return new TextDecoder('gb18030').decode(buf);
      } catch {
        return new TextDecoder('utf-8').decode(buf);
      }
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export const API = {
  SNAPSHOT: 'https://qt.gtimg.cn/q=',
  SEARCH: 'https://smartbox.gtimg.cn/s3/',
  SOHU: 'https://q.stock.sohu.com/hisHq',
};

/**
 * K 线端点候选池（按优先级）。
 *
 * ## 为什么需要多源（2026-10-03 实测）
 * 腾讯的 `fqkline`（前复权）端点会被自家 WAF 拦截，返回 **HTTP 501**
 * 并附带 `waf.tencent.com/501page.html` 的 JS 挑战页。
 * 该故障是**间歇性**的：同一时刻 `kline/kline` 与 `proxy.finance.qq.com`
 * 都能正常返回数据。因此必须按优先级逐个降级，不能只依赖单一端点。
 *
 * | # | 端点 | 复权 | 实测 |
 * |---|---|---|---|
 * | 1 | `proxy.finance.qq.com/.../fqkline` | 前复权 | ✅ 200，含 `qfqday` |
 * | 2 | `web.ifzq.gtimg.cn/.../fqkline` | 前复权 | ⚠️ 间歇 501（WAF） |
 * | 3 | `ifzq.gtimg.cn/.../fqqline` | 前复权 | ✅ 200 |
 * | 4 | `web.ifzq.gtimg.cn/.../kline/kline` | 不复权 | ✅ 200，含 `day` |
 *
 * 三者均返回 `Access-Control-Allow-Origin: *`，浏览器可直连。
 * 降级到不复权源时技术指标会略有偏差（除权跳空），但趋势判定仍可用。
 */
const KLINE_SOURCES = [
  {
    name: 'qq-proxy-qfq',
    build: (code, n) =>
      `https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get?param=${code},day,,,${n},qfq`,
  },
  {
    name: 'ifzq-qfq',
    build: (code, n) =>
      `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,,,${n},qfq`,
  },
  {
    name: 'ifzq-alt-qfq',
    build: (code, n) =>
      `https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,,,${n},qfq`,
  },
  {
    name: 'ifzq-raw',
    build: (code, n) =>
      `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=${code},day,,,${n}`,
  },
];

/** 记录每个源的健康度，供 UI 展示与诊断。 */
export const klineHealth = {
  ok: 0,
  fail: 0,
  bySource: Object.create(null),
  lastError: '',
};

function noteSource(name, ok, err) {
  const h = klineHealth.bySource[name] || (klineHealth.bySource[name] = { ok: 0, fail: 0 });
  if (ok) { h.ok++; klineHealth.ok++; } else { h.fail++; klineHealth.fail++; klineHealth.lastError = err || ''; }
}

/* ------------------------------------------------------------------ */
/* 行情快照                                                            */
/* ------------------------------------------------------------------ */

const MARKET_BY_PREFIX = { sh: 'sh', sz: 'sz', bj: 'bj' };

/**
 * 解析腾讯快照。
 *
 * 字段索引（对照 2026-09-30 实测响应逐字段核验，0-based）：
 *   1 名称  2 代码  3 现价  4 昨收  5 今开  6 成交量(手)
 *   31 涨跌额  32 涨跌幅%  33 最高  34 最低
 *   36 成交量(手)  37 成交额(万)  38 换手率%  39 市盈率TTM
 *   43 振幅%  44 流通市值(亿)  45 总市值(亿)  46 市净率
 *   47 涨停价  48 跌停价  49 量比
 *   67 52周最高  68 52周最低
 */
export function parseSnapshot(raw) {
  const out = [];
  const re = /v_([a-z]{2}\d{6})="([^"]*)"/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const symbol = m[1];
    const body = m[2];
    if (!body) continue;
    const f = body.split('~');
    if (f.length < 45) continue;

    const name = (f[1] || '').trim();
    const code = (f[2] || '').trim();
    const price = num(f[3]);
    if (!name || !code || price <= 0) continue; // 停牌/退市/无效

    out.push({
      symbol,
      code,
      market: MARKET_BY_PREFIX[symbol.slice(0, 2)] || 'sh',
      name,
      price,
      prevClose: num(f[4]),
      open: num(f[5]),
      high: num(f[33]),
      low: num(f[34]),
      volume: num(f[6]) * 100,        // 手 → 股
      amount: num(f[37]) * 10000,     // 万 → 元
      changePct: num(f[32]),
      turnoverRate: num(f[38]),
      amplitude: num(f[43]),
      peTtm: numOrNull(f[39]),
      pb: numOrNull(f[46]),
      floatCap: num(f[44]) * 1e8,     // 亿 → 元
      totalCap: num(f[45]) * 1e8,
      high52w: num(f[67]),
      low52w: num(f[68]),
      volRatio: num(f[49]),
      limitUp: num(f[47]),
      limitDown: num(f[48]),
      updateTime: parseTime(f[30]),
    });
  }
  return out;
}

/** 批量拉取快照，自动分片 + 并发。 */
export async function fetchSnapshots(stocks, { concurrency = 8, onProgress } = {}) {
  const CHUNK = 60;
  const map = new Map();
  // 过滤非法项，避免脏数据拼出坏 URL 导致整批失败
  const valid = stocks.filter((s) => s && typeof s.tencent === 'string' && s.tencent.length >= 8);
  if (!valid.length) return map;

  const chunks = [];
  for (let i = 0; i < valid.length; i += CHUNK) {
    chunks.push(valid.slice(i, i + CHUNK));
  }

  let done = 0;
  for (let g = 0; g < chunks.length; g += concurrency) {
    const group = chunks.slice(g, g + concurrency);
    await Promise.all(
      group.map(async (chunk) => {
        try {
          const codes = chunk.map((s) => s.tencent).join(',');
          const raw = await fetchText(API.SNAPSHOT + codes, { gbk: true, timeout: 15000 });
          for (const q of parseSnapshot(raw)) map.set(q.symbol, q);
        } catch (e) {
          console.warn('[snapshot] 批次失败', chunk.length, e);
        } finally {
          done += chunk.length;
          onProgress?.(done, valid.length);
        }
      })
    );
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* K 线                                                                */
/* ------------------------------------------------------------------ */

/** 解析前复权日 K。返回按日期升序的数组。 */
export function parseKLine(raw, stock) {
  let json;
  try { json = JSON.parse(raw); } catch { return []; }
  const node = json?.data?.[stock.tencent];
  if (!node) return [];

  const rows = node.qfqday || node.day;
  if (!Array.isArray(rows)) return [];

  const out = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 6) continue;
    // 日期必须是 YYYY-MM-DD。脏数据（如占位行 'bad-date'）若混进来，
    // 会让下面的字符串排序把整条时间序列排乱，进而算错所有技术指标。
    const date = String(r[0] || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const close = num(r[2]);
    if (close <= 0) continue;
    const high = num(r[3]);
    const low = num(r[4]);
    // OHLC 必须自洽（low ≤ open/close ≤ high），否则视为坏点。
    if (high <= 0 || low <= 0 || high < low) continue;
    out.push({
      date,
      open: num(r[1]),
      close,
      high,
      low,
      volume: num(r[5]) * 100, // 手 → 股
      amount: 0,
      turnoverRate: null,       // 由搜狐源回填
    });
  }
  // 同日重复行只保留最后一条（腾讯偶尔返回重复）
  const dedup = new Map();
  for (const b of out) dedup.set(b.date, b);
  return [...dedup.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * 拉取单只标的的日 K 线，按优先级在多个端点间降级。
 *
 * 腾讯的 fqkline 端点会被自家 WAF 间歇性拦截（HTTP 501 + JS 挑战页），
 * 单一端点会导致全市场筛选「加载完 K 线后无任何结果」。
 * 这里逐个尝试直到拿到有效数据，并记录各源健康度。
 */
export async function fetchKLine(stock, count = 320) {
  let lastErr = '';
  for (const src of KLINE_SOURCES) {
    try {
      const raw = await fetchText(src.build(stock.tencent, count), { timeout: 12000 });
      const bars = parseKLine(raw, stock);
      if (bars.length) {
        noteSource(src.name, true);
        return bars;
      }
      // 200 但解析不出数据。两种情况：
      //   1) WAF 返回 HTML 挑战页
      //   2) 腾讯对该标的没有 K 线数据（实测北交所 bj 全部返回 day:[]）
      lastErr = `${src.name}: 无 K 线数据`;
      noteSource(src.name, false, lastErr);
    } catch (e) {
      lastErr = `${src.name}: ${e?.message || e}`;
      noteSource(src.name, false, lastErr);
    }
  }
  throw new Error(lastErr || '所有 K 线源均不可用');
}

/**
 * 用当日换手率反推流通股本，为每根 K 线补上换手率。
 *
 * ## 为什么需要（2026-10-03 线上故障）
 * 筹码分布模型（业界通用做法）依赖**每日换手率**做筹码衰减：
 *   a = turnoverRate × decayFactor
 * 唯一提供历史换手率的搜狐 hisHq **没有 CORS 头**，需用户自建 Worker 代理，
 * 默认状态下 turnoverRate 全为 null → 筹码退化为无权重 → 集中度算不出
 * → 漏斗第 ⑤ 层 0 只通过 → 用户看到「筛选没结果」。
 *
 * ## 反推公式
 * 换手率(%) = 成交量(手) × 100 / 流通股本(股) × 100
 * ⇒ 流通股本 = 成交量(手) × 100 × 10000 / (换手率 × 100)
 *            = 成交量(手) × 10000 / 换手率
 *
 * 快照（qt.gtimg.cn）同时提供当日换手率与成交量，两者交叉即可定出股本，
 * 再回填到全部历史 K 线上。误差来自换手率只保留两位小数，
 * 对筹码分布（相对形态）影响可忽略。
 *
 * 另一种等价算法：直接用流通市值 ÷ 当日均价。用股本法更稳（均价需额外假设）。
 *
 * @param bars   K 线序列（会被就地修改）
 * @param quote  当日快照（需含 volume / turnoverRate / price）
 * @returns 补齐换手率的比例；无法推算返回 0
 */
export function inferTurnover(bars, quote) {
  if (!Array.isArray(bars) || !bars.length) return 0;
  if (!quote) return 0;

  const turnPct = quote.turnoverRate;   // 百分数，如 0.31 表示 0.31%
  const volHands = quote.volume / 100;  // 股 → 手
  if (!(turnPct > 0) || !(volHands > 0)) return 0;

  // 流通股本（股）= 成交量(手) × 100 × 100 / 换手率%
  const floatShares = (volHands * 100 * 100) / turnPct;
  if (!(floatShares > 0)) return 0;

  let filled = 0;
  for (const b of bars) {
    if (b.turnoverRate != null && b.turnoverRate > 0) { filled++; continue; }
    // b.volume 单位为股
    const pct = (b.volume / floatShares) * 100;
    if (pct > 0) {
      b.turnoverRate = Math.min(100, pct);
      filled++;
    }
  }
  return bars.length ? filled / bars.length : 0;
}

/** 批量 K 线（并发受限） */
export async function fetchKLines(stocks, { count = 320, concurrency = 8, onProgress, onError } = {}) {
  const map = new Map();
  let done = 0;
  let failed = 0;
  for (let g = 0; g < stocks.length; g += concurrency) {
    const group = stocks.slice(g, g + concurrency);
    await Promise.all(
      group.map(async (s) => {
        try {
          const k = await fetchKLine(s, count);
          if (k.length) map.set(s.symbol, k);
          else failed++;
        } catch (e) {
          failed++;
          onError?.(s, e);
        } finally {
          done++;
          onProgress?.(done, stocks.length);
        }
      })
    );
  }
  // 成功率过低时明确抛出，让上层提示用户而不是静默返回空结果。
  // 阈值 5%：正常情况下停牌/退市/新上市占比极低，超过说明数据源故障。
  if (stocks.length >= 50 && map.size / stocks.length < 0.95) {
    const pct = ((1 - map.size / stocks.length) * 100).toFixed(1);
    const err = klineHealth.lastError;
    throw new Error(
      `K 线数据获取失败率 ${pct}%（成功 ${map.size}/${stocks.length}）。` +
      `所有行情源当前均不可用${err ? '：' + err : ''}。请稍后重试。`
    );
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* 历史换手率（筹码峰模型必需）                                          */
/* ------------------------------------------------------------------ */

const SOHU_DAYS = 400;

/**
 * 拉取历史换手率。
 * 搜狐无 CORS 头 → 需配置代理；未配置时返回 null，筹码模型走降级路径。
 */
export async function fetchTurnover(stock) {
  const end = new Date();
  const start = new Date(end.getTime() - (SOHU_DAYS * 2 + 30) * 86400000);
  const url =
    `${API.SOHU}?code=cn_${stock.code}` +
    `&start=${ymd(start)}&end=${ymd(end)}&stat=1&order=A&period=d&rt=json`;

  try {
    const raw = await fetchText(withProxy(url), { gbk: true, timeout: 15000 });
    return parseSohu(raw);
  } catch {
    return null;
  }
}

export function parseSohu(raw) {
  let s = raw.trim();
  // 剥离 jsonp 包裹
  if (s.startsWith('callback') || s.startsWith('jsonp')) {
    const lp = s.indexOf('(');
    const rp = s.lastIndexOf(')');
    if (lp >= 0 && rp > lp) s = s.slice(lp + 1, rp);
  }
  let arr;
  try { arr = JSON.parse(s); } catch { return null; }
  if (!Array.isArray(arr) || !arr.length) return null;
  const hq = arr[0]?.hq;
  if (!Array.isArray(hq) || !hq.length) return null;

  const map = new Map();
  for (const row of hq) {
    if (!Array.isArray(row) || row.length < 10) continue;
    const d = String(row[0]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue; // 跳过表头行
    const close = pct(row[2]);
    if (close <= 0) continue;
    map.set(d, pct(row[9])); // 换手率 %
  }
  return map.size ? map : null;
}

/** 批量换手率 */
export async function fetchTurnovers(stocks, { concurrency = 5, onProgress } = {}) {
  const map = new Map();
  let done = 0;
  for (let g = 0; g < stocks.length; g += concurrency) {
    const group = stocks.slice(g, g + concurrency);
    await Promise.all(
      group.map(async (s) => {
        const t = await fetchTurnover(s);
        if (t) map.set(s.symbol, t);
        done++;
        onProgress?.(done, stocks.length);
      })
    );
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

function pct(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace('%', '').trim());
  return Number.isFinite(n) ? n : 0;
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseTime(s) {
  if (s && s.length >= 14) {
    return `${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`;
  }
  return '';
}

/** 计算 52 周价格分位（0~1） */
export function pos52w(q) {
  const span = q.high52w - q.low52w;
  if (span <= 0) return 0.5;
  return clamp((q.price - q.low52w) / span, 0, 1);
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
