/**
 * 搜索模块测试（含 GBK 编码回归）
 * 运行：node scripts/test-search.js
 *
 * 重点：新浪/腾讯都返回 GBK，若用 res.text()（按 UTF-8 解码）
 * 中文名会全部乱码。这里用真实 GBK 字节构造样本做回归。
 */

import { parseSina, parseTencent, decodeGbk } from '../worker/search.js';

let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

/* ---------- GBK 编码回归 ---------- */
console.log('\n[GBK 编码]');

/**
 * 构造真实 GBK 字节。
 * 字节取自 2026-10-03 实抓的新浪 suggest3 响应（key=002594）：
 *   var suggestvalue="sz002594,11,002594,sz002594,<GBK:比亚迪>,,,<GBK:比亚迪>,99,1,ESG,,;
 * 手工写 GBK 字节极易出错（曾把「亚」写成 0xC0FD），因此直接用实测值。
 */
const GBK = {
  '比亚迪': [0xB1, 0xC8, 0xD1, 0xC7, 0xB5, 0xCF],
  '宁德时代': [0xC4, 0xFE, 0xB5, 0xC2, 0xCA, 0xB1, 0xB4, 0xFA],
  '贵州茅台': [0xB9, 0xF3, 0xD6, 0xDD, 0xC3, 0xA9, 0xCC, 0xA8],
};

{
  const decoded = decodeGbk(new Uint8Array(GBK['比亚迪']).buffer);
  ok(decoded === '比亚迪', 'GBK 字节解码为「比亚迪」', `got=${decoded}`);
}

{
  const decoded = decodeGbk(new Uint8Array(GBK['宁德时代']).buffer);
  ok(decoded === '宁德时代', 'GBK 字节解码为「宁德时代」', `got=${decoded}`);
}

{
  const decoded = decodeGbk(new Uint8Array(GBK['贵州茅台']).buffer);
  ok(decoded === '贵州茅台', 'GBK 字节解码为「贵州茅台」', `got=${decoded}`);
}

{
  // 对照：UTF-8 解码 GBK 字节会出错（证明必须走 gb18030）
  const wrong = new TextDecoder('utf-8').decode(new Uint8Array(GBK['比亚迪']).buffer);
  ok(wrong !== '比亚迪', '对照：UTF-8 解码 GBK 确实会错', `wrong=${wrong}`);
}

/* ---------- 新浪解析 ---------- */
console.log('\n[新浪解析]');

{
  // 用真实响应结构（名称在索引 4，拼音在 6）
  const raw = 'var suggestvalue="sh600265,11,600265,sh600265,*ST景谷,,STJG,99,1,,,ST景谷;'
            + 'sz300750,11,300750,sz300750,宁德时代,,NDSN,99,1,,,宁德时代";';
  const r = parseSina(raw);
  ok(r.length === 2, '解析出 2 条', `got=${r.length}`);
  ok(r[0].name === '*ST景谷', 'ST 前缀名称正确（索引 4）', `got=${r[0].name}`);
  ok(r[0].pinyin === 'STJG', '拼音在索引 6', `got=${r[0].pinyin}`);
  ok(r[0].symbol === 'sh600265' && r[0].code === '600265', 'symbol/code 拆分');
  ok(r[1].name === '宁德时代', '第二条名称');
  ok(r.every((x) => x.market && x.tencent === x.symbol), 'market/tencent 字段完整');
}

{
  const r = parseSina('var suggestvalue="";');
  ok(r.length === 0, '空响应安全返回');
  ok(parseSina('garbage').length === 0, '非预期格式安全返回');
  ok(parseSina('var suggestvalue="sh600265,11";').length === 0, '字段不足时跳过');
}

/* ---------- 腾讯解析 ---------- */
console.log('\n[腾讯解析]');

{
  // 腾讯对中文做 \uXXXX 转义
  const raw = 'v_hint="sz~300750~\\u5b81\\u5fb7\\u65f6\\u4ee3~ndsd~GP-A'
            + '^sh~600519~\\u8d35\\u5dde\\u8305\\u53f0~gzmt~GP-A";';
  const r = parseTencent(raw);
  ok(r.length === 2, '解析出 2 条', `got=${r.length}`);
  ok(r[0].name === '宁德时代', 'Unicode 转义还原', `got=${r[0].name}`);
  ok(r[1].name === '贵州茅台', '第二条转义还原', `got=${r[1].name}`);
  ok(r[0].symbol === 'sz300750', 'symbol 正确');
}

{
  ok(parseTencent('v_hint="";').length === 0, '空响应安全返回');
  ok(parseTencent('').length === 0, '空字符串安全返回');
}

/* ---------- 结果 ---------- */
console.log(`\n${'='.repeat(46)}`);
console.log(`通过 ${pass} · 失败 ${fail} · 共 ${pass + fail}`);
console.log('='.repeat(46));
process.exit(fail > 0 ? 1 : 0);
