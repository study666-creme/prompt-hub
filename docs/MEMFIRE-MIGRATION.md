# MemFire 数据库备份与恢复

> Supabase -> MemFire 的生产迁移已经完成。本文现在用于例行备份、恢复演练和未来换库，不是迁移当天清单。

## 必须分别备份的内容

| 内容 | 位置 | 方式 |
|---|---|---|
| Postgres 业务表 | MemFire Database | `pg_dump -Fc` |
| Auth 用户 | 同一 Postgres dump 中的 auth schema | 恢复后核对用户数和登录 |
| Storage 元数据 | Postgres storage schema | 随 dump 保存 |
| 图片对象 | Cloudflare R2 + MemFire Storage | 独立对象备份/清单 |
| Worker Secrets | Cloudflare | 密码管理器离线记录，不能进 Git |

数据库 dump 不包含 R2 对象内容，所以不能只保存一个 `.dump` 就认为图片已备份。

## 创建数据库备份

1. 在 MemFire 控制台复制 PostgreSQL 连接 URI和数据库密码。
2. 本机安装 PostgreSQL 15+ 客户端，确认 `pg_dump`、`pg_restore`、`psql` 可用。
3. 在 PowerShell 运行：

```powershell
cd D:\prompt-hub
.\scripts\pg-dump-for-migrate.ps1 -Mode uri
```

选择/粘贴 URI 时使用数据库连接密码，不是 anon 或 service role API key。输出在被 Git 忽略的 `backups/`。

备份后检查：

```powershell
pg_restore --list .\backups\prompt-hub-final-YYYYMMDD-HHMM.dump | Select-Object -First 20
```

把 dump 复制到至少一个不在本机项目目录中的加密位置，并记录创建时间和源项目。

## 恢复演练

只对新建的空 MemFire 项目执行：

```powershell
cd D:\prompt-hub
.\scripts\memfire-restore.ps1 -DumpFile '.\backups\prompt-hub-final-YYYYMMDD-HHMM.dump'
```

`-CleanTarget` 会删除/覆盖目标对象，只能在已确认是临时空库且普通恢复失败时使用。不要对生产项目试运行。

恢复后核对：

- `auth.users`, `profiles`, `user_data`, `community_posts`, `generation_requests` 数量。
- RLS、GRANT、RPC 和 `storage` schema 是否存在。
- 用测试账号登录，读取卡片，不修改已有数据。
- Worker 指向测试库时 `/health` 返回 `supabase: ok`。

## 切换数据库

1. 在新库完成恢复和只读核对。
2. 记录旧 `SUPABASE_URL` 和 key，保留回滚能力。
3. 更新 Worker Secrets `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`，必要时更新 `SUPABASE_JWT_SECRET`。
4. 更新前端/扩展 anon key 与 auth storage key。
5. 先部署 Worker，验 `/health`、登录和社区 API，再部署 Pages/扩展。
6. 观察至少 24 小时，不立即删除旧库。

变量名仍叫 `SUPABASE_*`，因为 MemFire 使用 Supabase-compatible API；这不表示生产仍在 Supabase Cloud。

## 回滚

把 Worker Secrets 和前端 anon 配置改回旧库并重新部署。不要在回滚过程中批量删除新库或 R2 对象，先保留现场做差异核对。
