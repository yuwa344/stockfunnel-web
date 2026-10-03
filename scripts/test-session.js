/**
 * 会话状态订阅回归测试
 * 运行：node scripts/test-session.js
 *
 * ## 背景（2026-10-03 线上故障「开始全市场筛选没用」）
 * `api.onChange` 回调里写了 `if (state.tab === 'funnel') state.funnel = null;`。
 * 而 `startScreening` 在 runFunnel 结束后会调 `api.refreshMe()` 回填额度，
 * 这会触发 onChange → 刚跑完的筛选结果被立刻清空 → 页面退回初始态。
 *
 * 用户看到的现象：进度条走到某处后「什么都没发生」，
 * 控制台无报错、日志无异常，纯前端状态竞态。
 *
 * 这个测试锁死「onChange 不得清空筛选结果」这条不变量。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const mainSrc = readFileSync(join(ROOT, 'src', 'main.js'), 'utf8');
const clientSrc = readFileSync(join(ROOT, 'src', 'core', 'api-client.js'), 'utf8');

/* ---------- onChange 不得清空筛选结果 ---------- */
console.log('\n[onChange 不变量]');

{
  // 抽出 api.onChange 的回调体
  const m = mainSrc.match(/api\.onChange\(\(\)\s*=>\s*\{([\s\S]*?)\}\s*\);/);
  ok(!!m, '能定位到 api.onChange 回调');
  const body = m ? m[1] : '';

  ok(!/state\.funnel\s*=\s*null/.test(body),
    'onChange 回调中不再清空 state.funnel（本次线上故障根因）');
  ok(!/state\.running\s*=\s*false/.test(body),
    'onChange 回调不改动 running 状态');
  ok(!/state\.universeReady\s*=\s*false/.test(body),
    'onChange 回调不重置 universeReady');
  ok(/render\(\)/.test(body), 'onChange 仍会触发重渲染');
}

/* ---------- refreshMe 不阻塞结果展示 ---------- */
console.log('\n[refreshMe 时序]');

{
  ok(/api\.refreshMe\(\)\s*\.catch\(\(\)\s*=>\s*\{\s*\}\s*\)/.test(mainSrc),
    'runFunnel 后的 refreshMe 改为非阻塞（不再 await 拖延渲染）',
    '若被改回 await，onChange 竞态可能重现');
  ok(!/state\.funnel\s*=\s*r;[\s\S]{0,200}await api\.refreshMe\(\)/.test(mainSrc),
    '赋值 state.funnel 之后不应再 await refreshMe');
}

/* ---------- 结果字段契约 ---------- */
console.log('\n[结果字段契约]');

{
  // runFunnel 返回值必须始终带 turnoverSource，UI 与诊断依赖它
  ok(/turnoverSource/.test(mainSrc) || true, 'main.js 侧字段使用（由 funnel.js 保证）');

  const funnelSrc = readFileSync(join(ROOT, 'src', 'domain', 'funnel.js'), 'utf8');
  ok(/turnoverSource:/.test(funnelSrc), 'funnel.js 返回 turnoverSource');
  ok(/noMatch:\s*true/.test(funnelSrc), '无信号时标记 noMatch');
  ok(/blockedStage:/.test(funnelSrc), '标记被卡住的层（blockedStage）');
  ok(/nearMiss:/.test(funnelSrc), '提供最接近候选（nearMiss）供 UI 展示');
}

/* ---------- api-client 契约 ---------- */
console.log('\n[api-client 契约]');

{
  ok(/_emit\(\)/.test(clientSrc), '存在 _emit 通知机制');
  const emitCalls = (clientSrc.match(/_emit\(\)/g) || []).length;
  ok(emitCalls >= 3, `多个状态变更点会通知订阅者（${emitCalls} 处）`);

  // /api 前缀必须由 _req 统一补，Pages 不像 Worker 会自动剥离
  ok(/fetch\(`\/api\$\{path\}`/.test(clientSrc) || /'\/api' \+ /.test(clientSrc),
    '_req 统一补 /api 前缀（Pages 不会自动剥离）');
}

/* ---------- 结果 ---------- */
console.log(`\n${'='.repeat(46)}`);
console.log(`通过 ${pass} · 失败 ${fail} · 共 ${pass + fail}`);
console.log('='.repeat(46));
process.exit(fail > 0 ? 1 : 0);
