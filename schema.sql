/**
 * D1 数据库 schema
 * ------------------------------------------------------------------
 * Cloudflare D1 是基于 SQLite 的无服务器数据库，与 Workers 同域部署，
 * 彻底避免跨域问题。
 *
 * 执行方式：
 *   wrangler d1 execute stockfunnel --file=./schema.sql
 */

/* ---------------- 用户表 ---------------- */
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,          -- PBKDF2-SHA256, 格式: iterations$salt$hash
  is_vip        INTEGER NOT NULL DEFAULT 0,
  vip_expires   TEXT,                      -- ISO8601, NULL = 永久
  is_admin      INTEGER NOT NULL DEFAULT 0,
  is_banned     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login    TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_vip     ON users(is_vip);

/* ---------------- 会话表 ---------------- */
/* 采用服务端会话而非无状态 JWT：便于「封禁立即生效」「单点登出」 */
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  user_agent TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT    NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

/* ---------------- 自选股表 ---------------- */
CREATE TABLE IF NOT EXISTS watchlist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  symbol     TEXT    NOT NULL,             -- sh600519
  name       TEXT    NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, symbol),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id, sort_order);

/* ---------------- 筛选记录表 ---------------- */
/* 保存用户的筛选结果，便于回溯与二次分析 */
CREATE TABLE IF NOT EXISTS screen_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  tier         TEXT    NOT NULL,           -- 'basic' | 'advanced'
  config_json  TEXT    NOT NULL,
  universe     INTEGER NOT NULL DEFAULT 0,
  stage_counts TEXT    NOT NULL DEFAULT '[]',  -- JSON array
  signal_count INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_runs_user ON screen_runs(user_id, created_at DESC);

/* ---------------- 使用额度表 ---------------- */
/* 免费用户每日筛选次数限制 */
CREATE TABLE IF NOT EXISTS usage_daily (
  user_id      INTEGER NOT NULL,
  day          TEXT    NOT NULL,           -- YYYY-MM-DD
  screen_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

/* ---------------- 登录审计 ---------------- */
CREATE TABLE IF NOT EXISTS auth_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  username   TEXT,
  action     TEXT    NOT NULL,             -- register | login | login_fail | logout | admin_update
  ip         TEXT,
  user_agent TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_authlog_time ON auth_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_authlog_user ON auth_log(user_id);
