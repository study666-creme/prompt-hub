# R2 图片存储与恢复

> 历史图片迁入 R2 已完成。本文描述当前读写模式、巡检和恢复，不再作为迁移倒计时文档。

## 当前模式

生产 Worker 配置 `MEDIA_STORAGE_MODE=r2-first`：

| 操作 | 行为 |
|---|---|
| 读取 | 先 R2；缺失时回源 MemFire Storage |
| 上传 | R2 成功后继续写 MemFire Storage，保持双份 |
| 列表 | 默认签 `_grid.jpg` 缩略图 |
| 详情/下载/Canvas | 显式请求 full 原图 |
| 删除 | 仅通过校验所有权和引用关系的 Worker 接口 |

`r2` 模式是 R2-only，只有确认所有对象完整且接受失去 Storage 回源时才使用。`supabase` 模式只读写 MemFire Storage，用于紧急隔离 R2 问题。

## 路径约定

```text
{user_uuid}/{card_id}.jpg
{user_uuid}/{card_id}_grid.jpg
{user_uuid}/generated/{job_or_card_id}.jpg
{user_uuid}/generated/{job_or_card_id}_grid.jpg
```

数据库保存 `storage://card-images/{path}`。Worker CDN URL 和签名 token 会过期，不能持久化回 JSON。

## 巡检

后台 `admin.html -> 卡片库` 可以只读扫描当前页图片。指定用户的深度诊断：

```powershell
$env:AUDIT_USER_ID = '<user-uuid>'
node scripts/audit-card-images.mjs
```

配置来自 `scripts/admin.local.env`。公开仓库脚本不带默认用户 ID。

R2 缺对象但 MemFire Storage 有原图时，先 dry-run：

```powershell
$env:AUDIT_USER_ID = '<user-uuid>'
node scripts/run-warehouse-repair.mjs --dry-run --max 80
```

核对路径和数量后再去掉 `--dry-run`。该脚本用于回填，不会修复已经失效且没有任何备份的第三方外链。

## 404 判断

1. CDN token 401：重新签名，不代表对象丢失。
2. R2 miss 但 Storage 命中：`r2-first` 应回源；可安排回填。
3. R2 和 Storage 都 miss：检查本地备份、生成任务结果或历史对象清单。
4. 第三方 URL 404：只能从原作者/本地备份恢复。
5. 只有 `_grid` 缺失：从存在的 full 原图生成，不要上传空占位。

## 备份建议

- 开启 Cloudflare R2 对象版本/生命周期策略时先确认成本和保留期。
- 定期导出对象清单（key、size、etag、时间），与数据库引用做差异检查。
- 关键原图另外保存离线副本；数据库 dump 不包含 R2 内容。
- 删除 orphan 前保留预览清单并等待观察期。

## 紧急切换

R2 大面积故障时可临时把 `MEDIA_STORAGE_MODE` 改为 `supabase` 并部署 Worker；MemFire Storage 必须确有完整对象。恢复 `r2-first` 前先在测试路径确认读写和缩略图正常。
