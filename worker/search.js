/**
 * 股票搜索（服务端代理）
 * ==================================================================
 * 浏览器不能直连搜索接口：新浪 suggest3 与腾讯 smartbox 都不返回
 * Access-Control-Allow-Origin 头（实测确认）。
 *
 * 但前端与 Worker 同域，所以走服务端代理即可，天然无跨域问题。
 *
 * 数据源：新浪 suggest3（返回名称最完整，含 ST/退市最新状态），
 * 失败时回退腾讯 smartbox。
 *
 * 优点相比本地速查表：
 * - 覆盖全部 A 股（约 5400 只），不是 124 只
 * - 名称实时（ST / *ST / 退市状态会同步变化）
 * - 支持中文名、拼音首字母、代码前缀
 */

const SINA = 'https://suggest3.sinajs.cn/suggest/type=11,12&key=';
const TENCENT = 'https://smartbox.gtimg.cn/s3/?t=all&q=';

export async function searchStocks(keyword, { limit = 20, market = '' } = {}) {
  const kw = String(keyword || '').trim();
  if (!kw) return [];

  // 至少输入 1 个字符即可（纯数字自动按代码前缀搜）
  const out = await fromSina(kw, limit);
  if (out.length) return applyMarket(out, market, limit);

  const fb = await fromTencent(kw, limit);
  return applyMarket(fb, market, limit);
}

/* ------------------------------------------------------------------ */
/* 新浪 suggest3                                                       */
/* ------------------------------------------------------------------ */

/**
 * 响应形如：
 * var suggestvalue="sh600265,11,600265,sh600265,*ST景谷,,STJG,99,1,,,ST景谷";
 * 多条用 ; 分隔
 *
 * 编码坑：新浪返回 **GBK**，必须 arrayBuffer + TextDecoder('gb18030')。
 * 用 res.text() 会按 UTF-8 解码，中文名全部乱码（实测踩过）。
 */
async function fromSina(kw, limit) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(SINA + encodeURIComponent(kw), {
      headers: {
        // 新浪校验 Referer，缺失会返回空
        Referer: 'https://finance.sina.com.cn',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const buf = await res.arrayBuffer();
    return parseSina(decodeGbk(buf));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** GBK/GB18030 解码（新浪与腾讯都是 GBK） */
export function decodeGbk(buf) {
  try {
    return new TextDecoder('gb18030').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

export function parseSina(text) {
  const m = text.match(/suggestvalue="([^"]*)"/);
  if (!m || !m[1]) return [];

  const out = [];
  for (const row of m[1].split(';')) {
    const f = row.split(',');
    if (f.length < 7) continue;

    const symbol = (f[0] || '').trim();       // sh600265
    if (!/^(sh|sz|bj)\d{6}$/.test(symbol)) continue;

    // 字段布局（实测 2026-10-03）：
    //   0 symbol  1 type  2 code  3 symbol(重复)  4 名称  5 ?  6 拼音
    const name = (f[4] || '').trim();
    if (!name) continue;

    const code = symbol.slice(2);
    const market = symbol.slice(0, 2);

    out.push({
      symbol,
      code,
      market,
      tencent: symbol,
      name,
      pinyin: (f[6] || '').trim(),
    });
    if (out.length >= 30) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 腾讯 smartbox（回退）                                                */
/* ------------------------------------------------------------------ */

/**
 * 响应形如：
 * v_hint="sh~600265~*ST\u666f\u8c37~stjg~GP-A"
 * 中文做了 \uXXXX 转义
 */
async function fromTencent(kw, limit) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(TENCENT + encodeURIComponent(kw));
    if (!res.ok) return [];
    const buf = await res.arrayBuffer();
    return parseTencent(decodeGbk(buf));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function parseTencent(text) {
  const out = [];
  const re = /(sh|sz|bj)~(\d{6})~([^~\n"]+)~/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = unescapeUnicode(m[3].trim());
    if (!name) continue;
    const symbol = m[1] + m[2];
    out.push({
      symbol,
      code: m[2],
      market: m[1],
      tencent: symbol,
      name,
      pinyin: '',
    });
    if (out.length >= 30) break;
  }
  return out;
}

function unescapeUnicode(s) {
  if (!s.includes('\\u')) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i + 6 <= s.length && s[i] === '\\' && s[i + 1] === 'u') {
      const code = parseInt(s.slice(i + 2, i + 6), 16);
      if (Number.isFinite(code)) {
        out += String.fromCharCode(code);
        i += 5;
        continue;
      }
    }
    out += s[i];
  }
  return out;
}

/* ------------------------------------------------------------------ */

function applyMarket(list, market, limit) {
  const filtered = market ? list.filter((x) => x.market === market) : list;
  // 精确代码匹配排最前
  return filtered.sort((a, b) => {
    const ax = a.code === list[0]?.code ? 0 : 1;
    const bx = b.code === list[0]?.code ? 0 : 1;
    return ax - bx;
  }).slice(0, limit);
}
