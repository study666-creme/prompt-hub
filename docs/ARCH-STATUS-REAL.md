# 架构真实进度

> 最后更新：2026-07-06 · 以 **index.html 引用 + 线上行为** 为准

## 图例

| 符号 | 含义 |
|------|------|
| ✅ | 已接入生产（index 引用或 Worker 已部署） |
| 🟡 | 代码在仓库，未完全替换旧路径 |
| ❌ | 仅文档/计划 |

---

## Phase 0 — 数据安全

| 项 | 状态 | 说明 |
|----|------|------|
| `checkCloudCardReferences` | ✅ | `features-draft.js` → `purgeCreationMedia` |
| `scripts/test-purge-safety.mjs` | 🟡 | 测 mock 逻辑；生产函数已存在 |
| 旧 ADR / PHASE0 草稿 | ❌ | 本次已清理；保留安全测试脚本 |

---

## Phase 1 — 类型系统

| 项 | 状态 | 说明 |
|----|------|------|
| `packages/shared` | ✅ | 仅保留运行时 utils；`CardSchema` 改为轻量本地校验，不再把 zod 打进浏览器包 |
| 全站 JSDoc 迁移 | ❌ | 未系统替换 |

---

## Phase 2 — 媒体层

| 项 | 状态 | 说明 |
|----|------|------|
| `packages/media-client` MediaCache | ✅ | 生产逻辑在 `src/bridge/media-client-entry.js`，包内仅保留实际打包需要的缓存模块 |
| `MediaCache` + `ingestSignedBatch` | ✅ | `batchSignPaths` 签名后同步进统一缓存 |
| 列表/预览 resolve | ✅ | `PromptHubMedia.resolveListUrl` 等；`MediaPipeline` 为薄代理 |
| 签名执行 | 🟡 | 仍由 `SupabaseSync.batchSignPaths` 调 Worker（结果回写 MediaCache） |

---

## Phase 3 — 模块化桥接

| 项 | 状态 | 说明 |
|----|------|------|
| `pack-media-client.js` | ✅ | `index.html` 在 `supabase-sync` 之后、`pack-core` 之前 |
| `media-pipeline.prefetchList` | ✅ | 经 `PromptHubMedia.prefetchList` |
| `CardListRenderer` 替换 renderCards | ❌ | **故意不做**（会破坏 `.card` DOM） |
| `src/bridge/warehouse-bridge.js` | ❌ | 草稿已清理，暂不保留未接入生产的桥接代码 |

---

## Phase 4 — Vite 现代化

| 项 | 状态 |
|----|------|
| 全站 Vite | ❌ 未开始 |

---

## 存储 / Worker（并行演进）

| 项 | 状态 |
|----|------|
| `MEDIA_STORAGE_MODE=r2-first` | ✅ |
| Worker `r2_backfill` repair | ✅ |
| `scripts/run-warehouse-repair.mjs` | ✅ |
| MemFire 全量切库 | ❌ |

---

## 验收命令

```powershell
cd d:\prompt-hub
node scripts/build-media-client-bundle.mjs
node scripts/test-phase3-integration.mjs
node scripts/test-purge-safety.mjs
```

浏览器控制台：

```javascript
window.PromptHubMedia?.phase          // '2-complete'
window.PromptHubMedia?.resolveListUrl
window.MediaPipeline?.resolveListUrl  // 与上同源（pack-core 代理）
```

---

## 下一步（建议顺序）

1. 终端一键 R2（含 `_grid` 缩略图）：`node scripts/run-warehouse-repair.mjs --all`
2. 迁库前 dump：`.\scripts\pg-dump-for-migrate.ps1`
3. 浏览器 repair（小批量）：`await runWarehouseBulkRepair({ max: 40, maxRounds: 20 })`
4. 明天 MemFire：先看 `docs/MEMFIRE-MORNING-RUNBOOK.md`，完整背景见 `docs/MEMFIRE-MIGRATION.md`

## 2026-07-03 后续优化（已做）

- R2 脚本同步回填 `_grid` 缩略图（列表图更快恢复）
- 社区 sync 遇 503/超时自动退避 3 分钟，控制台只警告一次
- 浏览器 repair 按 Worker `nextOffset` 扫完全库后自动结束
- 生图仓库 prefetch 走 `PromptHubMedia`
