/**
 * 认证与会员相关 UI：登录页、注册、会员升级、Admin 后台。
 * 全部为 Liquid Glass 风格，与主应用视觉统一。
 */

import { api, ApiError } from '../core/api-client.js';
import { el, esc, toast, ICON, t } from '../core/utils.js';

/* ================================================================== */
/* 登录 / 注册                                                          */
/* ================================================================== */

export function openAuthSheet(onSuccess) {
  let mode = 'login';

  const backdrop = el(`
    <div class="sheet-backdrop" id="authBackdrop">
      <div class="sheet" style="max-height:92vh">
        <div class="sheet-grab"></div>
        <div class="sheet-head">
          <h2 id="authTitle">登录</h2>
          <button class="btn btn-icon" id="authClose">✕</button>
        </div>
        <div class="sheet-body">
          <div class="row" style="gap:7px;margin-bottom:16px">
            <button class="chip on grow" data-mode="login" style="justify-content:center">登录</button>
            <button class="chip grow" data-mode="register" style="justify-content:center">注册</button>
          </div>

          <div id="authError" style="display:none;padding:10px 12px;margin-bottom:12px;
            border-radius:var(--r-md);background:rgba(232,69,60,.12);
            border:1px solid rgba(232,69,60,.3);color:var(--up);font-size:12.5px"></div>

          <div style="margin-bottom:12px">
            <div class="metric-label" style="margin-bottom:5px">用户名</div>
            <input type="text" id="authUser" placeholder="3-20 位，支持中英文" autocomplete="username">
          </div>
          <div style="margin-bottom:12px">
            <div class="metric-label" style="margin-bottom:5px">密码</div>
            <input type="password" id="authPass" placeholder="至少 6 位"
              autocomplete="current-password"
              onkeydown="if(event.key==='Enter')document.getElementById('authSubmit').click()">
          </div>
          <div id="authPass2Wrap" style="display:none;margin-bottom:12px">
            <div class="metric-label" style="margin-bottom:5px">确认密码</div>
            <input type="password" id="authPass2" placeholder="再次输入密码"
              autocomplete="new-password">
          </div>

          <button class="btn btn-primary" id="authSubmit">登录</button>

          <hr class="sep">
          <p style="margin:0;font-size:11.5px;color:var(--text-2);line-height:1.55">
            注册即可使用<b>免费版</b>：单只股票技术分析 + 简化趋势筛选。
            升级 <b>VIP</b> 解锁全市场六层漏斗、筹码分布与枢轴突破信号。
          </p>
        </div>
      </div>
    </div>`);

  document.body.appendChild(backdrop);
  const $ = (s) => backdrop.querySelector(s);

  const close = () => { backdrop.remove(); };

  const setMode = (m) => {
    mode = m;
    backdrop.querySelectorAll('[data-mode]').forEach((b) =>
      b.classList.toggle('on', b.dataset.mode === m));
    $('#authTitle').textContent = m === 'login' ? '登录' : '注册';
    $('#authSubmit').textContent = m === 'login' ? '登录' : '注册并开始';
    $('#authPass2Wrap').style.display = m === 'register' ? '' : 'none';
    $('#authPass').setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
    $('#authError').style.display = 'none';
  };

  backdrop.querySelectorAll('[data-mode]').forEach((b) => {
    b.onclick = () => setMode(b.dataset.mode);
  });
  $('#authClose').onclick = close;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };

  $('#authSubmit').onclick = async () => {
    const username = $('#authUser').value.trim();
    const password = $('#authPass').value;
    const btn = $('#authSubmit');

    const showErr = (m) => {
      const box = $('#authError');
      box.textContent = m;
      box.style.display = '';
    };

    if (!username || !password) return showErr('请填写用户名与密码');
    if (mode === 'register' && password !== $('#authPass2').value) {
      return showErr('两次输入的密码不一致');
    }

    btn.disabled = true;
    btn.textContent = '处理中…';
    try {
      if (mode === 'login') await api.login(username, password);
      else await api.register(username, password);
      close();
      toast(mode === 'login' ? '登录成功' : '注册成功，欢迎加入');
      onSuccess?.();
    } catch (e) {
      showErr(e instanceof ApiError ? e.message : '操作失败，请重试');
      btn.disabled = false;
      btn.textContent = mode === 'login' ? '登录' : '注册并开始';
    }
  };

  setTimeout(() => $('#authUser')?.focus(), 120);
  return close;
}

