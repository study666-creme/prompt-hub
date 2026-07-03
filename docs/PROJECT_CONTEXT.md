# Prompt Hub — 项目上下文

> 给 AI / 协作者：新任务先读本文件 + `docs/AI-PITFALLS.md`。

---

## 当前部署阶段（2026-07-03 · Fable5 重构简报 · 卡片库灰块）

| 项 | 状态 |
|----|------|
| **Pages** | https://prompt-hubs.com · 构建号 `20260702g`（`window.__APP_BUILD__`） |
| **Worker** | `prompt-hub-api` · https://api.prompt-hubs.com · `MEDIA_STORAGE_MODE=r2-first` |
| **画布** | infinite-canvas-jay.vercel.app · 本地 `127.0.0.1:3000/canvas` |
| **重构文档** | `docs/FABLE5-REARCHITECT-BRIEF.md`（给 Fable5 的低成本现代化蓝图） |

### 已打通

- ✅ 生图 → 最近生成（7 天），手动「存入库」才进卡片库
- ✅ JWT + `sign-batch` / `warehouse-thumbs`；卡片库进页清 404 缓存
- ✅ 侧栏 **「卡藏」** · 标题 **卡藏 · 卡片式提示词仓库**
- ✅ 画布全节点 hover 工具栏（`766644e`）
- ✅ `/health`、兑换、生图 API

### 已知问题

- 大量老卡仍灰块 → R2 缺对象 + repair 未批量跑（见 `docs/CARD-LOADING.md`）
- 画布 **`Maximum update depth`** → 代码已修，待 push infinite-canvas 并 redeploy Vercel
- Service Worker 偶发 `Failed to fetch`；强刷看 `__APP_BUILD__`
- 前端巨型单文件（`script.js` / `features-draft.js`）维护成本高 → 见 Fable5 简报分阶段重构

### 下一步

1. 用 `docs/FABLE5-REARCHITECT-BRIEF.md` 第 0 节模板让 Fable5 出 Phase 0～1 计划
2. 强刷卡片库验收；仍灰块跑 R2 同步 / warehouse repair
3. 画布 push 缩放 fix → Vercel 部署

```powershell
cd d:\prompt-hub
.\deploy-pages.ps1
```

### 测试账号

- 邮箱 `2705367723@qq.com`
- `author_id`：`ab5c77dc-570e-4af7-ac38-2d311be96244`

---

## 新对话提示词（复制整段）

```text
项目：Prompt Hub（d:\prompt-hub），Pages https://prompt-hubs.com，API https://api.prompt-hubs.com。

必读：docs/AI-PITFALLS.md、docs/ARCHITECTURE-CHANGE-GUARD.md、docs/CURRENT-ISSUES.md、docs/FEED-MODULES.md、docs/AI-HANDOFF.md。

协作：简体中文；用户是小白；分步说明；Cloudflare 写清菜单路径；勿提交密钥。
```
