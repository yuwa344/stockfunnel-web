# 部署指南

## 前置：一次性准备

```bash
npm i -g wrangler
wrangler login          # 浏览器授权，需你的 Cloudflare 账号
```

## 步骤

### 1. 创建 D1 数据库

```bash
wrangler d1 create stockfunnel
```

输出里有一行：
```
{ "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", ... }
```
把它填入 `wrangler.toml`：

```toml
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "stockfunnel",
    "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",   ← 替换这里
    "migrations_dir": "migrations"
  }
]
```

### 2. 初始化表结构

```bash
wrangler d1 execute stockfunnel --file=./schema.sql
```

### 3. 创建管理员

```bash
node scripts/create-admin.js admin 你的密码
```

复制输出的 `sql` 字段，然后：

```bash
wrangler d1 execute stockfunnel --command "<粘贴上一步的 SQL>"
```

### 4. 部署

```bash
wrangler deploy
```

输出会给出 `https://stockfunnel.<你的子域>.workers.dev`。

### 5.（可选）绑定自定义域

Cloudflare Dashboard → Workers & Pages → stockfunnel → Settings → Domains → Add

## 更新部署

```bash
wrangler deploy
```

## 换手率代理（可选，提升筹码层精度）

1. Cloudflare Dashboard → Workers & Pages → Create → Worker
2. 粘贴 `workers/proxy.js` 内容 → Deploy
3. 在应用内：漏斗 → 参数 → 换手率数据源，填入 `https://<代理名>.<子域>.workers.dev/?url=`

## 常见问题

**D1 database_id 填错**
`wrangler d1 list` 可查看已有的库与 ID。

**忘记管理员密码**
```bash
wrangler d1 execute stockfunnel --command "DELETE FROM users WHERE username='admin'"
node scripts/create-admin.js admin 新密码
# 再次执行输出的 SQL
```

**前端 404 / 白屏**
Worker 的 `assets.directory` 指向项目根目录，确保 `index.html` 在根目录。

**跨域报错**
正常情况下同域部署不会有 CORS 问题。若使用了自定义域名回源，检查是否正确绑定了 Worker。