/* ================================================================== */
/* 会员升级页                                                          */
/* ================================================================== */

export function openVipSheet() {
  const tiers = [
    {
      id: 'free', name: '免费版', price: '¥0',
      features: ['单只股票技术分析', 'K 线与关键指标', '简化趋势筛选', '3 次/日筛选额度'],
      cur: api.tier === 'free',
    },
    {
      id: 'vip', name: 'VIP 会员', price: '¥28/月', featured: true,
      features: [
        '全市场六层漏斗筛选', '筹码分布与集中度', '枢轴突破开仓信号',
        '枢轴位与 5-8% 止损参数', '云端自选同步', '50 次/日筛选额度',
      ],
    },
  ];

  const backdrop = el(`
    <div class="sheet-backdrop" id="vipBackdrop">
      <div class="sheet">
        <div class="sheet-grab"></div>
        <div class="sheet-head">
          <h2>会员方案</h2>
          <button class="btn btn-icon" id="vipClose">✕</button>
        </div>
        <div class="sheet-body">
          <p style="margin:0 0 14px;font-size:12.5px;color:var(--text-2);line-height:1.55">
            六层漏斗筛选需要遍历全市场 K 线并逐层计算，属重度计算能力。
            免费版提供单只分析与简化筛选，VIP 解锁完整漏斗。
          </p>

          ${tiers.map((tr) => `
            <div class="card" style="margin-bottom:11px;${tr.featured
              ? 'border-color:rgba(10,132,255,.4);box-shadow:var(--glass-shadow),0 0 0 1px rgba(10,132,255,.14)'
              : ''}">
              <div class="row">
                <div>
                  <div style="font-size:15px;font-weight:800">${tr.name}</div>
                  <div style="font-size:11px;color:var(--text-3)">${tr.price}</div>
                </div>
                <span class="grow"></span>
                ${tr.cur
                  ? '<span class="badge" style="background:rgba(10,132,255,.16);color:#0a84ff">当前方案</span>'
                  : tr.featured
                    ? '<span class="badge" style="background:rgba(10,132,255,.16);color:#0a84ff">推荐</span>'
                    : ''}
              </div>
              <hr class="sep">
              ${tr.features.map((f) => `
                <div class="row" style="gap:7px;margin:5px 0">
                  <span style="color:var(--down);flex:0 0 auto;font-size:13px">✓</span>
                  <span style="font-size:12.5px">${f}</span>
                </div>`).join('')}
              ${tr.featured ? `<button class="btn btn-primary" data-upgrade
                style="margin-top:11px">联系管理员开通</button>` : ''}
            </div>`).join('')}

          <p style="margin:12px 0 0;font-size:11px;color:var(--text-3);line-height:1.55;text-align:center">
            支付通道暂未接入，请联系管理员在后台为您开通 VIP。
          </p>
        </div>
      </div>
    </div>`);

  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('#vipClose').onclick = close;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  backdrop.querySelectorAll('[data-upgrade]').forEach((b) => {
    b.onclick = () => { close(); toast('请联系管理员开通 VIP 会员'); };
  });
}

/* ================================================================== */
/* Admin 后台                                                          */
/* ================================================================== */

