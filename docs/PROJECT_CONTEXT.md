# Prompt Hub — 项目上下文

> 给 AI / 协作者：新任务先读本文件 + `docs/AI-PITFALLS.md`。

---

## 当前部署阶段（2026-07-04 · 构建 `20260704c`）

| 项 | 状态 |
|----|------|
| **Pages** | https://prompt-hubs.com · **`window.__APP_BUILD__` = `20260704c`** |
| **Worker** | `prompt-hub-api` · https://api.prompt-hubs.com · `MEDIA_STORAGE_MODE=r2-first` |
| **架构真实进度** | **`docs/ARCH-STATUS-REAL.md`**（勿信 `MISSION-COMPLETE.md` 旧版） |

### 已打通

- ✅ **卡片库 / 最近生成灰块大面积自恢复**（`20260704c`）：自有生图卡列表允许 full 降级；升构建号清 `ph_missing_paths_v1`；多图源 fallback
- ✅ **`pack-media-client.js`** → `window.PromptHubMedia`（Phase 1～3 生产桥接）
- ✅ Worker 分页 `recover-warehouse` + `r2_backfill`（避免 848 张全扫 503）
- ✅ `/health`、兑换、生图 API

### 已知问题

- 仍有个别灰卡：Console **404** 的 `.png` → R2/Supabase 无原图或 `genJobId` 记录已删，需 `runWarehouseBulkRepair` 或接受丢失
- 全量 `CardListRenderer` 替换 **未做**

### 下一步

1. 剩余灰卡：`await runWarehouseBulkRepair({ max: 40, maxRounds: 10 })` 或终端 `node scripts/run-warehouse-repair.mjs --all`
2. MemFire 迁库见 `docs/MEMFIRE-MIGRATION.md`

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
