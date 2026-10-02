/** 通用工具：格式化、主题、DOM 助手。 */

/* ---------------- 格式化 ---------------- */

export const fmt = {
  num(v, d = 2) {
    if (v == null || !Number.isFinite(v)) return '--';
    return v.toFixed(d);
  },
  money(v, d = 2) {
    if (v == null || !Number.isFinite(v)) return '--';
    const a = Math.abs(v);
    if (a >= 1e12) return (v / 1e12).toFixed(d) + '万亿';
    if (a >= 1e8) return (v / 1e8).toFixed(d) + '亿';
    if (a >= 1e4) return (v / 1e4).toFixed(d) + '万';
    return v.toFixed(d);
  },
  volume(v) {
    if (v == null || !Number.isFinite(v)) return '--';
    const hands = v / 100;
    if (hands >= 1e4) return (hands / 1e4).toFixed(2) + '万手';
    return hands.toFixed(0) + '手';
  },
  pct(v, d = 2, sign = true) {
    if (v == null || !Number.isFinite(v)) return '--';
    const s = v.toFixed(d);
    return sign && v > 0 ? `+${s}%` : `${s}%`;
  },
  pctAbs(v, d = 2) {
    if (v == null || !Number.isFinite(v)) return '--';
    return `${v.toFixed(d)}%`;
  },
  price(v) {
    if (v == null || !Number.isFinite(v)) return '--';
    if (Math.abs(v) >= 1) return v.toFixed(2);
    return v.toFixed(3);
  },
  cap(yi) {
    if (!Number.isFinite(yi)) return '--';
    return `${yi.toFixed(0)}亿`;
  },
};

/* ---------------- 主题 ---------------- */

/** 跟随系统色调；用户可覆盖（覆盖值存 localStorage） */
export function initTheme() {
  const saved = localStorage.getItem('sf_theme');
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.dataset.theme = saved;
    return saved;
  }
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = (e) => {
    document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
  };
  apply(mq);
  mq.addEventListener('change', (e) => {
    if (!localStorage.getItem('sf_theme')) apply(e);
  });
  return document.documentElement.dataset.theme;
}

export function toggleTheme() {
  const cur = document.documentElement.dataset.theme;
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('sf_theme', next);
  return next;
}

export function isDark() {
  return document.documentElement.dataset.theme === 'dark';
}

/** Canvas 绘图用的主题色 */
export function chartTheme() {
  return isDark()
    ? {
        grid: '#2a2a34', axis: '#6e6e78', bg: '#1c1c22',
        up: '#ff453a', down: '#32d74b',
        volUp: 'rgba(255,69,58,0.30)', volDown: 'rgba(50,215,75,0.30)',
        ma5: '#64b5ff', ma10: '#ffd60a', ma20: '#bf5af2', ma60: '#64d2ff',
        brand: '#0a84ff', warn: '#ff9f0a',
      }
    : {
        grid: '#e3e6ec', axis: '#8b94a8', bg: '#ffffff',
        up: '#e8453c', down: '#12a05c',
        volUp: 'rgba(232,69,60,0.20)', volDown: 'rgba(18,160,92,0.20)',
        ma5: '#0a84ff', ma10: '#f0a020', ma20: '#9b5de5', ma60: '#00a0c6',
        brand: '#0a84ff', warn: '#f0a020',
      };
}

/* ---------------- i18n（语言跟随系统） ---------------- */

