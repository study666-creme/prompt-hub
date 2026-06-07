# Supabase → MemFire Cloud 迁移指南（小白分步）

> **目标**：数据库 + 登录用户 + 卡片图片迁到国内 MemFire；**业务代码几乎不改**（仍用 `supabase-js`）。  
> **前提**：先按 `docs/SUPABASE-BACKUP-BEGINNER.md` 做好 **pg_dump + 图片下载**。  
> **勿提交**：`admin.local.env`、密钥、`backups/`。

---

## 分阶段：先库后图（Plan B · 当前选定）

> **选定 2026-06-06**：因 Supabase Pro 恢复后 **egress 仍受限**（约至 **6 月 25 日**），图片暂无法批量拉出；**数据库先迁 MemFire**，图片 **6 月 25 日后** 再 `sync-supabase-to-r2.mjs --download-only` 上 R2。

| 阶段 | 做什么 | 不做什么 |
|------|--------|----------|
| **现在（Phase 1）** | `pg_restore` → MemFire；改前端 + Worker 指向 MemFire | **不**跑 `memfire-upload-storage.mjs`；**不**指望 MemFire Storage 有旧图 |
| **过渡期（～6/25 前）** | 卡片库/登录/兑换/生图 API 用 MemFire 库；**新帖可正常发**（配图走 MemFire 桶或 R2 新图） | **不**批量拉 Supabase 旧图（402）；旧帖缺图由前端自动隐藏 |
| **现在可选（R2）** | 建 R2 桶 + Worker 绑定；新上传可写 R2（`MEDIA_STORAGE_MODE=r2`，见 `R2-MIGRATION.md`） | **不能**跑 `sync-supabase-to-r2.mjs` 拉历史图（Supabase Storage 402） |
| **6 月 25 日后（Phase 2）** | `node scripts/sync-supabase-to-r2.mjs --download-only` → R2；Worker 设 `MEDIA_STORAGE_MODE=r2-first` 并 deploy | 再考虑 `memfire-upload-storage` 或纯 R2 |

### 过渡期你会看到什么

- **登录 / 卡片数据 / 积分**：正常（数据在 MemFire）。
- **卡片库旧图、社区 Feed 旧图**：**暂不可见**（`storage://` 仍在库里，但 Worker 回源 MemFire 空桶 → 404）。属预期，不是 restore 失败。
- **新上传的图**：写入 **MemFire** `card-images` 和/或 **R2**（若已建桶并设 `MEDIA_STORAGE_MODE=r2`）；与 Supabase 旧图分离，6/25 后 R2 同步会补齐历史图。

### 卡片库：旧 Supabase 无图卡自动隐藏（～6/25 前）

> **同样适用于** 迁 MemFire 前在 **阿里云 / 本机** 调试的阶段。

| 项 | 说明 |
|----|------|
| **隐藏谁** | 带 `storage://card-images/...`、且**当前存储拉不到图**的卡片（多为旧境外 Supabase 图） |
| **不删数据** | 卡片仍在 `user_data` 与浏览器 IndexedDB；只是列表不展示 |
| **仍显示** | 无图纯文字卡、本机新上传且能验到的图、`data:` / 有效 https 图 |
| **实现** | `shouldShowCardInWarehouse` + `isPathKnownMissing`（`supabase-sync.js`） |
| **恢复** | **6 月 25 日后** `sync-supabase-to-r2.mjs` + Worker `MEDIA_STORAGE_MODE=r2-first` → 旧图可拉 → 列表自动再显示 |
| **勿误操作** | 不要用「批量删无图卡」清库；过渡期不需要看见它们即可 |

### 你现在存的卡：存在哪？上线会同步吗？

| 位置 | 内容 |
|------|------|
| **浏览器 IndexedDB**（`PromptRepoDB`） | 本机缓存，刷新后仍在 |
| **云端 `user_data` 表** | 登录后 `pushToCloud` 写入（JSON：`cards`、`groups`、`settings`…） |
| **不是** 项目文件夹里的 `.json` 文件 | 除非手动导出 |

