# Prompt Hub — 项目上下文

> 给 AI / 协作者：新任务先读本文件 + `docs/AI-PITFALLS.md`。

---

## 当前部署阶段（2026-07-02 · 卡片库 hotfix）

| 项 | 状态 |
|----|------|
| **Pages** | https://prompt-hubs.com · **`20260701e`** |
| **Worker** | `prompt-hub-api` · https://api.prompt-hubs.com |

### 已打通

- ✅ 卡片库 text-only 修复：whSig 短路检测 + hydrate 补图 + 生图卡不降级文字
- ✅ 社区「随机」每次点击重洗顺序
- ✅ 自动恢复合并时不 bump updatedAt（减少「刚刚」刷屏）

### 已知限制

- 生图卡仍多一跳 Worker `warehouse-thumbs`

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
