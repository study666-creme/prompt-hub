# Chrome / Edge 扩展商店上架指南

> 扩展目录：`extension/` · 当前版本见 `manifest.json`

---

## 我已帮你准备好的（仓库内）

| 项 | 位置 |
|----|------|
| 扩展源码 | `extension/`（Manifest V3） |
| 隐私说明 | `extension/PRIVACY.md` |
| 商店文案草稿 | `extension/STORE-LISTING.zh-CN.txt` |
| 打包脚本 | `scripts/package-extension.ps1` |
| 主站说明入口 | 卡片库左侧「提示词采集」面板 |
| API | `POST /api/v1/extension/quick-card`（含 `publishToCommunity`） |

---

## 你需要完成的步骤

### 第 1 步：注册开发者账号（一次性）

| 商店 | 链接 | 费用 |
|------|------|------|
| **Chrome Web Store** | [Chrome 开发者控制台](https://chrome.google.com/webstore/devconsole) | 约 **$5 USD** 一次性 |
| **Microsoft Edge**（可选） | [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/) | 免费 |

用与 Prompt Hub 一致的 Google 账号注册即可。

### 第 2 步：主站放隐私政策 URL（必做）

商店审核要求**可公开访问的隐私政策链接**。

1. 将 `extension/PRIVACY.md` 内容发布到主站，例如：  
   `https://prompt-hub.cn/privacy-extension.html`  
   （可用 Pages 新增静态页，或放在现有用户协议页锚点）
2. 上架时在「Privacy policy」字段填该 URL。

### 第 3 步：打包 zip

在 PowerShell 执行：

```powershell
cd d:\prompt-hub
.\scripts\package-extension.ps1
```

会在 `dist/` 生成 `prompt-hub-extension-vX.X.X.zip`（仅含扩展运行所需文件）。

### 第 4 步：Chrome 网上应用店提交

1. 打开 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. **New item** → 上传 zip
3. 按 `extension/STORE-LISTING.zh-CN.txt` 填写：
   - 名称、简短说明、详细说明
   - 分类：**Productivity**（生产力）
   - 语言：中文（简体）
   - 图标：已含 `icons/icon128.png` 等
   - 截图：需你自行截 1～5 张（1280×800 或 640×400），建议包含：弹窗、存卡面板、划选复制
4. **Single purpose**：说明为「将用户手动选择的文字/图片保存到 Prompt Hub 账号」
5. **Permission justification**（权限理由，英文或中文均可）：
   - `storage`：保存登录会话
   - `scripting`：在用户打开的页面注入存卡面板
   - `host_permissions`（prompt-hub.cn / api）：登录同步与保存
   - `optional_host_permissions` `<all_urls>`：仅用户点击「打开面板」时使用
6. **Privacy policy URL**：第 2 步的链接
7. 选择可见范围：**Unlisted**（不公开搜索，仅链接安装）或 **Public**
8. 提交审核（通常 **1～7 天**）

### 第 5 步：Edge 加载项（可选，同一 zip）

1. [Partner Center → Extensions](https://partner.microsoft.com/dashboard/microsoftedge/overview)
2. 提交同一 zip + 相同说明
3. Edge 审核通常比 Chrome 快

### 第 6 步：主站放安装链接

审核通过后：

- Chrome：`https://chrome.google.com/webstore/detail/你的扩展ID`
- Edge：Partner Center 提供的商店链接

在「提示词采集」面板或设置页增加「从商店安装」按钮。

---

## 审核常见拒稿点（本扩展已规避）

- 不自动爬取整页 → 仅划选/悬停/拖入/粘贴
- 首次使用有**使用须知**确认
- 可选 `<all_urls>`，非安装即全站权限
- 隐私说明已写清数据去向

若被拒，按邮件理由改文案或权限说明后重新提交即可。

---

## 我无法代你完成的事

- 支付 $5 开发者注册费
- 登录你的 Google / Microsoft 账号点提交
- 上传商店截图（需真实浏览器界面）
- 在主站域名发布隐私政策页（需你部署 Pages）
- 等待审核结果

---

*最后更新：2026-05-30*
