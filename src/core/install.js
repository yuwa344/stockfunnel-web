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

const isIOS = () => {
  const ua = navigator.userAgent;
  // iPadOS 13+ 伪装为 Mac，用触点检测补充判断
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/.test(ua) || iPadOS;
};

const isSafari = () => {
  const ua = navigator.userAgent;
  return /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua);
};

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

const isAndroid = () => /android/i.test(navigator.userAgent);

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

/** 生成 .mobileconfig（Web Clip 描述文件）内容 */
export function buildMobileConfig({ url, label = '六层漏斗选股', iconDataUrl }) {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key><string>com.apple.webClip.managed</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadIdentifier</key><string>com.stockfunnel.webclip</string>
      <key>PayloadUUID</key><string>${uuid()}</string>
      <key>PayloadDisplayName</key><string>${escXml(label)}</string>
      <key>PayloadOrganization</key><string>StockFunnel</string>
      <key>PayloadDescription</key><string>添加到主屏幕以获得全屏体验</string>
      <key>PayloadContent</key>
      <dict>
        <key>URL</key><string>${escXml(url)}</string>
        <key>WebClip</key>
        <dict>
          <key>Label</key><string>${escXml(label)}</string>
          <key>URL</key><string>${escXml(url)}</string>
          <key>Icon</key><data>${iconDataUrl || ''}</data>
        </dict>
      </dict>
    </dict>
  </array>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadIdentifier</key><string>com.stockfunnel.profile</string>
  <key>PayloadUUID</key><string>${uuid()}</string>
  <key>PayloadDisplayName</key><string>${escXml(label)}</string>
  <key>PayloadDescription</key><string>安装后将在主屏幕创建应用图标</string>
  <key>PayloadRemovalDisallowed</key><false/>
</dict>
</plist>`;
  return plist;
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

/** 触发描述文件下载（iOS Safari 会提示"正在下载描述文件"） */
export async function downloadProfile({ url, label }) {
  let iconDataUrl = '';
  try {
    // 读取 180×180 图标并转为 base64（描述文件要求 <data> 为裸 base64）
    const res = await fetch('assets/icon-180.png');
    const blob = await res.blob();
    iconDataUrl = await blobToBase64(blob);
  } catch {
    // 图标缺失不阻断流程
  }

  const xml = buildMobileConfig({ url, label, iconDataUrl });
  const blob = new Blob([xml], { type: 'application/x-apple-aspen-config' });
  const href = URL.createObjectURL(blob);

  // iOS Safari 对 download 属性支持有限，同时用 location 兜底
  const a = document.createElement('a');
  a.href = href;
  a.download = 'StockFunnel.mobileconfig';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(href);
  }, 3000);
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
