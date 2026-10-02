/**
 * Service Worker —— 离线壳缓存。
 *
 * 策略：
 * - 预缓存应用壳（HTML/CSS/JS/图标），保证离线可打开
 * - 导航请求：网络优先，失败回退缓存
 * - 静态资源：缓存优先 + 后台更新（stale-while-revalidate）
 * - 行情接口：完全不缓存（必须实时）
 */

const VERSION = 'sf-v1.0.0';
const SHELL = `shell-${VERSION}`;
const RUNTIME = `rt-${VERSION}`;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/core/glass.css',
  './src/core/utils.js',
  './src/core/install.js',
  './src/data/api.js',
  './src/data/universe.js',
  './src/domain/indicators.js',
  './src/domain/chip.js',
  './src/domain/factors.js',
  './src/domain/config.js',
  './src/domain/funnel.js',
  './src/ui/charts.js',
  './src/main.js',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 行情接口不缓存
  if (/qt\.gtimg\.cn|ifzq\.gtimg\.cn|stock\.sohu\.com|smartbox\.gtimg\.cn/.test(url.host)) {
    return;
  }

  // 导航：网络优先
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // 静态资源：缓存优先 + 后台更新
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(RUNTIME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
