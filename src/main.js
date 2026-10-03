/**
 * 应用主入口。
 * 单页应用，底部 Tab 切换：自选 / 搜索 / 漏斗。
 */

import * as API from './data/api.js';
import { universeIndex, quickSearch, COMMON_COUNT } from './data/universe.js';
import { runFunnel, getUniverse, loadUniverse } from './domain/funnel.js';
import { PRESETS, DEFAULT_CONFIG, STAGES, STAGE_DESC } from './domain/config.js';
import { ChipDistribution } from './domain/chip.js';
import * as IND from './domain/indicators.js';
import * as CH from './ui/charts.js';
import {
  fmt, initTheme, toggleTheme, isDark, chartTheme, initLang, t,
  el, esc, toast, priceClass, ICON,
} from './core/utils.js';
import {
  initInstallPrompt, detectPlatform, installOrAddToHome,
} from './core/install.js';
import { api, ApiError } from './core/api-client.js';
import { openAuthSheet, openVipSheet, openAccountSheet, openAdminSheet } from './ui/account.js';

/* ---------------- 全局状态 ---------------- */

const state = {
  tab: 'watchlist',
  watchlist: loadWatchlist(),
  quotes: new Map(),
  sparkCache: new Map(),
  config: { ...DEFAULT_CONFIG },
  preset: 'standard',
  funnel: null,
  running: false,
  progress: null,
  abort: null,
  selectedStage: -1,
  universeReady: false,
  searchKw: '',
  searchApi: null,      // 服务端搜索结果
  searching: false,
  backendOk: null,      // null=未检测 false=不可达
  detail: null,
  configOpen: false,
};

function loadWatchlist() {
  const DEFAULTS = [
    { code: '600519', market: 'sh' },
    { code: '300750', market: 'sz' },
    { code: '601318', market: 'sh' },
    { code: '000858', market: 'sz' },
    { code: '002594', market: 'sz' },
    { code: '300059', market: 'sz' },
  ];
  let raw = [];
  try {
    raw = JSON.parse(localStorage.getItem('sf_watchlist') || 'null') || DEFAULTS;
  } catch {
    raw = DEFAULTS;
  }
  // 结构归一化：保证 tencent / symbol 存在（兼容旧版本数据）
  return raw
    .map((s) => {
      if (!s || !s.code) return null;
      const code = String(s.code);
      const market = s.market || (code.startsWith('6') ? 'sh' : 'sz');
      return {
        code,
        market,
        tencent: s.tencent || market + code,
        symbol: s.symbol || market + code,
        name: String(s.name || ''),
      };
    })
    .filter(Boolean);
}

function saveWatchlist() {
  localStorage.setItem('sf_watchlist', JSON.stringify(state.watchlist));
}

/* ---------------- 启动 ---------------- */

initTheme();
initLang();
initInstallPrompt();

window.addEventListener('sf:installable', () => {
  if (state.tab === 'watchlist') render();
});

document.getElementById('ambient').innerHTML =
  '<div class="amb-2"></div><div class="amb-3"></div>';

render();
checkBackend();

/* ---------------- 渲染 ---------------- */

function render() {
  const app = document.getElementById('app');
  const scrollY = window.scrollY;

  app.innerHTML = `
    <header class="topbar nav-glass">
      <div class="grow">
        <h1>${titleOf(state.tab)}</h1>
        ${subtitleOf(state.tab)}
      </div>
      ${actionButtons()}
    </header>
    <main class="content">${pageHtml()}</main>
    ${tabBar()}
  `;

  // 内联 SVG 需补 class 才能被 CSS 约束尺寸（innerHTML 解析不保留 SVG namespace 特性）
  app.querySelectorAll('svg').forEach((s) => {
    if (!s.classList.contains('ic')) s.classList.add('ic');
  });

  bindEvents();
  afterRender();

  window.scrollTo(0, scrollY);
}

function titleOf(tab) {
  return { watchlist: t('watchlist'), search: t('search'), funnel: t('funnel'), detail: '' }[tab];
}

function subtitleOf(tab) {
  if (tab === 'watchlist') {
    return `<span class="sub">${state.watchlist.length} 只自选</span>`;
  }
  if (tab === 'funnel') {
    return state.universeReady
      ? `<span class="sub">全市场 ${getUniverse()?.length ?? 0} 只已就绪</span>`
      : `<span class="sub">${t('universeHint')}</span>`;
  }
  return '';
}

function actionButtons() {
  // 后端连通状态点：灰=未检测 绿=正常 红=不可达
  const dot = state.backendOk === null
    ? `<span class="net-dot" title="后端检测中"></span>`
    : state.backendOk
      ? `<span class="net-dot ok" title="后端正常"></span>`
      : `<span class="net-dot bad" title="后端不可达"><button class="net-fix" id="btnNetFix">?</button></span>`;

  if (state.tab === 'detail') {
    return dot + `<button class="btn btn-icon" id="btnBack" aria-label="返回">${ICON.back}</button>`;
  }
  let html = dot;
  if (state.tab === 'watchlist') {
    html += accountChip();
    html += `<button class="btn btn-icon" id="btnTheme" aria-label="切换主题">${isDark() ? ICON.sun : ICON.moon}</button>`;
    html += `<button class="btn btn-icon" id="btnRefresh" aria-label="${t('refresh')}">${ICON.refresh}</button>`;
  }
  if (state.tab === 'funnel') {
    html += accountChip();
    html += `<button class="btn btn-icon" id="btnConfig" aria-label="${t('settings')}">${ICON.tune}</button>`;
    if (!state.running && api.isVip) {
      html += `<button class="btn btn-icon btn-primary" id="btnRun" aria-label="${t('startScreening')}">${ICON.play}</button>`;
    }
  }
  if (state.tab === 'search') html += accountChip();
  return html;
}

/** 账号 / 会员徽章 */
function accountChip() {
  if (!api.user) {
    return `<button class="chip" id="btnLogin" style="height:36px;padding:0 13px">
      ${ICON.star} 登录
    </button>`;
  }
  const tier = { free: '免费', vip: 'VIP', admin: '管理' }[api.tier];
  const color = api.isVip
    ? 'background:rgba(240,160,32,.16);color:#f0a020'
    : 'background:rgba(10,132,255,.14);color:#0a84ff';
  return `<button class="chip" id="btnAccount" style="height:36px;padding:0 12px;${color}">
    ${ICON.starFill} ${esc(api.user.username)} · ${tier}
  </button>`;
}

function tabBar() {
  const item = (key, icon, iconOn, label) => `
    <button class="tab ${state.tab === key ? 'active' : ''}" data-tab="${key}">
      ${state.tab === key ? iconOn : icon}
      <span>${label}</span>
    </button>`;
  return `<nav class="tabbar">
    ${item('watchlist', ICON.star, ICON.starFill, t('watchlist'))}
    ${item('search', ICON.search, ICON.search, t('search'))}
    ${item('funnel', ICON.filter, ICON.filterFill, t('funnel'))}
  </nav>`;
}

/* ---------------- 页面：自选 ---------------- */

function pageHtml() {
  switch (state.tab) {
    case 'watchlist': return pageWatchlist();
    case 'search': return pageSearch();
    case 'detail': return pageDetail();
    case 'funnel': return pageFunnel();
    default: return '';
  }
}

