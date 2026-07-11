# 运营监控

最后核对：2026-07-11

## 后台入口

- 页面：`https://prompt-hubs.com/admin.html`
- 位置：概览 → **运行监控**
- 接口：`GET /api/admin/dashboard/monitoring?hours=24`

## 卡片库巡检后台

- 页面：`https://prompt-hubs.com/admin.html` → **卡片库**
- 接口：
  - `GET /api/admin/cards/summary`
  - `GET /api/admin/cards?limit=20&offset=0&risk=all`
  - `GET /api/admin/cards?limit=20&offset=0&risk=all&checkImages=1`
- 定位：只读巡检云端 `user_data.data.cards`，帮助定位黑卡、灰卡、旧外链、路径串号、重复 ID 和空内容卡。
- 性能：后端会为卡片索引做 20 秒短缓存，并复用并发扫描；后台“刷新”按钮会带 `refresh=1` 强制重建。
- 安全边界：不会删除用户卡片或图片；“抽检本页图片”只检查当前分页里的 Storage/R2 图片是否真实存在。

## 存储巡检

- 位置：概览 → **存储用量** → **扫描存储**。
- 后台首次打开不会自动遍历对象桶，避免无意义的 R2 列表请求。
- `r2-first` / `r2` 扫描 Cloudflare R2，`supabase` 扫描 MemFire Storage。
- 统计只读；不能用全桶对象字节反写 `profiles.storage_bytes`，因为桶内还包含缩略图和生成仓库对象。
- 删除账号时会同时尝试清理 R2 与 MemFire Storage，避免留下不可归属对象。

## 现在能看什么

1. **Worker/API 错误**
   - 近 24 小时 API 4xx / 5xx、状态码分布、热门接口。
   - 5xx 和图片 404 会保留最近路径，便于定位是哪个接口炸。

2. **图片 404**
   - 覆盖 `/api/v1/media/*` 图片代理和 `/api/v1/generate/jobs/:jobId/image`。
   - 404 精确记录；成功图片请求按 20% 抽样并折算，避免监控写 KV 拖慢图片加载。

3. **生成失败率**
   - 从 `generation_requests` 汇总近 24 小时任务数、成功、失败、生成中、卡住超过 30 分钟。
   - 最近失败会展示 job、模型、provider、错误信息。

4. **Cloudflare 请求量**
   - 后台展示的是 Worker 自计数近似值，来源为 KV `PROMPT_HUB_METRICS`。
   - 正式账单、免费额度和 Pages 静态请求量仍以 Cloudflare 控制台 Analytics 为准。

5. **轻量运营流水**
   - 从 `credit_ledger`、`code_redemptions`、`payment_webhook_events` 读取近 24 小时积分消耗、退款、发放、兑换和支付 webhook 事件。

## Cloudflare 绑定

Worker 配置：

```toml
[[kv_namespaces]]
binding = "PROMPT_HUB_METRICS"
id = "37976970d22347fba80ca6c72238f6e7"
preview_id = "c2602858d4bd40a4b1603de6d7b4af22"
```

如果后台提示“Worker 自计数未启用”，检查：

1. `server/wrangler.toml` 是否包含上述 `kv_namespaces`。
2. Worker 是否已重新部署：`cd server && npm run deploy`。
3. Cloudflare → Workers & Pages → `prompt-hub-api` → Settings → Bindings 是否存在 `PROMPT_HUB_METRICS`。

## 注意

- 监控只读业务数据，不会删除卡片、图片或生成记录。
- KV 指标保留约 72 小时，后台默认展示 24 小时。
- 图片成功请求是抽样近似；图片 404、API 5xx、生图失败来自精确路径或数据库记录。
- 如果需要官方 Cloudflare Analytics API，可后续增加 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 后做 GraphQL 查询；当前版本不要求新增密钥。
