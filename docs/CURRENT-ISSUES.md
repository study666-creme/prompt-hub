# 当前问题与进度（2026-07-08）

> **接手顺序**：本文 → `PROJECT_CONTEXT.md` → `CARD-LOADING.md` → `AI-HANDOFF.md`  
> **调试细节**：Cloudflare 额度 → `docs/DEBUG-GUIDE.md`

---

## 仓库构建号

| 项 | 值 |
|----|-----|
| **当前 Pages** | **`20260708g`**（`window.__APP_BUILD__`） |
| **运营后台** | `admin-login.html` 登录入口 + `admin.html` 控制台 · build `20260708g` |
| Pages | https://prompt-hubs.com |
| API | https://api.prompt-hubs.com |
| Worker | `prompt-hub-api` |

---

## 首屏带宽 / 加载（**已解决 · 2026-06 用户验收**）

> 几百 MB 首屏是 **2026-05 旧版**现象；当前三页首屏均已健康。

### 用户 Network 验收（2026-06-07 · build `20260625d/e`）

| 页面 | 已传输 | DOMContentLoaded | 说明 |
|------|--------|------------------|------|
| **卡片库** | ~889 kB | ~1.0 s | 99 请求，首屏 grid 缩略图 |
| **提示词社区** | ~865 kB | ~534 ms | 159 请求 |
| **图片生成 → 仓库** | 首屏 sign-batch | — | 批量签名，非整页拉原图 |

**已落地**：文字/骨架先渲染 · 视口懒加载 · `_grid` 缩略图 · 批量 `sign-batch` · 列表禁止 full 回退 · prefetch cap。

**勿再当 P0**：除非用户再次贴 Network 显示单页 >10 MB 或连续 404/500 刷屏。

历史根因与文件索引见 **`docs/CARD-LOADING.md`**（归档）。

---

## 当前活跃项

| 优先级 | 项 | 状态 |
|--------|-----|------|
| 🔴 | **R2 历史图同步** | 用户本机 `backups/card-images` → R2 脚本进行中 |
| 🟠 | **MemFire 迁移** | Supabase Pro 约至 2026-07-07 |
| 🟡 | **部分历史图 404** | 旧第三方直链（如 aitohumanize）无法靠 R2 恢复 |
| 🟡 | **偶发 API 502** | R2 齐后单路径排查 |
| 🟢 | **运营监控** | 后台概览新增 Worker/API 5xx、图片 404、生图失败率、近似请求量与积分流水 |
| 🟢 | **Feed 滚动 / 生图 Tab** | `20260625p`：点侧栏后不再强制回拉 scroll；Tab 切换 force 重绘 |
| 🟢 | **SyncOrchestrator** | pull/Feed 刷新走编排器 |

---

## 历史 P0（社区 / 侧栏 · 部分已修）

| 优先级 | 类型 | 状态 |
|--------|------|------|
| P0-1 | `communityImgInitialSrc` 传 `null` 崩侧栏 | **已修** |
| P0-2 | 签名 404 / Storage 文件不存在 | **随 R2 同步缓解** |
| P0-3 | API 偶发断连 | 间歇 |

---

## Cloudflare 每日请求

- 上限 **100,000/天**；首屏已瘦身后额度压力明显低于 2026-05。
- 查看：Cloudflare 控制台 → **Workers 和 Pages** → **分析**
- 站内近 24 小时近似量：后台 `admin.html` → 概览 → **运行监控**。该值来自 Worker KV 自计数，图片成功请求抽样折算；官方账单仍以 Cloudflare Analytics 为准。

---

## 改代码前约定

- 修复后默认 `.\deploy-pages.ps1`；用户纯小白 → 分步 + 可复制命令。
- 勿提交密钥；仅用户要求时 `git commit`。

---

*最后更新：2026-06-07 · Pages `20260625p` · Feed 滚动/生图 Tab/侧栏已修 · 后台 UI 侧栏导航*
