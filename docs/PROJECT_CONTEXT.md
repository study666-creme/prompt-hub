# Prompt Hub 项目上下文

> 最后核对：2026-07-11。新任务先读本文、`CURRENT-ISSUES.md` 和 `AI-PITFALLS.md`。

## 当前线上状态

| 项 | 当前值 |
|---|---|
| 主站 | <https://prompt-hubs.com> |
| Pages build | `20260712b`（以 `window.__APP_BUILD__` 为准） |
| API | <https://api.prompt-hubs.com>，Worker `prompt-hub-api` |
| 数据库/Auth | MemFire，代码继续使用 Supabase 兼容变量名和 SDK |
| 图片 | `MEDIA_STORAGE_MODE=r2-first`，R2 优先、MemFire Storage 回源 |
| 监控 | `admin.html` 运行监控 + Cloudflare Observability/KV |
| Canvas | <https://infinite-canvas-jay.vercel.app/canvas> |

`prompt-hub.cn` 与 `api.prompt-hub.cn` 仅保留兼容，不是新功能验收主入口。

## 已验证基线

- 手机卡片库首批 12 张，向下滚动再分页；生产首屏约 1.54 MiB。
- 手机社区首屏渲染 12 张，滚动一次约 24 张；生产首屏约 1.79 MiB。
- 列表默认请求 `_grid` 缩略图，详情/下载才请求 full。
- `/prompts/` 刷新保持卡片库路由，不跳回社区。
- MemFire、R2、New API、运营监控和 Canvas 生图链路已接入。

## 架构约束

1. 根目录 loader 和 `legacy/`、`styles/`、`partials/` 是同一套源码的开发拆分；Pages 部署时会在 staging 合并。
2. `pack-*.js` 是生产包，脚本顺序是运行时契约；改入口后必须跑 `npm run check:predeploy`。
3. 卡片真源是 `user_data.data.cards`，本地 IndexedDB 只是快照；不得用空本地数组覆盖云端。
4. 图片 JSON 应保存 `storage://card-images/...`，签名 URL 只作短期展示缓存。
5. Worker Secrets 不进入 Git；前端只能保存公开 anon key。

## 近期重点

- 继续观察手机弱网首屏、图片 404 和第三方生图失败率。
- 会员/积分产品文案应与 `subscription.js`、`membership.js`、服务端规则保持一致。
- 对外开源前补充明确许可证；Canvas 的 AGPL 与 Prompt Hub 授权边界分开处理。

## 接手入口

```text
项目：D:\prompt-hub
主站：https://prompt-hubs.com
API：https://api.prompt-hubs.com
先读：docs/PROJECT_CONTEXT.md、docs/CURRENT-ISSUES.md、docs/AI-PITFALLS.md、docs/FILE-MAP.md
验证：npm run check:predeploy；server 运行 npm run typecheck && npm test
约束：不提交密钥或真实测试账号；不删除用户卡片/图片；改静态资源后再部署 Pages。
```
