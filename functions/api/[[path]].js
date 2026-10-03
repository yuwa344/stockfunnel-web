/**
 * Pages Functions —— API 反向代理
 * ==================================================================
 * 架构背景：
 *   - `*.workers.dev` 在中国大陆被 DNS 污染 + IP/SNI 阻断，浏览器直连失败
 *   - `*.pages.dev` 实测可直连
 *   - 但用户浏览器访问不到 Worker，API 也会挂
 *
 * 解决：把 API 请求在边缘（pages.dev）转发一次。
 * 用户只跟 pages.dev 打交道，Worker 变成纯后端，用户从不直连。
 *
 * 路由规则（Pages Functions 约定）：
 *   文件路径  /functions/api/[[path]].js
 *   实际访问  /api/<path>
 *
 * 透传逻辑：原样转发方法/头/体，回传状态码与响应头。
 * 额外注入 Access-Control-Allow-Origin（同域部署其实不需要，
 * 但保留以便将来把前端拆到别的域）。
 */

/** 真实后端 Worker 地址 */
const WORKER = 'https://stockfunnel.kongchris655.workers.dev';

/** 允许的前端来源（同域为主，保留 * 便于本地调试） */
const ALLOW_ORIGIN = '*';

/** 预检请求直接返回 */
function preflight(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || ALLOW_ORIGIN;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === 'OPTIONS') {
    return preflight(request);
  }

  // pages.dev 上做一次健康检查，便于确认部署成功
  if (!params.path || params.path.length === 0) {
    return json(request, {
      ok: true,
      service: 'stockfunnel-edge',
      routes: '/api/search, /api/me, /api/watchlist, /api/screen, /api/auth/*, /api/admin/*',
    });
  }

  const upstream = new URL('/api/' + params.path.join('/'), WORKER);
  // 保留 query string
  const q = new URL(request.url).searchParams;
  for (const [k, v] of q) upstream.searchParams.set(k, v);

  const headers = new Headers();
  // 透传客户端头，但剔除 hop-by-hop 与 host
  for (const [k, v] of request.headers) {
    const lk = k.toLowerCase();
    if (['host', 'cf-connecting-ip', 'cf-ray', 'content-length', 'accept-encoding'].includes(lk)) continue;
    headers.set(k, v);
  }

  let body;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.arrayBuffer();
  }

  let res;
  try {
    res = await fetch(upstream.toString(), {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
    });
  } catch (e) {
    return json(request, {
      error: 'upstream_unreachable',
      message: String(e?.message || e),
    }, 502);
  }

  // 回传响应
  const outHeaders = new Headers();
  const ct = res.headers.get('content-type');
  if (ct) outHeaders.set('content-type', ct);
  Object.entries(corsHeaders(request)).forEach(([k, v]) => outHeaders.set(k, v));

  const payload = await res.arrayBuffer();
  return new Response(payload, {
    status: res.status,
    headers: outHeaders,
  });
}

function json(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(request) },
  });
}