function pageWatchlist() {
  if (!state.watchlist.length) {
    return `<div class="empty">
      ${ICON.star}
      <p>${t('emptyWatchlist')}</p>
      <p>${t('emptyWatchlistHint')}</p>
    </div>`;
  }

  const rows = state.watchlist.map((s) => {
    const q = state.quotes.get(s.symbol);
    const name = s.name || q?.name || s.code;
    const color = q ? priceClass(q.changePct) : 'flat';
    return `
      <div class="card pressable" data-open="${s.symbol}" style="padding:11px 13px;margin-bottom:9px">
        <div class="row">
          <div class="grow">
            <div style="font-size:14.5px;font-weight:700" class="truncate">${esc(name)}</div>
            <div style="font-size:11px;color:var(--text-3)" class="tnum">${s.code}</div>
          </div>
          <canvas class="spark" data-spark="${s.symbol}" width="56" height="22"
            style="width:56px;height:22px;flex:0 0 auto"></canvas>
          <div style="text-align:right;min-width:76px">
            <div class="tnum ${color}" style="font-size:14.5px;font-weight:700">
              ${q ? fmt.price(q.price) : '--'}
            </div>
            <div class="tnum ${color}" style="font-size:11.5px;font-weight:600">
              ${q ? fmt.pct(q.changePct) : '--'}
            </div>
          </div>
          <div style="text-align:right;min-width:46px">
            <div style="font-size:9.5px;color:var(--text-3)">换手</div>
            <div class="tnum" style="font-size:11.5px;font-weight:600">
              ${q ? q.turnoverRate.toFixed(1) + '%' : '--'}
            </div>
          </div>
        </div>
      </div>`;
  }).join('');

  const p = detectPlatform();
  let installCard = '';
  if (!p.standalone) {
    if (p.isIOS) {
      installCard = `
        <div class="card" style="border-color:rgba(10,132,255,.28)">
          <div class="card-title">${ICON.download} 添加到主屏幕</div>
          <p style="margin:0 0 10px;font-size:12.5px;color:var(--text-2);line-height:1.5">
            点击下方按钮下载并安装描述文件，随后主屏幕将出现应用图标（全屏运行，无需浏览器地址栏）。
          </p>
          <button class="btn btn-primary" id="btnInstallIOS">${ICON.download} 下载描述文件</button>
        </div>`;
    } else {
      installCard = `
        <div class="card" style="border-color:rgba(10,132,255,.28)">
          <div class="card-title">${ICON.download} ${t('addHome')}</div>
          <p style="margin:0 0 10px;font-size:12.5px;color:var(--text-2);line-height:1.5">
            ${p.canPrompt
              ? '安装后将出现在桌面，以独立窗口全屏运行。'
              : '在浏览器菜单中选择「安装应用」或「添加到主屏幕」即可。'}
          </p>
          <button class="btn ${p.canPrompt ? 'btn-primary' : ''}" id="btnInstall"
            ${p.canPrompt ? '' : 'disabled'}>
            ${ICON.download} ${t('addHome')}
          </button>
        </div>`;
    }
  }

  return rows + installCard;
}

/* ---------------- 页面：搜索 ---------------- */

function pageSearch() {
  // 主路径：服务端 API 搜索（覆盖全部 A 股，名称实时）
  // 兜底：内置速查表（离线/接口失败时仍可用）
  const api = state.searchApi || [];
  const quick = state.searchKw ? quickSearch(state.searchKw, 20) : [];
  const seenSym = new Set();
  const results = api.concat(quick).filter((s) => {
    if (seenSym.has(s.symbol)) return false;
    seenSym.add(s.symbol);
    return true;
  }).slice(0, 30);
  let bodyHtml;

  if (state.searchKw && !results.length) {
    if (state.searching) {
      bodyHtml = `<div class="empty">${ICON.search}<p>搜索中…</p></div>`;
    } else {
      bodyHtml = `<div class="empty">
        ${ICON.search}
        <p>未找到「${esc(state.searchKw)}」相关标的</p>
        <p style="font-size:11px">可尝试输入 6 位代码，或中文名 / 拼音首字母</p>
      </div>`;
    }
  } else if (!state.searchKw) {
    const presets = ['600519', '300750', '000858', '601318', '688981', '002594'];
    bodyHtml = `
      <div class="card">
        <div class="card-title">${ICON.search} 试试搜索</div>
        <div class="row" style="flex-wrap:wrap;gap:7px">
          ${presets.map((c) => `<button class="chip" data-kw="${c}">${c}</button>`).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-title">${ICON.info} 搜索说明</div>
        <p style="margin:0 0 10px;font-size:12.5px;color:var(--text-2);line-height:1.55">
          搜索走<b>实时接口</b>，覆盖全部 A 股（约 5400 只），名称与 ST 状态实时同步。
          支持 6 位代码、中文名、拼音首字母。
        </p>
        <p style="margin:0;font-size:11.5px;color:var(--text-3);line-height:1.5">
          另内置 <b>${COMMON_COUNT}</b> 只常用股票速查表作为离线兜底，接口不可用时仍可搜索。
        </p>
      </div>`;
  } else {
    bodyHtml = results.map((s) => {
      const q = state.quotes.get(s.symbol);
      const name = s.name || q?.name || s.code;
      const inList = state.watchlist.some((w) => w.symbol === s.symbol);
      return `
        <div class="card pressable" data-open="${s.symbol}" style="padding:11px 13px;margin-bottom:9px">
          <div class="row">
            <div style="width:42px;flex:0 0 auto;height:32px;border-radius:8px;
                display:flex;align-items:center;justify-content:center;
                background:${marketColor(s.market)}22;color:${marketColor(s.market)};
                font-size:9.5px;font-weight:800">
              ${s.market.toUpperCase()}
            </div>
            <div class="grow">
              <div style="font-size:14.5px;font-weight:700" class="truncate">${esc(name)}</div>
              <div style="font-size:11px;color:var(--text-3)" class="tnum">${s.code}</div>
            </div>
            <div style="text-align:right;min-width:64px">
              <div class="tnum ${q ? priceClass(q.changePct) : 'flat'}"
                   style="font-size:14px;font-weight:700">${q ? fmt.price(q.price) : '--'}</div>
              <div class="tnum ${q ? priceClass(q.changePct) : 'flat'}"
                   style="font-size:11px">${q ? fmt.pct(q.changePct) : ''}</div>
            </div>
            <button class="btn btn-icon" data-star="${s.symbol}" style="width:32px;height:32px"
              title="${inList ? '移出自选' : '加入自选'}">
              <span style="color:${inList ? '#f0a020' : 'var(--text-3)'}">
                ${inList ? ICON.starFill : ICON.star}
              </span>
            </button>
            <button class="btn btn-icon" data-basic="${s.symbol}" style="width:32px;height:32px"
              title="快速分析">
              <span style="color:var(--f0)">${ICON.filter}</span>
            </button>
          </div>
        </div>`;
    }).join('');
  }

  return `
    <div style="margin-bottom:12px">
      <input type="search" id="searchInput" placeholder="${t('searchPlaceholder')}"
        value="${esc(state.searchKw)}" autocomplete="off">
    </div>
    ${bodyHtml}`;
}

function marketColor(m) {
  return m === 'sh' ? '#e8453c' : m === 'sz' ? '#12a05c' : '#7c5cff';
}

/* ---------------- 页面：详情 ---------------- */

function pageDetail() {
  const d = state.detail;
  if (!d) return `<div class="empty">${ICON.info}<p>加载中…</p></div>`;
  if (d.error) {
    return `<div class="empty">
      ${ICON.info}
      <p style="color:var(--up)">${esc(d.error)}</p>
      <button class="btn" id="btnRetryDetail" style="margin-top:14px;max-width:180px">${t('retry')}</button>
    </div>`;
  }
  if (d.loading) {
    return `<div class="empty">
      <div class="spinner" style="margin:0 auto 12px;width:26px;height:26px"></div>
      <p>加载行情…</p>
    </div>`;
  }

  const q = d.quote;
  const bars = d.bars || [];
  const color = priceClass(q.changePct);

  return `
    <div class="card">
      <div style="font-size:32px;font-weight:800;line-height:1;color:var(--${color})" class="tnum">
        ${fmt.price(q.price)}
        <span style="font-size:15px;font-weight:700;margin-left:8px">${fmt.pct(q.changePct)}</span>
      </div>
      <div style="margin-top:7px;font-size:11.5px;color:var(--text-3)" class="tnum">
        ${q.change >= 0 ? '+' : ''}${fmt.num(q.change)}  昨收 ${fmt.price(q.prevClose)}  今开 ${fmt.price(q.open)}
        ${q.updateTime ? `　·　${q.updateTime}` : ''}
      </div>
    </div>

    <div class="card" style="padding:12px 6px 6px">
      <div class="row" style="padding:0 8px 4px">
        <span style="font-size:12.5px;font-weight:700">日K（前复权）</span>
        <span class="grow"></span>
        <span style="font-size:10px;color:var(--text-3)">按住查看十字光标</span>
      </div>
      <canvas id="kline" style="width:100%;height:320px;display:block;touch-action:pan-y"></canvas>
    </div>

    <div class="card">
      <div class="card-title">${ICON.info} ${t('keyMetrics')}</div>
      <div class="grid3">
        ${metric('成交量', fmt.volume(q.volume))}
        ${metric('成交额', fmt.money(q.amount))}
        ${metric('换手率', fmt.pctAbs(q.turnoverRate))}
        ${metric('振幅', fmt.pctAbs(q.amplitude))}
        ${metric('市盈率TTM', q.peTtm != null ? q.peTtm.toFixed(2) : '--')}
        ${metric('市净率', q.pb != null ? q.pb.toFixed(2) : '--')}
        ${metric('量比', q.volRatio.toFixed(2))}
        ${metric('流通市值', fmt.cap(q.floatCap / 1e8))}
        ${metric('总市值', fmt.cap(q.totalCap / 1e8))}
        ${metric('52周最高', fmt.price(q.high52w))}
        ${metric('52周最低', fmt.price(q.low52w))}
        ${metric('52周分位', fmt.pctAbs(d.pos52 * 100))}
      </div>
    </div>

    ${techCard(d)}

    ${chipCard(d)}
  `;
}

