/**
 * K 线数据源降级测试
 * 运行：node scripts/test-kline.js
 *
 * ## 背景（2026-10-03 线上故障）
 * 用户反馈「开始全市场筛选没用」：进度条走到 83% 后页面静默退回初始状态，
 * 控制台无任何报错。根因是腾讯 `fqkline` 端点被自家 WAF 拦截，
 * 返回 HTTP 501 + `waf.tencent.com` 的 JS 挑战页：
 *
 *   <!DOCTYPE html><html><head><script>var i=location.href;...
 *   window.location.href="https://waf.tencent.com/501page.html?u="+...
 *
 * 该端点返回 200 之外的状态码时 `fetch` 抛错，K 线全部拉取失败，
 * 趋势层 0 只通过 → runFunnel 提前返回空结果 → UI 看起来「什么都没发生」。
 *
 * 修复：多端点按优先级降级 + 失败率超阈值时显式抛错（不再静默）。
 */

import { parseKLine, inferTurnover, klineHealth, API } from '../src/data/api.js';

let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const STOCK = { code: '600519', market: 'sh', tencent: 'sh600519', symbol: 'sh600519', name: '贵州茅台' };

/* ---------- 真实响应样本（2026-10-03 实抓） ---------- */
console.log('\n[真实响应解析]');

const QQ_QFQ = JSON.stringify({
  code: 0, msg: '',
  data: { sh600519: { qfqday: [
    ['2026-09-28', '1236.000', '1243.880', '1244.010', '1228.100', '28218.000'],
    ['2026-09-29', '1244.600', '1235.580', '1245.870', '1230.880', '26366.000'],
    ['2026-09-30', '1239.530', '1258.620', '1268.000', '1236.050', '38331.000'],
  ] } },
});

const IZHQ_RAW = JSON.stringify({
  code: 0, msg: '',
  data: { sh600519: { day: [
    ['2026-09-28', '1236.000', '1243.880', '1244.010', '1228.100', '28218.000'],
    ['2026-09-30', '1239.530', '1258.620', '1268.000', '1236.050', '38331.000'],
  ] } },
});

// 腾讯 WAF 挑战页：状态码可能是 200，也可能 501。两种都要能被识别为无效。
const WAF_CHALLENGE = '<!DOCTYPE html><html><head><script>var i=location.href;'
  + 'var v=window.btoa?window.btoa(window.encodeURIComponent(i)):"";'
  + 'window.location.href="https://waf.tencent.com/501page.html?u="+location.origin'
  + '&id=fc8794684b4334617da4ae9850c39f23-1782976637514558-425-139768697235200'
  + '-19963252672253302&st=03&v="+v;</script></head></html>';

/* ---------- parseKLine ---------- */
{
  const r = parseKLine(QQ_QFQ, STOCK);
  ok(r.length === 3, '前复权源（qfqday）解析出 3 根');
  ok(r[2].close === 1258.62, '收盘价正确', `got=${r[2].close}`);
  ok(r[2].high === 1268 && r[2].low === 1236.05, '最高/最低正确');
  ok(r[2].volume === 38331 * 100, '成交量 手→股 换算正确', `got=${r[2].volume}`);
}
{
  const r = parseKLine(IZHQ_RAW, STOCK);
  ok(r.length === 2, '不复权源（day key）也能解析 —— 降级链末位依赖此兼容');
  ok(r[1].close === 1258.62, '不复权源价格正确');
}
{
  const r = parseKLine(WAF_CHALLENGE, STOCK);
  ok(r.length === 0, 'WAF 挑战页解析为空数组（触发降级而非误当有效数据）');
}
{
  ok(parseKLine('', STOCK).length === 0, '空响应安全');
  ok(parseKLine('not json', STOCK).length === 0, '非 JSON 安全');
  ok(parseKLine('{"code":0,"data":{}}', STOCK).length === 0, '无该标的节点安全');
  ok(parseKLine(JSON.stringify({ data: { sh600519: { qfqday: 'x' } } }), STOCK).length === 0,
    'rows 非数组安全');
}
{
  // 脏数据：字段不足 / 日期非法 / 价格为 0 / OHLC 不自洽（high<low），都应被过滤
  const dirty = JSON.stringify({
    data: { sh600519: { qfqday: [
      ['2026-09-25', '1', '2'],                                   // 字段不足
      ['bad-date', '1', '2', '3', '1', '5'],                       // 日期非法
      ['2026-09-26', '1', '0', '3', '1', '5'],                      // 收盘价 0
      ['2026-09-27', '1', '2', '3', '9', '5'],                      // high<low 不自洽
      ['2026-09-28', '10', '11', '12', '9', '5'],                   // 正常
      ['2026-09-29', '11', '12', '13', '10', '5'],                  // 正常
    ] } },
  });
  const r = parseKLine(dirty, STOCK);
  ok(r.length === 2, '脏数据行被正确过滤（仅保留 2 根有效）', `len=${r.length}`);
  ok(r.every((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.date)), '无非法日期残留');
  ok(r.every((b) => b.high >= b.low), '无 OHLC 不自洽数据');
}
{
  // 同日重复行只保留最后一条
  const dup = JSON.stringify({
    data: { sh600519: { qfqday: [
      ['2026-09-30', '10', '11', '12', '9', '5'],
      ['2026-09-30', '10', '99', '12', '9', '5'],
    ] } },
  });
  const r = parseKLine(dup, STOCK);
  ok(r.length === 1 && r[0].close === 99, '同日重复行去重，保留最后一条', `len=${r.length} close=${r[0]?.close}`);
}

