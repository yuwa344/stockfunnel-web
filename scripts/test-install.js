/**
 * iOS 描述文件（.mobileconfig）结构测试
 * 运行：node scripts/test-install.js
 *
 * 背景：iOS 报「必填字段 url 缺失」——
 * 原实现的 PayloadContent 里嵌了 {URL, WebClip:{...}} 两层结构，
 * 且图标写成空的 <data></data>，iOS 校验直接拒绝。
 * 本测试锁定正确结构，防止回归。
 */

import { buildMobileConfig, detectPlatform } from '../src/core/install.js';

let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

/* ---------- 基本结构 ---------- */
console.log('\n[结构]');

const xml = buildMobileConfig({
  url: 'https://stockfunnel.pages.dev/',
  label: '六层漏斗选股',
});

ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'XML 声明');
ok(xml.includes('<!DOCTYPE plist PUBLIC'), 'DOCTYPE 声明');
ok(xml.trimEnd().endsWith('</plist>'), 'plist 闭合');
ok(xml.includes('<key>PayloadType</key>\n      <string>com.apple.webClip.managed</string>'), 'WebClip payload 类型');
ok(xml.includes('<key>PayloadType</key>\n  <string>Configuration</string>'), '顶层 Configuration 类型');

/* ---------- 关键：URL 必须是 PayloadContent 的直接子键 ---------- */
console.log('\n[URL 字段（报错根因）]');

{
  // 提取 WebClip payload 的 PayloadContent 块
  const m = xml.match(/<key>PayloadContent<\/key>\s*<dict>([\s\S]*?)<\/dict>/);
  ok(!!m, '找到 WebClip 的 PayloadContent 字典');
  const block = m ? m[1] : '';

  ok(/<key>URL<\/key>\s*<string>https:\/\/stockfunnel\.pages\.dev\/<\/string>/.test(block),
    'URL 是 PayloadContent 的直接子键', `\n${block.slice(0, 120)}`);
  ok(/<key>Label<\/key>/.test(block), 'Label 存在');
  ok(!/<key>WebClip<\/key>/.test(xml), '不再有多余的 WebClip 嵌套层');
  ok(!/<data><\/data>/.test(xml), '没有空的 <data></data>（会让 iOS 校验失败）');
}

/* ---------- 免信任安装 ---------- */
console.log('\n[安装体验]');

ok(/<key>PayloadScope<\/key>\s*<string>System<\/string>/.test(xml),
  'PayloadScope=System（免信任安装）');
ok(/<key>IsRemovable<\/key>\s*<false\/>/.test(xml), 'IsRemovable=false');
ok(/<key>IgnoreCertificate<\/key>\s*<true\/>/.test(xml), 'IgnoreCertificate=true');

/* ---------- UUID 合法性 ---------- */
console.log('\n[标识符]');

{
  const uuids = [...xml.matchAll(/<key>PayloadUUID<\/key>\s*<string>([^<]+)<\/string>/g)]
    .map((m) => m[1]);
  ok(uuids.length === 2, '两个 PayloadUUID（内层 + 外层）', `got=${uuids.length}`);
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  ok(uuids.every((u) => uuidRe.test(u)), 'UUID 符合 v4 格式', uuids.join(' '));
  ok(new Set(uuids).size === 2, '两个 UUID 互不相同');
}

/* ---------- URL 规范化 ---------- */
console.log('\n[URL 规范化]');

{
  ok(/<string>https:\/\/stockfunnel\.pages\.dev<\/string>/.test(
    buildMobileConfig({ url: 'stockfunnel.pages.dev' })), '缺协议时补 https://');
  ok(!/127\.0\.0\.1/.test(
    buildMobileConfig({ url: '' })), '空 URL 回退到线上地址');
  ok(/&amp;/.test(buildMobileConfig({ url: 'https://x.dev/?a=1&b=2' })), 'URL 中的 & 被转义');
}

/* ---------- 图标（有/无两种） ---------- */
console.log('\n[图标]');

{
  const withIcon = buildMobileConfig({
    url: 'https://x.dev/',
    iconBase64: 'iVBORw0KGgoAAAANSUhEUg',
  });
  ok(/<key>IconData<\/key>\s*<data>iVBORw0KGgoAAAANSUhEUg<\/data>/.test(withIcon),
    'IconData 存在且为裸 base64');
  ok(!/^data:/.test(withIcon.split('<key>IconData</key>')[1]), 'IconData 不含 data: 前缀');

  const noIcon = buildMobileConfig({ url: 'https://x.dev/', iconBase64: '' });
  ok(!/IconData/.test(noIcon), '无图标时省略 IconData 键（而非写空 data）');
}

/* ---------- 平台检测不崩溃 ---------- */
console.log('\n[平台检测]');

{
  const p = detectPlatform();
  ok(typeof p.isIOS === 'boolean', 'isIOS 为布尔');
  ok(typeof p.standalone === 'boolean', 'standalone 为布尔');
}

console.log(`\n${'='.repeat(46)}`);
console.log(`通过 ${pass} · 失败 ${fail} · 共 ${pass + fail}`);
console.log('='.repeat(46));
process.exit(fail > 0 ? 1 : 0);
