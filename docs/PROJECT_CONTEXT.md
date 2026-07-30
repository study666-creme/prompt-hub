# Prompt Hub 项目上下文

最后核对：2026-07-30

> 新任务先读本文、`RECONCILE-20260726.md`、`CURRENT-ISSUES.md` 和 `AI-PITFALLS.md`；如果根目录存在 `DO-NOT-DEPLOY.md`，还必须先遵守其中的冻结条件。

## 仓库与生产状态

| 项 | 当前事实 |
|---|---|
| 唯一候选主树 | `D:\prompt-hub` |
| 历史生产审计树 | `D:\canvas\prompt-hub`，只读，不再开发或部署 |
| 主站 | `https://prompt-hubs.com` |
| API | `https://api.prompt-hubs.com`，Worker `prompt-hub-api` |
| 数据库/Auth | MemFire，保留 Supabase-compatible SDK 和变量名 |
| 图片 | R2 优先、MemFire Storage 回源 |
| Canvas | `https://canvas.prompt-hubs.com` 为正式回跳目标；其他域名仅按 CORS/部署记录兼容 |

双树收编与发布前置已完成，`20260730a` 已获受控发布授权。生产是否已经切到该版本必须通过 `/health.buildSha`、Pages build 和线上冒烟取证，不能只凭本地测试通过作结论。

Pages 的准确 build 只从线上 `window.__APP_BUILD__` 读取；Worker 在本轮受控发布前没有可靠提交指纹。发布后以 `/health.buildSha` 为唯一 Worker 版本证据，不在本文长期复制构建号。

## 主树候选已经具备

- 图片和视频的稳定请求幂等、单次付费提交、未知结果退款 SLA 与持久恢复槽。
- 图片秒级前端轮询、服务端 poll/archive drain、临时结果优先展示和本地归档重试。
- 视频独立队列、长时 SD processing、同渠道 submit/poll/content、明确计费秒数差价退款。
- 实时公开模型投影，`quality` 与 `resolution` 分离，香蕉参考图能力保留。
- 支付回调审计、订单监控、Canvas 席位契约、`/wallet` 兼容入口和首次建点奖励。
- 正式发布的冻结/脏树守卫和 Git SHA 注入。

以上属于 `20260730a` 受控发布契约，执行顺序和生产验收见 `DEPLOY-CHECKLIST.md`。

## 架构约束

1. 根目录 loader、`legacy/`、`styles/`、`partials/` 和 `pack-*.js` 共同组成 Pages 运行时；改入口必须跑 `npm run check:predeploy`。
2. `user_data.data.cards` 是卡片真源，本地 IndexedDB 只是快照；空本地数据不能覆盖云端。
3. 图片 JSON 保存 `storage://card-images/...`，签名/CDN URL 只用于展示。
4. Worker Secrets 不进入 Git；公开目录不能暴露真实渠道、密钥或内部上游字段。
5. 付费生成只能从数据库 `queued` 状态领取一次。未知结果不等于失败，也不授权重新 POST。
6. Prompt Hub 提交规范化模型参数，provider 特有转换由 New API 能力层承担。

## 当前优先级

1. 从最终干净 SHA 完成 Worker dry-run，核对全部绑定。
2. 按固定顺序执行五项生产迁移并记录结果。
3. 发布 Worker 与 Pages，核对 `/health.buildSha`、队列 consumer、DLQ、cron 和仓库首屏资源。
4. 只使用只读或明确幂等的生产验收，不发起重复付费生成。

## 接手命令

```powershell
cd D:\prompt-hub
git status --short --branch
npm run check:docs
npm run check:predeploy

cd server
npm run typecheck
npm test
npm run deploy:dry-run
```

正式发布必须按 `DEPLOY-CHECKLIST.md` 顺序执行；不删除用户数据，也不使用重复付费生成做验收。