function metric(label, value, color) {
  return `<div>
    <div class="metric-label">${label}</div>
    <div class="metric-value ${color || ''}">${value}</div>
  </div>`;
}

function techCard(d) {
  const bars = d.bars;
  if (!bars?.length) return '';
  const cls = IND.closes(bars);
  const ma5 = IND.lastSma(cls, 5);
  const ma10 = IND.lastSma(cls, 10);
  const ma20 = IND.lastSma(cls, 20);
  const ma60 = IND.lastSma(cls, 60);
  const ma250 = IND.lastSma(cls, 250);
  const rsi14 = IND.rsi(bars);
  const atr14 = IND.atr(bars, 14);
  const vol60 = IND.annualizedVol(bars, 60);

  const ma200Seq = IND.sma(cls, 200).filter((v) => v != null);
  const slope = ma200Seq.length >= 20
    ? IND.regressionSlope(ma200Seq.slice(-20)) : null;

  const n = bars.length;
  let hi = -Infinity, lo = Infinity;
  for (const c of bars) {
    if (c.high > hi) hi = c.high;
    if (c.low < lo) lo = c.low;
  }
  const range = Math.abs(hi - lo) < 1e-9 ? 1 : hi - lo;
  const periodPos = ((bars[n - 1].close - lo) / range) * 100;

  return `
    <div class="card">
      <div class="card-title">${ICON.filter} ${t('techIndicators')}</div>
      <div class="grid3" style="margin-bottom:12px">
        ${metric('MA5', ma5?.toFixed(2))}
        ${metric('MA10', ma10?.toFixed(2))}
        ${metric('MA20', ma20?.toFixed(2))}
        ${metric('MA60', ma60?.toFixed(2))}
        ${metric('MA250', ma250?.toFixed(2))}
        ${metric('200MA斜率', slope != null ? slope.toFixed(3) + '%' : '--',
          slope == null ? '' : slope > 0 ? 'up' : 'down')}
      </div>
      <hr class="sep">
      <div class="grid3">
        ${metric('RSI(14)', rsi14?.toFixed(1) ?? '--',
          rsi14 == null ? '' : rsi14 > 70 ? 'up' : rsi14 < 30 ? 'down' : '')}
        ${metric('ATR(14)', atr14?.toFixed(2))}
        ${metric('年化波动', vol60 != null ? vol60.toFixed(1) + '%' : '--')}
        ${metric('区间分位', periodPos.toFixed(1) + '%')}
        ${metric('区间最高', fmt.price(hi))}
        ${metric('区间最低', fmt.price(lo))}
      </div>
    </div>`;
}

function chipCard(d) {
  if (!d.chip || d.chip.isEmpty) return '';
  const c = d.chip;
  const price = d.quote.price > 0 ? d.quote.price : d.bars[d.bars.length - 1].close;
  const c90 = c.concentration90();
  const profit = c.profitRatio(price);
  const avg = c.avgCost();
  const res = c.resistancePeak(price);

  return `
    <div class="card">
      <div class="row" style="margin-bottom:2px">
        <span class="card-title" style="margin:0">${ICON.filter} ${t('chipDistribution')}</span>
        <span class="grow"></span>
        <span class="badge" style="background:rgba(124,92,255,.16);color:#7c5cff">本地模型推算</span>
      </div>
      <p style="margin:0 0 8px;font-size:10px;color:var(--text-3)">
        基于换手率衰减法从量价反推，非交易所公开数据
      </p>
      <canvas id="chipChart" style="width:100%;height:180px;display:block"></canvas>
      <div class="grid4" style="margin-top:12px">
        ${metric('90%集中度', (c90 * 100).toFixed(2) + '%', c90 < 0.10 ? 'up' : '')}
        ${metric('获利比例', profit.toFixed(1) + '%', profit > 85 ? 'up' : '')}
        ${metric('平均成本', fmt.price(avg))}
        ${metric('上方阻力', res == null ? '无' : fmt.price(res), res == null ? 'up' : 'warn')}
      </div>
    </div>`;
}

/* ---------------- 页面：漏斗 ---------------- */

function pageFunnel() {
  // 会员门控：未登录 / 非 VIP
  if (!api.isVip) {
    return `
      <div class="card" style="text-align:center;padding:26px 20px;
        border-color:rgba(240,160,32,.3)">
        <div style="color:#f0a020;display:flex;justify-content:center">${ICON.bolt}</div>
        <div style="font-size:16px;font-weight:800;margin:10px 0 6px">六层漏斗 · VIP 功能</div>
        <p style="margin:0 0 16px;font-size:12.5px;color:var(--text-2);line-height:1.6">
          全市场六层漏斗需要遍历 5000+ 标的的 K 线、逐层计算动量与筹码分布，
          属重度计算能力，仅对 VIP 会员开放。
        </p>
        <div style="text-align:left;max-width:340px;margin:0 auto 16px">
          ${['全市场六层漏斗筛选', '筹码分布与集中度分析', '枢轴突破开仓信号', '5%-8% 止损风控参数']
            .map((f) => `<div class="row" style="gap:7px;margin:5px 0">
              <span style="color:#f0a020;font-size:13px">✓</span>
              <span style="font-size:12.5px">${f}</span></div>`).join('')}
        </div>
        ${!api.user
          ? `<button class="btn btn-primary" id="btnNeedLogin">${ICON.star} 登录 / 注册</button>`
          : `<button class="btn btn-primary" id="btnNeedVip">${ICON.bolt} 升级 VIP</button>`}
        <p style="margin:12px 0 0;font-size:11px;color:var(--text-3)">
          免费版已可用：单只股票技术分析与关键指标
        </p>
      </div>

      <div class="card">
        <div class="card-title">${ICON.info} 筛选逻辑预览</div>
        ${STAGES.map((s, i) => `
          <div class="row" style="align-items:flex-start;gap:9px;margin:9px 0">
            <div style="width:3px;align-self:stretch;min-height:32px;border-radius:2px;
              background:var(--f${i})"></div>
            <div>
              <div style="font-size:13px;font-weight:700;color:var(--f${i})">${s.title}</div>
              <div style="font-size:11px;color:var(--text-3);line-height:1.4">${STAGE_DESC[s.key]}</div>
            </div>
          </div>`).join('')}
      </div>`;
  }

  // 未就绪
  if (!state.universeReady) {
    return `
      <div class="card">
        <div class="card-title">${ICON.filter} 筛选逻辑</div>
        ${STAGES.map((s, i) => `
          <div class="row" style="align-items:flex-start;gap:9px;margin:9px 0">
            <div style="width:3px;align-self:stretch;min-height:32px;border-radius:2px;
              background:var(--f${i})"></div>
            <div>
              <div style="font-size:13px;font-weight:700;color:var(--f${i})">${s.title}</div>
              <div style="font-size:11px;color:var(--text-3);line-height:1.4">${STAGE_DESC[s.key]}</div>
            </div>
          </div>`).join('')}
      </div>
      <div class="card">
        <div class="card-title">${ICON.info} 准备全市场代码表</div>
        <p style="margin:0 0 12px;font-size:12.5px;color:var(--text-2);line-height:1.55">
          需枚举 A 股代码段并用批量行情校验，得到约 5000+ 只有效标的的本地索引。
          完成后搜索与筛选均在本地进行。首次约 1-2 分钟。
        </p>
        <button class="btn btn-primary" id="btnBuildIndex">${ICON.play} 建立代码表</button>
        ${state.progress ? progressHtml(state.progress) : ''}
      </div>`;
  }

  // 运行中
  if (state.running) {
    return `
      <div class="card" style="text-align:center;padding:34px 20px">
        <div class="spinner" style="margin:0 auto 16px;width:30px;height:30px"></div>
        <div style="font-size:14px;font-weight:650">${esc(state.progress?.message || '准备中…')}</div>
        ${state.progress && state.progress.total > 1 ? progressHtml(state.progress) : ''}
        <div style="margin-top:8px;font-size:11.5px;color:var(--text-3)">
          当前阶段：${stageName(state.progress?.message)}
        </div>
        <button class="btn" id="btnCancel" style="margin-top:20px">${t('cancel')}</button>
      </div>`;
  }

  // 结果
  const r = state.funnel;
  if (!r) {
    return `
      <div class="card">
        <div class="card-title">${ICON.filter} 筛选逻辑</div>
        ${STAGES.map((s, i) => `
          <div class="row" style="align-items:flex-start;gap:9px;margin:9px 0">
            <div style="width:3px;align-self:stretch;min-height:32px;border-radius:2px;
              background:var(--f${i})"></div>
            <div>
              <div style="font-size:13px;font-weight:700;color:var(--f${i})">${s.title}</div>
              <div style="font-size:11px;color:var(--text-3);line-height:1.4">${STAGE_DESC[s.key]}</div>
            </div>
          </div>`).join('')}
      </div>
      <button class="btn btn-primary" id="btnRun">${ICON.play} ${t('startScreening')}</button>
      <p style="text-align:center;font-size:11px;color:var(--text-3);margin-top:10px">
        全市场 ${getUniverse()?.length ?? 0} 只 · 预计 1-3 分钟
      </p>`;
  }

  if (r.error) {
    return `<div class="empty">${ICON.info}
      <p style="color:var(--up)">${esc(r.error)}</p>
      <button class="btn" id="btnRun" style="margin-top:14px;max-width:180px">${t('retry')}</button>
    </div>`;
  }

  return renderFunnelResult(r);
}

