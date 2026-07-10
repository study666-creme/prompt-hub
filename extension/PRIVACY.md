# Prompt Hub 扩展隐私说明

## 扩展处理的数据

- 登录会话：从 `prompt-hubs.com` 同步，保存在浏览器 `chrome.storage.local`。
- 用户主动提交的内容：提示词、标题、标签、图片和可选来源 URL。
- 面板设置：是否自动保存、裁边和默认发布选项。

数据通过 HTTPS 发往 `api.prompt-hubs.com`，进入用户自己的 Prompt Hub 账号。完整站点隐私政策见 <https://prompt-hubs.com/privacy.html>。

## 扩展不会

- 自动抓取整页 HTML 或批量爬取网站。
- 记录用户未主动保存的浏览历史。
- 向第三方出售用户数据。
- 在未获用户授权时注入任意网站。

## 权限

| 权限 | 用途 |
|---|---|
| `storage` | 保存会话和设置 |
| `scripting` | 用户主动打开时注入面板 |
| 主站/API host permissions | 同步登录和保存卡片 |
| optional `<all_urls>` | 在用户选择的网页显示面板 |

用户可以在扩展弹窗退出登录、关闭面板权限，或在浏览器扩展设置中移除扩展及其本地数据。
