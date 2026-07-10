# 数据模型与存储分层

## 四层数据

```text
MemFire Postgres/Auth
  profiles, user_data, community_posts, generation_requests,
  credit_ledger, activation_codes, membership_*, asset_packages ...

Cloudflare R2 / MemFire Storage
  card-images/{user_uuid}/...

Worker/CDN URL
  短期签名和边缘缓存，不是持久数据

浏览器
  IndexedDB 快照 + localStorage/sessionStorage UI 状态
```

## 核心表

| 表 | 用途 | 写入者 |
|---|---|---|
| `user_data` | 每用户一行 JSON：卡片、分组、设置和功能切片 | 用户 RLS/Worker |
| `profiles` | 会员、积分汇总、配额和统计 | Worker |
| `credit_ledger` | 积分流水 | Worker |
| `activation_codes`, `code_redemptions` | 卡密和核销 | Worker/admin |
| `generation_requests` | 生图任务、provider、结果和退款状态 | Worker |
| `community_posts` | 全站公开帖子 | Worker |
| `community_post_likes`, `community_notifications` | 点赞和通知 | Worker |
| `membership_task_*` | 任务进度与领取 | Worker |
| `asset_packages*` | 资产包和用户权益 | Worker |
| `site_settings` | 后台可配置模型目录 | Worker/admin |

Schema 真源是 `supabase/schema.sql` 与 `supabase/migrations/`。MemFire 使用 Supabase-compatible schema，所以目录名暂不改。

## 用户 JSON

`user_data.data` 常见字段：

- `cards`: 卡片主数据
- `customGroups`, `globalFields`: 仓库结构
- `settings`: 筛选、发布默认值、tombstone 等
- `communityPosts`: 当前账号社区副本
- `creations`: 生图历史/最近生成数据
- 其他功能切片由 `FeatureDraft.getCloudSlice` 合并

卡片常用字段包括 `id`、`title`、`prompt`、`image`、`cardImages`、`groupId`、`tags`、`pinned`、`updatedAt`、`publishedToCommunity`、`communityPostId`、`genJobId` 和 `referenceAssets`。

## 图片引用

| 形式 | 处理 |
|---|---|
| `storage://card-images/{uid}/{path}` | 推荐持久格式，需 Worker 签名 |
| `https://.../api/v1/media/...` | 短期 CDN 展示 URL，不回写 JSON |
| 第三方 `https://...` | 可展示但源站失效后无法恢复 |
| `data:image/...` | 本地待上传，不应长期同步到大 JSON |

`referenceAssets` 记录参考图来源元数据，`refImages` 保存真正提交上游的引用。数组索引、`sourceCardId` 和 `jobId` 要保持对应。

## 社区一致性

`community_posts` 是公共展示真源；`communityPosts` 是用户私有副本；卡片发布字段是意图。去重优先 `source_card_id`，不能仅按 prompt 文本合并不同作者帖子。

## 数据库查询示例

```sql
select id, author_id, source_card_id, published, created_at
from public.community_posts
where published = true
order by created_at desc
limit 50;
```

公开文档和脚本示例必须使用占位 UUID，不写真实用户 ID。
