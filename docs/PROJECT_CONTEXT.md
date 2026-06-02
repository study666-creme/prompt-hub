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
| **图片生成** | 扣积分；`POST /api/v1/generate`；上游 **GrsAI** |
| **资产包** | 领取存入「拥有」、封面预览、选择性导入、大图下载 |
| **资产创作** | `asset-studio.html` · 左图右文档悬浮详情 + 字段设置 |

部署：**Pages** https://prompt-hub.cn · **API** https://api.prompt-hub.cn · Worker 名 `prompt-hub-api`

---

## 当前部署阶段（2026-06-03）

| 项 | 状态 |
|----|------|
| Worker | `prompt-hub-api` · API https://api.prompt-hub.cn |
| Pages | https://prompt-hub.cn · 构建 `20260603g` |
| **已打通** | 社区 feed / 兑换；资产包；PWA；GrsAI 生图；生图价展示含「92折·原价6」；生图画风「2.5D国漫写实」；卡片库排序「随机」 |
| **生图 Key** | Worker `IMAGE_API_KEY` + `IMAGE_API_BASE_URL=https://grsai.dakka.com.cn` |
| **视觉 Key** | `APIMART_API_KEY` + `APIMART_API_BASE_URL=https://api.apimart.ai`（反推/裂变/社区配图审核） |

### 已知问题

- **Apimart 账单看不到 Gemini**：生图账单与 Chat/LLM 分开；单次配图审核约 <0.001 元；历史批量同步曾跳过视觉审核（新帖已改为走 Gemini）
- **GrsAI 后台 gemini -1**：误打到 GrsAI 账户的老路径（反推/误配 base），不是用户站内积分

### 下一步

1. 强刷 `20260603g`：生图灵感/裂变画风选「2.5D国漫写实」；卡片库排序菜单选「随机」
2. Cloudflare Worker 确认 `APIMART_API_BASE_URL=https://api.apimart.ai`（勿填 GrsAI）
3. Apimart 控制台查 **Chat/LLM** 分类（非 Image）是否有 `gemini-2.5-flash-lite` 记录

### 部署

```powershell
cd d:\prompt-hub\server
npx wrangler deploy
cd ..
.\deploy-pages.ps1
```

### 测试账号

- 邮箱 `2705367723@qq.com`

---

## 更多文档

见 `docs/FILE-MAP.md`、`docs/DEPLOY-CHECKLIST.md`。
