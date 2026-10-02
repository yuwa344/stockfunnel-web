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
  KLINE: 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get',
  SEARCH: 'https://smartbox.gtimg.cn/s3/',
  SOHU: 'https://q.stock.sohu.com/hisHq',
};

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
    const close = num(r[2]);
    if (close <= 0) continue;
    out.push({
      date: r[0],
      open: num(r[1]),
      close,
      high: num(r[3]),
      low: num(r[4]),
      volume: num(r[5]) * 100, // 手 → 股
      amount: 0,
      turnoverRate: null,       // 由搜狐源回填
    });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

export async function fetchKLine(stock, count = 320) {
  const url = `${API.KLINE}?param=${stock.tencent},day,,,${count},qfq`;
  const raw = await fetchText(url, { timeout: 15000 });
  return parseKLine(raw, stock);
}

/** 批量 K 线（并发受限） */
export async function fetchKLines(stocks, { count = 320, concurrency = 8, onProgress, onError } = {}) {
  const map = new Map();
  let done = 0;
  for (let g = 0; g < stocks.length; g += concurrency) {
    const group = stocks.slice(g, g + concurrency);
    await Promise.all(
      group.map(async (s) => {
        try {
          const k = await fetchKLine(s, count);
          if (k.length) map.set(s.symbol, k);
        } catch (e) {
          onError?.(s, e);
        } finally {
          done++;
          onProgress?.(done, stocks.length);
        }
      })
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
