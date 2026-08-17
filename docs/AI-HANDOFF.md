# AI 接手说明

## 2026-08-17 视频渠道与幂等恢复修复

- 视频模型可执行性由实时模型目录和管理渠道目录共同决定。渠道目录可用
  时，零条 active 渠道的视频模型不公开；恰好一条时保留稳定模型 ID 并
  在服务端绑定该渠道；多条时继续发布独立线路 ID。渠道目录自身不可读
  时，公共模型目录沿用基础目录，避免模型广场被清空，但付费提交在扣费
  和 New API POST 之前以 `ROUTING_UNAVAILABLE` 失败。
- Canvas 的 `clientRequestId` 现在持久化到视频任务 `meta`，同一用户由
  `generation_requests_video_client_request_id_uidx` 唯一约束。重复 POST
  返回原任务，不会二次扣费或二次提交；New API 请求同时携带
  `Idempotency-Key`。
- `GET /api/v1/video/requests/:clientRequestId` 是只读恢复接口。它返回原
  任务的真实 `processing`/`completed`/`failed` 状态和退款结果，不创建、
  重试或重放任务。
- New API 的 `无可用渠道 (distributor)` 属于提交前可确定拒绝。Canvas
  必须立即显示失败，不能把它当作传输丢包进入 `submission_unknown`；真正
  的断网、超时或未知 5xx 仍保持不重放的保护状态。
- 自动化只验证目录、解析、路由、幂等头、恢复状态和错误映射；真实 H3
  付费生成仍由维护者手工执行。

## 2026-08-17 Canvas 视频目录契约

- 画布视频入口由实时目录驱动；目录数量会随上游变化（本次部署时为 17
  个，2026-08-17 最终只读复核时为 18 个）。不要在浏览器或 Worker
  另维护一份模型名称黑名单，也不要把文档中的数量当作固定清单。
- Prompt Hub 视频中继同时接受原生 `size`/`seconds` 与兼容
  `resolution`/`duration`，并按目录声明的 `path` 组装 New API 请求。目录
  中的 `fixed` 参数（例如 H3 的 `async: true`、部分线路的 `n: 1` 和固定
  时长）由服务端补入。
- H3 只使用 `768`（`1376x768`）和 `1080p`（`1920x1080`）；`2K` 不是 H3
  选项。原生请求不能同时发送 H3 的原生字段与兼容字段。
- 入口还保留 Kling O3 Pro 的 `images`、`style_references`、
  `element_references`、`input_video` 角色字段，避免参考素材在中继校验
  时被丢弃。
- H3 的真实付费生成由维护者手工测试；自动化验证不得提交付费任务。

### 部署与生产验收

- Relay 实现提交为 `d63cf3c`（`fix: adapt canvas video requests to catalog
  contracts`）和 `91f4bbe`（`fix: support live S-2.5 video contract`）。
  Cloudflare Worker `prompt-hub-api` 已部署为版本
  `54b026c2-d474-4541-8118-833a7b2b33f7`，部署列表确认该版本承载 100%
  流量。
- 零费用验证：聚焦契约测试 15/15，完整 Worker 单测 28 个文件
  170/170，TypeScript、35/35 文档链接、根目录 bundle 构建和
  `git diff --check` 均通过。S-2.5 的实时契约为 4-30 秒、480p/720p、
  16:9/9:16/1:1，最多 30 张图片、10 个视频和 10 个音频参考。
- 2026-08-17 最终只读生产复核：Prompt Hub 公共目录版本
  `46006424e305c1e58e7ad3b0` 返回 45 个模型、其中 18 个视频模型；
  Canvas 归一化目录返回 63 个模型、其中 18 个视频模型，能力版本为
  `2026-08-17.4`。H3、`S-2.0mini-官转`、`S-2.0fast-官转` 均存在。
- Playwright 只读打开 `https://canvas.prompt-hubs.com/generate/video`，
  页面实际显示“18 个可用模型”；选择 H3 后模型 ID 为 `minimax_h3`，
  画面尺寸和分辨率选项仅为 `768` 与 `1080p`。Prompt Hub 图片生成页
  的三个模型分组合计实际渲染 8 个可用图片模型，目录接口
  `/api/v1/generate/models` 同样返回 8 个模型，且未显示目录不可用提示。
- 验收脚本拦截所有非 GET 请求；只拦截到 Cloudflare RUM 统计请求，
  没有发送生成 POST、H3 请求或任何付费任务。H3 真实生成仍由维护者
  执行。

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
- 卡藏 API 图片报价已经包含其加价，必须从上游人民币字段按 `1 元 = 100 积分`直接换算；不能再次加价、信任上游 credits 字段或复制一份手工积分表。
- `gpt-image-2-chat` 是内部兼容 ID，对外显示为“全能模型2 · 特价 1K”；它走 `/v1/chat/completions`，固定 1K 且暂不支持参考图或尺寸参数，不要改回图片 generations 协议。
- 实际 New API 渠道映射只允许运营后台经 `NEWAPI_CATALOG_ADMIN_SECRET` 读取；公开模型目录不得返回渠道、域名或任何凭据字段。
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
