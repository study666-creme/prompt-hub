# 图片迁 Cloudflare R2（治本 · 减 Supabase egress）

> **目标**：文件存 R2；浏览器仍走 `api.prompt-hub.cn/api/v1/media/...`；Supabase 只留 **Auth + 数据库**。  
> **当前**：~1GB 图在 Supabase `card-images`；迁一次成本最低。

---

## 为什么迁

| | Supabase Storage | Cloudflare R2 |
|--|------------------|---------------|
| 存储 ~1GB | Pro 含 100GB | **10GB 免费**，超出约 $0.015/GB/月 |
| **出站 egress** | 计入 Supabase 账单（你曾 64GB） | **永久免费** |
| 与现有 CDN | Worker 回源仍打 Supabase | Worker 回源打 R2，**不再烧 Supabase egress** |

---

## 架构（迁完后）

```
浏览器 → api.prompt-hub.cn/media/c|i/... → CF 边缘缓存
                ↓ cache miss
         Worker 读 R2（CARD_IMAGES_R2）
                ↓ 可选 fallback
         Supabase Storage（过渡期 / 双写）
```

环境变量 `MEDIA_STORAGE_MODE`：

| 值 | 行为 |
|----|------|
| `supabase`（默认） | 仅 Supabase，与现在一致 |
| `r2-first` | **先 R2，没有再 Supabase**（仅迁移过渡期；会烧 Supabase egress） |
| `r2` | **仅 R2**（`wrangler.toml` 当前默认；迁完或新图只写 R2 后用） |

---

## 第 1 步：Cloudflare 建 R2 桶

1. 登录 https://dash.cloudflare.com  
2. 左侧 **R2 object storage** → **Create bucket**  
3. 桶名：`prompt-hub-card-images`（与 `server/wrangler.toml` 一致）  
4. **Location**：选离用户近的（如亚太 APAC）  
5. **Public access**：保持 **关闭**（私有桶，只给 Worker 读）

### 创建 R2 API Token（同步脚本用）

1. R2 页 → **Manage R2 API Tokens** → **Create API Token**  
2. 权限：**Object Read & Write**，范围：该桶  
3. 记下 **Access Key ID**、**Secret Access Key**、**Account ID**

---

## 第 2 步：Worker 绑定 R2

`server/wrangler.toml` 已预留：

```toml
[[r2_buckets]]
binding = "CARD_IMAGES_R2"
bucket_name = "prompt-hub-card-images"
```

部署：

```powershell
cd d:\prompt-hub\server
npx wrangler deploy
```

确认 Cloudflare → Workers → `prompt-hub-api` → **Settings → Bindings** 里有 `CARD_IMAGES_R2`。

---

## 第 3 步：同步现有图片 Supabase → R2

**先完成** `docs/SUPABASE-BACKUP-BEGINNER.md` 备份。

在项目根创建 `scripts\admin.local.env`（勿提交 git）：

```env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

R2_ACCOUNT_ID=你的AccountID
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=prompt-hub-card-images
```

运行：

```powershell
cd d:\prompt-hub
node scripts/sync-supabase-to-r2.mjs
```

仅下载到本机、不上传 R2：

```powershell
node scripts/sync-supabase-to-r2.mjs --download-only --out backups\card-images
```

脚本结束会打印：扫描数、上传数、跳过数、失败数。

---

## 第 4 步：切换读路径（灰度）

在 Cloudflare Worker 变量里加（**Variables**，非 Secret 即可）：

```
MEDIA_STORAGE_MODE = r2-first
```

再部署 Worker。此时：

- 读图：**先 R2**，miss 再 Supabase  
- 写 grid 缩略图：**R2 + Supabase 双写**（有 R2 绑定时）

验收：

1. 登录 → 卡片库 / 社区 / 生图仓库有图  
2. Network 里图片仍是 `api.prompt-hub.cn/api/v1/media/...`  
3. Supabase Dashboard → **Usage → Egress** 增速明显变慢  

---

## 第 5 步：全量切 R2（可选）

确认 R2 对象数 ≈ Supabase 桶文件数后：

```
MEDIA_STORAGE_MODE = r2
```

观察 1～2 天无 404 激增后，Supabase Storage 可只当冷备份或逐步清空（**勿删未验证的数据**）。

---

