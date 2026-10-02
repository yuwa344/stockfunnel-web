/**
 * Cloudflare Worker —— 应用入口
 * ==================================================================
 * 同一份 Worker 同时承担：
 *   1. 静态资源服务（前端）
 *   2. REST API（用户 / 自选 / 筛选 / Admin）
 *
 * 前端与 API 同域，因此不存在跨域问题。
 *
 * 会员分级：
 *   free  → 基础分析：单只股票 K 线 + 关键指标 + 简化趋势判断
 *   vip   → 高级分析：全市场六层漏斗筛选 + 筹码分布 + 枢轴信号
 *   admin → 后台管理
 *
 * 鉴权采用服务端会话（sessions 表），封禁可立即生效。
 */

import { Auth } from './auth.js';
import { Api } from './routes.js';

const STATIC_TTL = 3600;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // ---------------- API ----------------
    if (url.pathname.startsWith('/api/')) {
      const started = Date.now();
      try {
        const res = await Api.handle(request, env, url);
        const out = new Response(res.body, res);
        out.headers.set('Access-Control-Allow-Origin', origin(request));
        out.headers.set('Vary', 'Origin');
        if (res.ok) {
          out.headers.set('X-Response-Time', `${Date.now() - started}ms`);
        }
        return out;
      } catch (e) {
        console.error('[api]', url.pathname, e);
        return json({ error: 'internal_error', message: String(e?.message || e) }, 500, request);
      }
    }

    // ---------------- 静态资源 ----------------
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    return serveStatic(request, env, url);
  },
};

/* ------------------------------------------------------------------ */
/* 静态资源                                                            */
/* ------------------------------------------------------------------ */

async function serveStatic(request, env, url) {
  // ASSETS 由 Wrangler 的 assets 绑定提供
  const assets = env.ASSETS;
  if (!assets) {
    return new Response('Assets binding not configured', { status: 500 });
  }

  // SPA 回退：非文件路径一律返回 index.html
  const pathname = decodeURIComponent(url.pathname);
  const isFile = /\.[a-z0-9]+$/i.test(pathname);

  let res = await assets.fetch(new Request(new URL(pathname, url.origin), request));
  if (res.status === 404 && !isFile) {
    res = await assets.fetch(new Request(new URL('/index.html', url.origin), request));
  }

  const out = new Response(res.body, res);
  // Service Worker 不缓存，确保更新能生效
  if (pathname === '/sw.js') {
    out.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  } else if (isFile) {
    out.headers.set('Cache-Control', `public, max-age=${STATIC_TTL}`);
  } else {
    out.headers.set('Cache-Control', 'no-cache');
  }
  // 安全响应头
  out.headers.set('X-Content-Type-Options', 'nosniff');
  out.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  out.headers.set('X-Frame-Options', 'SAMEORIGIN');
  return out;
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

export function json(data, status = 200, request = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request),
    },
  });
}

function corsHeaders(request) {
  return {
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function origin(request) {
  if (!request) return '*';
  const o = request.headers.get('Origin');
  // 同域部署为主，保留回显以便本地调试
  return o || '*';
}
