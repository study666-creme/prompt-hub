# 数据与仓库安全

## 公开仓库边界

这个仓库是公开的。以下内容不得提交：

- `.env`, `.env.local`, `server/.dev.vars`, `scripts/admin.local.env`
- 数据库密码、`service_role`、Cloudflare/API token、上游生图 Key
- 用户密码、访问令牌、真实测试账号、用户 UUID、订单或卡密清单
- `.wrangler/`, `.pages-deploy/`, `backups/`, `dist/` 等本地产物

前端 anon key 和公开 API 域名可以出现在静态配置中；它们不能代替 RLS 和 Worker 授权。

## 权限模型

| 数据 | 客户端 | Worker/admin |
|---|---|---|
| 用户 `user_data` | 仅本人 RLS | service role 可维护 |
| 私有卡片图片 | 仅本人签名访问 | R2/Storage 读写 |
| 公共社区帖/图 | 只读公开接口 | 发布、下架和审核 |
| 积分/会员/卡密 | 只读本人状态 | 唯一写入方 |
| 生图任务 | 只读本人 | 扣费、结算、退款和归档 |

RLS 和 GRANT 定义在 `supabase/`。恢复新库后必须执行 schema/迁移并用 `/health` 验证 service role，不要临时开放全表匿名读写来绕过权限错误。

## 防丢失

- 登录后先拉云端再合并；空本地数据不能覆盖云端。
- 账号切换前保存 UID 归属快照并取消旧账号同步任务。
- 删除使用 tombstone，避免旧设备复活。
- 数据库定期 `pg_dump`；R2 与数据库备份分开保存。
- 恢复演练在新项目/测试桶完成，禁止直接对生产执行 `--clean`。

备份步骤见 `MEMFIRE-MIGRATION.md`。

## 部署前检查

```powershell
git status --short
git diff --cached
git grep -n -I -E "(BEGIN .*PRIVATE KEY|sk-[A-Za-z0-9_-]{20,}|service_role.*=.+)"
```

该简单扫描不能替代专用 secret scanner。发现已公开的真实密钥时，先在提供商处撤销/轮换，再从当前提交移除；仅删除 Git 文件不能让旧密钥失效。

## 事故处理

1. 立即撤销或轮换泄露凭据。
2. 检查 Cloudflare、MemFire 和上游调用日志。
3. 暂停相关 provider 或管理接口，避免继续扣费/写入。
4. 用审计日志确认影响用户和时间段。
5. 修复后补回归测试和最小必要的事故规则，不在主文档保留账号级细节。
