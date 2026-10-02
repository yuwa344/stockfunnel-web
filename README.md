# 六层漏斗选股（A 股全市场多因子筛选）

跨端 Web 应用。Liquid Glass 视觉，色调跟随系统，iOS/Android 均可安装到桌面。

## 六层筛选漏斗

| 层 | 名称 | 核心规则 |
|---|---|---|
| ① | 长期趋势 | MA20>60>120>250 多头排列 · 200MA 回归斜率上行 · 52 周分位 ∈ [25%, 98%] |
| ② | 基本面爆发 | PE ∈ (0, 80] · PB ≤ 12 · 流通市值 30–3000 亿 · 景气度加速确认 |
| ③ | 动量强度 RS | 63/126/252 日多周期 RS，横向截面排名取前 15% |
| ④ | VCP 收缩 | 摆动波段深度逐级收窄 · 末端量能萎缩至前期 65% 以下 |
| ⑤ | 筹码集中 | 90% 筹码集中度 < 10% · 获利比 > 85% · 上方无阻力峰（单峰密集） |
| ⑥ | 枢轴突破 | 突破 20 日枢轴点 · 量能 ≥ 1.5× · 止损严格 5%–8% · 目标 2R |

## 数据来源（实测 CORS 结论）

| 端点 | CORS | 用途 | 处理 |
|---|---|---|---|
| `qt.gtimg.cn` | ✅ `*` | 实时快照（60 只/请求批量） | 浏览器直连 |
| `web.ifzq.gtimg.cn` | ✅ `*` | 日 K 线（前复权） | 浏览器直连 |
| `smartbox.gtimg.cn` | ❌ | 搜索 | **改用本地全市场索引** |
| `q.stock.sohu.com` | ❌ | 历史换手率（筹码峰必需） | **需代理** |

腾讯接口返回 **GBK** 编码，浏览器用 `TextDecoder('gb18030')` 解码（超集，兼容 GBK 生僻字）。

### 换手率代理（可选但推荐）

筹码分布模型需要历史每日换手率。搜狐无 CORS 头，需部署代理：

1. Cloudflare Dashboard → Workers → Create Worker
2. 粘贴 `workers/proxy.js` → Deploy
3. 在应用「漏斗 → 参数 → 换手率数据源」填入 `https://your-worker.workers.dev/?url=`

未配置时代码可运行，但筹码层精度下降，界面会明确标注。

## 技术栈

- **前端**：原生 ES Module + Canvas 自绘（零框架、零构建）
- **样式**：Apple Liquid Glass（`backdrop-filter` + 环境光斑 + 顶部高光 + 内阴影）
- **后端**：Cloudflare Workers + D1（SQLite）
- **鉴权**：PBKDF2-SHA256 120k 迭代 + 服务端会话（封禁即时生效）

## 部署

```bash
npm i -g wrangler
wrangler login

# 1. 创建 D1
wrangler d1 create stockfunnel
#    把返回的 database_id 填入 wrangler.toml

# 2. 初始化表结构
wrangler d1 execute stockfunnel --file=./schema.sql

# 3. 创建首个管理员（在 D1 控制台执行，把 <哈希> 换成下方脚本生成的值）
node -e "const c=require('crypto');..."
#    或本地临时提升：UPDATE users SET is_admin=1 WHERE username='你的用户名';

# 4. 部署
wrangler deploy

# 5. 绑定自定义域（可选）
wrangler pages project create    # 若用 Pages
```

本地开发：

```bash
npx wrangler dev            # 含 D1 本地模拟
# 或纯静态（无后端）
python -m http.server 8899
```

## 会员分级

| 等级 | 权限 | 额度 |
|---|---|---|
| 游客 | 行情 / K 线 / 搜索 / 快速分析 | — |
| 免费 | + 云端自选同步 | 3 次/日筛选 |
| VIP | + 全市场六层漏斗 + 筹码分布 + 枢轴信号 | 50 次/日筛选 |
| 管理员 | + 后台管理（用户 / VIP 开关 / 封禁 / 统计 / 审计） | 无限 |

筛选实际在浏览器完成（直连行情源），服务端只做**鉴权 + 额度扣减 + 审计**，避免服务器成为计算瓶颈。

## PWA / 桌面安装

- **Android / 桌面 Chrome**：捕获 `beforeinstallprompt`，点击按钮直接弹安装框
- **iOS Safari**：不支持该 API，自动生成 `.mobileconfig` 描述文件，下载安装后主屏幕出现 Web Clip 图标

## 目录结构

```
├── index.html
├── manifest.webmanifest
├── sw.js                    Service Worker（离线壳缓存）
├── schema.sql               D1 表结构
├── wrangler.toml
├── workers/proxy.js         换手率 CORS 代理（可选部署）
├── worker/                  后端
│   ├── index.js             入口：静态资源 + API 路由分发
│   ├── auth.js              PBKDF2 + 会话管理
│   └── routes.js            REST API + 会员门控 + Admin
├── src/
│   ├── core/                glass.css / utils / install / api-client
│   ├── data/                api.js（数据源）/ universe.js（全市场枚举）
│   ├── domain/              indicators / chip / factors / config / funnel
│   ├── ui/                  charts.js（Canvas）/ account.js（登录·会员·后台）
│   └── main.js              应用入口与页面渲染
└── assets/                  图标
```

## 免责声明

本项目为技术演示，不构成任何投资建议。股市有风险，入市需谨慎。
