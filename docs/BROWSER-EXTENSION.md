# 浏览器扩展

扩展位于 `extension/`，Manifest V3，当前版本以 `extension/manifest.json` 为准。它只处理用户手动选择、拖入或粘贴的内容，并保存到当前 Prompt Hub 账号。

## 功能

- 在任意获授权网页注入存卡面板。
- 划选或悬停复制文字，粘贴/拖入图片。
- 选择标签和卡片库分组。
- 可选发布到社区。
- 从 `prompt-hubs.com` 同步登录会话，并通过 `api.prompt-hubs.com` 存卡。

## 认证链路

```text
主站 localStorage session
  -> extension/content/bridge.js
  -> chrome.runtime message
  -> chrome.storage.local ph_session
  -> background.js 刷新 token / 调 API
```

Auth storage key 必须与 `extension/config.js` 和主站 MemFire 项目一致。换数据库时要同时更新 `content/bridge.js`，否则扩展会一直显示未登录。

## API

| 路径 | 用途 |
|---|---|
| `GET /api/v1/extension/status` | 会话和用户设置 |
| `GET /api/v1/extension/tags` | 标签 |
| `GET /api/v1/extension/groups` | 卡片库分组 |
| `GET /api/v1/extension/cards` | Canvas/扩展分页卡片 |
| `POST /api/v1/extension/quick-card` | 保存文字、图片、标签和发布意图 |

## 本地安装

1. Chrome/Edge -> 扩展程序 -> 开启开发者模式。
2. 选择“加载已解压的扩展程序”。
3. 选择仓库 `extension/`。
4. 修改代码后点扩展卡片“重新加载”，再刷新被注入页面。

## 打包

```powershell
cd D:\prompt-hub
.\scripts\package-extension.ps1
```

输出在被 Git 忽略的 `dist/`。上传商店前检查 zip 不包含 `.env`、源码外的测试文件或本地账号信息。

## 修改检查

- `manifest.json` 的 `.com` 主站、API host permissions 和 content script matches 同步。
- `.cn` 可保留兼容，但不能作为弹窗默认登录地址。
- `STORE-LISTING.zh-CN.txt`、版本号、隐私政策和商店截图同步。
- 不扩大 `<all_urls>` 为安装即强制权限；继续使用 optional permission。
- 实际登录、标签、纯文字存卡、图片存卡和社区开关各验一次。

上架步骤见 `CHROME-WEB-STORE.md`，扩展隐私说明见 `extension/PRIVACY.md`。