function stageName(msg) {
  if (!msg) return '—';
  for (const s of STAGES) if (msg.includes(s.title)) return s.title;
  return '准备';
}

function progressHtml(p) {
  const ratio = p.total > 0 ? p.done / p.total : 0;
  return `
    <div class="progress" style="margin-top:14px"><i style="width:${(ratio * 100).toFixed(1)}%"></i></div>
    <div style="margin-top:6px;font-size:11px;color:var(--text-3)" class="tnum">
      ${p.done} / ${p.total} (${(ratio * 100).toFixed(0)}%)
    </div>`;
}

function renderFunnelResult(r) {
  const selIdx = state.selectedStage;
  const sel = selIdx >= 0 ? r.stages[selIdx] : null;
  const elapsed = ((r.finishedAt - r.startedAt) / 1000).toFixed(0);

  const funnel = r.stages.map((s, i) => {
    const ratio = s.passed.length === 0 ? 0
      : Math.max(0.08, Math.min(1, Math.log(s.passed.length + 1) / Math.log(Math.max(2, r.universeSize))));
    return `
      <div class="pressable" data-stage="${i}"
        style="padding:9px 12px;margin-bottom:5px;border-radius:10px;cursor:pointer;
          background:${selIdx === i ? `var(--f${i})1f` : 'var(--glass-bg)'};
          border:1px solid ${selIdx === i ? `var(--f${i})` : 'var(--glass-border)'}">
        <div class="row" style="gap:9px">
          <div class="grow">
            <div class="progress" style="height:5px">
              <i style="width:${(ratio * 100).toFixed(1)}%;background:var(--f${i})"></i>
            </div>
            <div class="row" style="margin-top:4px">
              <span style="font-size:12.5px;font-weight:700;color:${s.passed.length ? `var(--f${i})` : 'var(--text-3)'}">
                ${STAGES[i].title}
              </span>
              <span class="grow"></span>
              <span style="font-size:10px;color:var(--text-3)">
                ${s.passed.length ? '留存 ' + (s.passed.length / s.inputCount * 100).toFixed(1) + '%' : ''}
              </span>
            </div>
          </div>
          <div class="tnum" style="font-size:15px;font-weight:800;
            color:${s.passed.length ? `var(--f${i})` : 'var(--text-3)'};min-width:38px;text-align:right">
            ${s.passed.length}
          </div>
        </div>
      </div>`;
  }).join('');

  const signals = r.signals?.length
    ? `<div class="card" style="border-color:rgba(240,160,32,.3)">
        <div class="row" style="margin-bottom:10px">
          <span style="color:#f0a020">${ICON.bolt}</span>
          <span style="font-size:14px;font-weight:700">${t('signals')}</span>
          <span class="grow"></span>
          <span class="badge" style="background:rgba(240,160,32,.16);color:#f0a020">${r.signals.length} 个</span>
        </div>
        ${r.signals.map(signalCard).join('')}
      </div>`
    : `<div class="card">
        <div class="row">
          <span style="color:var(--text-3)">${ICON.info}</span>
          <span style="font-size:11.5px;color:var(--text-2);line-height:1.45">${t('noSignal')}</span>
        </div>
      </div>`;

  return `
    <div class="card">
      <div class="row" style="margin-bottom:12px">
        <span style="font-size:14px;font-weight:700">筛选漏斗</span>
        <span class="grow"></span>
        <span style="font-size:10px;color:var(--text-3)">点击层查看名单</span>
      </div>
      <div style="padding:9px 11px;margin-bottom:5px;border-radius:10px;
        background:var(--fill-soft);border:1px solid var(--glass-border)">
        <div class="row">
          <span style="font-size:12.5px;font-weight:700">全市场</span>
          <span class="grow"></span>
          <span class="tnum" style="font-size:15px;font-weight:800">${r.universeSize}</span>
        </div>
      </div>
      ${funnel}
    </div>

    <div class="card">
      <div class="grid3" style="text-align:center">
        <div><div class="metric-value" style="font-size:17px">${r.universeSize}</div>
          <div class="metric-label">全市场</div></div>
        <div><div class="metric-value" style="font-size:17px;color:var(--f5)">
          ${r.stages.length ? r.stages[r.stages.length - 1].passed.length : 0}</div>
          <div class="metric-label">最终信号</div></div>
        <div><div class="metric-value" style="font-size:17px">${elapsed}s</div>
          <div class="metric-label">耗时</div></div>
      </div>
      ${!r.turnoverAvailable ? `<hr class="sep">
        <p style="margin:0;font-size:10.5px;color:var(--warn);line-height:1.45">
          ⚠ 未配置换手率代理，筹码层精度受限。详见设置说明。
        </p>` : ''}
    </div>

    ${sel ? stageDetailCard(sel, selIdx) : ''}
    ${signals}
    <button class="btn" id="btnRun">${ICON.refresh} 重新筛选</button>
  `;
}

