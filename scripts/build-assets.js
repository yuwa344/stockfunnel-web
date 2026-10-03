/**
 * 构建静态资源目录。
 *
 * Cloudflare Workers 的 assets 目录不能包含 node_modules
 * （里面有 92 MB 的 workerd.exe，超过 25 MiB 上限）。
 * 所以把需要的前端文件复制到干净的 public/ 目录。
 *
 * 用法：node scripts/build-assets.js
 */

import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public');

/** 需要复制的文件 / 目录 */
const INCLUDE = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'src',
  'assets',
];

async function copyIfExists(name) {
  const from = path.join(ROOT, name);
  if (!existsSync(from)) {
    console.warn(`  skip  ${name}  (not found)`);
    return false;
  }
  const to = path.join(OUT, name);
  await cp(from, to, { recursive: true });
  const s = await stat(to);
  console.log(`  copy  ${name}${s.isDirectory() ? '/' : ''}`);
  return true;
}

async function dirSize(dir) {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else total += (await stat(p)).size;
  }
  return total;
}

async function main() {
  console.log('Building static assets -> public/\n');

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  for (const name of INCLUDE) {
    await copyIfExists(name);
  }

  // 校验：不能包含后端源码与数据库脚本
  const forbidden = ['worker', 'workers', 'node_modules', 'schema.sql', 'wrangler.toml', '.git'];
  const entries = await readdir(OUT);
  const bad = entries.filter((e) => forbidden.includes(e));
  if (bad.length) {
    console.error(`\nERROR: unexpected entries in public/: ${bad.join(', ')}`);
    process.exit(1);
  }

  const size = await dirSize(OUT);
  const mb = (size / 1024 / 1024).toFixed(2);
  console.log(`\nDone. ${entries.length} entries, ${mb} MiB`);
  if (size > 25 * 1024 * 1024) {
    console.error('WARNING: exceeds the 25 MiB Workers asset limit');
    process.exit(1);
  }
  console.log('Now run:  npx wrangler deploy');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
