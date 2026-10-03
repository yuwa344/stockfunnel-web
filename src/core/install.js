/**
 * PWA 安装分发。
 *
 * ## 平台差异（关键）
 *
 * ### Android / 桌面 Chrome
 * 支持 `beforeinstallprompt` 事件，可直接调 `prompt()` 弹出安装对话框，
 * 安装后写入桌面 + 独立窗口运行。
 *
 * ### iOS Safari
 * **不支持** beforeinstallprompt。唯一途径是「添加到主屏幕」：
 *   - iOS 16.4+：Safari 分享菜单 → 添加到主屏幕
 *   - 更早版本：仅支持通过 **.mobileconfig 描述文件** 预置 Web Clip 图标
 *
 * 因此本模块对 iOS 生成并引导下载描述文件，实现「下载 → 打开描述文件
 * → 确认安装 → 主屏幕出现图标」的完整链路，等效于 Android 的桌面添加。
 */

/** UA 读取（Node 测试环境下 navigator 不存在，返回空串） */
function ua() {
  return (typeof navigator !== 'undefined' && navigator.userAgent) || '';
}

const isIOS = () => {
  const s = ua();
  // iPadOS 13+ 伪装为 Mac，用触点检测补充判断
  const maxTouch = (typeof navigator !== 'undefined' && navigator.maxTouchPoints) || 0;
  const iPadOS = /Macintosh/.test(s) && maxTouch > 1;
  return /iPhone|iPad|iPod/.test(s) || iPadOS;
};

const isSafari = () => /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua());

const isStandalone = () => {
  // Node / 测试环境下无 window.matchMedia
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator?.standalone === true;
};

const isAndroid = () => /android/i.test(ua());

/* ------------------------------------------------------------------ */
/* Android：beforeinstallprompt                                          */
/* ------------------------------------------------------------------ */

let deferredPrompt = null;

export function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    window.dispatchEvent(new CustomEvent('sf:installable'));
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    window.dispatchEvent(new CustomEvent('sf:installed'));
  });
}

export function canPromptInstall() {
  return deferredPrompt != null;
}

/** Android / 桌面：直接弹出安装对话框 */
export async function promptInstall() {
  if (!deferredPrompt) {
    // 已安装或浏览器不支持
    return { ok: false, reason: 'unavailable' };
  }
  const p = deferredPrompt;
  deferredPrompt = null;
  p.prompt();
  const { outcome } = await p.userChoice;
  return { ok: outcome === 'accepted', outcome };
}

/* ------------------------------------------------------------------ */
/* iOS：描述文件                                                        */
/* ------------------------------------------------------------------ */

/**
 * 生成 .mobileconfig（Web Clip 描述文件）内容。
 *
 * ## 结构说明（踩坑记录）
 * `com.apple.webClip.managed` 的 PayloadContent 必须是 WebClip 字典本身，
 * URL 直接放在它的 `URL` 键下。早期版本在 PayloadContent 里又嵌了一层
 * `{URL, WebClip:{...}}`，且 Icon 为空 `<data></data>`，
 * iOS 校验直接报「必填字段 url 缺失」。
 *
 * 另外 WebClip 字典需包含：
 *  - URL        必填
 *  - Label      图标下方显示的名称
 *  - IconData   可选，纯 base64（**不带 data: 前缀**）
 *  - IsRemovable 设为 false 可禁止用户误删
 *
 * PayloadScope=System 让描述文件免信任安装（否则每次打开都提示信任）。
 */
