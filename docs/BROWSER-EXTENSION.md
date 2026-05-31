# 浏览器插件（Prompt Hub 快捷存卡）

> 状态：**v1.0.4** · 目录 `extension/`

## 安装（个人 / 内测）

1. Chrome/Edge → 扩展程序 → **开发者模式** → **加载已解压的扩展程序**
2. 选择仓库 `extension` 文件夹
3. Supabase 执行 `20260530100000_user_data_service_role.sql`（否则保存报 permission denied）
4. `cd server && .\deploy.ps1` 部署 API（含 `GET /tags` 与带 `tags` 的 quick-card）

## 给全站用户用上（公开发布）

| 方式 | 说明 |
|------|------|
| **Chrome 网上应用店** | 注册 [Chrome Web Store 开发者](https://chrome.google.com/webstore/devconsole)（一次性约 $5）→ 打包 `extension` 为 zip 上传 → 审核约数天。上架后在网站放商店链接。 |
| **Microsoft Edge 加载项** | [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/) 提交同一套扩展，审核通常较快。 |
| **官网下载（进阶）** | 在 prompt-hub.cn 提供「安装说明 + zip 包」；企业环境可组策略推送。普通用户仍推荐商店安装。 |

**建议流程**：内测稳定 → 上架 Edge + Chrome → 在 Prompt Hub 设置页增加「安装浏览器插件」链接。详见 **`docs/CHROME-WEB-STORE.md`**。

## 功能（v1.0.4）

| 功能 | 说明 |
|------|------|
| **悬浮存卡面板** | 拖入/粘贴图片、填写提示词、**选择标签**后点「保存到仓库」 |
| **公开到社区** | 与主页卡片库相同：开启后保存即公开；默认跟随设置「新建默认发布」；须提示词 ≥15 字且配图 |
| **真正关闭** | 标题栏 **×** 关闭本页面板；本标签不再自动出现，需扩展弹窗「在当前页打开面板」 |
| **收起** | **−** 仅折叠内容，面板仍保留 |
| **内容不丢失** | 面板内拖入/粘贴图片**仅预览**，点保存才提交；成功保存后才清空 |
| **智能全局粘贴** | 面板已打开且页面**无**聚焦的输入框/文本框/contenteditable 时，**Ctrl+V 截图直接保存**（无需先点图片框） |
| **划选 / 悬停复制** | 划选文字 →「复制到提示词」；悬停段落 →「复制段落」 |
| **登录同步** | 与 prompt-hub.cn 登录态同步 |

## 使用步骤

1. 扩展图标 → **登录 / 同步**（在 prompt-hub.cn 保持登录）
2. **在当前页打开面板**（首次需允许「访问所有网站」）
3. 划选或悬停复制文字 → 可选标签 → **保存到仓库**
4. 截图：若光标不在网页输入框，直接 **Ctrl+V** 即可保存；若在面板里操作，先预览再点保存

## 数据库（必做）

```sql
-- supabase/migrations/20260530100000_user_data_service_role.sql
grant select, insert, update on public.user_data to service_role;
```

或在 Supabase SQL Editor 粘贴上面一行执行。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/extension/quick-card` | 保存卡片（body 可含 `tags`、`publishToCommunity`） |
| GET | `/api/v1/extension/tags` | 读取用户仓库已有标签 |
| GET | `/api/v1/extension/status` | 登录、会员、`defaultPublishCommunity` |

## 合规

用户主动悬停/划选/拖入/粘贴；不自动爬取整页。详见 `extension/PRIVACY.md`。
