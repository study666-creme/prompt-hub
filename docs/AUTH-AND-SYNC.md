# 认证与云同步

> 主文件：`script.js`、`supabase-sync.js`、`cloud-sync-safety.js`

---

## 登录流程

```
authSignIn()
  → SupabaseSync.signIn(email, password)
  → completeAuthSession({ migrateGuest })
       → localStorage.removeItem('promptrepo_post_logout')
       → handleCloudAfterLogin()
            → restoreAccountPrivateData(uid)  // IDB / 本地快照
            → pullFromCloud()                 // user_data
            → mergePayload (cloud-sync-safety)
            → FeatureDraft.reconcileCommunityWithCards
            → refreshFeedsAfterCardsSync
```

`onAuthStateChange`（`script.js` + `supabase-sync.js`）：

- `SIGNED_IN`：defer `completeAuthSession`（避免 Supabase 死锁）
- `SIGNED_OUT`：设 `promptrepo_post_logout`，`purgeSignedOutLocalData`

**假登录问题（已修过一版）**：退出后 `promptrepo_post_logout=1` 时，旧逻辑会在再次登录时立刻 signOut；现改为有 session 时清除该标志。

---

## 账号切换

`handleCloudAfterLogin` 检测 `uidChanged` / `idbMismatch`：

- 清空 `cards`、`communityPosts`（`FeatureDraft.clearAllLocalFeatureData`）
- `resetIdbForAccountSwitch`
- 再 pull 新账号云数据

**勿**把 A 账号社区帖显示为 B 账号作者（见 `migrateCommunityAuthorIds`）。

---

## 云数据合并原则

`cloud-sync-safety.js`：

- **禁止**用空 `cards` / `communityPosts` 覆盖云端（`validatePush`）
- 同 id 合并取较新 `updatedAt`；图片取「更有内容」的一方
- `deletedCardTombstones`：本地删过的卡 id 不再从云复活

---

## 游客

- 卡片上限 **10**（`GUEST_CARD_LIMIT`）
- 登录后可 `migrateGuest`：把 session 里 pending 游客数据写入新账号

---

## 关键 localStorage

| 键 | 说明 |
|----|------|
| `promptrepo_last_uid` | 上次登录 uuid |
| `promptrepo_post_logout` | 退出后防串号 |
| `promptrepo_guest_session` | 游客有过卡片 |
| `promptrepo_pending_guest_migrate` | 待迁移 JSON |

---

## Supabase 表

- **Auth**：`auth.users`（邮箱登录）
- **业务 JSON**：`public.user_data`（`user_id`, `data`, `updated_at`）

拉取：`SupabaseSync.pullCloudData`  
推送：`SupabaseSync.pushCloudData`（登录后 debounce `scheduleCloudPush`）

---

## SyncOrchestrator（`sync-orchestrator.js` · 打包在 `pack-core.js`）

| API | 用途 |
|-----|------|
| `schedulePush` | 静默 push（默认 90s；urgent 350ms；非 urgent 跳过图片上传） |
| `schedulePull` | 后台 pull 防抖（登录/切页/定时同步） |
| `notifyCardsChanged` | `saveAllData` 后排队元数据 push |
| `requestFeedRefresh` | 防抖 800ms 刷新社区/生图 Feed（替代散落 `refreshFeedsAfterCardsSync`） |
| `cancelPending` | 退出/切账号时取消排队 push/pull |

`script.js`：`scheduleCloudPush` → 编排器；`scheduleDeferredCloudPull` → 编排器；需 **await pull 完成** 的路径仍直接 `runDeferredCloudPull`（如生图静默同步）。

---

## 相关文档

- 数据分层：`docs/DATA-MODEL.md`
- 社区与云 JSON 冲突：`docs/CURRENT-ISSUES.md`
- Supabase 手机/微信：`docs/SUPABASE-AUTH.md`
