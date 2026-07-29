# 数据与仓库安全

最后核对：2026-07-27。

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

`consume_user_credits`、`refund_user_credits`、会员原子 RPC 和 `grant_canvas_create_node_reward` 只授权 `service_role` 执行。客户端只能通过已认证 Worker 路由提交自己的用户 ID，不能直接调用奖励或钱包函数。

## 付费操作安全

- 图片和视频的上游 POST 必须先通过数据库 CAS 领取 `queued` 状态，并绑定唯一 attempt ID。
- 网络超时、队列重投、Worker 中断、`running`、`outcome_unknown` 或 task `not_found` 都不能自动发起第二次付费 POST。
- 确定性 4xx、上游明确失败和未知结果 SLA 使用持久 `refund_pending` 槽；退款 ref 唯一并可幂等恢复。
- 视频播放只根据当前用户拥有的任务 ID访问配置好的 New API `/content` 端点，不能 fetch 数据库中的任意 `resultUrl`，避免 SSRF。
- 上游渠道 ID、真实基址和密钥只存在服务端；公开目录使用 `public-model-projection`，不得透出渠道映射。

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

正式 Worker 发布还会由 `server/scripts/run-worker-release.mjs` 拒绝冻结标记和脏工作区，并把已审查提交 SHA 注入 `/health.buildSha`。冻结期间只能执行 dry-run。

## 事故处理

1. 立即撤销或轮换泄露凭据。
2. 检查 Cloudflare、MemFire 和上游调用日志。
3. 暂停相关 provider 或管理接口，避免继续扣费/写入。
4. 用审计日志确认影响用户和时间段。
5. 修复后补回归测试和最小必要的事故规则，不在主文档保留账号级细节。