**本机现在存的卡**：在阿里云 `supabase_db.user_data` 里有一份；迁 **MemFire** 时把 **含最新数据的 dump** `pg_restore` 进去即可（试用到期前再 dump 一次）。

**换设备 / 上线后**：登录同一账号 → 从云端 `pull` → 自动同步；**新卡、新图**随 MemFire 走，不依赖旧 Supabase 图。

### 社区帖（无需改代码）

| 机制 | 说明 |
|------|------|
| **新帖** | **可以正常发**；配图须已在 MemFire 桶或 R2（新上传的图） |
| **旧帖缺图** | `feed-images.js` 的 `removeBrokenCommunityFeedCard` 在图片 404 后 **从 Feed 移除该卡片**（仅视觉隐藏，库内 `published` 不变） |
| **服务端发布** | `resolvePublicImageRef` 校验桶内文件；**旧 Supabase 图**在 MemFire 空桶时无法通过校验——用新上传的图发帖即可 |
| **勿误操作** | 切 MemFire 后 **不要** 调 admin `POST /admin/community/purge-ghosts`（会按 MemFire 空桶误下架全部帖）；等 R2 同步后再 purge |

### Phase 2 检查清单（～6 月 25 日）

1. Supabase egress 恢复后：`node scripts/sync-supabase-to-r2.mjs --download-only --out backups\card-images`（或全量同步到 R2）。
2. Cloudflare Worker → **Variables**：`MEDIA_STORAGE_MODE` = `r2-first`。
3. `cd server && npm run deploy`。
4. 打开卡片库 + 社区 Feed，确认旧图恢复。
5. 可选：`purge-ghosts` 清理仍无效的帖。

详见 `docs/R2-MIGRATION.md`。

---

## 分工一览

| 谁做 | 内容 |
|------|------|
| **你（必须亲手）** | 注册 MemFire、pg_dump/restore、控制台建桶、改 Worker Secrets、部署 |
| **仓库已备好** | 本文档、`scripts/memfire-upload-storage.mjs`、`scripts/memfire-preflight.mjs`、配置模板 |

---

## 第 0 步：迁移前备份（必做）

1. 按 **`docs/SUPABASE-BACKUP-BEGINNER.md`** 完成数据库 dump + 图片下载。  
2. 在 Supabase Dashboard → **Settings → API** 抄到本地（勿提交 git）：

| 项 | 用途 |
|----|------|
| Project URL | 旧库 |
| anon key | 对照 |
| service_role key | dump/迁图 |
| **JWT Secret** | 迁到 MemFire 后用户可免重新登录 |

3. 确认本机有 `pg_dump` / `pg_restore`（PostgreSQL 客户端，或 WSL）。

---

## 第 1 步：注册 MemFire 并建项目（你操作）

1. 打开 https://memfiredb.com/ → 注册 → **个人实名**。  
2. 控制台 → **创建应用 / 项目**（名称如 `prompt-hub`）。  
3. 记下（后面要填进配置）：

| 项 | 在 MemFire 哪里 |
|----|-----------------|
| **API URL** | 项目设置 → API（形如 `https://xxxx.baseaf.memfiredb.com`） |
| **anon public key** | 同上 |
| **service_role key** | 同上（**仅后端/脚本**，勿放前端仓库） |
| **JWT Secret** | 项目设置 → API → JWT（见第 3 步） |
| **数据库连接串** | 数据库 → 连接信息（restore 用） |

4. **套餐**：选能覆盖你当前数据量的档（库 + 存储）；先看清 **Storage 单文件上限** ≥ 50MB（与迁移 `20260602120000_card_images_50mb_limit.sql` 一致）。

---

## 第 2 步：MemFire 建 Storage 桶（你操作）

1. MemFire 控制台 → **Storage** → 新建桶 **`card-images`**。  
2. 设为 **私有**（与 Supabase 一致）。  
3. 若控制台可设单文件上限，设为 **50MB** 或与旧站一致。