function signalCard(s) {
  return `
    <div style="padding:11px 12px;margin-bottom:9px;border-radius:10px;
      background:var(--fill-soft);border:1px solid rgba(240,160,32,.28)">
      <div class="row">
        <span style="font-size:14px;font-weight:800">${esc(s.name)}</span>
        <span style="font-size:10.5px;color:var(--text-3)" class="tnum">${s.code}</span>
        <span class="grow"></span>
        <span style="font-size:11px;font-weight:700;color:#f0a020">
          量比 ${s.volumeRatio.toFixed(2)}×
        </span>
      </div>
      <div class="grid4" style="margin-top:9px">
        ${metric('买入', fmt.price(s.price), 'up')}
        ${metric('止损', fmt.price(s.stopLoss), 'down')}
        ${metric('目标', fmt.price(s.target), 'warn')}
        ${metric('盈亏比', s.rr.toFixed(1) + 'R')}
      </div>
      <div class="row" style="margin-top:7px">
        <span style="font-size:10px;color:var(--text-3)">
          止损幅度 ${s.stopPct.toFixed(1)}%（风控区间 5%-8%）
        </span>
      </div>
      ${s.reason ? `<div style="margin-top:5px;font-size:10.5px;color:var(--text-3);line-height:1.4">
        ${esc(s.reason)}</div>` : ''}
    </div>`;
}

function stageDetailCard(s, idx) {
  const color = `var(--f${idx})`;
  const rej = Object.entries(s.rejectedStats || {})
    .sort((a, b) => b[1] - a[1]);

  return `
    <div class="card">
      <div class="row" style="margin-bottom:3px">
        <div style="width:3px;height:15px;border-radius:2px;background:${color}"></div>
        <span style="font-size:14px;font-weight:700;color:${color}">${STAGES[idx].title}</span>
        <span class="grow"></span>
        <span style="font-size:11px;color:var(--text-3)">${s.passed.length} 只通过</span>
      </div>
      <div style="font-size:10px;color:var(--text-3);margin-bottom:8px">${STAGES[idx].label}</div>

      ${s.passed.length === 0
        ? `<p style="text-align:center;font-size:12px;color:var(--text-3);padding:14px 0">该层无通过标的</p>`
        : s.passed.slice(0, 30).map(factorTile).join('')}

      ${s.passed.length > 30
        ? `<p style="font-size:10.5px;color:var(--text-3);margin:8px 0 0">另有 ${s.passed.length - 30} 只未显示</p>`
        : ''}

      ${rej.length ? `<hr class="sep">
        <div style="font-size:12px;font-weight:700;color:var(--text-2);margin-bottom:8px">淘汰原因 TOP</div>
        ${rej.slice(0, 6).map(([k, v]) => {
          const maxV = rej[0][1];
          return `<div style="margin:6px 0">
            <div class="row">
              <span class="grow truncate" style="font-size:11px">${esc(k)}</span>
              <span class="tnum" style="font-size:11px;color:var(--text-3)">${v}</span>
            </div>
            <div class="progress" style="height:3px;margin-top:3px">
              <i style="width:${(v / maxV * 100).toFixed(0)}%;background:var(--flat);opacity:.6"></i>
            </div>
          </div>`;
        }).join('')}
        ${rej.length > 6 ? `<p style="font-size:10px;color:var(--text-3);margin:6px 0 0">另有 ${rej.length - 6} 条规则</p>` : ''}
        ` : ''}
    </div>`;
}

function factorTile(f) {
  const s = f.stock;
  const name = s.name || state.quotes.get(s.symbol)?.name || s.code;
  return `
    <div class="pressable" data-open="${s.symbol}" style="padding:7px 2px">
      <div class="row">
        <span style="font-size:13.5px;font-weight:700" class="truncate">${esc(name)}</span>
        <span style="font-size:10.5px;color:var(--text-3)" class="tnum">${s.code}</span>
        <span class="grow"></span>
        <div class="progress" style="width:42px;height:4px">
          <i style="width:${f.score.toFixed(0)}%"></i>
        </div>
        <span class="tnum" style="font-size:11px;font-weight:700;min-width:20px;text-align:right">
          ${f.score.toFixed(0)}
        </span>
      </div>
      ${f.notes?.length ? `<div class="truncate" style="font-size:10.5px;color:var(--text-3);margin-top:2px">
        ${esc(f.notes.slice(0, 3).join(' · '))}</div>` : ''}
    </div>`;
}

/* ---------------- 事件绑定 ---------------- */

function bindEvents() {
  // Tab
  document.querySelectorAll('[data-tab]').forEach((b) => {
    b.onclick = () => {
      if (state.tab === b.dataset.tab) return;
      state.tab = b.dataset.tab;
      state.selectedStage = -1;
      render();
      onEnterTab();
    };
  });

  // 详情返回
  const back = document.getElementById('btnBack');
  if (back) back.onclick = () => { state.tab = 'watchlist'; state.detail = null; render(); };

  // 主题
  const themeBtn = document.getElementById('btnTheme');
  if (themeBtn) themeBtn.onclick = () => { toggleTheme(); render(); };

  // 刷新自选
  const refreshBtn = document.getElementById('btnRefresh');
  if (refreshBtn) refreshBtn.onclick = () => refreshQuotes(true);

  // 打开详情
  document.querySelectorAll('[data-open]').forEach((n) => {
    n.onclick = (e) => {
      if (e.target.closest('[data-star]')) return;
      openDetail(n.dataset.open);
    };
  });

  // 搜索页
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.oninput = debounce((e) => {
      const kw = e.target.value;
      state.searchKw = kw;
      // 服务端搜索（覆盖全市场，名称实时）
      doSearch(kw);
    }, 280);
  }
  document.querySelectorAll('[data-kw]').forEach((b) => {
    b.onclick = () => { state.searchKw = b.dataset.kw; doSearch(b.dataset.kw); };
  });
  document.querySelectorAll('[data-star]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      toggleStar(b.dataset.star);
    };
  });

  // 免费版快速分析
  document.querySelectorAll('[data-basic]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      quickAnalyze(b.dataset.basic);
    };
  });

  // 登录入口
  const loginBtn = document.getElementById('btnLogin');
  if (loginBtn) loginBtn.onclick = () => openAuthSheetWrap();

  // 后端不可达时的手动修复入口
  const netFix = document.getElementById('btnNetFix');
  if (netFix) netFix.onclick = () => {
    const cur = localStorage.getItem('sf_api') || '';
    const v = prompt(
      '后端地址（留空表示同源 /api，由 Pages 边缘代理）\n' +
      '例如 https://stockfunnel.kongchris655.workers.dev',
      cur
    );
    if (v === null) return;
    if (v.trim()) localStorage.setItem('sf_api', v.trim().replace(/\/+$/, ''));
    else localStorage.removeItem('sf_api');
    checkBackend();
  };

  // 账号菜单
  const accBtn = document.getElementById('btnAccount');
  if (accBtn) accBtn.onclick = () => openAccountSheet(() => render());

  // 会员门控按钮
  const needLogin = document.getElementById('btnNeedLogin');
  if (needLogin) needLogin.onclick = () => openAuthSheetWrap();

  const needVip = document.getElementById('btnNeedVip');
  if (needVip) needVip.onclick = () => openVipSheet();

  // 建立索引
  const buildBtn = document.getElementById('btnBuildIndex');
  if (buildBtn) buildBtn.onclick = () => ensureUniverse();

  // 筛选
  const runBtn = document.getElementById('btnRun');
  if (runBtn) runBtn.onclick = () => startScreening();

  const cancelBtn = document.getElementById('btnCancel');
  if (cancelBtn) cancelBtn.onclick = () => state.abort?.abort();

  const cfgBtn = document.getElementById('btnConfig');
  if (cfgBtn) cfgBtn.onclick = () => openConfigSheet();

  // 层展开
  document.querySelectorAll('[data-stage]').forEach((n) => {
    n.onclick = () => {
      const i = Number(n.dataset.stage);
      state.selectedStage = state.selectedStage === i ? -1 : i;
      render();
    };
  });

  // 详情重试
  const retryBtn = document.getElementById('btnRetryDetail');
  if (retryBtn) retryBtn.onclick = () => { state.detail = null; openDetail(lastDetailSymbol); };

  // 安装
  const iosInstall = document.getElementById('btnInstallIOS');
  if (iosInstall) iosInstall.onclick = async () => {
    iosInstall.disabled = true;
    const r = await installOrAddToHome({ url: location.href.split('#')[0], label: '六层漏斗选股' });
    iosInstall.disabled = false;
    toast(r.ok ? '描述文件已下载，请打开并安装' : '下载失败，请重试');
  };
  const installBtn = document.getElementById('btnInstall');
  if (installBtn) installBtn.onclick = async () => {
    const r = await installOrAddToHome({ url: location.href.split('#')[0], label: '六层漏斗选股' });
    if (r.ok) toast('安装成功');
    else if (r.reason === 'manual') toast('请在浏览器菜单中选择「安装应用」');
    else if (r.reason === 'already-installed') toast('已在主屏幕运行中');
  };
}

