# Prompt Hub 文档

这里仅保留当前架构、开发和运营仍会使用的文档。一次性故障说明、迁移当天清单和旧性能报告已经删除，历史可从 Git 查询。

## 从这里开始

| 文档 | 什么时候读 |
|---|---|
| [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) | 了解线上状态、部署拓扑和当前优先级 |
| [`AI-HANDOFF.md`](AI-HANDOFF.md) | 新 AI 或协作者接手任务 |
| [`CURRENT-ISSUES.md`](CURRENT-ISSUES.md) | 确认已知风险和回归基线 |
| [`FILE-MAP.md`](FILE-MAP.md) | 按功能定位代码 |
| [`AI-PITFALLS.md`](AI-PITFALLS.md) | 改前端加载、社区、同步或图片链路前 |

## 架构与数据

- [`BACKEND.md`](BACKEND.md): Worker 路由、依赖和 Secrets
- [`FRONTEND-SPLIT-MAP.md`](FRONTEND-SPLIT-MAP.md): 前端拆分、构建产物和脚本顺序
- [`DATA-MODEL.md`](DATA-MODEL.md): MemFire 表、用户 JSON、图片引用和本地缓存
- [`AUTH-AND-SYNC.md`](AUTH-AND-SYNC.md): 登录、账号切换和云同步
- [`COMMUNITY-ARCHITECTURE.md`](COMMUNITY-ARCHITECTURE.md): 社区数据流、分页和布局
- [`CARD-LOADING.md`](CARD-LOADING.md): 卡片/社区/生图列表的图片加载策略
- [`R2-MIGRATION.md`](R2-MIGRATION.md): 当前 R2/Storage 读写与恢复策略

## 开发与发布

- [`LOCAL-DEV.md`](LOCAL-DEV.md): 本地 Pages + Worker 联调
- [`DEPLOY-CHECKLIST.md`](DEPLOY-CHECKLIST.md): Pages/Worker 发布和回滚
- [`ARCHITECTURE-CHANGE-GUARD.md`](ARCHITECTURE-CHANGE-GUARD.md): 跨模块改动边界
- [`UI-GUIDELINES.md`](UI-GUIDELINES.md): 统一 UI 和动效基线
- [`adr/`](adr/): 已接受的架构决策

## 运维与安全

- [`OPERATIONS-MONITORING.md`](OPERATIONS-MONITORING.md): 后台监控与巡检
- [`DATA-SECURITY.md`](DATA-SECURITY.md): 密钥、RLS、备份与公开仓库规则
- [`MEMFIRE-MIGRATION.md`](MEMFIRE-MIGRATION.md): MemFire 备份、恢复和换库演练
- [`CUSTOM-DOMAIN.md`](CUSTOM-DOMAIN.md): 当前域名与 Cloudflare 路由
- [`SUPABASE-PROXY-SETUP.md`](SUPABASE-PROXY-SETUP.md): 旧 `.cn` 自建 Supabase 路线的应急说明
- [`OVERSEAS-FIRST.md`](OVERSEAS-FIRST.md): `.com` 主站与 `.cn` 兼容拓扑

## 产品与集成

- [`MEMBERSHIP-CREDITS.md`](MEMBERSHIP-CREDITS.md): 会员、积分和配额规则
- [`BROWSER-EXTENSION.md`](BROWSER-EXTENSION.md): 浏览器扩展架构
- [`CHROME-WEB-STORE.md`](CHROME-WEB-STORE.md): 扩展打包与上架
- [`CANVAS-INTEGRATION.md`](CANVAS-INTEGRATION.md): 无限画布联动
- [`VIDEO-CANVAS-EXPORT.md`](VIDEO-CANVAS-EXPORT.md): 视频画布导出提案，尚未全部实现
- [`TAOBAO-SELLING.md`](TAOBAO-SELLING.md): 激活码运营流程
- [`SEO.md`](SEO.md): 搜索引擎与站点元数据

## 维护规则

1. 不在文档中写真实测试账号、用户 UUID、数据库项目 ID或密钥。
2. 不为单次 bug 新建 `FIX-*`、`SUMMARY` 或 `HANDOVER`；稳定规则写入现有文档，事件细节留在提交记录。
3. 不长期硬编码“当前构建号”；仅 `PROJECT_CONTEXT.md` 和 `CURRENT-ISSUES.md` 可记录已验证 build。
4. 删除或重命名文档后，运行本地链接检查并更新本索引。