> 存储策略（RLS）应随 **第 4 步 SQL/restore** 一并迁入；restore 后检查桶策略是否生效。

---

## 第 3 步：对齐 JWT Secret（强烈建议，你操作）

为让老用户 **不用重新登录**：

1. 复制 **Supabase** 的 JWT Secret。  
2. MemFire 控制台 → **API / JWT 设置** → 设为 **与 Supabase 相同**（若 MemFire 允许自定义）。  
3. 保存后 **anon / service_role key 可能会变** → 用 MemFire 控制台里 **最新** 的 key 填配置。

若无法自定义 JWT：用户需 **重新登录一次**，**卡片数据不丢**。

---

## 第 4 步：导入数据库（你操作，二选一）

### 方法 A：整库 restore（推荐，含 `auth.users`）

**第 1 步** 在 MemFire 拿到 **Postgres 连接信息**（主机、端口、库名、用户、密码）。

**第 2 步** PowerShell（把主机等换成 MemFire 给的）：

```powershell
cd d:\prompt-hub
$env:PGPASSWORD = "MemFire数据库密码"
pg_restore -h 你的memfire数据库主机 -p 5432 -U postgres -d postgres --no-owner --no-acl -v backups\prompt-hub-YYYYMMDD.dump
Remove-Item Env:PGPASSWORD
```

**第 3 步** 若报错「已存在」：MemFire 新项目一般是空库；若有冲突，用 MemFire 文档或 **只 restore public + auth schema**（进阶，可先问 AI 带报错信息）。

**第 4 步** 验证（MemFire SQL 编辑器或本机 `psql`）：

```sql
select count(*) from auth.users;
select count(*) from profiles;
select count(*) from community_posts;
```

数字应与 Supabase 备份前接近。

### 方法 B：只跑仓库迁移 SQL（无旧用户密码时）

仅 **全新空项目** 适用；**不能**保留 Supabase 已有用户登录态。

1. MemFire SQL 编辑器 → 按 **`supabase/migrations/`** 文件名顺序执行（从 `20260526000000_backend_core.sql` 起）。  
2. 已有 dump 时 **不要** 用此法替代 restore。

---

## 第 5 步：迁移图片（你操作）

**第 1 步** 复制环境变量模板：

```powershell
cd d:\prompt-hub
copy scripts\admin.local.env.example scripts\admin.local.env
```

**第 2 步** 编辑 `scripts\admin.local.env`（勿提交 git）：

```ini
# 源（Supabase，迁完可删）
SUPABASE_URL=https://yibawjvhmqcysdovscss.supabase.co
SUPABASE_SERVICE_ROLE_KEY=你的supabase_service_role

# 目标（MemFire）
MEMFIRE_URL=https://你的项目.baseaf.memfiredb.com
MEMFIRE_SERVICE_ROLE_KEY=你的memfire_service_role
```

**第 3 步** 若第 0 步已下载图片，可从本地传（省 Supabase 流量）：

```powershell
node scripts/memfire-upload-storage.mjs --from-local backups\card-images
```

**或** 直接从 Supabase 拉到 MemFire：

```powershell
node scripts/memfire-upload-storage.mjs
```

**第 4 步** 跑预检：

```powershell
node scripts/memfire-preflight.mjs
```

应看到 MemFire Storage 对象数量与 Supabase 接近。

---

## 第 6 步：改仓库配置（你操作，对照模板）

### 6.1 主站 `supabase-config.js`

对照 `supabase-config.memfire.example.js`，改两行：

```javascript
window.SUPABASE_URL = 'https://你的项目.baseaf.memfiredb.com';
window.SUPABASE_ANON_KEY = 'MemFire的anon_key';
```

> 变量名仍叫 `SUPABASE_*`，SDK 兼容 MemFire，**不用改** `supabase-sync.js` 业务逻辑。

### 6.2 `index.html` 预连接（2 行）

把 `preconnect` / `dns-prefetch` 里的域名改成 **MemFire API 域名**（与 `SUPABASE_URL` 一致）。

### 6.3 浏览器扩展 `extension/config.js`

