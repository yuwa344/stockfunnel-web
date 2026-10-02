# 部署指南

## 最快方式：双击脚本（Windows）

项目根目录有 `deploy.bat`，**双击即可**，或在 cmd.exe 里：

```bat
cd C:\Users\Huang\WorkBuddy\2026-10-02-22-34-03\stockfunnel-web

deploy.bat login     :: 登录 Cloudflare（自动开浏览器）
deploy.bat db        :: 创建 D1 数据库
deploy.bat init      :: 建表
deploy.bat go        :: 一键：建库 + 建表 + 部署
deploy.bat admin     :: 创建管理员账号
deploy.bat proxy     :: 查看换手率代理部署说明
```

脚本内部使用 `npx wrangler`（项目已自带 wrangler 4.147，无需全局安装）。
**不要在 cmd.exe 里用 `#` 写注释** —— 那是 bash 语法，Windows 会报
`'#' 不是内部或外部命令`。

---

## 手动方式（Git Bash / PowerShell）

### 前置：一次性准备

```bash
npm i -g wrangler      # 可选，项目已自带 wrangler
wrangler login         # 浏览器授权，需你的 Cloudflare 账号
```

## 步骤

> 命令里若用 wrangler 代替 `npx wrangler`，需先 `npm i -g wrangler`；
> 直接用 `npx wrangler` 则无需全局安装。

### 1. 创建 D1 数据库

```bash
npx wrangler d1 create stockfunnel
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
npx wrangler d1 execute stockfunnel --file=./schema.sql
```

### 3. 创建管理员

```bash
node scripts/create-admin.js admin 你的密码
```

复制输出的 `sql` 字段，然后：

```bash
npx wrangler d1 execute stockfunnel --command "<粘贴上一步的 SQL>"
```

### 4. 部署

```bash
npx wrangler deploy
```

输出会给出 `https://stockfunnel.<你的子域>.workers.dev`。

### 5.（可选）绑定自定义域

Cloudflare Dashboard → Workers & Pages → stockfunnel → Settings → Domains → Add

## 更新部署

```bash
npx wrangler deploy
```

## 换手率代理（可选，提升筹码层精度）

1. Cloudflare Dashboard → Workers & Pages → Create → Worker
2. 粘贴 `workers/proxy.js` 内容 → Deploy
3. 在应用内：漏斗 → 参数 → 换手率数据源，填入 `https://<代理名>.<子域>.workers.dev/?url=`

## 常见问题

**D1 database_id 填错**
`npx wrangler d1 list` 可查看已有的库与 ID。

**忘记管理员密码**
```bash
npx wrangler d1 execute stockfunnel --command "DELETE FROM users WHERE username='admin'"
node scripts/create-admin.js admin 新密码
# 再次执行输出的 SQL
```

**前端 404 / 白屏**
Worker 的 `assets.directory` 指向项目根目录，确保 `index.html` 在根目录。

**跨域报错**
正常情况下同域部署不会有 CORS 问题。若使用了自定义域名回源，检查是否正确绑定了 Worker。
