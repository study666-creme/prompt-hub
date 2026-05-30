# Prompt Hub 扩展隐私说明

## 收集的数据

- **登录会话**：从 prompt-hub.cn 同步的 Supabase 访问令牌，仅存于浏览器 `chrome.storage.local`
- **您提交的内容**：提示词、您拖入的图片、当前页面 URL（作为来源备注），经 HTTPS 上传至 Prompt Hub 服务器

## 不收集的数据

- 不会自动读取整页 HTML 或后台批量抓取
- 不会记录浏览历史（除您保存时自愿附带的当前页 URL）
- 不向第三方出售数据

## 权限说明

| 权限 | 用途 |
|------|------|
| storage | 保存登录态与设置 |
| scripting | 在您同意的网页注入存卡面板 |
| optional `<all_urls>` | 仅在您点击「打开面板」时请求 |
| prompt-hub.cn / api | 登录同步与保存卡片 |

## 联系

问题与删除账号请求请通过 Prompt Hub 主站用户协议中的联系方式处理。