let lastDetailSymbol = null;

function openAuthSheetWrap() {
  openAuthSheet(async () => {
    await syncWatchlistAfterLogin();
    render();
  });
}

/* ---------------- 渲染后处理 ---------------- */

function afterRender() {
  // 迷你走势
  document.querySelectorAll('[data-spark]').forEach((c) => {
    const sym = c.dataset.spark;
    const cached = state.sparkCache.get(sym);
    if (cached) {
      CH.drawSpark(c, cached, chartTheme().ma5);
    } else {
      loadSpark(sym);
    }
  });

  // K 线 + 筹码
  if (state.tab === 'detail' && state.detail && !state.detail.loading && !state.detail.error) {
    drawDetailCharts();
  }
}

function drawDetailCharts() {
  const d = state.detail;
  const theme = chartTheme();

  const kc = document.getElementById('kline');
  if (kc && d.bars?.length) {
    let selected = null;
    const draw = () => CH.drawKLine(kc, { bars: d.bars, theme, selected });
    draw();

    const pick = (clientX) => {
      const rect = kc.getBoundingClientRect();
      const x = clientX - rect.left;
      const chartW = rect.width - 52;
      const n = Math.min(100, d.bars.length);
      const slot = chartW / n;
      let idx = Math.floor(x / slot);
      idx = Math.max(0, Math.min(n - 1, idx));
      selected = idx;
      draw();
    };

    let dragging = false;
    kc.onpointerdown = (e) => { dragging = true; kc.setPointerCapture(e.pointerId); pick(e.clientX); };
    kc.onpointermove = (e) => { if (dragging) pick(e.clientX); };
    kc.onpointerup = (e) => { dragging = false; selected = null; draw(); };
    kc.onpointercancel = () => { dragging = false; selected = null; draw(); };
  }

  const cc = document.getElementById('chipChart');
  if (cc && d.chip && !d.chip.isEmpty) {
    const price = d.quote.price > 0 ? d.quote.price : d.bars[d.bars.length - 1].close;
    CH.drawChip(cc, { chip: d.chip, currentPrice: price, theme });
  }
}

async function loadSpark(symbol) {
  const stock = findStock(symbol);
  if (!stock) return;
  try {
    const bars = await API.fetchKLine(stock, 40);
    if (bars.length) {
      state.sparkCache.set(symbol, bars.map((b) => b.close));
      const c = document.querySelector(`[data-spark="${symbol}"]`);
      if (c) CH.drawSpark(c, state.sparkCache.get(symbol), chartTheme().ma5);
    }
  } catch { /* 静默 */ }
}

/* ---------------- 数据动作 ---------------- */

function findStock(symbol) {
  if (!symbol || typeof symbol !== 'string') return null;
  const hit = universeIndex.get(symbol)
    || state.watchlist.find((s) => s.symbol === symbol);
  if (hit) return hit;
  // 兜底：由 symbol 构造（symbol 形如 sh600519）
  const m = symbol.slice(0, 2);
  const code = symbol.slice(2);
  if (!/^(sh|sz|bj)$/.test(m) || !/^\d{6}$/.test(code)) return null;
  return { code, market: m, tencent: symbol, symbol, name: '' };
}

async function refreshQuotes(force = false) {
  if (!state.watchlist.length) return;
  const stocks = state.watchlist.map((s) => findStock(s.symbol)).filter(Boolean);
  if (!stocks.length) return;
  try {
    const map = await API.fetchSnapshots(stocks, { concurrency: 4 });
    for (const [k, v] of map) {
      state.quotes.set(k, v);
      // 回填名称
      const w = state.watchlist.find((x) => x.symbol === k);
      if (w) w.name = v.name;
    }
    saveWatchlist();
    render();
  } catch (e) {
    console.error('[quotes]', e);
    toast('行情刷新失败');
  }
}

function toggleStar(symbol) {
  const i = state.watchlist.findIndex((s) => s.symbol === symbol);
  if (i >= 0) {
    const [rm] = state.watchlist.splice(i, 1);
    state.quotes.delete(symbol);
    toast(`${rm.name || rm.code} 已移出自选`);
    if (api.user) api.removeWatch(symbol).catch(() => {});
  } else {
    const s = findStock(symbol);
    state.watchlist.unshift(s);
    const q = state.quotes.get(symbol);
    if (q?.name) s.name = q.name;
    toast(`${s.name || s.code} 已加入自选`);
    if (api.user) api.addWatch(symbol, s.name || '').catch(() => {});
    refreshQuotes();
  }
  saveWatchlist();
  render();
}

/** 登录后：把本地自选同步到云端并拉取云端列表 */
async function syncWatchlistAfterLogin() {
  if (!api.user) return;
  try {
    const local = state.watchlist.map((s) => ({ symbol: s.symbol, name: s.name || '' }));
    if (local.length) await api.syncWatchlist(local);
    const cloud = await api.listWatchlist();
    if (cloud?.length) {
      // 合并：云端优先（多端同步）
      const bySym = new Map();
      for (const w of state.watchlist) bySym.set(w.symbol, w);
      for (const c of cloud) {
        if (bySym.has(c.symbol)) bySym.get(c.symbol).name = c.name || bySym.get(c.symbol).name;
        else bySym.set(c.symbol, { code: c.symbol.slice(2), market: c.symbol.slice(0, 2), tencent: c.symbol, symbol: c.symbol, name: c.name || '' });
      }
      state.watchlist = [...bySym.values()];
      saveWatchlist();
      await refreshQuotes();
    }
    toast('自选已同步到云端');
  } catch (e) {
    console.warn('[watchlist-sync]', e);
  }
}

/**
 * 免费版快速分析：单只股票技术面判定。
 * 只跑第 1 层趋势因子 + 简化动量，不涉及全市场遍历与筹码模型。
 */
