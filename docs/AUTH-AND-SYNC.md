# 认证与云同步

## 当前实现

生产认证和数据库使用 MemFire，但前端 SDK、环境变量和部分函数仍沿用 `Supabase` 命名。浏览器不直连数据库域名，而是通过 `https://api.prompt-hubs.com/supabase` 反代 Auth/REST/Storage。

当前仅启用邮箱密码登录；手机号和微信登录开关在 `supabase-config.js` 中为关闭状态。

## 登录流程

```text
authSignIn
  -> SupabaseSync.signIn
  -> completeAuthSession
     -> restoreAccountPrivateData
     -> pullFromCloud
     -> CloudSyncSafety.mergePayload
     -> refreshFeedsAfterCardsSync
```

`onAuthStateChange` 收到 `SIGNED_IN` 后延迟完成同步，避免在 Supabase SDK 回调中产生锁等待。`SIGNED_OUT` 会取消待执行的 push/pull，并清理当前账号的内存态。

## 数据真源与合并

| 数据 | 真源 | 本地作用 |
|---|---|---|
| 卡片、分组、设置 | `public.user_data.data` | IndexedDB 快照、离线启动 |
| 社区公共帖 | `public.community_posts` | 本地缓存和用户私有副本 |
| 积分、会员 | `public.profiles` + Worker | 仅展示缓存，不由前端写 |
| 生图任务 | `public.generation_requests` | pending/recent UI 缓存 |

`cloud-sync-safety.js` 负责：

- 拒绝空本地数组覆盖已有云端数据。
- 同 ID 内容按更新时间合并，并保留更完整的图片引用。
- 应用 `deletedCardTombstones`，防止已删卡片被旧设备复活。
- 在账号切换时隔离 UID 对应的本地快照。

## 同步编排

`sync-orchestrator.js` 打包进 `pack-core.js`，统一调度：

| API | 用途 |
|---|---|
| `schedulePush` | 防抖上传用户 JSON |
| `schedulePull` | 后台拉取云端更新 |
| `notifyCardsChanged` | 保存卡片后触发元数据同步 |
| `requestFeedRefresh` | 合并社区/生图刷新请求 |
| `cancelPending` | 退出或换号时取消任务 |

需要立即拿到新数据的流程可以直接等待 pull；普通保存不应同步阻塞 UI。

## 关键本地键

- `promptrepo_last_uid`: 最近账号 UID
- `promptrepo_post_logout`: 退出隔离标记
- `promptrepo_guest_session`: 游客数据存在标记
- `promptrepo_pending_guest_migrate`: 登录后待迁移游客数据
- `promptrepo_public_feed_cache`: 公共社区短期缓存

这些键不是云端备份。排障时清空它们可能暂时隐藏问题，不能作为正式修复。

## 验收

1. 本地 Worker `/health` 返回 `supabase: ok`。
2. 登录后创建一张不公开测试卡，等待同步完成。
3. 无痕窗口登录同账号，确认卡片出现且图片可加载。
4. 删除测试卡后再次跨窗口确认 tombstone 生效。
5. 验收不得使用或删除维护者已有卡片。
