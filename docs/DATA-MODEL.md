# 数据模型与存储分层

> 社区「DB 有帖、界面没有」类问题，先对照本表分清数据在哪一层。

---

## 四层存储

```
┌─────────────────────────────────────────────────────────┐
│ 1. Supabase Postgres                                     │
│    community_posts（全站公开 Feed，API 读）                 │
│    profiles, credit_ledger, generation_requests …        │
├─────────────────────────────────────────────────────────┤
│ 2. Supabase user_data（每用户一行 JSON）                  │
│    data.cards, data.communityPosts, data.creations …     │
├─────────────────────────────────────────────────────────┤
│ 3. Supabase Storage 桶 card-images                       │
│    {user_uuid}/{cardId}.jpg|webp|png                     │
├─────────────────────────────────────────────────────────┤
│ 4. 浏览器本地                                             │
│    IndexedDB（卡片快照）+ localStorage + sessionStorage   │
└─────────────────────────────────────────────────────────┘
```

---

## `community_posts` 表（全站社区）

迁移：`supabase/migrations/20260528180000_community_posts_public.sql`

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | text PK | 帖 id，常与 `cp_{cardId}` 或卡片 `communityPostId` 对应 |
| `author_id` | **uuid** | 必须对应 `auth.users.id`；**不能**存 `888` 字面量 |
| `author_name` | text | 展示名，可为邮箱前缀如 `2705367723` |
| `source_card_id` | text | 卡片库 card.id |
| `image` | text | 多为 `storage://card-images/{uuid}/…` |
| `published` | boolean | false = 下架 |

**RLS**：默认 deny；仅 **service_role**（Worker）读写。

**用户大号示例**：

- `author_id` = `ab5c77dc-570e-4af7-ac38-2d311be96244`
- `author_name` = `2705367723`

---

## `user_data.data` JSON（每账号私有）

| 字段 | 内容 |
|------|------|
| `cards` | 卡片库主数据 |
| `communityPosts` | 社区帖**副本**（与 `community_posts` 可能不一致） |
| `creations` | 生图历史 |
| `settings` | 含 `deletedCardTombstones` 等 |

合并逻辑：`cloud-sync-safety.js` → `mergePayload`。

---

## 卡片对象（cards[]）常用字段

| 字段 | 说明 |
|------|------|
| `id` | 本地生成 id |
| `prompt`, `title`, `image` | 内容与图 ref |
| `publishedToCommunity` | 是否意图发布 |
| `communityPostId` | 关联社区帖 id |
| `groupId`, `tags`, `pinned` | 仓库 UI |

---

## 图片引用格式

| 形式 | 说明 |
|------|------|
| `storage://card-images/{uuid}/{file}` | 私有桶，需签名 URL |
| `https://…` | 外链或已签名 |
| `data:image/…` | 本地未上传 |

签名：`GET /api/v1/media/community/sign?ref=…`（游客可读社区图）。

**404 原因**：Storage 无文件，或路径与 `cardId` 不一致（历史 `resolvePublicImageRef` 问题）。

---

## 生图参考图来源（referenceAssets）

`refImage` / `refImages` 仍然保存实际可用于生图的图片引用；`referenceAssets` 只保存来源元数据，用来让“填入生图”同时恢复参考图来源，便于后续签名、修复、追踪。

常见位置：

- 生图草稿：`localStorage` 的 `LS_IMAGEGEN`
- 生成中任务：`imageGenPendingJobs[]`
- 生图历史：`creations[]`
- 存入库卡片：`cards[]`

数组元素结构：

```json
{
  "ref": "storage://card-images/{uuid}/{file}",
  "sourceCardId": "card_or_creation_id",
  "jobId": "generation_job_id",
  "source": "feed"
}
```

约定：

- `ref` 必须与同下标的 `refImages[]` 对应；缺失时可按下标回填。
- `sourceCardId` 用于列表缩略图/原图签名时定位卡片资源。
- `jobId` 用于生图结果、MJ 四宫格和恢复任务之间的关联。
- `source` 目前常见为 `feed`、`upload`、`annotation`。

---

## 前端双列表（`features-draft.js`）

| 变量 | 来源 | 用途 |
|------|------|------|
| `publicFeedPosts` | API `getCommunityFeed` | 全站展示**应以之为准**（20260614b） |
| `communityPosts` | localStorage + 云 merge | 账号私有；`reconcile` 会裁剪 |

展示：`getAllCommunityPosts()` = merge(public, local, buildFromCards)。

---

## 历史事故：888 / 换号串号

1. 旧版退出不清 `communityPosts` / 卡片内存。
2. 换登小号 888，`upsert` 把 `author_name` 写成 888；图片路径仍是大号 UUID。
3. 888 卡片库为空，无法在 UI 删帖。
4. 清理：`scripts/purge-community-ghost-888.sql`（勿对 uuid 列用 `!~*` 正则）。

---

## 常用 SQL（Supabase SQL Editor）

**查看在线帖：**

```sql
SELECT id, author_id, author_name, source_card_id,
       left(prompt, 40) AS prompt, left(image, 80) AS image, created_at
FROM public.community_posts
WHERE published = true
ORDER BY created_at DESC
LIMIT 50;
```

**下架显示名 888：**

```sql
UPDATE public.community_posts
SET published = false, updated_at = now()
WHERE published = true AND trim(author_name) = '888';
```

**按用户查帖：**

```sql
SELECT * FROM public.community_posts
WHERE author_id = 'ab5c77dc-570e-4af7-ac38-2d311be96244'::uuid
  AND published = true;
```
