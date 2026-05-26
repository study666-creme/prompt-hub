# 提示词仓库 · 手机使用与应用市场上线指南

## 一、手机浏览器使用（已完成）

部署最新代码后，用手机打开：https://prompt-hub-web.pages.dev

- 支持触摸操作、底部导航、分组/菜单抽屉
- 编辑卡片为全屏面板
- 可「添加到主屏幕」当 App 用（见下文 PWA）

---

## 二、添加到主屏幕（PWA，免费，推荐先做）

无需应用商店审核，用户可像 App 一样打开：

### iPhone（Safari）

1. 打开网站 → 分享 → **添加到主屏幕**
2. 桌面会出现「提示词仓库」图标

### Android（Chrome）

1. 打开网站 → 菜单 → **安装应用** / **添加到主屏幕**

### 开发者注意

- 网站需 **HTTPS**（Cloudflare Pages 已满足）
- 需部署 `manifest.webmanifest` 和 `sw.js`（项目已包含）

---

## 三、应用市场上线（两种路线）

### 路线 A：PWA 包装上架 Google Play（相对省事）

用 **Google Play 的 TWA（Trusted Web Activity）** 把现有网站包成 Android App。

| 项目 | 说明 |
|------|------|
| 费用 | Google Play 开发者账号 **约 $25（一次性）** |
| 周期 | 首次审核约 **数天～2 周** |
| 工具 | [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) 或 PWA Builder |
| 要求 | 网站稳定 HTTPS、有隐私政策页面 |

**不适合**：仅靠 PWA 无法直接上 **苹果 App Store**（苹果要求原生或特定框架打包）。

### 路线 B：Capacitor 打包 iOS + Android（正式 App）

用 [Capacitor](https://capacitorjs.com/) 把当前网页包进原生壳，可上架 **Google Play + App Store**。

| 项目 | 说明 |
|------|------|
| Google Play | 开发者账号约 **$25（一次性）** |
| App Store | Apple 开发者 **¥688/年** |
| 电脑 | 上架 iOS **必须用 Mac** + Xcode |
| 周期 | 准备材料 + 审核，首次约 **2～4 周** |
| 材料 | 应用图标、截图、简介、**隐私政策 URL**、测试账号 |

基本步骤（以后可做）：

```bash
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap init "提示词仓库" com.yourname.prompthub
# 将 index.html 等静态文件设为 webDir，或构建输出目录
npx cap add android
npx cap add ios
npx cap sync
npx cap open android   # 或 ios
```

在 Android Studio / Xcode 里签名、打包、提交商店。

---

## 四、上架前建议准备的页面与内容

1. **隐私政策**（必填）：说明收集邮箱、Supabase 存储、图片上传等  
2. **用户协议**（建议）  
3. **应用截图**：手机竖屏 3～5 张  
4. **应用描述**：中文简介 + 关键词  
5. **测试账号**：审核员可登录（在 App 备注里提供邮箱密码）

隐私政策可放在：`https://prompt-hub-web.pages.dev/privacy.html`（需自行添加页面）

---

## 五、推荐节奏（给个人开发者）

| 阶段 | 做什么 |
|------|--------|
| **现在** | 部署移动端 + PWA，邀请朋友「添加到主屏幕」 |
| **1～2 周** | 写隐私政策页，收集反馈 |
| **1 个月** | 若 Android 需求强：Bubblewrap 上架 Google Play |
| **有需要再做** | Mac + Capacitor 上架 App Store |

---

## 六、费用一览（约）

| 项目 | 费用 |
|------|------|
| 网站托管 Cloudflare | 免费 |
| Supabase | 免费档起步 |
| Google Play | ~$25 一次性 |
| Apple App Store | ~¥688/年 |
| 域名（可选） | ~¥50/年起 |

---

如有需要，可继续在项目里添加 `privacy.html` 或 Capacitor 初始化配置。