async function quickAnalyze(symbol) {
  const stock = findStock(symbol);
  const backdrop = el(`
    <div class="sheet-backdrop" id="qaBackdrop">
      <div class="sheet" style="max-height:80vh">
        <div class="sheet-grab"></div>
        <div class="sheet-head">
          <h2 id="qaTitle">快速分析</h2>
          <button class="btn btn-icon" id="qaClose">✕</button>
        </div>
        <div class="sheet-body" id="qaBody">
          <div class="row" style="justify-content:center;padding:26px">
            <div class="spinner"></div>
          </div>
        </div>
      </div>
    </div>`);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('#qaClose').onclick = close;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  backdrop.querySelector('#qaTitle').textContent =
    (stock.name || stock.code) + ' · 快速分析';

  const body = backdrop.querySelector('#qaBody');
  try {
    const [quotes, bars] = await Promise.all([
      API.fetchSnapshots([stock]),
      API.fetchKLine(stock, 320),
    ]);
    const q = quotes.get(stock.symbol);
    if (!q || !bars.length) throw new Error('数据获取失败');

    const cls = IND.closes(bars);
    const ma20 = IND.lastSma(cls, 20);
    const ma60 = IND.lastSma(cls, 60);
    const ma250 = IND.lastSma(cls, 250);
    const ma200Seq = IND.sma(cls, 200).filter((v) => v != null);
    const slope = ma200Seq.length >= 20
      ? IND.regressionSlope(ma200Seq.slice(-20)) : null;
    const rs63 = IND.rs(bars, 63);
    const rs252 = IND.rs(bars, 252);
    const rsi14 = IND.rsi(bars);
    const close = bars[bars.length - 1].close;
    const stack = ma20 > ma60 && ma60 > ma250;
    const aboveMa250 = ma250 != null && close > ma250;
    const pos52 = API.pos52w(q);

    // 综合评级
    let score = 0;
    const checks = [];
    const add = (ok, label, detail) => {
      checks.push({ ok, label, detail });
      if (ok) score += 1;
      return ok;
    };
    add(bars.length >= 260, '上市满一年', `${bars.length} 根K线`);
    add(stack, 'MA 多头排列', ma20 && ma60 && ma250
      ? `MA20 ${ma20.toFixed(2)} / MA60 ${ma60.toFixed(2)} / MA250 ${ma250.toFixed(2)}` : '--');
    add(slope != null && slope > 0, '200MA 上行', slope != null ? `${slope.toFixed(3)}%/日` : '数据不足');
    add(aboveMa250, '站上 200MA', ma250 ? `${(close / ma250 - 1).toFixed(1)}%` : '--');
    add(pos52 >= 0.25 && pos52 <= 0.98, '52周位置合理',
      `分位 ${(pos52 * 100).toFixed(1)}%`);
    add(rs252 != null && rs252 > 0, '年度 RS 为正',
      rs252 != null ? `${(rs252 * 100).toFixed(1)}%` : '--');

    const rating = score >= 5 ? '优' : score >= 3 ? '中' : '弱';
    const ratingColor = score >= 5 ? 'var(--up)' : score >= 3 ? 'var(--warn)' : 'var(--down)';

    body.innerHTML = `
      <div class="card" style="text-align:center;padding:18px">
        <div style="font-size:11px;color:var(--text-3)">趋势评级</div>
        <div style="font-size:34px;font-weight:800;color:${ratingColor};line-height:1.1">${rating}</div>
        <div style="font-size:12px;color:var(--text-3)">通过 ${score}/${checks.length} 项</div>
        <div class="progress" style="margin-top:10px">
          <i style="width:${(score / checks.length * 100).toFixed(0)}%;background:${ratingColor}"></i>
        </div>
      </div>

      <div class="card">
        <div class="card-title">${ICON.filter} 技术面判定</div>
        ${checks.map((c) => `
          <div class="row" style="gap:8px;margin:8px 0;align-items:flex-start">
            <span style="color:${c.ok ? 'var(--up)' : 'var(--flat)'};font-size:13px;flex:0 0 auto">
              ${c.ok ? '✓' : '○'}</span>
            <div class="grow">
              <div style="font-size:12.5px;font-weight:600">${c.label}</div>
              <div style="font-size:10.5px;color:var(--text-3)" class="tnum">${c.detail}</div>
            </div>
          </div>`).join('')}
      </div>

      <div class="card">
        <div class="card-title">${ICON.info} 关键指标</div>
        <div class="grid3">
          ${metric('现价', fmt.price(q.price))}
          ${metric('涨跌幅', fmt.pct(q.changePct), priceClass(q.changePct))}
          ${metric('换手率', fmt.pctAbs(q.turnoverRate))}
          ${metric('RSI(14)', rsi14?.toFixed(1) ?? '--')}
          ${metric('RS 3月', rs63 != null ? fmt.pct(rs63 * 100) : '--', rs63 > 0 ? 'up' : 'down')}
          ${metric('RS 1年', rs252 != null ? fmt.pct(rs252 * 100) : '--', rs252 > 0 ? 'up' : 'down')}
        </div>
      </div>

      <button class="btn" id="qaFull">${ICON.filter} 打开完整详情</button>
      <p style="text-align:center;font-size:10.5px;color:var(--text-3);margin:10px 0 0;line-height:1.5">
        ${api.isVip
          ? 'VIP 可解锁全市场六层漏斗筛选'
          : '升级 VIP 可解锁全市场六层漏斗、筹码分布与枢轴突破信号'}
      </p>`;

    body.querySelector('#qaFull').onclick = () => {
      close();
      openDetail(symbol);
    };
  } catch (e) {
    body.innerHTML = `<p style="text-align:center;color:var(--up);font-size:12.5px;padding:20px">
      分析失败：${esc(e.message || e)}</p>`;
  }
}

/**
 * 股票搜索。
 *
 * 主路径：服务端 /api/search（Worker 代理新浪 suggest3 / 腾讯 smartbox，
 *        覆盖全部 A 股，名称与 ST 状态实时）。
 * 兜底：内置速查表 quickSearch（离线或接口失败时）。
 */
async function doSearch(kw) {
  const q = String(kw || '').trim();

  if (!q) {
    state.searchApi = null;
    state.searching = false;
    render();
    return;
  }

  state.searching = true;
  render();
  // 保持输入焦点与光标
  const keepFocus = () => {
    const ni = document.getElementById('searchInput');
    if (ni) {
      const pos = ni.value.length;
      ni.focus();
      ni.setSelectionRange(pos, pos);
    }
  };
  keepFocus();

  try {
    const r = await api.search(q, 20);
    // 竞态保护：用户可能已经继续输入
    if (state.searchKw.trim() !== q) return;
    state.searchApi = r.items || [];
  } catch (e) {
    console.warn('[search]', e);
    state.searchApi = null;   // 回退到速查表
  } finally {
    if (state.searchKw.trim() === q) {
      state.searching = false;
      render();
      keepFocus();
    }
  }
}

async function openDetail(symbol) {
  lastDetailSymbol = symbol;
  state.tab = 'detail';
  state.detail = { loading: true, stock: findStock(symbol) };
  render();

  const stock = state.detail.stock;
  try {
    const quotes = await API.fetchSnapshots([stock]);
    const quote = quotes.get(stock.symbol) || fallbackQuote(stock);
    if (quote.name && !stock.name) {
      stock.name = quote.name;
      const w = state.watchlist.find((x) => x.symbol === stock.symbol);
      if (w) { w.name = quote.name; saveWatchlist(); }
    }
    state.quotes.set(stock.symbol, quote);

    const bars = await API.fetchKLine(stock, 320);

    // 换手率（筹码峰输入）—— 需代理，否则降级
    let barsWithTurn = bars;
    let hasTurn = false;
    if (localStorage.getItem('sf_proxy')) {
      const turn = await API.fetchTurnover(stock);
      if (turn) {
        barsWithTurn = bars.map((c) => {
          let tr = null;
          for (const [d, v] of turn) { if (d >= c.date) { tr = v; break; } }
          return { ...c, turnoverRate: tr };
        });
        hasTurn = true;
      }
    }
    // 附加派生字段
    barsWithTurn = barsWithTurn.map((c, i, arr) => ({
      ...c,
      changePct: i > 0 && arr[i - 1].close ? (c.close / arr[i - 1].close - 1) * 100 : 0,
    }));

    const chip = ChipDistribution.build(barsWithTurn, { lookback: 250, binCount: 120 });

    state.detail = {
      loading: false,
      stock,
      quote,
      bars: barsWithTurn,
      chip,
      hasTurn,
      pos52: API.pos52w(quote),
    };
  } catch (e) {
    state.detail = { loading: false, error: e?.message || String(e), stock };
  }
  render();
}

function fallbackQuote(stock) {
  return {
    symbol: stock.symbol, code: stock.code, market: stock.market, name: stock.name || stock.code,
    price: 0, prevClose: 0, open: 0, high: 0, low: 0, volume: 0, amount: 0,
    changePct: 0, turnoverRate: 0, amplitude: 0, peTtm: null, pb: null,
    floatCap: 0, totalCap: 0, high52w: 0, low52w: 0, volRatio: 0,
    limitUp: 0, limitDown: 0, updateTime: '',
  };
}

async function ensureUniverse() {
  if (state.universeReady || state.building) return;
  state.building = true;
  state.progress = { message: '枚举代码段…', done: 0, total: 1 };
  render();
  try {
    await loadUniverse({
      force: true,
      onProgress: (p) => {
        state.progress = p;
        // 有输入时只更新提示文字，避免重建 DOM 打断输入
        const label = document.getElementById('uniLabel');
        if (label) {
          label.textContent = `正在建立全市场索引… ${p.message} (${p.done}/${p.total})`;
        } else {
          render();
        }
      },
    });
    state.universeReady = true;
    toast(`代码表就绪：${getUniverse()?.length ?? 0} 只`);
  } catch (e) {
    toast('建立失败：' + (e?.message || e));
  } finally {
    state.building = false;
    state.progress = null;
    render();
  }
}

