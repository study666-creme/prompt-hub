# Supabase 备份清单（代开 Pro 当天 · 小白版）

> **何时做**：Organization 恢复、能登录 Dashboard 后 **立刻做**（优先于改代码）。  
> **目的**：数据库 + 图片丢了还能迁走；不备份 = 封号/再限流时可能全没。

---

## 第 0 步：确认已恢复

1. 打开 https://supabase.com/dashboard → 进你的 Project  
2. 左侧 **Storage → Files** 能列出 `card-images`  
3. 打开 https://prompt-hub.cn → 能 **登录**  
4. 打开 https://api.prompt-hub.cn/health → 返回正常  

任一不行 → 先解决 Pro/限流，再备份。

---

## 第 1 步：备份数据库（Postgres）

### 方法 A：Dashboard 导出（最简单）

1. Dashboard → **Database** → **Backups**（Pro 含每日备份，可先确认有最近一条）  
2. 或 **SQL Editor** → 对关键表跑只读查询保存结果（应急用）：

```sql
-- 用户数
select count(*) from auth.users;
-- 社区帖
select count(*) from community_posts;
-- 个人资料
select count(*) from profiles;
```

### 方法 B：本机 `pg_dump`（完整备份，推荐）

**第 1 步** 在 Dashboard → **Project Settings → Database** 复制：

- **Host**（Connection string 里的主机）  
- **Database name**（通常 `postgres`）  
- **Port**（通常 `5432`）  
- **User**（通常 `postgres`）  
- **Password**（点 Reset database password 设一个临时密码，用完可再改）

**第 2 步** 本机 PowerShell（需已装 PostgreSQL 客户端，或 WSL 里 `pg_dump`）：

```powershell
cd d:\prompt-hub
mkdir backups -Force
$env:PGPASSWORD = "你刚设的密码"
pg_dump -h db.xxxxx.supabase.co -p 5432 -U postgres -d postgres -Fc -f "backups\prompt-hub-$(Get-Date -Format yyyyMMdd).dump"
Remove-Item Env:PGPASSWORD
```

生成 `backups\prompt-hub-YYYYMMDD.dump` 即成功。

> 没有 `pg_dump`：用 Dashboard **Database → Backups** 下载，或先只做方法 A + 第 2 步图片备份。

---

## 第 2 步：备份图片（Storage `card-images`）

约 **1GB**，用脚本批量下载到本机。

**第 1 步** 在项目根复制 `scripts\admin.local.env.example` 为 `scripts\admin.local.env`（若已有则跳过），填入：

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=你的service_role密钥
```

> `service_role` 在 Dashboard → **Project Settings → API**；**勿提交 git、勿发聊天**。

**第 2 步** 运行同步脚本（会下载到 `backups\card-images\`）：

```powershell
cd d:\prompt-hub
node scripts/sync-supabase-to-r2.mjs --download-only
```

或 Pro 恢复后先只做下载：

```powershell
node scripts/sync-supabase-to-r2.mjs --download-only --out backups\card-images
```

---

## 第 3 步：抄下配置（迁服/灾难时用）

记在本地密码管理器或 `backups\restore-notes.txt`（**勿提交 git**）：

| 项 | 在哪抄 |
|----|--------|
| `SUPABASE_URL` | Settings → API |
| `SUPABASE_ANON_KEY` | Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API |
| `supabase-config.js` 线上用的 anon | 仓库 `supabase-config.js` |
| Worker secrets 列表 | Cloudflare → Workers → `prompt-hub-api` → Settings → Variables |
| 测试账号 `author_id` | `docs/PROJECT_CONTEXT.md` |

---

## 第 4 步：验证备份能用

```powershell
# 数据库 dump 文件应 > 100KB（有数据时通常更大）
Get-Item backups\prompt-hub-*.dump | Select-Object Name, Length

# 图片目录应有文件
(Get-ChildItem backups\card-images -Recurse -File).Count
```

---

## 恢复时怎么用（仅作备忘）

| 数据 | 恢复到新 Supabase 项目 |
|------|------------------------|
| `.dump` 文件 | `pg_restore` 或 Dashboard 导入 |
| `backups\card-images\` | 上传到新区 `card-images` 桶，或迁 **R2**（见 `docs/R2-MIGRATION.md`） |
| Auth 用户 | 密码 **不能** 从 dump 还原明文；用户需 **重置密码** 或 magic link |

---

## 备份后当天还可做

1. 若计划迁国内：**按 `docs/MEMFIRE-MIGRATION.md` 做 Supabase → MemFire**（备份完成后进行）  
2. 按 `docs/R2-MIGRATION.md` **第 1～3 步** 建 R2 桶（不必立刻切流量）  
3. 跑 `node scripts/sync-supabase-to-r2.mjs` 把图同步到 R2（Pro 恢复后）  
4. Network 看社区是否还有 404 刷屏 → 有则继续 A1 治理  

---

*与 `docs/MEMFIRE-MIGRATION.md`、`docs/R2-MIGRATION.md`、`docs/PROJECT_CONTEXT.md` 配套。*
