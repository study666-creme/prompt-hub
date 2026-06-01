# 当前问题与进度（2026-05-30）

> **接手顺序**：本文 → `PROJECT_CONTEXT.md` → `COMMUNITY-ARCHITECTURE.md` → `CARD-LOADING.md` → `AI-HANDOFF.md`  
> **重要**：用户控制台已证实——**布局/CSS 不是主因**，应先修 **JS 报错 + 图片签名 404**。

---

## 仓库构建号

| 项 | 值 |
|----|-----|
| 用户实测 | **`20260601r`**（修侧栏 JS 崩溃 + 去掉有害 hotfix） |
| Pages | https://prompt-hub.cn |
| API | https://api.prompt-hub.cn |
| Worker | `prompt-hub-api` |

---

## 根因结论（2026-05-30 · 用户 Console 截图）

之前多轮改 CSS / Masonry / 加载顺序（20260601l～q、`hotfix-community-layout.js`）**未解决**，因为页面在更底层就失败了：

```
图片签名 404 / API 断连
        ↓
图永远加载不出 → Masonry 算不出高度 → 中间空一大块
        ↓
renderCommunitySidePanel 内 JS 抛错 → 侧栏 body 写不进去 → 侧栏全黑
```

| 优先级 | 类型 | 证据 | 影响 |
|--------|------|------|------|
| **P0-1** | **JS 运行时错误** | `TypeError: Cannot read properties of null (reading 'assetId')` | **✅ 已修 20260601r**（`communityImgInitialSrc` 不再传 `null`） |
| **P0-2** | **图片签名 404** | Console 大量 sign 404 | **未完全解决** — 多为 Storage 文件不存在；已加强 `cardId`/`authorId` 传递 |
| **P0-3** | **API 不稳定** | `GET api.prompt-hub.cn/api/v1/me` → `ERR_CONNECTION_CLOSED` | 登录态/同步异常，加重签名失败 |
| ~~P2~~ | ~~纯 CSS / Masonry 调参~~ | 在 P0-1/2 未修前，改布局**治标不治本** | 用户反馈「搞了半天还是没修好」 |

### P0-1 代码位置（已定位，一行级）

`features-draft.js`：

```javascript
function communityImgInitialSrc(image) {
  return feedImgInitialSrc(image, null);  // ← null 导致 opts.assetId 抛错
}
```

`feedImgInitialSrc` 内访问 `opts.assetId`，**opts 为 null 时必崩**。  
侧栏打开时会调 `communityImgInitialSrc` → **`renderCommunitySidePanel` 中断** → 只剩标题、body 空。

**修复**：`communityImgInitialSrc(image, opts)` + 侧栏传入 `post.sourceCardId`（**20260601r**）

### P0-2 图片 404（仍可能存在）

1. **Storage 里文件已删**，DB/Feed 仍引用旧 `storage://` 路径（历史卡片 404，见下表 #2）
2. **Worker 签名逻辑**找不到路径（`cardId` / `authorId` 与真实路径不一致）
3. **Supabase bucket RLS** 或 Worker 用的 service key 权限不足
4. 签名 URL **过期**且前端缓存了坏 URL（次要；404 更像路径不存在）

### 用户界面现象 ↔ 根因对照

| 用户看到的 | 实际原因 |
|------------|----------|
| 侧栏只有标题、下面全黑 | P0-1 JS 崩 + 侧栏图 404 |
| 社区往下滚中间空一大块 | 图 404 → 卡片高度不对 → Masonry 错位 |
| 卡片库后面先有图、第一页还黑 | 部分路径能签/有缓存，大量 404；不是单纯加载顺序 |
| 用久了很卡 | 成百上千次 404 + 重试 + Masonry 重排 |

---

## 已做但未见效的尝试（记录避坑）

| 方向 | 构建/文件 | 为何无效 |
|------|-----------|----------|
| 社区侧栏 CSS、`community-workspace` | 20260601l～q | 侧栏 JS 已崩，CSS 救不了 |
| Masonry horizontalOrder、批量重排 | features-draft.js | 图没高度，重排仍空 |
| 首屏 24 张视觉序加载 | card-image-loader.js | 签名 404，顺序无意义 |
| `hotfix-community-layout.js` | index.html 已引入 | 未修 `communityImgInitialSrc(null)`；404 仍在 |

**教训**：Console 无红字、Network 签名 200 之前，**不要继续调 Masonry/CSS**。

---

## 建议修复顺序（下次开任务）

1. **修 P0-1**（1 行 + 侧栏传入 post 的 assetId）— 侧栏应立刻恢复文案/按钮  
2. **Network 抽 1 条 404 的 sign 请求**：复制完整 URL、ref 参数、响应 JSON  
3. **Worker 侧**查 `communityMediaSignHandler` / Storage 是否存在该 path  
4. **批量清理**无文件的社区帖（或 `markPathMissing` 后隐藏占位）  
5. P0-1/2 全绿后，再视情况微调 Masonry（若仍有缝）

---

## 控制台诊断（用户可复制）

```javascript
// 1. 构建号
window.__APP_BUILD__

// 2. 侧栏是否写入 HTML（点一张卡后跑）
document.getElementById('communitySideBody')?.innerHTML?.length
document.querySelector('#communitySideBody .community-side-prompt')

// 3. 复现 assetId 崩溃
try {
  window.FeatureDraft?.renderCommunitySidePanel?.(/* 需要 postId */)
} catch (e) { console.error(e) }

// 4. 看前 5 张社区图的 ref 与 src
[...document.querySelectorAll('#communityGrid img[data-image-ref]')].slice(0, 5).map(img => ({
  ref: img.dataset.imageRef,
  src: img.src?.slice(0, 80),
  ok: img.complete && img.naturalWidth > 8
}))

// 5. API 是否通
fetch('https://api.prompt-hub.cn/health').then(r => console.log('health', r.status))
fetch('https://api.prompt-hub.cn/api/v1/community/feed?limit=3').then(r => console.log('feed', r.status))

// 6. 手动测一条签名（把 REF 换成 Network 里 404 那条的 ref）
// await window.PromptHubApi.signCommunityMediaRef('storage://...', { authorId: '...', cardId: '...' })
```

---

## 其它已知问题

| # | 现象 | 备注 |
|---|------|------|
| 1 | 历史卡片 Storage 404 | 与 P0-2 同源，文件已删需重传或下架 |
| 2 | 首屏 3 秒内全清晰难 | 见 `CARD-LOADING.md`；前提是签名成功 |
| 3 | 大资产包浏览慢 | 199 张逐张解析 |

---

## 2026-06-06 其它已上线（独立）

生图 grace 轮询、社区交互不自动点赞、sign-batch、`_grid` 缩略图等——**不替代**上述 P0 修复。

---

## 改代码前约定

- 用户 2026-05-30 曾要求「只更新文档」；当前仍 **未闭环**。  
- 下次改动：**先 P0-1 一行 + 验证 Console 无 assetId 报错**，再查 404。  
- 勿再大块 CSS 重写。

---

*最后更新：2026-05-30 · 根据用户 Console 404 + TypeError 修正根因判断*
