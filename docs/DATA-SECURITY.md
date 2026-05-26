# 数据安全说明

本文说明 Prompt Hub 如何防止**数据丢失**、**越权读取**和**客户端篡改积分/激活码**。

## 数据存放位置

| 数据 | 存储 | 谁能读 | 谁能写 |
|------|------|--------|--------|
| 卡片、分组、设置、社区帖、创作 | `user_data.data` (JSON) | 仅本人 (RLS) | 仅本人 |
| 卡片图片 | Storage `card-images/{userId}/…`（**私有桶**） | 仅本人（登录后 `createSignedUrl`） | 仅本人路径 |
| 积分、会员 | `profiles` | 仅本人 | **仅 API**（`apply_credit_delta`） |
| 积分流水 | `credit_ledger` | 仅本人 | **仅 API** |
| 激活码 | `activation_codes` | 无人（客户端） | **仅 API** |
| 生图记录 | `generation_requests` | 仅本人 | **仅 API** |

## 前端防丢失（已实现）

1. **登录后先拉云端**，再决定是否清空本地；不会因「本地卡片为 0」就清空再拉取。
2. **切换账号前**对旧账号做 `snapshotLocalForUser` 本地备份。
3. **上传前校验**（`cloud-sync-safety.js`）：
   - 本地卡片为空但云端有卡 → **拒绝上传**
   - 本地社区/创作为空但云端有记录 → **拒绝上传**
4. **合并上传**：允许时按 `id` 合并本地与云端，避免多端少传一条就删掉云端条目。
5. **社区、创作、点赞收藏**已纳入 `user_data` 同步（`FeatureDraft.getCloudSlice`）。

## 数据库（需在 Supabase 执行）

1. 日常策略：`supabase/fix-policies.sql`
2. 一次性 GRANT：`scripts/apply-grants-once.sql`
3. 安全加固迁移：`supabase/migrations/20260526180000_data_security_hardening.sql`
4. 私有图片桶：`supabase/migrations/20260526190000_private_card_images.sql`

在 **SQL Editor** 中按顺序执行（迁移可单独跑最新一段）。

## API / Worker

- 兑换、生图、造码、里程碑领奖均走 **Cloudflare Worker**，使用 `sb_secret_`（service role），**禁止**把 secret 放进前端或 Git。
- `/health` 中 `supabase: ok` 表示 service role 与 GRANT 正常。
- 管理接口 `POST /api/admin/codes` 需 `ADMIN_API_KEY`。

## 运营与合规建议

1. **Supabase 控制台**开启 Point-in-Time Recovery（付费计划）作灾难恢复。
2. 淘宝发货前自测：注册 → 造码兑换 → 建卡 → 换浏览器登录 → 卡片仍在。
3. **不要**在 Supabase 给 `user_data` 加「所有人可读」策略。
4. 卡片图已改为**私有桶** + 短时签名 URL；云端 JSON 存 `storage://card-images/{path}` 引用，不存长期公开链接。
5. 演示社区帖（`MOCK_POSTS`）仅**未登录**时展示，登录后隐藏，且**不会**写入用户云数据。
6. 生产环境 API 的 `CORS_ORIGINS` 必须配置为你的 Pages 域名（未配置则拒绝跨域，不用 `*`）。

## 故障排查

| 现象 | 可能原因 |
|------|----------|
| 兑换 500 | Worker 用了 publishable 密钥；或未跑 `apply-grants-once.sql` |
| 云端同步失败：已阻止上传 | 保护生效：先点「同步」拉云端，或换设备登录恢复 |
| 积分显示 0 但兑换成功 | 网络未拉到 `profiles`；刷新或检查 API `/api/v1/me` |
| 社区帖换机没了 | 旧版仅 localStorage；登录并同步后写入 `user_data` |

## 部署检查清单

- [ ] Worker：`SUPABASE_SERVICE_ROLE_KEY` = `sb_secret_…`
- [ ] 已执行 `20260526180000_data_security_hardening.sql`
- [ ] 已执行 `20260526190000_private_card_images.sql`
- [ ] 前端已部署含 `cloud-sync-safety.js` + 签名 URL 的版本（`sw.js` v37+）
- [ ] Worker 已 `npm run deploy`（CORS / 速率限制 / 管理员密钥校验）
- [ ] `CORS_ORIGINS` 含你的 Pages 域名（`wrangler.toml` 或 Dashboard）
- [ ] `ADMIN_API_KEY` 仅保存在 Wrangler secrets，未提交仓库