export function openAdminSheet(onChange) {
  if (!api.isAdmin) { toast('需要管理员权限'); return; }

  const backdrop = el(`
    <div class="sheet-backdrop" id="adminBackdrop">
      <div class="sheet" style="max-height:94vh">
        <div class="sheet-grab"></div>
        <div class="sheet-head">
          <h2>${ICON.tune} 管理后台</h2>
          <button class="btn btn-icon" id="adminClose">✕</button>
        </div>
        <div class="sheet-body">
          <div id="adminStats" class="grid3" style="text-align:center;margin-bottom:14px"></div>

          <div class="row" style="margin-bottom:12px">
            <input type="search" id="adminSearch" placeholder="搜索用户名…">
            <button class="btn btn-icon" id="adminRefresh">${ICON.refresh}</button>
          </div>

          <div class="row" style="gap:7px;margin-bottom:10px">
            <button class="chip on" data-filter="all">全部</button>
            <button class="chip" data-filter="vip">VIP</button>
            <button class="chip" data-filter="free">免费</button>
            <button class="chip" data-filter="banned">封禁</button>
          </div>

          <div id="adminList"></div>
        </div>
      </div>
    </div>`);

  document.body.appendChild(backdrop);
  const $ = (s) => backdrop.querySelector(s);
  const close = () => backdrop.remove();
  $('#adminClose').onclick = close;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };

  let filter = 'all';
  let keyword = '';

  const load = async () => {
    $('#adminList').innerHTML = '<div class="row" style="justify-content:center;padding:20px"><div class="spinner"></div></div>';
    try {
      const [stats, users] = await Promise.all([
        api.adminStats(),
        api.adminUsers({ q: keyword, size: 50 }),
      ]);

      $('#adminStats').innerHTML = `
        <div><div class="metric-value" style="font-size:18px">${stats.users}</div><div class="metric-label">用户</div></div>
        <div><div class="metric-value" style="font-size:18px;color:#f0a020">${stats.vip}</div><div class="metric-label">VIP</div></div>
        <div><div class="metric-value" style="font-size:18px">${stats.todayRuns}</div><div class="metric-label">今日筛选</div></div>`;

      let items = users.items;
      if (filter === 'vip') items = items.filter((u) => u.isVip);
      else if (filter === 'free') items = items.filter((u) => !u.isVip && !u.isBanned);
      else if (filter === 'banned') items = items.filter((u) => u.isBanned);

      if (!items.length) {
        $('#adminList').innerHTML = '<p style="text-align:center;color:var(--text-3);font-size:12.5px;padding:20px">无匹配用户</p>';
        return;
      }

      $('#adminList').innerHTML = items.map((u) => `
        <div class="card" style="padding:12px;margin-bottom:9px" data-uid="${u.id}">
          <div class="row">
            <div class="grow">
              <div class="row" style="gap:6px">
                <span style="font-size:14px;font-weight:700">${esc(u.username)}</span>
                ${u.isVip ? '<span class="badge" style="background:rgba(240,160,32,.18);color:#f0a020">VIP</span>' : ''}
                ${u.isAdmin ? '<span class="badge" style="background:rgba(124,92,255,.18);color:#7c5cff">管理员</span>' : ''}
                ${u.isBanned ? '<span class="badge" style="background:rgba(232,69,60,.18);color:var(--up)">封禁</span>' : ''}
              </div>
              <div style="font-size:10.5px;color:var(--text-3);margin-top:2px">
                注册 ${String(u.createdAt).slice(0, 10)} · 筛选 ${u.runs} 次
                ${u.vipExpires ? ` · VIP至 ${String(u.vipExpires).slice(0, 10)}` : ''}
              </div>
            </div>
          </div>
          <div class="row" style="gap:6px;margin-top:10px;flex-wrap:wrap">
            <button class="chip" data-act="vip" data-id="${u.id}" data-cur="${u.isVip}">
              ${u.isVip ? '取消 VIP' : '开通 VIP'}
            </button>
            <button class="chip" data-act="vip30" data-id="${u.id}">VIP 30天</button>
            <button class="chip" data-act="vip365" data-id="${u.id}">VIP 一年</button>
            <button class="chip" data-act="ban" data-id="${u.id}" data-cur="${u.isBanned}">
              ${u.isBanned ? '解封' : '封禁'}
            </button>
            <button class="chip" data-act="admin" data-id="${u.id}" data-cur="${u.isAdmin}">
              ${u.isAdmin ? '取消管理员' : '设为管理员'}
            </button>
            <button class="chip" data-act="del" data-id="${u.id}"
              style="color:var(--up)">删除</button>
          </div>
        </div>`).join('');

      // 绑定操作
      backdrop.querySelectorAll('[data-act]').forEach((b) => {
        b.onclick = async () => {
          const { act, id, cur } = b.dataset;
          b.disabled = true;
          try {
            if (act === 'vip') {
              await api.adminUpdate({ id: Number(id), isVip: cur !== 'true' });
            } else if (act === 'vip30') {
              const exp = new Date(Date.now() + 30 * 86400000).toISOString();
              await api.adminUpdate({ id: Number(id), isVip: true, vipExpires: exp });
            } else if (act === 'vip365') {
              const exp = new Date(Date.now() + 365 * 86400000).toISOString();
              await api.adminUpdate({ id: Number(id), isVip: true, vipExpires: exp });
            } else if (act === 'ban') {
              await api.adminUpdate({ id: Number(id), isBanned: cur !== 'true' });
            } else if (act === 'admin') {
              await api.adminUpdate({ id: Number(id), isAdmin: cur !== 'true' });
            } else if (act === 'del') {
              if (!confirm('确定删除该用户？其自选与记录将一并删除。')) { b.disabled = false; return; }
              await api.adminDelete(Number(id));
            }
            toast('操作成功');
            await load();
            onChange?.();
          } catch (e) {
            toast(e instanceof ApiError ? e.message : '操作失败');
            b.disabled = false;
          }
        };
      });
    } catch (e) {
      $('#adminList').innerHTML =
        `<p style="color:var(--up);font-size:12.5px;text-align:center">${esc(e.message || '加载失败')}</p>`;
    }
  };

  let searchTimer = null;
  $('#adminSearch').oninput = (e) => {
    keyword = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 300);
  };
  $('#adminRefresh').onclick = load;
  backdrop.querySelectorAll('[data-filter]').forEach((b) => {
    b.onclick = () => {
      filter = b.dataset.filter;
      backdrop.querySelectorAll('[data-filter]').forEach((x) =>
        x.classList.toggle('on', x === b));
      load();
    };
  });

  load();
}