export function buildMobileConfig({
  url,
  label = '六层漏斗选股',
  iconBase64 = '',
  ignoreCertificate = true,
}) {
  // 规范化 URL：描述文件要求完整绝对地址，去掉 hash 与结尾斜杠之外的杂项
  let target = String(url || '').trim();
  if (!target) target = 'https://stockfunnel.pages.dev/';
  if (!/^https?:\/\//i.test(target)) target = 'https://' + target.replace(/^\/+/, '');

  // 图标可选：空则不写 IconData 键（写空 <data> 会导致校验失败）
  const iconLine = iconBase64
    ? `      <key>IconData</key>\n      <data>${iconBase64}</data>\n`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key>
      <string>com.apple.webClip.managed</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>PayloadIdentifier</key>
      <string>com.stockfunnel.webclip</string>
      <key>PayloadUUID</key>
      <string>${uuid()}</string>
      <key>PayloadDisplayName</key>
      <string>${escXml(label)}</string>
      <key>PayloadDescription</key>
      <string>在主屏幕创建应用图标</string>
      <key>PayloadScope</key>
      <string>System</string>
      <key>PayloadContent</key>
      <dict>
        <key>URL</key>
        <string>${escXml(target)}</string>
        <key>Label</key>
        <string>${escXml(label)}</string>
        <key>IsRemovable</key>
        <false/>
        <key>IgnoreCertificate</key>
        <${ignoreCertificate ? 'true' : 'false'}/>
${iconLine}      </dict>
    </dict>
  </array>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
  <key>PayloadIdentifier</key>
  <string>com.stockfunnel.profile</string>
  <key>PayloadUUID</key>
  <string>${uuid()}</string>
  <key>PayloadDisplayName</key>
  <string>${escXml(label)}</string>
  <key>PayloadDescription</key>
  <string>安装后主屏幕出现图标，可全屏运行</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadOrganization</key>
  <string>StockFunnel</string>
</dict>
</plist>
`;
}

function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function escXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])
  );
}

/** UTF-8 安全的 base64（避免 String.fromCharCode(...bigArray) 栈溢出） */
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK)
    );
  }
  return btoa(bin);
}

/**
 * 触发描述文件下载（iOS Safari 会提示「正在下载描述文件」）。
 *
 * 图标策略：优先内嵌 60×60 左右的 PNG（约 3-5 KB base64）。
 * 内嵌的好处是安装时不依赖网络取图；若获取失败则省略 IconData 键，
 * iOS 会用默认图标 —— **绝不能写空的 <data></data>**，会导致校验失败。
 */
export async function downloadProfile({ url, label }) {
  let iconBase64 = '';
  try {
    // 优先用 120px 索引色 PNG（1.5 KB）；拿不到再退 180px（16 KB）
    const candidates = ['assets/icon-120-pal.png', 'assets/icon-120.png', 'assets/icon-180.png'];
    for (const path of candidates) {
      try {
        const res = await fetch(path, { cache: 'force-cache' });
        if (!res.ok) continue;
        const blob = await res.blob();
        if (blob.size > 0) {
          iconBase64 = await blobToBase64(blob);
          break;
        }
      } catch { /* 试下一个 */ }
    }
  } catch (e) {
    console.warn('[install] 图标获取失败，将使用 iOS 默认图标', e);
  }

  const xml = buildMobileConfig({ url, label, iconBase64 });
  const blob = new Blob([xml], { type: 'application/x-apple-aspen-config' });
  const href = URL.createObjectURL(blob);
  const filename = 'StockFunnel.mobileconfig';

  // 主路径：blob URL + download 属性（桌面与新版 iOS 有效）
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  // 兜底：data: URL。旧版 iOS Safari 对 blob: 支持差，会忽略 download 而直接打开，
  // 故延迟片刻再补一次 data: 触发。两者可共存，先命中者生效。
  setTimeout(() => {
    try {
      const b = document.createElement('a');
      b.href = 'data:application/x-apple-aspen-config;charset=utf-8;base64,'
             + utf8ToBase64(xml);
      b.download = filename;
      b.rel = 'noopener';
      b.style.display = 'none';
      document.body.appendChild(b);
      b.click();
      setTimeout(() => b.remove(), 1500);
    } catch (e) {
      console.warn('[install] 兜底下载失败', e);
    }
  }, 700);

  // 清理（延迟足够长，避免打断下载）
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(href);
  }, 5000);

  return { size: xml.length, hasIcon: !!iconBase64 };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/* ------------------------------------------------------------------ */
/* 统一入口：根据平台给出最优安装路径                                     */
/* ------------------------------------------------------------------ */

export function detectPlatform() {
  return {
    isIOS: isIOS(),
    isAndroid: isAndroid(),
    isSafari: isSafari(),
    standalone: isStandalone(),
    canPrompt: canPromptInstall(),
  };
}

/**
 * 主动安装 / 添加到桌面。
 * - Android/桌面：走 beforeinstallprompt
 * - iOS：下载描述文件
 */
export async function installOrAddToHome({ url, label }) {
  const p = detectPlatform();

  if (p.standalone) {
    return { ok: false, reason: 'already-installed' };
  }

  if (p.isIOS) {
    await downloadProfile({ url, label });
    return { ok: true, method: 'profile' };
  }

  if (p.canPrompt) {
    const r = await promptInstall();
    return { ...r, method: 'prompt' };
  }

  // 非 iOS 且无 prompt（部分桌面浏览器）→ 手动引导
  return { ok: false, reason: 'manual', method: 'manual' };
}
