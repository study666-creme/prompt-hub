# Prompt Hub — 项目上下文

> 给 AI / 协作者：新任务先读本文件 + `docs/AI-PITFALLS.md`。

---

## 当前部署阶段（2026-07-02 · 卡片库交互 + 加载修复）

| 项 | 状态 |
|----|------|
| **Pages** | https://prompt-hubs.com · **`20260701h`** |
| **Worker** | `prompt-hub-api` · https://api.prompt-hubs.com |

### 已打通

- ✅ 画布 API：`GET /extension/cards` 含纯提示词卡（`hasImage: false`）；Worker 已部署
- ✅ 画布前端：纯文字卡插入为「提示词节点」（需 Vercel 重部署 infinite-canvas-jay）

### 已知限制

- 尚无 storage 的生图卡仍走 `warehouse-thumbs` Worker

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
