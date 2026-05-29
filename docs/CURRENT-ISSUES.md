# 当前问题与进度总结（2026-05-29）

> 给接手 AI / 维护者：**先读本文**，再按 `docs/FILE-MAP.md` 定位代码。  
> 用户已要求暂停改代码；以下为实测仍存在的现象与已尝试方向。

---

## 用户核心诉求（仍未完全满足）

1. **大号 `2705367723@qq.com`**：Supabase `community_posts` 里约有 **15 条**已发布帖（`author_id = ab5c77dc-570e-4af7-ac38-2d311be96244`），但登录后社区 **只能看到 2～3 条**（含他人 `11111` 一条 + 自己新发的刀图等）。
2. **卡片库**：本地约有十几张卡，但与社区/云端历史 **不同步**；「同步卡片库 → 社区」提示已对齐，**无法把库里缺的卡从社区拉回来**（`restoreCardsFromCommunityFeed` 在仓库已加，用户侧部署后仍无效或未验证通过）。
3. **游客**：社区页长期 **「正在加载全站社区…」**，列表出不来（`20260614b` 仍报告如此）。
4. **布局**：登录后社区 Masonry **每隔几秒变大变小**（图片 onload 触发重排 + 历史动画逻辑）。
5. **历史脏数据**：旧版换号不清卡导致 `author_name=888` 等；用户已在 Supabase 执行 SQL 清理 888；**库里 author_id 已是正确 UUID**。

---

## 已确认的事实（非猜测）

| 事实 | 证据 |
|------|------|
| 社区帖在 DB 存在 | 用户 SQL：`SELECT … FROM community_posts WHERE published=true` 约 15 行，`author_id` 均为大号 UUID |
| 不是「全站只有 2 条」 | API/DB 有数据；是 **前端展示链路** 丢了大部分 |
| 888 已清理 | 用户执行 `scripts/purge-community-ghost-888.sql`（修正版，勿对 uuid 列用正则） |
| 部分图片 404 | 控制台 `api.prompt-hub.cn` 图片 404；Storage `card-images` 无对应文件 |
| 构建号 | 仓库 `index.html` → `window.__APP_BUILD__ = '20260614b'`，SW `prompt-hub-v208` |

---

## 根因分析（供下一位调试）

### A. 登录后看不到自己的社区帖

数据有 **三条并行通道**，展示时混在一起：

| 通道 | 变量/表 | 说明 |
|------|---------|------|
| 全站公开 Feed | `publicFeedPosts` + `GET /api/v1/community/feed` + 表 `community_posts` | **应以之为准** |
| 账号私有副本 | `communityPosts` + `user_data.data.communityPosts` | 登录 pull/push 合并 |
| 卡片库派生 | `buildPostsFromPublishedCards()` | 仅含本地 `__promptHubCards` 里勾了发布的卡 |

**疑似仍出问题的地方**（`features-draft.js`）：

1. `renderCommunityNow` 在 `publicFeedAt === 0` 时先显示 loading，若 `refreshPublicCommunityFeed` 失败则 **游客永远空白**。
2. `maybeReconcileCommunityWithCards` / `reconcileCommunityWithCards`：卡片库无对应 `source_card_id` 时，历史上会从 `communityPosts` **裁掉**自己的帖（`20260614b` 试图用 `publicFeedPosts` 分离，用户仍看不到 → **需验证 API 是否 200、publicFeedPosts 是否写入、getAllCommunityPosts 是否合并**）。
3. `filterCommunityPostsForDisplay` + `getDeletedCardTombstones`：删卡墓碑可能仍影响 **本地** `communityPosts`（公开 Feed 已加 `skipCardTombstones`，需确认线上是否已部署 `20260614b`）。
4. `CloudSyncSafety.mergeCommunityPostsList` 合并云端 JSON 时，可能用 **空/旧** 本地列表覆盖 API 结果（见 `cloud-sync-safety.js`）。

**调试建议（不改代码先验证）**：