async function startScreening() {
  if (state.running) return;

  // 门控 1：会员
  if (!api.isVip) {
    if (!api.user) { openAuthSheetWrap(); return; }
    openVipSheet();
    return;
  }

  // 门控 2：额度（本地预检，避免无谓的全市场拉取）
  const q = api.quota;
  if (q && q.remaining <= 0) {
    toast('今日筛选额度已用完，明天再来');
    return;
  }

  // 门控 3：服务端校验并扣减额度（真正的权威校验在服务端）
  try {
    await api.requestScreen('advanced', state.config, {});
  } catch (e) {
    if (e instanceof ApiError) {
      toast(e.message);
      if (e.code === 'vip_required') { openVipSheet(); return; }
      if (e.code === 'quota_exceeded') { await api.refreshMe(); render(); return; }
      if (e.code === 'unauthorized') { openAuthSheetWrap(); return; }
      return;
    }
    toast('额度校验失败，请重试');
    return;
  }

  if (!state.universeReady) { await ensureUniverse(); }
  if (!state.universeReady) return;

  state.running = true;
  state.funnel = null;
  state.selectedStage = -1;
  state.abort = new AbortController();
  state.progress = { message: '准备中…', done: 0, total: 1 };
  render();

  try {
    const r = await runFunnel(
      state.config,
      (p) => { state.progress = p; render(); },
      state.abort.signal
    );
    state.funnel = r;
    if (r.error) toast(r.error);
    else toast(`筛选完成：${r.stages.length ? r.stages[r.stages.length - 1].passed.length : 0} 个信号`);

    // 回填额度（本次已在启动时扣减，此处只刷新显示）
    await api.refreshMe();
  } catch (e) {
    state.funnel = { error: e?.message || String(e), stages: [] };
  } finally {
    state.running = false;
    state.progress = null;
    state.abort = null;
    render();
  }
}

/* ---------------- 参数面板 ---------------- */

const SLIDERS = [
  ['pos52wMin', '① 52周分位下限', 0, 0.6, 0.01, (v) => `${(v * 100).toFixed(0)}%`],
  ['peMax', '② PE 上限', 10, 150, 1, (v) => v.toFixed(0)],
  ['rsTopPercent', '③ RS 排名前百分比', 0.02, 0.5, 0.01, (v) => `${(v * 100).toFixed(0)}%`],
  ['vcpVolumeDryRatio', '④ 末端量能萎缩至', 0.3, 1.0, 0.01, (v) => `${(v * 100).toFixed(0)}%`],
  ['concentration90Max', '⑤ 90%集中度上限', 0.02, 0.3, 0.005, (v) => `${(v * 100).toFixed(1)}%`],
  ['profitRatioMin', '⑤ 获利比例下限', 50, 98, 1, (v) => `${v.toFixed(0)}%`],
  ['breakoutVolumeRatio', '⑥ 突破量比要求', 1.1, 3.0, 0.1, (v) => `${v.toFixed(1)}×`],
  ['minStopLossPct', '⑥ 止损下限', 2, 8, 0.5, (v) => `${v.toFixed(1)}%`],
  ['maxStopLossPct', '⑥ 止损上限', 5, 15, 0.5, (v) => `${v.toFixed(1)}%`],
];

function openConfigSheet() {
  const backdrop = el(`
    <div class="sheet-backdrop" id="cfgBackdrop">
      <div class="sheet">
        <div class="sheet-grab"></div>
        <div class="sheet-head">
          <h2>${t('settings')}</h2>
          <button class="btn btn-icon" id="cfgClose">${esc('✕')}</button>
        </div>
        <div class="sheet-body">
          <div class="row" style="gap:7px;margin-bottom:14px">
            ${['standard', 'aggressive', 'strict'].map((p) => `
              <button class="chip ${state.preset === p ? 'on' : ''}" data-preset="${p}">
                ${{ standard: '标准', aggressive: '激进', strict: '严格' }[p]}
              </button>`).join('')}
          </div>

          ${SLIDERS.map(([key, label, min, max, step, f]) => `
            <div style="margin:10px 0">
              <div class="row">
                <span style="font-size:12.5px" class="grow">${label}</span>
                <span class="tnum" style="font-size:12.5px;font-weight:800" id="lbl-${key}">
                  ${f(state.config[key])}
                </span>
              </div>
              <input type="range" data-cfg="${key}" min="${min}" max="${max}" step="${step}"
                value="${state.config[key]}">
            </div>`).join('')}

          <hr class="sep">
          <div class="card-title">${ICON.info} 换手率数据源（筹码峰）</div>
          <p style="margin:0 0 9px;font-size:11.5px;color:var(--text-2);line-height:1.55">
            筹码分布模型需要<b>历史每日换手率</b>。该数据来自搜狐接口，
            但它<b>不返回 CORS 头</b>，浏览器无法直连。需部署一个代理后填入：
          </p>
          <input type="text" id="proxyInput" placeholder="https://your-worker.workers.dev/?url="
            value="${localStorage.getItem('sf_proxy') || ''}" style="margin-bottom:8px">
          <p style="margin:0;font-size:10.5px;color:var(--text-3);line-height:1.5">
            仓库 <code>workers/proxy.js</code> 为可直接部署的 Cloudflare Worker 代理。
            未配置时筹码层会降级估算，精度下降但流程完整。
          </p>

          <button class="btn btn-primary" id="cfgApply" style="margin-top:16px">
            ${ICON.play} 应用并重新筛选
          </button>
        </div>
      </div>
    </div>`);

  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector('#cfgClose').onclick = close;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };

  backdrop.querySelectorAll('[data-preset]').forEach((b) => {
    b.onclick = () => {
      state.preset = b.dataset.preset;
      state.config = { ...PRESETS[state.preset] };
      close();
      openConfigSheet();
    };
  });

  backdrop.querySelectorAll('[data-cfg]').forEach((inp) => {
    inp.oninput = () => {
      const key = inp.dataset.cfg;
      state.config[key] = parseFloat(inp.value);
      const def = SLIDERS.find((s) => s[0] === key);
      backdrop.querySelector(`#lbl-${key}`).textContent = def[5](state.config[key]);
      state.preset = 'custom';
    };
  });

  backdrop.querySelector('#cfgApply').onclick = () => {
    const p = backdrop.querySelector('#proxyInput').value.trim();
    if (p) localStorage.setItem('sf_proxy', p);
    else localStorage.removeItem('sf_proxy');
    close();
    toast('参数已应用');
    startScreening();
  };
}

/* ---------------- Tab 进入 ---------------- */

function onEnterTab() {
  if (state.tab === 'watchlist') {
    refreshQuotes();
  } else if (state.tab === 'search') {
    // 搜索页不自动建立全市场索引（实测枚举约 8 秒，但会让页面卡顿）
    // 速查表已覆盖常用股票；需要全市场时点按钮手动建立
  } else if (state.tab === 'funnel') {
    if (!state.universeReady) ensureUniverse();
  }
}

function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// 首次进入
onEnterTab();

// 恢复会话（静默，不阻塞首屏）
api.refreshMe().then((u) => {
  if (u) {
    syncWatchlistAfterLogin().then(render);
  } else {
    render();
  }
}).catch(() => render());

/**
 * 后端连通性检测。
 * 若前端在 pages.dev 而 /api 代理未生效，这里会失败，
 * 用户就能明确看到「后端不可达」而不是一堆空白页面。
 */
async function checkBackend() {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.backendOk = true;
  } catch (e) {
    state.backendOk = false;
    console.warn('[backend] 不可达', e);
  }
  render();
}

// 会话变化时刷新 UI（登录/退出/会员变更）
api.onChange(() => {
  if (state.tab === 'funnel') state.funnel = null;
  render();
});

// PWA：注册 Service Worker（localhost 下跳过，避免开发期缓存干扰）
if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// 主题变化时重绘 Canvas
new MutationObserver(() => {
  if (state.tab === 'detail' && state.detail && !state.detail.loading) {
    setTimeout(drawDetailCharts, 30);
  }
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// 窗口尺寸变化重绘
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.tab === 'detail' && state.detail && !state.detail.loading) drawDetailCharts();
  }, 160);
});
