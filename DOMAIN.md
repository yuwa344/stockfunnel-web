# 域名绑定与访问问题

## 问题现象

访问 `https://stockfunnel.kongchris655.workers.dev` 需要挂 VPN。

## 根本原因

**`*.workers.dev` 域名在中国大陆被 DNS 污染。**

实测（2026-10-03）：

```
$ nslookup stockfunnel.kongchris655.workers.dev
Addresses: 2a03:2880:f111:83:face:b00c:0:25de   ← Facebook 段
          173.255.213.90                          ← 无效地址
```

`2a03:2880::/32` 是 Facebook 的 IPv6 段，说明 DNS 返回了完全错误的地址。

对照测试证明 Cloudflare 本身是通的：

| 域名 | 结果 |
|---|---|
| `dash.cloudflare.com` | 403（能连通） |
| `api.cloudflare.com` | 301（能连通） |
| `stockfunnel...workers.dev` | **超时** |

**结论：不是 Cloudflare 被墙，是 `workers.dev` 这个域名被墙。**

---

## 解决方案：绑定自定义域名

绑定后访问 `https://你的域名`，不再走 `workers.dev`，问题解决。

### 前提

- 你有一个域名（任意后缀，.com/.cn/.xyz 都可以）
- 域名已托管到 Cloudflare（Nameserver 指向 Cloudflare）

**没有域名也行** —— 看下面的「方案 B」。

---

## 方案 A：绑定自定义域名（推荐）

### 第 1 步：把域名托管到 Cloudflare

1. 打开 https://dash.cloudflare.com → 登录
2. 左侧 **Websites** → **Add a site**
3. 输入你的域名（如 `example.com`），选 Free 套餐
4. Cloudflare 会给你两个 Nameserver，例如：
   ```
   anna.ns.cloudflare.com
   bob.ns.cloudflare.com
   ```
5. 到你的域名注册商（阿里云/腾讯云/Namecheap…）把 Nameserver 改成上面两个
6. 等待生效（通常几分钟到 48 小时）

### 第 2 步：添加 Worker 自定义域

1. Cloudflare Dashboard → **Workers & Pages** → 点 `stockfunnel`
2. **Settings** → **Domains & Routes**
3. 点 **Add** → **Custom domain**
4. 输入要绑定的域名，如 `app.example.com`
5. 点 **Add domain**

Cloudflare 会自动添加 DNS 记录并部署证书，**不需要额外操作**。

### 第 3 步：验证

```bash
nslookup app.example.com        # 应解析到 Cloudflare 的正常 IP
curl https://app.example.com/api/health
```

浏览器打开 `https://app.example.com` 即可，**无需 VPN**。

### 建议：绑定根域 + 常用子域

| 域名 | 用途 |
|---|---|
| `app.example.com` | 主应用（推荐） |
| `api.example.com` | 可选，把 API 分开 |

---

## 方案 B：不用域名，改用 Pages 或其他平台

如果暂时没有域名，可以考虑：

### B1. Cloudflare Pages（同样是 Cloudflare，workers.dev 仍不可用）

Pages 默认给 `xxx.pages.dev`，**这个域名没被墙**，可以直接访问。

把静态资源部署到 Pages，Worker 仍用自定义域名或保留 API 用途。
但这样前后端分离，API 又要解决跨域 —— 复杂度上升，不推荐。

### B2. 部署到国内可直连的平台

如果目标用户主要在国内，建议改用：

| 平台 | 说明 |
|---|---|
| **Vercel** | `vercel.app` 在国内可直连（有 CDN），改绑自己的域名更快 |
| **腾讯云静态网站托管 / COS** | 国内访问最快，需备案 |
| **阿里云 OSS + CDN** | 同上，需备案 |
| **Netlify** | 国内访问一般 |

**注意**：国内平台部署需要 ICP 备案（静态托管在部分情况下也需要）。

如果走 Vercel，后端的 D1 需要换成 Vercel Postgres 或其他方案，改动较大。

---

## 我的建议

**优先买一个便宜域名（.xyz 首年通常 10 元以内）绑到 Cloudflare。**

理由：
- 一次配置，长期有效
- Cloudflare 全球 CDN，国内访问 Custom Domain 体验不错
- 不需要备案（绑 Cloudflare 的域名解析在境外，不走国内备案流程）
- 以后换平台，域名直接带走

---

## 常见问题

**Q：绑定域名后还是需要 VPN？**

A：检查是否仍在访问 `workers.dev` 地址。浏览器可能缓存了旧地址，
或分享链接时还用的是 workers.dev。

**Q：需要 ICP 备案吗？**

A：使用 Cloudflare 的 Custom Domain **不需要备案**（域名解析在 Cloudflare 境外）。
只有把网站托管到腾讯云/阿里云等国内服务器才需要备案。

**Q：会不会影响现有功能？**

A：不会。自定义域名和 workers.dev 指向同一个 Worker，
数据（D1）、API 都一样，只是访问地址换了。

**Q：SSL 证书会自动配置吗？**

A：会自动。Cloudflare 会为自定义域名签发并自动续期证书，无需手动操作。
