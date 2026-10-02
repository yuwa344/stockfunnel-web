/**
 * Cloudflare Worker —— 换手率数据 CORS 代理。
 *
 * ## 为什么需要
 * 筹码分布模型必需「历史每日换手率」，唯一稳定提供该字段的免费接口
 * `q.stock.sohu.com` **不返回 CORS 头**，浏览器无法直连。
 * 腾讯的两个端点（qt.gtimg.cn / web.ifzq.gtimg.cn）实测返回
 * `Access-Control-Allow-Origin: *`，因此**无需代理**，只有搜狐需要。
 *
 * ## 部署
 * 1. 打开 Cloudflare Dashboard → Workers & Pages → Create Worker
 * 2. 粘贴本文件代码 → Deploy
 * 3. 把 Worker 地址填入应用「参数 → 换手率数据源」：
 *    https://your-worker.workers.dev/?url=
 *
 * 也可以部署到 Vercel / 边缘函数，接口约定相同（GET /?url=<encodeURIComponent(目标URL)>）。
 */

const ALLOW_HOSTS = [
  'q.stock.sohu.com',
  'qt.gtimg.cn',
  'web.ifzq.gtimg.cn',
  'smartbox.gtimg.cn',
  'push2his.eastmoney.com',
  'push2.eastmoney.com',
];

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 健康检查
    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 'stockfunnel-proxy' });
    }

    const target = url.searchParams.get('url');
    if (!target) {
      return json({ error: 'missing url param' }, 400);
    }

    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return json({ error: 'invalid url' }, 400);
    }

    if (!ALLOW_HOSTS.includes(parsed.hostname)) {
      return json({ error: 'host not allowed', host: parsed.hostname }, 403);
    }

    const upstream = await fetch(parsed.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
          + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': 'https://q.stock.sohu.com/',
      },
    });

    const buf = await upstream.arrayBuffer();
    const ct = upstream.headers.get('content-type') || 'text/plain; charset=GBK';

    return new Response(buf, {
      status: upstream.status,
      headers: {
        'Content-Type': ct,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Cache-Control': 'public, max-age=60',
      },
    });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
