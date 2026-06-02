# Prompt Hub — 项目上下文（给 AI / 新对话用）

> **新聊天**：先读 **`docs/CURRENT-ISSUES.md`**（含 **P0 社区/卡片库布局**），再读 **`docs/AI-HANDOFF.md`**。  
> 默认中文；**P0 拉满算力**见 `docs/AI-WORK-MODE.md`；勿提交密钥。用户是纯小白 → 分步 + 可复制命令。

---

## 产品是什么

**提示词仓库（Prompt Hub）**：纯前端 SPA + Cloudflare Workers API + Supabase。

| 模块 | 说明 |
|------|------|
| **卡片库** | 提示词卡片、分组、Masonry；登录后同步 `user_data` |
| **提示词社区** | 全站 Feed（`community_posts` + API） |
| **我的主页** | 发布作品、关注/粉丝、拥有的/发布的资产包 |
| **图片生成** | 扣积分；`POST /api/v1/generate`；上游 APImart |
| **资产包** | 领取存入「拥有」、封面预览、选择性导入、大图下载 |
| **资产创作** | `asset-studio.html` · 左图右文档悬浮详情 + 字段设置 |

部署：**Pages** https://prompt-hub.cn · **API** https://api.prompt-hub.cn · Worker 名 `prompt-hub-api`

---

## 当前部署阶段（2026-06-02）

| 项 | 状态 |
|----|------|
| Worker | `prompt-hub-api` · API https://api.prompt-hub.cn |
| Pages | https://prompt-hub-hub（自定义域 prompt-hub.cn） |
| 构建号 | **20260602x** · SW `prompt-hub-v374` |
| **已打通** | 社区 feed / 生图 / 兑换；资产包预览·选择性导入·大图下载；PWA 添主屏引导 |
| **近期修复** | 卡片库缩略图误隐藏与加载失败删图区；资产包 UI 与编辑弹窗勾选样式；社区通知红点 |

### 已知问题

- 管理「自己发布的包」→ **我的主页 → 发布的资产包**（他人包在「拥有的资产包」无编辑入口）
- Storage 404 仍可能导致部分社区帖无图
- 卡片库 400+ 张时首屏缩略图需数秒陆续加载，属正常

### 下一步

1. 强刷后 `window.__APP_BUILD__` 应为 **20260602x**
2. 卡片库：缩略图应陆续出现，不应长期只有文字
3. 资产包：拥有的包 → 展开文件夹 → 点图下载；「选择性导入」勾选单张

### 部署

```powershell
cd d:\prompt-hub
.\deploy-pages.ps1
cd server
npx wrangler deploy
```

强刷：**Ctrl+Shift+R**；确认 `window.__APP_BUILD__` 与左下角一致。

### 测试账号

- 邮箱 `2705367723@qq.com`

---

## 更多文档

见 `docs/FILE-MAP.md`、`docs/DEPLOY-CHECKLIST.md`。
