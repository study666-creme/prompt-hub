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
| **资产包** | 领取存入「拥有」、封面预览、一键导入建文件夹 |
| **资产创作** | `asset-studio.html` · 左图右文档悬浮详情 + 字段设置 |

部署：**Pages** https://prompt-hub.cn · **API** https://api.prompt-hub.cn · Worker 名 `prompt-hub-api`

---

## 当前部署阶段（2026-05-30）

| 项 | 状态 |
|----|------|
| Worker | `prompt-hub-api` · API https://api.prompt-hub.cn |
| Pages | https://prompt-hub.cn |
| 构建号 | **20260602i** · SW `prompt-hub-v370` |
| **待验证** | 社区无灰色空卡片；下滑加载不跳顶 |

### 已知问题

- Storage 404 仍可能导致部分帖无图（失败帖会从网格移除，不再留灰块）
- 后台 Feed 刷新在用户已下滑时不再强制整页重绘

### 下一步

1. 强刷后 `window.__APP_BUILD__` 应为 **20260602i**
2. 社区下滑加载多页：滚动位置应保持在原位置附近
3. 不应再出现只有 ♥0 的深灰空卡片

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
