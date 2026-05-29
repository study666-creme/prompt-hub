# 当前问题与进度（2026-05-29）

> **接手顺序**：本文 → `PROJECT_CONTEXT.md` → `AI-HANDOFF.md`

---

## 仓库构建号

| 项 | 值 |
|----|-----|
| `__APP_BUILD__` | **`20260616f`** |
| SW `CACHE` | **`prompt-hub-v244`** |
| Pages | https://prompt-hub.cn |
| API | https://api.prompt-hub.cn |

---

## 2026-05-29 晚已交付（构建 20260616d～f）

| 项 | 说明 |
|----|------|
| 社区/我发布布局 | 恢复 Masonry 瀑布流；≤3 列 `horizontalOrder` + 去 margin 减少留白 |
| 欣赏模式 | 关闭时取消未完成 onload，清空 caption，防遮罩/提示词残留 |
| 手机社区 | 隐藏「欣赏作品」按钮 |
| 同步卡片库 | UI 已移除（顶栏、设置、空状态） |
| 社区图 400 | 缺 `?token=` 的签名 URL 不再写入 `img.src` |
| 我发布的闪屏 | `renderCreations` 先比对签名再重绘 |
| 任务中心 | 每日 5 积分 + 邀请 50 积分保留；其它任务只给会员天数；**仅邀请**要绑手机 |
| 社区通知 | 服务端 `community_notifications` + `/community/notify`；点赞/收藏推作者 |

### 用户待做

1. Supabase 执行 `supabase/migrations/20260529120000_community_notifications.sql`
2. 硬刷新确认左下角 **20260616f**
3. 用另一账号点赞/收藏，作者刷新社区看铃铛

---

## 仍未解决（P0）

| # | 现象 |
|---|------|
| 1 | **发布开关像全局开关** — 单卡 `publishedToCommunity` 与 UI/云端不同步 |
| 2 | **他人社区图慢** — 偶发像没图，等 30s 或签名慢 |
| 3 | **卡片库整体偏慢** — 进库、拉图、云同步 |

---

## 控制台验证

```javascript
window.__APP_BUILD__  // 应为 20260616f
await window.PromptHubApi.getCommunityFeed({ limit: 20 })
await window.PromptHubApi.fetchCommunityNotifications?.({ limit: 10 })
```

---

*最后更新：2026-05-29*