## Plan B：现在先建 R2，6/25 再灌旧图

> 与 `docs/MEMFIRE-MIGRATION.md` Plan B 配套：**旧图**等 Supabase egress 解禁后批量同步；**现在**只搭好 R2 基础设施。

### 旧图以后迁 R2 会有问题吗？

**一般不会。** 原因：

| 点 | 说明 |
|----|------|
| **路径不变** | 库里仍是 `storage://card-images/{userId}/xxx.jpg`；同步脚本 **原样复制 key**，不改数据库 |
| **前端不变** | 浏览器仍走 `api.prompt-hub.cn/api/v1/media/...` |
| **工具已有** | `scripts/sync-supabase-to-r2.mjs` 会 **跳过 R2 已有** 的文件（新图已写入的不重复传） |
| **读策略** | 同步完设 `r2-first`：先 R2，没有再 MemFire（新上传的图） |

唯一要注意：**6/25 前不要用 `MEDIA_STORAGE_MODE=r2`（仅 R2）**，否则 MemFire 里新上传的图 Worker 读不到。过渡期用 **`r2-first`**。

### 第 A 步：现在就能做（只搭 R2，不切流量）

1. Cloudflare → **R2** → 建桶 `prompt-hub-card-images`（亚太 APAC，**Private**）  
2. R2 → **Manage R2 API Tokens** → 建 Token（Read & Write），记下 Account ID / Access Key / Secret（**6/25 跑同步脚本时用**，可先抄到 `scripts\admin.local.env`）  
3. 部署 Worker（`wrangler.toml` 已绑 `CARD_IMAGES_R2`）：

```powershell
cd d:\prompt-hub\server
npx wrangler deploy
```

4. Cloudflare → Workers → `prompt-hub-api` → **Bindings** 确认有 `CARD_IMAGES_R2`  
5. **先不要改** `MEDIA_STORAGE_MODE`（保持默认 `supabase` 或空），线上行为与现在一致

### 第 B 步：MemFire 迁库完成后（新图开始分流）

Cloudflare Worker → **Variables** 新增：

```
MEDIA_STORAGE_MODE = r2-first
```

再 `npx wrangler deploy`。此时：

- **读**：先 R2 → 没有再 MemFire（新上传走 MemFire 桶）  
- **Worker 写缩略图/grid**：R2 + MemFire **双写**（有 R2 绑定时）  
- **旧 Supabase 图**：仍 404，等 6/25 同步  

### 第 C 步：~6/25 Supabase 解封后（灌旧图）

```powershell
cd d:\prompt-hub
node scripts/sync-supabase-to-r2.mjs --download-only --out backups\card-images
node scripts/sync-supabase-to-r2.mjs
```

验收：脚本打印上传数；卡片库 + 社区旧图恢复。仍保持 `r2-first` 即可。

---

## 新上传何时走 R2

当前阶段：**Worker 侧** `materializeCommunityGridIfMissing` / grid 上传已双写 R2。  
**浏览器直传 Supabase**（`supabase-sync.js` `uploadCardImage`）仍写 Supabase — 下一迭代可改为经 Worker 上传 R2。

迁移期 `r2-first` 已保证 **读** 走 R2；新卡上传仍进 Supabase，同步脚本可定期增量跑，或开通后跑一次全量即可。

---

## 费用粗算（你当前 ~1GB）

| 项 | 月费 |
|----|------|
| R2 存储 1GB | **$0**（10GB 免费内） |
| R2 egress | **$0** |
| Supabase Pro（数据库+Auth） | **$25** |

---

## 回滚

Worker 变量改回：

```
MEDIA_STORAGE_MODE = supabase
```

`npx wrangler deploy` — 立即回到仅 Supabase 读。

---

## 相关文件

| 文件 | 作用 |
|------|------|
| `server/src/lib/r2-storage.ts` | R2 读/写/存在检查 |
| `server/src/lib/media-cdn.ts` | CDN 出图，接 r2-storage |
| `server/wrangler.toml` | R2 binding |
| `scripts/sync-supabase-to-r2.mjs` | 批量同步 |
| `docs/SUPABASE-BACKUP-BEGINNER.md` | 开通 Pro 当天备份 |

---

*更新：2026-06-06 · 构建号以 `window.__APP_BUILD__` 为准*
