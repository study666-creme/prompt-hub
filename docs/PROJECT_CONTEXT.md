# Prompt Hub — 项目上下文（给 AI / 新对话用）

> **新聊天**：先读 **`docs/CURRENT-ISSUES.md`**，再读 **`docs/AI-HANDOFF.md`**。  
> 默认中文；最小 diff；勿提交密钥。用户是纯小白 → 分步 + 可复制命令。

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

## 当前部署阶段（2026-06-06 · 构建 **20260606n**）

| 项 | 状态 |
|----|------|
| Worker | `prompt-hub-api` · API https://api.prompt-hub.cn |
| Pages | https://prompt-hub.cn |
| 构建号 | **20260606n** |
| **生图** | 误判失败可捞回；上游多图全部入库；失败前 grace 确认 |
| **社区** | 排序 Tab 生效；复制/收藏/同款不再自动点赞 |
| **灵感抽卡** | 多词条融合；外露 12 个词条 + 广角/张力 |
| **加载** | 签图并发↑、首屏骨架+缓存；见 `CARD-LOADING.md` |
| **运营后台** | https://prompt-hub.cn/admin.html |

### 已知问题 / 下一步

- 强刷确认 `window.__APP_BUILD__ === '20260606n'`
- **首屏 3 秒内全部高清图**：受私有 Storage 签名限制，目标改为「3 秒内流畅骨架+文字，图片渐进清晰」（见 `PERFORMANCE-OPTIMIZATION.md`）
- 社区精选：数据表 + 运营录入待做
- 社区/他人图：服务端批量签名 API 待做（最大提速项）

### 测试账号

- 邮箱 `2705367723@qq.com`

### 部署

```powershell
cd d:\prompt-hub
.\deploy-pages.ps1
cd server
npx wrangler deploy
```

---

## 文档索引

| 文档 | 何时读 |
|------|--------|
| **[CURRENT-ISSUES.md](./CURRENT-ISSUES.md)** | **必读** — P0、实测 |
| **[CARD-LOADING.md](./CARD-LOADING.md)** | 卡片/社区图为何慢、已做优化 |
| **[PERFORMANCE-OPTIMIZATION.md](./PERFORMANCE-OPTIMIZATION.md)** | 性能与「流畅感」目标 |
| **[MEMBERSHIP-CREDITS.md](./MEMBERSHIP-CREDITS.md)** | 会员档位、激活码 |
| **[PROJECT-SNAPSHOT.md](./PROJECT-SNAPSHOT.md)** | 详细规划 + 现状 |
| [AI-HANDOFF.md](./AI-HANDOFF.md) | Grep 表、接手流程 |
