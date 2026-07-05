# MemFire 明早迁移 Runbook

目标日期：2026-07-07 早上。目标是先把数据库迁到 MemFire，再按现有 `SUPABASE_*` 兼容变量切换前端和 Worker。不要删除 Supabase 项目，至少保留 2 周用于回滚。

## 0. 今晚先准备

1. 在 MemFire 创建全新项目。
2. 记录这些信息，不要提交到 git：
   - API URL
   - anon public key
   - service_role key
   - Postgres host / port / user / database / password
3. Storage 新建私有 bucket：`card-images`。
4. 如果 MemFire 控制台允许，把 JWT Secret 设置成旧 Supabase 的 JWT Secret。若无法设置，旧用户需要重新登录一次，但卡片数据不会因为这个丢。
5. 确认本机能运行 `pg_dump`、`pg_restore`、`psql`。如果命令不存在，安装 PostgreSQL client tools。

## 1. 最终导出 Supabase

```powershell
cd D:\prompt-hub
.\scripts\pg-dump-for-migrate.ps1
```

脚本会让你输入 Supabase 数据库连接信息，输出类似：

```text
backups\prompt-hub-final-20260707-0830.dump
```

这个 `dump` 不提交 git，保留在本机和一份外部备份里。

## 2. 导入 MemFire

```powershell
cd D:\prompt-hub
.\scripts\memfire-restore.ps1 -DumpFile "backups\prompt-hub-final-20260707-0830.dump"
```

只在新 MemFire 目标库上运行。若你确认目标库是新库、且前一次导入失败需要清理后重试，再加：

```powershell
.\scripts\memfire-restore.ps1 -DumpFile "backups\prompt-hub-final-20260707-0830.dump" -CleanTarget
```

导入完成后看脚本输出的行数，重点确认：

```sql
select count(*) from auth.users;
select count(*) from public.user_data;
select count(*) from public.community_posts;
select count(*) from storage.objects where bucket_id = 'card-images';
```

## 3. 配置迁移检查脚本

复制本地环境模板：

```powershell
copy scripts\admin.local.env.example scripts\admin.local.env
```

填入旧 Supabase 和新 MemFire 的 URL / service_role key。这个文件已被 `.gitignore` 忽略，不要提交。

检查：

```powershell
node scripts\memfire-preflight.mjs
```

如果走 MemFire Storage，并且本机已有 `backups\card-images`：

```powershell
node scripts\memfire-upload-storage.mjs --from-local backups\card-images --dry-run
node scripts\memfire-upload-storage.mjs --from-local backups\card-images
node scripts\memfire-preflight.mjs
```

当前项目已经支持 R2-first。若图片主链路继续走 R2，可以先不把全部旧图搬进 MemFire Storage，数据库切换后重点验证新图上传和 R2 回源。

## 4. 切换应用配置

前端：

1. 用 `supabase-config.memfire.example.js` 对照修改 `supabase-config.js`。
2. 如浏览器扩展也要同步切换，用 `extension/config.memfire.example.js` 对照修改 `extension/config.js`。

Worker Secrets：

```powershell
cd D:\prompt-hub\server
npm exec -- wrangler secret put SUPABASE_URL
npm exec -- wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npm run deploy
```

填入的是 MemFire API URL 和 MemFire service_role key。变量名仍然叫 `SUPABASE_*`，因为代码层兼容 Supabase SDK。

Pages：

```powershell
cd D:\prompt-hub
.\deploy-pages.ps1
```

## 5. 上线验收

1. 打开 `https://api.prompt-hubs.com/health`，确认数据库健康。
2. 用测试账号登录，确认卡片库数量和最近卡片正常。
3. 新建一张卡并上传图片。
4. 打开一张 MJ 多图卡，逐张翻页，确认不再出现封面可见、其他图加载失败。
5. 发布/浏览社区 Feed。
6. 生图提交一次低成本任务，确认扣费、回写、入库流程正常。
7. 运行：

```powershell
node scripts\memfire-preflight.mjs --api https://api.prompt-hubs.com
```

## 6. 回滚

如果 MemFire 切换后出现严重问题：

1. 把 `supabase-config.js` 改回 Supabase。
2. Worker Secrets `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` 改回 Supabase。
3. 重新部署 Worker 和 Pages。
4. 不要删除 MemFire 数据，先保留现场排查。

回滚前后都不要批量删除卡片或调用 destructive purge。图片缺失优先按加载链路/R2/MemFire Storage 排查。
