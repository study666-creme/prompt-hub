# AI 接手说明

## 最小阅读顺序

1. `PROJECT_CONTEXT.md`: 线上拓扑和当前 build。
2. `CURRENT-ISSUES.md`: 当前风险与已关闭问题。
3. `AI-PITFALLS.md`: 会导致白屏、丢数据或高流量的禁区。
4. `FILE-MAP.md`: 按任务定位文件。
5. 涉及跨模块改动时再读 `ARCHITECTURE-CHANGE-GUARD.md`。

不要读取或引用公开文档中的真实测试账号。需要登录验收时，由维护者在本机通过未跟踪环境变量或密码管理器提供凭据。

## 工作流程

1. `git status --short --branch`，先区分用户现有改动。
2. 用 `rg` 定位调用链，只精读相关函数和上下文。
3. 先复现或取得 Network/API/后台监控证据，再修改。
4. 改动范围按根因决定；共享同步、图片和 Feed 模块要补回归验证。
5. 运行根目录预部署检查；改 Worker 时再跑 typecheck 和 tests。
6. 只暂存本次文件，提交前复核没有密钥、凭据或用户数据。
7. 用户要求上线时，按 `DEPLOY-CHECKLIST.md` 部署并做生产冒烟。

## 常用定位

| 问题 | 先看 |
|---|---|
| 卡片库分页/图片 | `legacy/script/part-09.js`、`card-image-loader.js`、`mobile.js` |
| 社区数据/分页 | `community-public-feed.js`、`legacy/features-draft/part-01.js`、`server/src/lib/community-feed.ts` |
| 社区/主页布局 | `feed-layout.js`、`styles/features/` |
| 生图提交/轮询 | `imagegen-submit.js`、`imagegen-job-runner.js`、`server/src/routes/v1/generate.ts` |
| 图片签名/R2 | `card-image-loader.js`、`server/src/routes/v1/media.ts`、`server/src/lib/r2-storage.ts` |
| 登录/同步 | `supabase-sync.js`、`cloud-sync-safety.js`、`sync-orchestrator.js` |
| 后台 | `legacy/admin/`、`server/src/routes/admin/` |
| Canvas/扩展 | `server/src/routes/v1/extension.ts`、`docs/CANVAS-INTEGRATION.md` |

## 当前生图与计费边界

- 新任务只允许卡藏 API 的全能模型2/香蕉和 Apimart MJ；不要把旧 provider 重新放回公开目录。
- 卡藏 API 价格必须从上游人民币字段按 `1 元 = 100 积分`自动换算，不能信任或复制一份手工积分表。
- 报价与提交需要新鲜目录，目录不可用时必须在扣费前失败。
- GrsAI、iThink、Mooko 适配器只服务已落库历史任务恢复；删除前先确认生产库没有对应未完成任务。
- 后台存储巡检按需触发且只读；不得按全桶字节回填用户配额。

## 必跑命令

```powershell
cd D:\prompt-hub
npm run check:predeploy

cd server
npm run typecheck
npm test
```

静态站生产冒烟由 `deploy-pages.ps1` 自动执行。只改文档或未部署的维护脚本时，不需要递增 Pages build。

## 交付要求

- 说明改了什么、为何这样改、验证了什么。
- 未运行的测试必须明确说出。
- 不删除用户卡片、图片或数据库记录来“验证修复”。
- 不把本地 `.env`、账号、UUID、token、Cloudflare 缓存文件提交到公开仓库。