```javascript
// 登录后 F12 Console
await window.PromptHubApi.getCommunityFeed({ limit: 80 })
// 应 ok:true，data.posts.length ≈ 15

window.FeatureDraft?.refreshPublicCommunityFeed?.({ force: true })
// 然后看 publicFeedPosts（若未 export，在 features-draft 断点或临时 log）

window.FeatureDraft // getAllCommunityPosts 需从模块暴露或 console 里看 community 列表长度
```

### B. 游客加载不出

1. `getCommunityFeed` → `publicGet` 网络/CORS/522（见 `docs/FIX-API-522-BEGINNER.md`）。
2. `publicFeedAt` 一直为 0 → UI 停在 loading（`renderCommunityNow` 早退逻辑）。
3. Service Worker 缓存旧 `features-draft.js`（需 Unregister + 强刷，版本号左下角应为 `20260614b`）。
4. Supabase 项目 **EXCEEDING USAGE LIMITS** 可能影响 Storage 签名，不一定阻塞 Feed JSON。

### C. 卡片库与社区脱节

- 卡片在 `user_data.data.cards`（JSON），社区帖在 `community_posts`（Postgres）。
- 「发布到社区」会写两边；**仅社区有、卡片库无** 时，需要 **从社区反建卡片**（`restoreCardsFromCommunityFeed`）或从 `user_data` / 本地备份恢复。
- 用户卡片库有 ~13 张，但多数 **未出现在社区 Feed**，与 DB 15 条不对应 → 可能云端 `cards` JSON 与本地 IDB 不一致。

### D. 布局抖动

- `layoutCommunityMasonry` + `bindCommunityGridImageRelayout`：每张图 load 触发 `scheduleCommunityLayout`。
- `20260614b` 已将 `transitionDuration` 改为 `0s` 并减少重复 bind，用户仍反馈抖动 → 可能未部署或 Masonry 与 `feed-layout-pending` 类切换仍触发重绘。

---

## 本轮已做改动（仓库内，用户侧效果未确认）

| 日期/构建 | 内容 |
|-----------|------|
| `20260613e`～`f` | 侧栏版本号；修复 `post_logout` 假登录；游客清 public feed 缓存 |
| `20260614a` | 社区顶栏/设置「同步卡片库」按钮 |
| `20260614b` | `publicFeedPosts` 与 `communityPosts` 分离；`restoreCardsFromCommunityFeed`；游客 Feed 失败回退缓存；Masonry 减动画 |
| Worker | `repairMisattributedCommunityAuthors`、`unpublishGhostCommunityPosts`（Feed 首屏时跑） |
| SQL | `scripts/purge-community-ghost-888.sql`（按 `author_name` / 图片路径归属下架） |

---

## 建议下一步（给接手者）

1. **先验证 API**：浏览器访问 `https://api.prompt-hub.cn/api/v1/community/feed?limit=80` 是否返回 15 条。
2. **再验证前端是否新构建**：左下角 `20260614b`，Network 里 `features-draft.js?v=20260614b`。
3. **在 `refreshPublicCommunityFeed` 成功后** 打印 `publicFeedPosts.length` 与 `getAllCommunityPosts().length`，定位是 API 问题还是 reconcile/merge 问题。
4. **卡片恢复**：若 API 有 15 条、`__promptHubCards` 仅 13 条且 id 对不上 `source_card_id`，应用 SQL 或脚本按 `source_card_id` 反写 `user_data.data.cards`（尚无官方迁移脚本）。
5. **暂勿再叠功能**：先修「登录/游客 Feed 展示 = API 结果」单一路径。

---

## 用户操作备忘（小白向）

```powershell
cd d:\prompt-hub
.\deploy-pages.ps1

cd d:\prompt-hub\server
npm run deploy
```

浏览器：F12 → Application → Service Workers → Unregister → Ctrl+F5。

设置入口：**卡片库** 页 → ⚙️ **字段 & 设置** → **社区** 区块（不是左侧「设置」外观面板）。
