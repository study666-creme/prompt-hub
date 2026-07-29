# Prompt Hub 项目上下文

最后核对：2026-07-27

> 新任务先读根目录 `DO-NOT-DEPLOY.md`、本文、`RECONCILE-20260726.md`、`CURRENT-ISSUES.md` 和 `AI-PITFALLS.md`。

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

当前处于双树发布冻结。生产仍是历史树的旧 Worker，主树候选中的原子积分、完整图片/视频安全状态机、Canvas 建点奖励和 `/health.buildSha` 尚未作为一个受控版本上线。不要把本地测试通过写成生产已修复。

Pages 的准确 build 只从线上 `window.__APP_BUILD__` 读取；Worker 在本轮受控发布前没有可靠提交指纹。发布后以 `/health.buildSha` 为唯一 Worker 版本证据，不在本文长期复制构建号。

## 主树候选已经具备

- 图片和视频的稳定请求幂等、单次付费提交、未知结果退款 SLA 与持久恢复槽。
- 图片秒级前端轮询、服务端 poll/archive drain、临时结果优先展示和本地归档重试。
- 视频独立队列、长时 SD processing、同渠道 submit/poll/content、明确计费秒数差价退款。
- 实时公开模型投影，`quality` 与 `resolution` 分离，香蕉参考图能力保留。
- 支付回调审计、订单监控、Canvas 席位契约、`/wallet` 兼容入口和首次建点奖励。
- 正式发布的冻结/脏树守卫和 Git SHA 注入。

以上均为未部署候选，外部前置步骤见 `DEPLOY-CHECKLIST.md`。

## 架构约束

1. 根目录 loader、`legacy/`、`styles/`、`partials/` 和 `pack-*.js` 共同组成 Pages 运行时；改入口必须跑 `npm run check:predeploy`。
2. `user_data.data.cards` 是卡片真源，本地 IndexedDB 只是快照；空本地数据不能覆盖云端。
3. 图片 JSON 保存 `storage://card-images/...`，签名/CDN URL 只用于展示。
4. Worker Secrets 不进入 Git；公开目录不能暴露真实渠道、密钥或内部上游字段。
5. 付费生成只能从数据库 `queued` 状态领取一次。未知结果不等于失败，也不授权重新 POST。
6. Prompt Hub 提交规范化模型参数，provider 特有转换由 New API 能力层承担。

## 当前优先级

1. 保持发布冻结，完成全量测试和 dry-run 绑定核验。
2. 准备生产数据库备份和五个待发布迁移的顺序执行记录。
3. 核对视频 Queue/DLQ 和 New API 前置能力版本。
4. 整理干净审查提交，再请求正式发布授权。

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

冻结期间不运行正式 deploy、不应用生产迁移、不删除用户数据，也不使用付费生成做验收。
