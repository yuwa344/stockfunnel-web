/**
 * 后端 API 客户端
 * ------------------------------------------------------------------
 * 与 Worker 同域，因此所有请求都是相对路径，无 CORS 问题。
 * 鉴权用 Bearer token（存内存 + localStorage 持久化）。
 */

const TOKEN_KEY = 'sf_token';

export class Api {
  constructor() {
    this.token = localStorage.getItem(TOKEN_KEY) || null;
    this.user = null;
    this.quota = null;
    this._listeners = new Set();
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    for (const fn of this._listeners) fn(this.user);
  }

  _setToken(t) {
    this.token = t;
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  }

  async _req(path, { method = 'GET', body, auth = true } = {}) {
    const headers = {};
    if (body != null) headers['Content-Type'] = 'application/json';
    if (auth && this.token) headers['Authorization'] = `Bearer ${this.token}`;

    let res;
    try {
      res = await fetch(`/api${path}`, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new ApiError('网络请求失败，请检查连接', 'network');
    }

    let data = null;
    try { data = await res.json(); } catch { /* 非 JSON */ }

    if (!res.ok) {
      if (res.status === 401) {
        // 会话失效
        this._setToken(null);
        this.user = null;
        this._emit();
      }
      throw new ApiError(
        data?.message || `请求失败 (${res.status})`,
        data?.error || String(res.status),
        res.status
      );
    }
    return data;
  }

  /* ---------------- 鉴权 ---------------- */

  async register(username, password) {
    const r = await this._req('/auth/register', {
      method: 'POST',
      body: { username, password },
      auth: false,
    });
    this._setToken(r.token);
    this.user = r.user;
    this._emit();
    return r.user;
  }

  async login(username, password) {
    const r = await this._req('/auth/login', {
      method: 'POST',
      body: { username, password },
      auth: false,
    });
    this._setToken(r.token);
    this.user = r.user;
    this._emit();
    await this.refreshMe();
    return r.user;
  }

  async logout() {
    try { await this._req('/auth/logout', { method: 'POST' }); } catch { /* 忽略 */ }
    this._setToken(null);
    this.user = null;
    this.quota = null;
    this._emit();
  }

  async refreshMe() {
    try {
      const r = await this._req('/me', { auth: !!this.token });
      this.user = r.user;
      this.quota = r.quota;
    } catch {
      this.user = null;
    }
    this._emit();
    return this.user;
  }

  get tier() {
    if (!this.user) return 'guest';
    if (this.user.isAdmin) return 'admin';
    return this.user.isVip ? 'vip' : 'free';
  }

  get isVip() {
    return this.tier === 'vip' || this.tier === 'admin';
  }

  get isAdmin() {
    return !!this.user?.isAdmin;
  }

  /* ---------------- 自选 ---------------- */

  async listWatchlist() {
    const r = await this._req('/watchlist');
    return r.items;
  }

  async addWatch(symbol, name) {
    const r = await this._req('/watchlist', { method: 'POST', body: { symbol, name } });
    return r.items;
  }

  async removeWatch(symbol) {
    const r = await this._req(`/watchlist?symbol=${encodeURIComponent(symbol)}`, {
      method: 'DELETE',
    });
    return r.items;
  }

  async syncWatchlist(items) {
    const r = await this._req('/watchlist/sync', { method: 'POST', body: { items } });
    return r.items;
  }

  /* ---------------- 筛选额度 ---------------- */

  /**
   * 申请筛选额度。
   * 实际筛选在客户端完成（浏览器直连行情源，服务器不做计算瓶颈），
   * 服务端只做鉴权 + 额度扣减 + 审计。
   */
  async requestScreen(tier, config, result) {
    const r = await this._req('/screen', {
      method: 'POST',
      body: { tier, config, result },
    });
    this.quota = r.quota;
    return r;
  }

  async screenHistory() {
    const r = await this._req('/screen/history');
    return r.items;
  }

  async vipInfo() {
    return this._req('/vip/info');
  }

  /* ---------------- Admin ---------------- */

  async adminUsers(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this._req(`/admin/users${qs ? '?' + qs : ''}`);
  }

  async adminUpdate(payload) {
    return this._req('/admin/users/update', { method: 'POST', body: payload });
  }

  async adminDelete(id) {
    return this._req('/admin/users/delete', { method: 'POST', body: { id } });
  }

  async adminStats() {
    return this._req('/admin/stats');
  }

  async adminLogs() {
    return this._req('/admin/logs');
  }
}

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const api = new Api();
