# Prompt Hub

Prompt Hub（卡藏）是一个卡片式提示词仓库，包含卡片管理、社区、AI 生图、云同步、会员积分、运营后台、浏览器扩展和无限画布联动。

- Web: <https://prompt-hubs.com>
- API: <https://api.prompt-hubs.com>
- 文档入口: [`docs/README.md`](docs/README.md)

## 技术结构

| 层 | 实现 |
|---|---|
| 前端 | 原生 JavaScript/CSS，Cloudflare Pages |
| API | Hono + TypeScript，Cloudflare Workers |
| 数据库与认证 | MemFire（Supabase 兼容 API） |
| 图片 | Cloudflare R2 为主，MemFire Storage 回源 |
| 本地数据 | IndexedDB + localStorage |
| 监控 | Worker Observability + KV 聚合 + 运营后台 |

前端仍是经典脚本应用。源文件、拆分片段和生产 `pack-*.js` 都有明确加载顺序，不能直接改成 ESM 或随意移动根目录运行文件。详见 [`docs/FRONTEND-SPLIT-MAP.md`](docs/FRONTEND-SPLIT-MAP.md)。

## 本地开发

要求 Node.js 18+、PowerShell 7（Windows）以及已配置的 `server/.dev.vars`。

```powershell
cd D:\prompt-hub
npm ci
cd server
npm ci
cd ..
.\serve-local.ps1
```

打开 <http://127.0.0.1:5500>。登录、云同步和生图依赖本地 Worker `http://127.0.0.1:8787`；完整配置见 [`docs/LOCAL-DEV.md`](docs/LOCAL-DEV.md)。

## 验证

```powershell
npm run check:predeploy
cd server
npm run typecheck
npm test
```

`check:predeploy` 会检查拆分片段、脚本语法、模块接线、回归规则和生产包，不需要手工打开旧测试页。

## 部署

```powershell
# Pages：自动检查、构建、递增 build 并做线上冒烟
.\deploy-pages.ps1

# Worker：仅 server/ 有改动时
cd server
npm run deploy
```

部署与回滚步骤见 [`docs/DEPLOY-CHECKLIST.md`](docs/DEPLOY-CHECKLIST.md)。

## 仓库目录

| 路径 | 用途 |
|---|---|
| `index.html`, `*.js`, `*.css` | Pages 入口、运行时加载器及兼容入口 |
| `legacy/`, `styles/`, `partials/` | 大文件拆分后的源码片段 |
| `server/` | Worker API 与单元测试 |
| `supabase/` | MemFire/Supabase 兼容 SQL schema 与迁移 |
| `scripts/` | 构建、验证、备份和运营工具 |
| `extension/` | Chrome/Edge 扩展 |
| `docs/` | 当前文档；历史修复记录以 Git 历史为准 |

根目录运行文件看起来较多，是 Pages 经典脚本路径和缓存兼容约束，不应仅为目录美观移动。按任务找文件请看 [`docs/FILE-MAP.md`](docs/FILE-MAP.md)。

## 安全与授权

不要提交 `.env`、`.dev.vars`、`admin.local.env`、数据库密码、`service_role`、上游 API Key 或用户访问令牌。公开问题中也不要粘贴真实账号与 UUID；安全说明见 [`docs/DATA-SECURITY.md`](docs/DATA-SECURITY.md)。

当前仓库没有 `LICENSE` 文件，因此不能默认视为 MIT 或其他开源许可。对外分发或开放复用前，需要由项目所有者明确许可证和前后端授权边界。
