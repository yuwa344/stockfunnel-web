/**
 * 鉴权模块
 * ==================================================================
 * - 密码：PBKDF2-SHA256，120,000 次迭代，16 字节随机盐（WebCrypto）
 * - 会话：32 字节随机 token 存 D1 sessions 表，服务端可撤销
 * - 鉴权：Bearer token → 查会话 → 查用户 → 检查封禁/VIP 有效期
 *
 * 为什么用服务端会话而非 JWT：
 *   封禁用户 / 强制下线 / 调整会员到期时间需要**立即生效**，
 *   JWT 无状态做不到，除非每次都查库（那就失去无状态的意义了）。
 */

const ITERATIONS = 120000;
const KEY_LEN = 32;
const SALT_LEN = 16;
const SESSION_DAYS = 30;

/* ------------------------------------------------------------------ */
/* 密码                                                                */
/* ------------------------------------------------------------------ */

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const key = await pbkdf2(password, salt, ITERATIONS);
  return `${ITERATIONS}$${b64(salt)}$${b64(key)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [iterStr, saltB64, hashB64] = String(stored).split('$');
    if (!iterStr || !saltB64 || !hashB64) return false;
    const iterations = parseInt(iterStr, 10);
    const salt = unb64(saltB64);
    const expected = unb64(hashB64);
    const actual = await pbkdf2(password, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function pbkdf2(password, salt, iterations) {
  const pwKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    pwKey,
    KEY_LEN * 8
  );
  return new Uint8Array(bits);
}

/** 常量时间比较，避免时序侧信道 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* ------------------------------------------------------------------ */
/* Base64（Workers 环境无 Buffer）                                       */
/* ------------------------------------------------------------------ */

export function b64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randToken() {
  return b64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ------------------------------------------------------------------ */
/* 会话                                                                */
/* ------------------------------------------------------------------ */

export class Auth {
  constructor(env) {
    this.env = env;
  }

  /** 注册。返回 { user } 或抛 { status, error } */
  async register(username, password, req) {
    const name = String(username || '').trim();
    if (!/^[A-Za-z0-9_\u4e00-\u9fa5]{3,20}$/.test(name)) {
      throw httpErr(400, 'invalid_username', '用户名需 3-20 位，支持中英文/数字/下划线');
    }
    if (String(password || '').length < 6) {
      throw httpErr(400, 'weak_password', '密码至少 6 位');
    }
    if (String(password || '').length > 128) {
      throw httpErr(400, 'password_too_long', '密码过长');
    }

    const exist = await this.env.DB.prepare(
      'SELECT id FROM users WHERE username = ?'
    ).bind(name).first();
    if (exist) {
      throw httpErr(409, 'username_taken', '该用户名已被注册');
    }

    const hash = await hashPassword(password);
    const res = await this.env.DB.prepare(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)'
    ).bind(name, hash).run();

    await this.log(res.lastInsertRowId, name, 'register', req);
    return this.login(username, password, req);
  }

  /** 登录。返回 { user, token } */
  async login(username, password, req) {
    const name = String(username || '').trim();
    const row = await this.env.DB.prepare(
      'SELECT * FROM users WHERE username = ?'
    ).bind(name).first();

    if (!row) {
      await this.log(null, name, 'login_fail', req);
      // 不区分「用户不存在」与「密码错误」，避免用户名枚举
      throw httpErr(401, 'bad_credentials', '用户名或密码错误');
    }
    if (row.is_banned) {
      throw httpErr(403, 'banned', '账号已被封禁，请联系管理员');
    }

    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) {
      await this.log(row.id, name, 'login_fail', req);
      throw httpErr(401, 'bad_credentials', '用户名或密码错误');
    }

    const token = randToken();
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    await this.env.DB.batch([
      this.env.DB.prepare(
        'INSERT INTO sessions (token, user_id, user_agent, expires_at) VALUES (?, ?, ?, ?)'
      ).bind(token, row.id, req.headers.get('User-Agent') || '', expires),
      this.env.DB.prepare(
        'UPDATE users SET last_login = datetime(\'now\') WHERE id = ?'
      ).bind(row.id),
      // 清理过期会话
      this.env.DB.prepare(
        'DELETE FROM sessions WHERE expires_at < datetime(\'now\')'
      ),
    ]);

    await this.log(row.id, name, 'login', req);
    return { user: publicUser(row), token, expiresAt: expires };
  }

  async logout(req) {
    const token = bearer(req);
    if (token) {
      await this.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    }
    return { ok: true };
  }

  /**
   * 从请求解析当前用户。
   * 返回 null（未登录）或 { id, username, isVip, isAdmin, tier }
   */
  async user(req) {
    const token = bearer(req);
    if (!token) return null;

    const row = await this.env.DB.prepare(
      `SELECT u.*, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > datetime('now')`
    ).bind(token).first();

    if (!row) return null;
    if (row.is_banned) return null;

    const isVip = isVipActive(row);
    return {
      id: row.id,
      username: row.username,
      isVip,
      isAdmin: !!row.is_admin,
      isBanned: !!row.is_banned,
      vipExpires: row.vip_expires,
      tier: isVip ? 'vip' : 'free',
      sessionExpires: row.expires_at,
    };
  }

  /** 写审计日志 */
  async log(userId, username, action, req) {
    try {
      await this.env.DB.prepare(
        'INSERT INTO auth_log (user_id, username, action, ip, user_agent) VALUES (?, ?, ?, ?, ?)'
      ).bind(
        userId ?? null,
        username ?? null,
        action,
        req.headers.get('CF-Connecting-IP') || '',
        (req.headers.get('User-Agent') || '').slice(0, 300)
      ).run();
    } catch (e) {
      console.warn('[auth-log]', e);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 会员判定                                                            */
/* ------------------------------------------------------------------ */

export function isVipActive(user) {
  if (user.is_admin) return true;          // 管理员天然 VIP
  if (!user.is_vip) return false;
  if (!user.vip_expires) return true;       // NULL = 永久
  return new Date(user.vip_expires).getTime() > Date.now();
}

export function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    isVip: isVipActive(row),
    isAdmin: !!row.is_admin,
    vipExpires: row.vip_expires,
    createdAt: row.created_at,
  };
}

/* ------------------------------------------------------------------ */

export function bearer(req) {
  const h = req.headers.get('Authorization') || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

export function httpErr(status, code, message) {
  const e = new Error(message || code);
  e.status = status;
  e.code = code;
  return e;
}

export { randToken };