/* ---------- 排序 ---------- */
{
  const unsorted = JSON.stringify({
    data: { sh600519: { qfqday: [
      ['2026-09-30', '1', '3', '3', '1', '5'],
      ['2026-09-28', '1', '1', '3', '1', '5'],
      ['2026-09-29', '1', '2', '3', '1', '5'],
    ] } },
  });
  const r = parseKLine(unsorted, STOCK);
  ok(r[0].date === '2026-09-28' && r[2].date === '2026-09-30', '按日期升序排序');
}

/* ---------- 降级链配置 ---------- */
console.log('\n[降级链]');

{
  // API.KLINE 单例已被移除（单端点会导致整批失败）
  ok(!('KLINE' in API), 'API 不再暴露单例 KLINE 端点（强制走降级链）');
  ok(!!API.SNAPSHOT && !!API.SEARCH, '其他端点常量保持不变');
}
{
  const h = klineHealth.bySource;
  ok(typeof h === 'object' && h !== null, 'klineHealth 可导出用于诊断');
}

/* ---------- 换手率反推 ---------- */
console.log('\n[换手率反推]');

{
  // 真实数据：贵州茅台 2026-09-30
  //   成交量 38331 手 = 3,833,100 股
  //   换手率 0.31%
  //   ⇒ 流通股本 = 3,833,100 / 0.0031 = 1,236,483,871 股（约 12.36 亿股）
  const bars = [
    { date: '2026-09-28', volume: 28218 * 100, turnoverRate: null },
    { date: '2026-09-29', volume: 26366 * 100, turnoverRate: null },
    { date: '2026-09-30', volume: 38331 * 100, turnoverRate: null },
  ];
  const quote = { volume: 38331 * 100, turnoverRate: 0.31, price: 1258.62 };
  const ratio = inferTurnover(bars, quote);
  ok(ratio === 1, '全部 K 线换手率已填充', `ratio=${ratio}`);

  // 反推股本 = vol(手) × 10000 / turn(%) = 38331 × 10000 / 0.31
  const floatShares = (38331 * 10000) / 0.31;
  const expectLast = (38331 * 100 / floatShares) * 100;
  ok(Math.abs(bars[2].turnoverRate - 0.31) < 0.005,
    '最后一日换手率应还原为快照值 0.31%', `got=${bars[2].turnoverRate.toFixed(4)}`);
  ok(expectLast < 0.32, '反推公式自洽', `expect=${expectLast.toFixed(4)}`);
  ok(bars[0].turnoverRate < bars[2].turnoverRate,
    '缩量日换手率低于放量日', `${bars[0].turnoverRate.toFixed(3)} < ${bars[2].turnoverRate.toFixed(3)}`);
}
{
  const bars = [{ date: '2026-09-30', volume: 1e6, turnoverRate: null }];
  ok(inferTurnover(bars, null) === 0 && bars[0].turnoverRate === null,
    '无快照时不猜测，保持 null');
  ok(inferTurnover(bars, { volume: 1e6, turnoverRate: 0 }) === 0,
    '换手率为 0（停牌）时返回 0');
  ok(inferTurnover(bars, { volume: 0, turnoverRate: 1.5 }) === 0,
    '成交量为 0 时返回 0');
  ok(inferTurnover([], { volume: 1, turnoverRate: 1 }) === 0, '空数组安全');
}
{
  // 已有换手率时不应被覆盖（搜狐代理优先）
  const bars = [{ date: 'x', volume: 1e6, turnoverRate: 3.33 }];
  inferTurnover(bars, { volume: 1e6, turnoverRate: 0.31 });
  ok(bars[0].turnoverRate === 3.33, '已有真实换手率不被推算值覆盖');
}

/* ---------- 结果 ---------- */
console.log(`\n${'='.repeat(46)}`);
console.log(`通过 ${pass} · 失败 ${fail} · 共 ${pass + fail}`);
console.log('='.repeat(46));
process.exit(fail > 0 ? 1 : 0);
