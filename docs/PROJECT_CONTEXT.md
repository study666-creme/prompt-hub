# Prompt Hub — 项目上下文

> 给 AI / 协作者：新任务先读本文件 + `docs/AI-PITFALLS.md`。

---

## 当前部署阶段（2026-07-02 · 卡片库对齐社区 Feed）

| 项 | 状态 |
|----|------|
| **Pages** | https://prompt-hubs.com · deploy 后见 `window.__APP_BUILD__` |
| **Worker** | `prompt-hub-api` · https://api.prompt-hubs.com |

### 已打通（卡片库架构）

- ✅ `whSig` 跳过重复整页渲染（同社区 feedSig）
- ✅ `softHydrateWarehouseContainer` + 切 Tab 快照保留已加载图
- ✅ prefetch 单链路 24 张；warehouse-thumbs session 缓存
- ✅ 生图「作品」feed 手机滚动兜底

### 已知限制

- 生图卡仍多一跳 Worker `warehouse-thumbs`（数据模型差异，非 CSS）

### 部署

```powershell
cd d:\prompt-hub
node scripts/build-foundation-bundle.mjs
node scripts/build-core-bundle.mjs
.\deploy-pages.ps1
```

### 部署

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

必读：docs/AI-PITFALLS.md、docs/CURRENT-ISSUES.md、docs/FEED-MODULES.md、docs/AI-HANDOFF.md。

协作：简体中文；用户是小白；分步说明；Cloudflare 写清菜单路径；勿提交密钥。
```
