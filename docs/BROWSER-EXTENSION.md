# 浏览器插件（Prompt Hub 快捷存卡）

> 状态：**v1.0.2** · 目录 `extension/`

## 安装（个人 / 内测）

1. Chrome/Edge → 扩展程序 → **开发者模式** → **加载已解压的扩展程序**
2. 选择仓库 `extension` 文件夹
3. Supabase 执行 `20260530100000_user_data_service_role.sql`（否则保存报 permission denied）
4. `cd server && .\deploy.ps1` 部署 API

## 给全站用户用上（公开发布）

| 方式 | 说明 |
|------|------|
| **Chrome 网上应用店** | 注册 [Chrome Web Store 开发者](https://chrome.google.com/webstore/devconsole)（一次性约 $5）→ 打包 `extension` 为 zip 上传 → 审核约数天。上架后在网站放商店链接。 |
| **Microsoft Edge 加载项** | [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/) 提交同一套扩展，审核通常较快。 |
| **官网下载（进阶）** | 在 prompt-hub.cn 提供「安装说明 + zip 包」；企业环境可组策略推送。普通用户仍推荐商店安装。 |

**建议流程**：内测稳定 → 上架 Edge + Chrome → 在 Prompt Hub 设置页增加「安装浏览器插件」链接。

## 功能

- 悬浮存卡面板（拖入/粘贴截图、保存提示词）
- **悬停段落**出现「复制段落」；**划选文字**出现「复制到提示词」
- 登录态与 prompt-hub.cn 同步

## 数据库（必做）

```sql
-- supabase/migrations/20260530100000_user_data_service_role.sql
grant select, insert, update on public.user_data to service_role;
```

或在 Supabase SQL Editor 粘贴上面一行执行。

## API

| 方法 | 路径 |
|------|------|
| POST | `/api/v1/extension/quick-card` |

## 合规

用户主动悬停/划选/拖入/粘贴；不自动爬取整页。详见 `extension/PRIVACY.md`。
