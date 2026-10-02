/**
 * 创建管理员账号脚本
 * ==================================================================
 * 用法：
 *   node scripts/create-admin.js <用户名> <密码>
 *
 * 会在本地 D1（.wrangler/state/v3/d1）创建用户并授予管理员权限。
 * 首次部署后需再次运行以授予 admin 权限。
 *
 * 注意：密码哈希算法必须与 worker/auth.js 完全一致
 *      （PBKDF2-SHA256 / 120000 迭代 / 16 字节盐 / base64）。
 */

import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';

const ITERATIONS = 120000;
const KEY_LEN = 32;
const SALT_LEN = 16;

function hashPassword(password) {
  const salt = randomBytes(SALT_LEN);
  const key = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, 'sha256');
  return `${ITERATIONS}$${salt.toString('base64')}$${key.toString('base64')}`;
}

const [, , username, password] = process.argv;

if (!username || !password) {
  console.error('用法: node scripts/create-admin.js <用户名> <密码>');
  process.exit(1);
}

if (!/^[A-Za-z0-9_\u4e00-\u9fa5]{3,20}$/.test(username)) {
  console.error('用户名需 3-20 位，支持中英文/数字/下划线');
  process.exit(1);
}

if (password.length < 6) {
  console.error('密码至少 6 位');
  process.exit(1);
}

const hash = hashPassword(password);

console.log(JSON.stringify({
  username,
  password_hash: hash,
  is_admin: 1,
  is_vip: 1,
  note: '把上面的值用于 wrangler d1 execute 插入，或在生产库执行：',
  sql:
    `INSERT INTO users (username, password_hash, is_admin, is_vip) `
    + `VALUES ('${username}', '${hash}', 1, 1) ON CONFLICT(username) `
    + `DO UPDATE SET password_hash=excluded.password_hash, is_admin=1, is_vip=1;`,
}, null, 2));
