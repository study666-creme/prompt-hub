# 部署与验证清单

## 哪些内容需要部署

| 改动 | Pages | Worker |
|---|---:|---:|
| 前端 HTML/JS/CSS、扩展下载入口 | 是 | 否 |
| `server/src/**`, `server/wrangler.toml` | 否 | 是 |
| SQL migration | 否 | 先在目标数据库执行 |
| 仅 Markdown、维护脚本、测试 | 否 | 否 |
| 前后端契约同时变化 | 先 Worker | 再 Pages |

## 发布前

```powershell
cd D:\prompt-hub
git status --short --branch
npm run check:predeploy

cd server
npm run typecheck
npm test
```

只改前端时 Worker 检查可不跑；只改文档时两边都不用部署。确认未暂存 `.env`、凭据、备份、账号信息或无关用户改动。

## Worker

```powershell
cd D:\prompt-hub\server
npm run deploy
```

验证：

```powershell
Invoke-RestMethod https://api.prompt-hubs.com/health
Invoke-RestMethod 'https://api.prompt-hubs.com/api/v1/community/feed?limit=2&offset=0'
```

`/health` 应为 `ok: true`、`supabase: ok`。provider 显示 missing 只代表对应可选线路未配置。

## Pages

```powershell
cd D:\prompt-hub
.\deploy-pages.ps1
```

脚本会依次执行预部署检查、递增 build、构建 staging、Wrangler Pages 上传和生产 HTTP 冒烟。不要手工把整个仓库目录上传 Pages；staging 会排除文档、脚本和本地文件。

## 生产验收

1. 打开 <https://prompt-hubs.com> 并确认 `window.__APP_BUILD__` 是新值。
2. 卡片库：刷新 `/prompts/`，路由保持；手机首批 12 张并可继续滚动。
3. 社区：首批分页、排序切换、打开/关闭侧栏、继续滚动。
4. 生图：模型目录、参考图、提交、轮询、预览和入库。
5. 图片：列表走 grid；详情 full；Network 无连续 404/5xx。
6. 后台：运行监控和卡片库摘要能打开。

涉及认证/同步时，用专门测试数据跨无痕窗口验证，不删除现有卡片。

## 回滚

- Pages：Cloudflare Dashboard -> Workers & Pages -> Pages 项目 -> Deployments -> 选择上一个成功版本 -> Rollback。
- Worker：从 Git 切到已知良好提交后重新 `npm run deploy`；Secrets 不随 Git 回滚。
- 数据库：不要直接覆盖生产。先新建目标库恢复 dump，核对后再切 Worker Secrets。
- R2：删除或覆盖对象前先确认数据库引用和备份，恢复见 `R2-MIGRATION.md`。
