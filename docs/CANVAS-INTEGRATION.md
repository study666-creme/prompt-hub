# 无限画布 ↔ Prompt Hub 卡片库

> **画布仓库**：https://github.com/study666-creme/infinite-canvas-jay  
> **画布地址**：https://infinite-canvas-jay.vercel.app/canvas（`canvas.prompt-hubs.com` DNS 配好后再切）
> **本地路径**：`D:\canvas\infinite-canvas\web`  
> **卡藏站点**：https://prompt-hubs.com · API：https://api.prompt-hubs.com

## 功能（双向）

| 方向 | 操作 |
|------|------|
| 画布 → 卡片库 | 图片节点 **右键** → **存为 Prompt Hub 卡片**（提示词 + 图片上传 R2） |
| 卡片库 → 画布 | **插入素材** → Tab **Prompt Hub 卡片库** → 选卡（**有图：图片+提示词**；**纯文字：仅插入提示词节点**） |
| 画布生图 | **设置 → Prompt Hub** 连接账号后，画布内 **图片生成** 走卡藏模型，**积分在卡藏侧扣除**（无需自填第三方 API Key） |

## API（Worker `prompt-hub-api`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/extension/cards?page&limit&q&group&tag` | 分页列出当前用户卡片（含**纯提示词卡**；有图时含缩略图 CDN URL；MJ 优先四宫格封面） |
| GET | `/api/v1/extension/groups` | 当前用户卡片库文件夹列表 |
| GET | `/api/v1/extension/tags` | 当前用户附加标签列表 |
| GET | `/api/v1/extension/status` | 连接状态 + **积分余额** |
| GET | `/api/v1/generate/models` | 生图模型列表（与卡藏生图页一致） |
| GET | `/api/v1/generate/cost?model=&resolution=` | 单次生图积分报价 |
| POST | `/api/v1/generate` | 提交生图（**服务端扣积分**） |
| GET | `/api/v1/generate/jobs/:jobId?settle=1` | 轮询任务 / 取图 URL |
| GET | `/api/v1/generate/jobs/:jobId/image` | **画布拉成图**（Bearer 鉴权，Worker 从 R2 代理，避免浏览器 CDN `Failed to fetch`） |
| GET | `/api/v1/media/sign?ref=&variant=full` | 插入画布时拉原图 |
| POST | `/api/v1/extension/quick-card` | 画布 → 卡片库（与浏览器插件相同） |

CORS：已允许 `localhost`、`*.vercel.app`、`prompt-hubs.com`；`canvas.prompt-hubs.com` 已预放行，但 DNS 生效前不要作为前端入口。

## 画布内配置

1. 打开画布右上角 **设置**
2. 切到 **Prompt Hub** 标签
3. 填写与卡藏相同的 **邮箱 + 密码**，点 **连接 Prompt Hub**
4. API 默认 `https://api.prompt-hubs.com`（本地 `localhost:3000` 可直接联调）

## 首次推送到 GitHub（维护者本机）

仓库已创建，代码在本地 `D:\canvas\infinite-canvas` 分支 **`github-main`**（含 Prompt Hub 双向改动）。在 **PowerShell** 执行：

```powershell
cd D:\canvas\infinite-canvas
git checkout github-main
git push -u origin github-main:main --force
```

推送成功后打开 https://github.com/study666-creme/infinite-canvas-jay 应能看到 `web/`、`DEPLOY.md` 等文件。

> 若 `git push` 报 `missing object` 或浅克隆错误，勿推旧 `main` 分支，只用上面的 `github-main:main`。

## 部署画布（Vercel）

1. 导入 GitHub 仓库 https://github.com/study666-creme/infinite-canvas-jay
2. **Root Directory** = `web`（Vercel 控制台设置；仓库根目录勿放含 `rootDirectory` 的 `vercel.json`）
3. Framework：**Next.js** · Build：`npm run build`
4. 部署后打开 Vercel 域名 → **设置 → Prompt Hub** 填卡藏邮箱密码 → 验收：
   - **插入素材 → Prompt Hub 卡片库** → 选卡 → 节点含图 + 提示词
   - 图片节点 **右键 → 存为 Prompt Hub 卡片**
   - 文本/配置节点 **生图** → 消耗卡藏积分 → 画布出现图片节点

详细步骤见画布仓库 [DEPLOY.md](https://github.com/study666-creme/infinite-canvas-jay/blob/main/DEPLOY.md) 与 [OPEN-SOURCE.md](https://github.com/study666-creme/infinite-canvas-jay/blob/main/OPEN-SOURCE.md)（AGPL 须公开 fork，Prompt Hub 可独立闭源）。

## 本地开发

```powershell
cd D:\canvas\infinite-canvas\web
npm run dev
```

浏览器 `http://localhost:3000` → `/canvas`。

## 相关文件

### 画布侧

| 文件 | 说明 |
|------|------|
| `src/services/prompt-hub.ts` | 登录、列表、签名、存卡、**生图 API** |
| `src/services/prompt-hub-generation.ts` | 画布生图：提交 + 轮询 + 下载到节点 |
| `src/stores/use-prompt-hub-store.ts` | 会话持久化 |
| `src/components/layout/prompt-hub-settings-panel.tsx` | 设置页 |
| `src/app/(user)/canvas/components/asset-picker-modal.tsx` | 素材选择（含 Prompt Hub Tab） |
| `src/app/(user)/canvas/components/prompt-hub-cards-tab.tsx` | 卡片库浏览与插入 |

### Prompt Hub 侧

| 文件 | 说明 |
|------|------|
| `server/src/routes/v1/extension.ts` | `GET /extension/cards` + `POST /extension/quick-card` |
| `server/src/lib/extension-card.ts` | 列表 + 写卡 |
| `server/src/lib/cors-headers.ts` | 含 `*.vercel.app` |
| `extension/background.js` | 插件同款存卡 API |

## 注意

- 画布项目/图片默认在**访问者浏览器本地**；只有「存卡」与「从卡片库插入」会走云端 API + R2。
- 删卡 tombstone 与卡片库加载优化见 Prompt Hub `docs/PROJECT_CONTEXT.md`。

## 变更日志

| 日期 | 提交/构建 | 说明 |
|------|-----------|------|
| 2026-07-02 | 待 push | **fix**：`Maximum update depth exceeded` — 节点缩放 `handleNodeResize` 与 hover 工具栏 state 去重（见 `docs/ERROR-LOG.md` §3c） |
| 2026-07-02 | `766644e` | **feat**：所有节点 hover 显示工具栏（与视频节点一致） |
| 2026-07-02 | `f95de28` | **fix**：文本节点底部缩放手柄可被面板遮挡 → 提高手柄层级 |

本地验收：`cd D:\canvas\infinite-canvas\web` → `npm run dev` → 打开 `/canvas/:id`，悬停/选中节点缩放不应红屏。