const DICT = {
  zh: {
    watchlist: '自选', search: '搜索', funnel: '漏斗',
    add: '添加', refresh: '刷新', emptyWatchlist: '还没有自选股',
    emptyWatchlistHint: '点击右下角「添加」开始',
    searchPlaceholder: '输入代码 / 名称 / 拼音，如 600519',
    universeLoading: '正在加载全市场…',
    universeHint: '首次需建立本地代码表，约 1-2 分钟',
    startScreening: '开始全市场筛选',
    settings: '参数设置',
    keyMetrics: '关键行情', techIndicators: '技术指标',
    chipDistribution: '筹码分布', signals: '开仓信号',
    noSignal: '本次筛选无 ⑥ 枢轴突破信号。形态收敛但尚未放量突破。',
    addHome: '添加到主屏幕',
    retry: '重试', cancel: '取消', done: '完成',
  },
  en: {
    watchlist: 'Watchlist', search: 'Search', funnel: 'Screener',
    add: 'Add', refresh: 'Refresh', emptyWatchlist: 'No stocks yet',
    emptyWatchlistHint: 'Tap "Add" to get started',
    searchPlaceholder: 'Code / Name / Pinyin, e.g. 600519',
    universeLoading: 'Loading full market…',
    universeHint: 'First run builds the local code table (~1-2 min)',
    startScreening: 'Run Full-Market Screen',
    settings: 'Parameters',
    keyMetrics: 'Key Metrics', techIndicators: 'Technical Indicators',
    chipDistribution: 'Chip Distribution', signals: 'Entry Signals',
    noSignal: 'No pivot breakout signals this run. Patterns are contracting but not yet breaking out.',
    addHome: 'Add to Home Screen',
    retry: 'Retry', cancel: 'Cancel', done: 'Done',
  },
  ja: {
    watchlist: '監視リスト', search: '検索', funnel: 'スクリーナー',
    add: '追加', refresh: '更新', emptyWatchlist: '銘柄がありません',
    emptyWatchlistHint: '「追加」をタップして開始',
    searchPlaceholder: 'コード / 名称 / 拼音（例: 600519）',
    universeLoading: '全市場を読み込み中…',
    universeHint: '初回はコード表の構築に 1-2 分',
    startScreening: '全市場スクリーニング',
    settings: 'パラメータ',
    keyMetrics: '主要指標', techIndicators: 'テクニカル指標',
    chipDistribution: 'チップ分布', signals: '買いシグナル',
    noSignal: '今回はピボット突破シグナルなし。',
    addHome: 'ホーム画面に追加',
    retry: '再試行', cancel: 'キャンセル', done: '完了',
  },
};

let lang = 'zh';

export function initLang() {
  const nav = (navigator.language || 'zh-CN').toLowerCase();
  if (nav.startsWith('zh')) {
    lang = /tw|hk|hant/.test(nav) ? 'zh' : 'zh';
  } else if (nav.startsWith('ja')) {
    lang = 'ja';
  } else {
    lang = 'en';
  }
  return lang;
}

export function t(key) {
  return DICT[lang]?.[key] ?? DICT.zh[key] ?? key;
}

export function getLang() { return lang; }

/* ---------------- DOM ---------------- */

/**
 * 从 HTML 字符串创建元素。
 *
 * 关键：内联 <svg> 必须放进 SVG namespace，否则浏览器不会应用
 * CSS 尺寸规则（表现为图标撑满整个容器）。因此这里手动创建
 * svg 元素并调用 setAttribute('class', ...)，保证 class 生效。
 */
export function el(html) {
  const d = document.createElement('div');
  d.innerHTML = html.trim();

  // 修正内联 SVG 的 namespace 与 class
  d.querySelectorAll('svg').forEach((svg) => {
    if (!svg.classList.contains('ic')) svg.classList.add('ic');
  });
  return d.firstElementChild;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

let toastTimer = null;
export function toast(msg) {
  const box = document.getElementById('toast');
  if (!box) return;
  box.textContent = msg;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), 1800);
}

export function priceClass(v) {
  if (v == null || v === 0) return 'flat';
  return v > 0 ? 'up' : 'down';
}

/** 图标（SVG 字符串） */
export const ICON = {
  star: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5l2.9 5.9 6.6.9-4.8 4.6 1.2 6.5L12 17.3 6.1 20.4l1.2-6.5L2.5 9.3l6.6-.9z"/></svg>',
  starFill: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 5.9 6.6.9-4.8 4.6 1.2 6.5L12 17.3 6.1 20.4l1.2-6.5L2.5 9.3l6.6-.9z"/></svg>',
  search: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  filter: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18M6 12h12M10 19h4"/></svg>',
  filterFill: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>',
  tune: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/></svg>',
  play: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5l13 7.5-13 7.5z"/></svg>',
  refresh: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 10-2.3 6.1M20 5v6h-6"/></svg>',
  back: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  plus: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  download: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 11l5 5 5-5M4 21h16"/></svg>',
  share: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13M8 7l4-4 4 4M5 14v6h14v-6"/></svg>',
  bolt: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>',
  moon: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/></svg>',
  sun: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>',
  info: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
};
