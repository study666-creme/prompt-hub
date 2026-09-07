# Prompt Hub 唯一部署树约定（2026-09-06 起生效）

## 背景

2026-09-06 中午发生过一次事故：两个本地仓库各自持有未合并的线上内容，
从其中一棵树部署 Worker 把另一棵树已上线的内容回滚（任务中心四项下线被
覆盖恢复）。为杜绝复发，立此约定。

## 唯一部署树

**`D:\prompt-hub`（分支 `merge/prompt-hub-20260906`，标签 `deploy-base-20260906`）**
是 Worker (`api.prompt-hubs.com`) 与 Pages (`prompt-hubs.com`) 的唯一部署源。

- `D:\canvas\prompt-hub` 只作为开发树使用（当前承载 video WIP），
  **禁止从这棵树执行 `wrangler deploy` 或 `deploy-pages.ps1`**。
- 任何部署前必须确认：目标改动已合入 `merge/prompt-hub-20260906`。
- 两树共同祖先之后的开发分支，完成后 `git merge` 进 merge 分支再部署。

## 当前内容基线（deploy-base-20260907 = main 4fa82c8，线上 Worker 94d42a31）

- 2026-09-07 后台重构上线：订单/流水/审计页、用户封禁、积分 RPC 修正、
  视频模型映射 + 按模型统计 + 错误日志、admin 前端 ES module 化（admin/ 目录）。
- Pages staging allowlist 新增 admin/（stage-pages.ps1）。
- Migration 已于 2026-09-07 通过 MemFire /pg/query 执行完成（admin_audit_logs、
  profiles 封禁列、payment_orders 后台列均已就位）。
- ⚠ 支付 schema 冲突：现网另有会话建的 payment_orders(status)+payment_events 完整模型，
  与后台重构这套 payment_orders(state) 并存（当前两表皆空）。后台 migration 已改为
  非破坏式（只加列不删表）。两套支付实现的正式合并需单独决策，勿再各自 drop 重建。

### 旧基线（deploy-base-20260906 = 线上 Worker 6f65fb31）

- 任务中心四项下线（extension_save_card / asset_studio_chat /
  asset_studio_link_card / mini-99）
- points-20 定价 CNY 30/3000，自定义充值入口下线
- M2/M4/M5/M6 稳定性修复（轮询预算时钟、聊天计费幂等、请求体预检、补投节流）
- 静态侧 = 20260906b Pages 部署内容

## 未合入的开发中内容（截至 2026-09-06）

- video WIP（video-settle 等）：在 `D:\canvas\prompt-hub` 工作树 +
  GitHub `backup/video-wip-20260906` 分支。

## 验证清单（每次 Worker 部署后）

1. `curl https://api.prompt-hubs.com/api/v1/health` → ok
2. 登录后检查任务中心四个下线条目不存在
3. 登录后检查 points-20 显示 ¥30/3000 且下单金额一致
