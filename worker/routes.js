/**
 * API 路由
 * ==================================================================
 * 会员门控策略：
 *
 *   游客（未登录）
 *     ├─ 行情 / K线 / 搜索       → 允许（有限频流）
 *     └─ 六层漏斗筛选           → 拒绝，引导注册
 *
 *   免费用户（free）
 *     ├─ 基础分析               → 允许（每日 N 次额度）
 *     │    · 单只股票技术面（趋势/动量/RS）
 *     │    · 简化筛选（仅第 1 层趋势）
 *     └─ 高级分析               → 拒绝，引导升级 VIP
 *          · 全市场六层漏斗
 *          · 筹码分布计算
 *          · 枢轴突破信号
 *
 *   VIP 用户
 *     ├─ 全部基础功能           → 允许
 *     └─ 全部高级功能           → 允许（额度更高）
 *
 *   管理员
 *     └─ /api/admin/*           → 允许
 */

import { Auth, isVipActive, httpErr, publicUser } from './auth.js';
import { searchStocks } from './search.js';

const FREE_DAILY_LIMIT = 3;
const VIP_DAILY_LIMIT = 50;

export const Api = {
  async handle(req, env, url) {
    const auth = new Auth(env);
    const path = url.pathname.replace(/^\/api/, '') || '/';

    try {
      // ---------- 公开 ----------
      if (path === '/health') {
        return json({ ok: true, ts: Date.now() });
      }

      // 股票搜索：服务端代理（新浪/腾讯均无 CORS 头，浏览器无法直连）
      if (path === '/search' && req.method === 'GET') {
        const q = url.searchParams.get('q') || '';
        const limit = Math.min(30, parseInt(url.searchParams.get('limit') || '20', 10));
        const market = url.searchParams.get('market') || '';
        const items = await searchStocks(q, { limit, market });
        return json({ items, query: q, source: 'sina+tencent' });
      }

      if (path === '/auth/register' && req.method === 'POST') {
        const { username, password } = await readJson(req);
        const r = await auth.register(username, password, req);
        return json(r, 201);
      }

      if (path === '/auth/login' && req.method === 'POST') {
        const { username, password } = await readJson(req);
        const r = await auth.login(username, password, req);
        return json(r);
      }

      if (path === '/auth/logout' && req.method === 'POST') {
        return json(await auth.logout(req));
      }

      // ---------- 需登录 ----------
      const me = await auth.user(req);

      if (path === '/me' && req.method === 'GET') {
        if (!me) return json({ user: null, tier: 'guest' });
        const counts = await usageToday(env, me.id);
        return json({
          user: {
            id: me.id,
            username: me.username,
            isVip: me.isVip,
            isAdmin: me.isAdmin,
            vipExpires: me.vipExpires,
            tier: me.tier,
          },
          quota: quotaOf(me, counts),
        });
      }

      if (!me) {
        throw httpErr(401, 'unauthorized', '请先登录');
      }

      // ---------- 自选 ----------
      if (path === '/watchlist') {
        if (req.method === 'GET') return json({ items: await listWatchlist(env, me.id) });
        if (req.method === 'POST') {
          const { symbol, name } = await readJson(req);
          if (!/^(sh|sz|bj)\d{6}$/.test(symbol || '')) {
            throw httpErr(400, 'bad_symbol', '代码格式不正确');
          }
          await env.DB.prepare(
            `INSERT INTO watchlist (user_id, symbol, name, sort_order)
             VALUES (?, ?, ?, COALESCE((SELECT MAX(sort_order)+1 FROM watchlist WHERE user_id=?), 0))
             ON CONFLICT(user_id, symbol) DO UPDATE SET name = excluded.name`
          ).bind(me.id, symbol, name || '', me.id).run();
          return json({ items: await listWatchlist(env, me.id) });
        }
        if (req.method === 'DELETE') {
          const sym = url.searchParams.get('symbol') || bodySymbol(req);
          if (!sym) throw httpErr(400, 'bad_symbol', '缺少 symbol');
          await env.DB.prepare(
            'DELETE FROM watchlist WHERE user_id = ? AND symbol = ?'
          ).bind(me.id, sym).run();
          return json({ items: await listWatchlist(env, me.id) });
        }
      }

      if (path === '/watchlist/sync' && req.method === 'POST') {
        // 首次登录时把本地自选同步到云端
        const { items } = await readJson(req);
        if (!Array.isArray(items)) throw httpErr(400, 'bad_payload', 'items 必须为数组');
        const cleaned = items
          .filter((x) => x && /^(sh|sz|bj)\d{6}$/.test(x.symbol || ''))
          .slice(0, 200)
          .map((x, i) => ({ symbol: x.symbol, name: String(x.name || '').slice(0, 30), i }));
        if (cleaned.length) {
          await env.DB.batch(cleaned.map((x) => env.DB.prepare(
            `INSERT INTO watchlist (user_id, symbol, name, sort_order)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, symbol) DO UPDATE SET name = excluded.name`
          ).bind(me.id, x.symbol, x.name, x.i)));
        }
        return json({ items: await listWatchlist(env, me.id) });
      }

      // ---------- 筛选：会员门控 ----------
      if (path === '/screen' && req.method === 'POST') {
        const { tier = 'advanced', config = {}, result = {} } = await readJson(req);

        // VIP 才能用高级漏斗
        if (tier === 'advanced' && !me.isVip) {
          throw httpErr(402, 'vip_required',
            '六层漏斗高级分析为 VIP 功能，请升级会员后使用');
        }

        // 额度校验
        const counts = await usageToday(env, me.id);
        const limit = me.isVip ? VIP_DAILY_LIMIT : FREE_DAILY_LIMIT;
        if (counts >= limit) {
          throw httpErr(429, 'quota_exceeded',
            me.isVip ? '今日筛选次数已达上限' : `免费版每日 ${limit} 次，已用完，请升级 VIP`);
        }
        await env.DB.prepare(
          `INSERT INTO usage_daily (user_id, day, screen_count) VALUES (?, ?, 1)
           ON CONFLICT(user_id, day) DO UPDATE SET screen_count = screen_count + 1`
        ).bind(me.id, today()).run();

        // 落库筛选记录
        const stageCounts = JSON.stringify(result.stageCounts || []);
        await env.DB.prepare(
          `INSERT INTO screen_runs (user_id, tier, config_json, universe, stage_counts, signal_count)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          me.id, tier,
          JSON.stringify(config).slice(0, 4000),
          result.universe || 0,
          stageCounts,
          result.signalCount || 0
        ).run();

        const newCounts = counts + 1;
        return json({
          ok: true,
          quota: quotaOf(me, newCounts),
          // 实际筛选在客户端完成（数据在浏览器直连行情源，避免服务器成为瓶颈）
          // 服务端只负责鉴权、额度与审计
        });
      }

      if (path === '/screen/history' && req.method === 'GET') {
        const rows = await env.DB.prepare(
          `SELECT id, tier, universe, stage_counts, signal_count, created_at
             FROM screen_runs WHERE user_id = ?
            ORDER BY id DESC LIMIT 20`
        ).bind(me.id).all();
        return json({
          items: (rows.results || []).map((r) => ({
            id: r.id,
            tier: r.tier,
            universe: r.universe,
            stageCounts: safeParse(r.stage_counts, []),
            signalCount: r.signal_count,
            createdAt: r.created_at,
          })),
        });
      }

      // ---------- 会员信息 ----------
      if (path === '/vip/info' && req.method === 'GET') {
        return json({
          tiers: TIERS,
          current: me.tier,
          expires: me.vipExpires,
        });
      }

      // ---------- Admin ----------
      if (path.startsWith('/admin/')) {
        if (!me.isAdmin) {
          throw httpErr(403, 'admin_required', '需要管理员权限');
        }
        return adminRoutes(req, env, me, path, url);
      }

      throw httpErr(404, 'not_found', `未知接口 ${path}`);
    } catch (e) {
      const status = e.status || 500;
      const code = e.code || 'internal_error';
      if (status >= 500) console.error('[route]', path, e);
      return json({ error: code, message: e.message || '服务器内部错误' }, status);
    }
  },
};

/* ================================================================== */
/* Admin 后台                                                          */
/* ================================================================== */

async function adminRoutes(req, env, me, path, url) {
  // 用户列表
  if (path === '/admin/users' && req.method === 'GET') {
    const q = url.searchParams.get('q') || '';
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const size = Math.min(100, parseInt(url.searchParams.get('size') || '30', 10));
    const offset = (page - 1) * size;

    let rows, total;
    if (q) {
      const like = `%${q}%`;
      total = await env.DB.prepare(
        'SELECT COUNT(*) c FROM users WHERE username LIKE ?'
      ).bind(like).first();
      rows = await env.DB.prepare(
        `SELECT u.*,
                (SELECT COUNT(*) FROM screen_runs r WHERE r.user_id = u.id) AS runs
           FROM users u WHERE u.username LIKE ?
          ORDER BY u.id DESC LIMIT ? OFFSET ?`
      ).bind(like, size, offset).all();
    } else {
      total = await env.DB.prepare('SELECT COUNT(*) c FROM users').first();
      rows = await env.DB.prepare(
        `SELECT u.*,
                (SELECT COUNT(*) FROM screen_runs r WHERE r.user_id = u.id) AS runs
           FROM users u ORDER BY u.id DESC LIMIT ? OFFSET ?`
      ).bind(size, offset).all();
    }

    return json({
      items: (rows.results || []).map((r) => ({
        id: r.id,
        username: r.username,
        isVip: isVipActive(r),
        vipFlag: !!r.is_vip,
        vipExpires: r.vip_expires,
        isAdmin: !!r.is_admin,
        isBanned: !!r.is_banned,
        createdAt: r.created_at,
        lastLogin: r.last_login,
        runs: r.runs,
      })),
      total: total?.c || 0,
      page,
      size,
    });
  }

  // 更新用户（VIP / 封禁 / 管理员）
  if (path === '/admin/users/update' && req.method === 'POST') {
    const { id, isVip, vipExpires, isBanned, isAdmin } = await readJson(req);
    if (!id) throw httpErr(400, 'bad_id', '缺少 id');

    // 不允许操作自己（防止误封自己 / 取消自己管理员）
    if (Number(id) === me.id) {
      if (isBanned === true || isAdmin === false) {
        throw httpErr(400, 'self_protect', '不能封禁自己或取消自己的管理员权限');
      }
    }

    const sets = [];
    const vals = [];
    if (typeof isVip === 'boolean') { sets.push('is_vip = ?'); vals.push(isVip ? 1 : 0); }
    if (vipExpires !== undefined) {
      sets.push('vip_expires = ?');
      vals.push(vipExpires || null);
    }
    if (typeof isBanned === 'boolean') { sets.push('is_banned = ?'); vals.push(isBanned ? 1 : 0); }
    if (typeof isAdmin === 'boolean') { sets.push('is_admin = ?'); vals.push(isAdmin ? 1 : 0); }
    if (!sets.length) throw httpErr(400, 'nothing_to_update', '没有要更新的字段');

    vals.push(Number(id));
    await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...vals).run();

    // 封禁 → 立即踢下线
    if (isBanned === true) {
      await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(Number(id)).run();
    }

    await new Auth(env).log(me.id, me.username, 'admin_update', req);
    const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
      .bind(Number(id)).first();

    return json({ user: row ? publicUser(row) : null });
  }

  // 删除用户
  if (path === '/admin/users/delete' && req.method === 'POST') {
    const { id } = await readJson(req);
    if (!id) throw httpErr(400, 'bad_id', '缺少 id');
    if (Number(id) === me.id) throw httpErr(400, 'self_protect', '不能删除自己');
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(Number(id)).run();
    return json({ ok: true });
  }

  // 统计概览
  if (path === '/admin/stats' && req.method === 'GET') {
    const [users, vip, banned, todayRuns, totalRuns] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) c FROM users').first(),
      env.DB.prepare('SELECT COUNT(*) c FROM users WHERE is_vip = 1').first(),
      env.DB.prepare('SELECT COUNT(*) c FROM users WHERE is_banned = 1').first(),
      env.DB.prepare('SELECT COUNT(*) c FROM screen_runs WHERE date(created_at) = date(\'now\')').first(),
      env.DB.prepare('SELECT COUNT(*) c FROM screen_runs').first(),
    ]);
    const recent = await env.DB.prepare(
      `SELECT action, COUNT(*) c FROM auth_log
        WHERE date(created_at) = date('now') GROUP BY action`
    ).all();
    return json({
      users: users?.c || 0,
      vip: vip?.c || 0,
      banned: banned?.c || 0,
      todayRuns: todayRuns?.c || 0,
      totalRuns: totalRuns?.c || 0,
      todayAuth: Object.fromEntries((recent.results || []).map((r) => [r.action, r.c])),
    });
  }

  // 审计日志
  if (path === '/admin/logs' && req.method === 'GET') {
    const rows = await env.DB.prepare(
      'SELECT * FROM auth_log ORDER BY id DESC LIMIT 100'
    ).all();
    return json({ items: rows.results || [] });
  }

  throw httpErr(404, 'not_found', `未知管理接口 ${path}`);
}

/* ================================================================== */
/* 辅助                                                                */
/* ================================================================== */

const TIERS = [
  {
    id: 'free', name: '免费版', price: '¥0',
    features: ['单只股票技术分析', 'K 线与关键指标', '简化趋势筛选', `${FREE_DAILY_LIMIT} 次/日筛选`],
    limits: '不含全市场漏斗与筹码分布',
  },
  {
    id: 'vip', name: 'VIP 会员', price: '¥28/月',
    features: ['全市场六层漏斗筛选', '筹码分布与集中度', '枢轴突破开仓信号', '云端自选同步', `${VIP_DAILY_LIMIT} 次/日筛选`],
    limits: null, featured: true,
  },
];

async function listWatchlist(env, userId) {
  const rows = await env.DB.prepare(
    'SELECT symbol, name FROM watchlist WHERE user_id = ? ORDER BY sort_order, id'
  ).bind(userId).all();
  return rows.results || [];
}

async function usageToday(env, userId) {
  const row = await env.DB.prepare(
    'SELECT screen_count FROM usage_daily WHERE user_id = ? AND day = ?'
  ).bind(userId, today()).first();
  return row?.screen_count || 0;
}

function quotaOf(me, used) {
  const limit = me.isVip ? VIP_DAILY_LIMIT : FREE_DAILY_LIMIT;
  return { used, limit, remaining: Math.max(0, limit - used), tier: me.tier };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function readJson(req) {
  try {
    const ct = req.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return {};
    return await req.json();
  } catch {
    throw httpErr(400, 'bad_json', '请求体不是合法 JSON');
  }
}

function bodySymbol(req) {
  // DELETE 也可能带 body
  return null;
}

function safeParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