/* ================================================================== */
/* 账号菜单                                                            */
/* ================================================================== */

export function openAccountSheet(onChange) {
  const u = api.user;
  if (!u) { openAuthSheet(onChange); return; }

  const tierName = { free: '免费版', vip: 'VIP 会员', admin: '管理员' }[api.tier];
  const quota = api.quota;

  const backdrop = el(`
    <div class="sheet-backdrop" id="accBackdrop">
      <div class="sheet" style="max-height:auto">
        <div class="sheet-grab"></div>
        <div class="sheet-head">
          <h2>账号</h2>
          <button class="btn btn-icon" id="accClose">✕</button>
        </div>
        <div class="sheet-body">
          <div class="card" style="padding:14px">
            <div class="row">
              <div>
                <div style="font-size:16px;font-weight:800">${esc(u.username)}</div>
                <div class="row" style="gap:6px;margin-top:4px">
                  <span class="badge" style="background:${api.isVip
                    ? 'rgba(240,160,32,.18);color:#f0a020' : 'rgba(10,132,255,.16);color:#0a84ff'}">
                    ${tierName}
                  </span>
                  ${u.vipExpires ? `<span style="font-size:10.5px;color:var(--text-3)">
                    至 ${String(u.vipExpires).slice(0, 10)}</span>` : ''}
                </div>
              </div>
              <span class="grow"></span>
            </div>
            ${quota ? `<hr class="sep">
              <div class="row">
                <div class="grow">
                  <div style="font-size:11.5px;color:var(--text-2)">今日筛选额度</div>
                  <div class="progress" style="height:5px;margin-top:5px">
                    <i style="width:${Math.min(100, quota.used / quota.limit * 100).toFixed(0)}%"></i>
                  </div>
                </div>
                <span class="tnum" style="font-size:12px;font-weight:700">
                  ${quota.used}/${quota.limit}
                </span>
              </div>` : ''}
          </div>

          ${!api.isVip ? `<button class="btn btn-primary" id="accVip" style="margin-bottom:9px">
            ${ICON.bolt} 升级 VIP 解锁六层漏斗
          </button>` : ''}

          ${api.isAdmin ? `<button class="btn" id="accAdmin" style="margin-bottom:9px">
            ${ICON.tune} 管理后台
          </button>` : ''}

          <button class="btn" id="accLogout">退出登录</button>
        </div>
      </div>
    </div>`);

  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('#accClose').onclick = close;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };

  const vipBtn = backdrop.querySelector('#accVip');
  if (vipBtn) vipBtn.onclick = () => { close(); openVipSheet(); };

  const adminBtn = backdrop.querySelector('#accAdmin');
  if (adminBtn) adminBtn.onclick = () => { close(); openAdminSheet(onChange); };

  backdrop.querySelector('#accLogout').onclick = async () => {
    await api.logout();
    close();
    toast('已退出登录');
    onChange?.();
  };
}