```javascript
SUPABASE_URL: 'https://你的项目.baseaf.memfiredb.com',
SUPABASE_ANON_KEY: 'MemFire的anon_key',
AUTH_STORAGE_KEY: 'sb-你的MemFire项目ref-auth-token',
```

`AUTH_STORAGE_KEY` 规则：MemFire 项目 ref 在 URL 里，格式 **`sb-{ref}-auth-token`**（与 Supabase 相同规则；迁后用户需重新登录一次时，旧 key 可清 localStorage）。

### 6.4 Cloudflare Worker Secrets（你操作）

Cloudflare 控制台 → **Workers & Pages** → **prompt-hub-api** → **Settings** → **Variables and Secrets**：

| Secret | 新值 |
|--------|------|
| `SUPABASE_URL` | MemFire API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | MemFire service_role |

本地开发同步改 `server/.dev.vars`（勿提交）。

然后部署 Worker：

```powershell
cd d:\prompt-hub\server
npm run deploy
```

### 6.5 部署 Pages

```powershell
cd d:\prompt-hub
.\deploy-pages.ps1
```

---

## 第 7 步：上线验收（你操作）

1. https://api.prompt-hub.cn/health → `supabase: ok`  
2. https://prompt-hub.cn → **邮箱登录**（旧账号）  
3. 卡片库有卡、图片能显示  
4. 新建一张卡 + 上传图  
5. 社区 Feed、兑换码、生图各点一次  
6. 扩展存卡（若用）试一次  

```powershell
node scripts/memfire-preflight.mjs --api https://api.prompt-hub.cn
```

---

## 第 8 步：观察与回滚

| 时间 | 做什么 |
|------|--------|
| **2～4 周内** | **不要删** Supabase 项目；保留 dump + `backups/card-images` |
| 每周 | `pg_dump` MemFire 到 `backups/`（同备份文档方法 B，换 MemFire 连接串） |
| 若严重故障 | 把 `supabase-config.js` + Worker Secrets **改回 Supabase**，重新 deploy（回滚） |

---

## MemFire 与 Supabase 差异（心里有数）

| 项 | 说明 |
|----|------|
| 新功能上线速度 | MemFire 慢半拍，小站无感 |
| Edge Functions | 你有 **Cloudflare Worker**，不依赖 Supabase Functions |
| 微信/短信 | MemFire 国内更顺（见 `docs/SUPABASE-AUTH.md`） |
| 以后迁阿里 RDS | 再 `pg_dump` 一次即可，**不丢表**；Auth/Storage 再逐步收口到 Worker |

---

## 常见问题

**Q：restore 后登录 401？**  
检查 JWT Secret 是否对齐；或让用户退出重新登录。

**Q：图片 403？**  
检查 `card-images` 桶是否私有、迁移 SQL 里 storage policy 是否存在、Worker `SUPABASE_URL` 是否已指向 MemFire。

**Q：pg_restore 报错？**  
把 **完整报错** + MemFire 连接方式发给 AI；不要反复覆盖生产库。

**Q：能否跳过图片先迁库？**  
可以（**Plan B** 即如此）：先 restore + 改配置；图 **6/25 后** 走 R2 同步（`sync-supabase-to-r2.mjs`），不必先 `memfire-upload-storage.mjs`。

---

## 相关文件

| 文件 | 作用 |
|------|------|
| `scripts/memfire-upload-storage.mjs` | Supabase 或本地 → MemFire Storage |
| `scripts/memfire-preflight.mjs` | 迁移前后对象数量/API 健康检查 |
| `supabase-config.memfire.example.js` | 主站配置模板 |
| `extension/config.memfire.example.js` | 扩展配置模板 |
| `docs/SUPABASE-BACKUP-BEGINNER.md` | 迁前备份 |
| `docs/R2-MIGRATION.md` | 图片也可走 R2（与 MemFire 并行，Worker 已支持） |

---

*更新：2026-06-06 · 迁移动线：Supabase（境外）→ MemFire（国内）→ 远期阿里 RDS。*
