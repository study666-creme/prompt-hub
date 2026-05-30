# 当前问题与进度（2026-05-29）

> **接手顺序**：本文 → `PROJECT_CONTEXT.md` → `AI-HANDOFF.md`

---

## 仓库构建号

| 项 | 值 |
|----|-----|
| `__APP_BUILD__` | **`20260616n`** |
| SW `CACHE` | **`prompt-hub-v252`** |
| Pages | https://prompt-hub.cn |
| API | https://api.prompt-hub.cn |

---

## 2026-05-29 已交付（构建 20260616m～n）

| 项 | 说明 |
|----|------|
| 社区点赞 | 本地 + `POST /community/posts/:id/like` 全站计数；需 SQL `20260529140000` + Worker 部署 |
| 会员档位 | 普通 / 轻量 lite / 基础 / 标准 / 专业；新价与新积分规则 |
| 激活码 | 旧会员卡密停用；新码每档 2 个；**同码**兑换前自选每日/一次性（lite 仅每日） |
| 轻量面板 | 单行紧凑布局 |
| 浏览器插件 | 规划文档 `docs/BROWSER-EXTENSION.md`（未开发） |

### 用户待做

1. Supabase 依次执行：`20260529140000` → `20260529150000` → `20260529160000`
2. `.\deploy-pages.ps1` + `server\deploy.ps1`
3. 硬刷新确认 **20260616n**

---

## 仍未解决（P0）

| # | 现象 |
|---|------|
| 1 | **发布开关像全局开关** — 单卡 `publishedToCommunity` 与 UI/云端不同步 |
| 2 | **他人社区图慢** — 偶发像没图，等签名 |
| 3 | **卡片库整体偏慢** — 进库、拉图、云同步 |

---

## 控制台验证

```javascript
window.__APP_BUILD__  // 应为 20260616n
await window.PromptHubApi.getCommunityFeed({ limit: 20 })
// 点赞（需登录）
await window.PromptHubApi.likeCommunityPost?.('帖子ID')
```

---

*最后更新：2026-05-29*
