# Prompt Hub — 项目上下文

> 给 AI / 协作者：新任务先读本文件 + `docs/AI-PITFALLS.md`。

---

## 当前部署阶段（2026-07-08 · MemFire 已上线）

| 项 | 状态 |
|----|------|
| **Pages** | https://prompt-hubs.com · 构建 `20260708b` |
| **Worker** | `prompt-hub-api` · https://api.prompt-hubs.com · `MEDIA_STORAGE_MODE=r2-first` |
| **DB** | **MemFire** `d95gau8g91hmdup86ag0` · Worker `/health` → `supabase: ok` |
| **图片** | R2（MemFire Storage 桶空属正常） |

### 已打通

- ✅ MemFire 数据 + auth 已 restore
- ✅ Worker `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` 已切 MemFire
- ✅ Pages anon key 已切 MemFire
- ✅ `/health`、社区 feed API 正常

### 请你本地验收

1. 打开 https://prompt-hubs.com ，**Ctrl+Shift+R** 强刷
2. **重新登录**（换库后旧 session 可能失效）
3. 检查：卡片库、社区、生图、兑换码

### 下一步（可选）

- 定价改造（本地）待 `wrangler deploy` 后生效
- MemFire JWT Secret 与旧 Supabase 对齐可免全员重登（未对齐则重登一次即可）

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
